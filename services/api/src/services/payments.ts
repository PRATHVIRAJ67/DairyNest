import crypto from 'node:crypto';
import { formatINR } from '@milk/shared';
import { camel } from '../db';
import type { Deps } from '../deps';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../errors';
import { audit, activateAfterCapture } from './subscriptions';

type CaptureArgs = { providerOrderId: string; providerPaymentId: string; amountMinor: number; method?: string };

/** Single entry point that turns a provider-confirmed capture into paid state. Idempotent. */
export async function applyCapture(deps: Deps, a: CaptureArgs) {
  const res = (await deps.db.query<{ r: any }>(`select fn_apply_payment_capture($1,$2,$3,$4) r`, [
    a.providerOrderId, a.providerPaymentId, a.amountMinor, a.method ?? null,
  ])).rows[0].r;
  if (!res.already_processed) {
    if (res.subscription_id) await activateAfterCapture(deps, res.subscription_id);
    await deps.notifier.notify(deps.db, {
      userId: res.user_id, type: 'payment.success', category: 'paymentUpdates',
      title: 'Payment received', body: `We received ${formatINR(a.amountMinor)}. Your deliveries are confirmed.`,
      data: { subscriptionId: res.subscription_id, paymentId: res.payment_id },
    });
    await audit(deps.db, res.user_id, 'payment.captured', 'payment', res.payment_id, { providerPaymentId: a.providerPaymentId, amountMinor: a.amountMinor });
  }
  return { alreadyProcessed: !!res.already_processed, subscriptionId: res.subscription_id as string | null };
}

export async function applyFailure(deps: Deps, providerOrderId: string, providerPaymentId: string, amountMinor: number, reason?: string) {
  const res = (await deps.db.query<{ r: any }>(`select fn_apply_payment_failure($1,$2,$3,$4) r`, [providerOrderId, providerPaymentId, amountMinor, reason ?? null])).rows[0].r;
  if (!res.ignored) {
    await deps.notifier.notify(deps.db, {
      userId: res.user_id, type: 'payment.failed', category: 'paymentUpdates',
      title: 'Payment failed', body: 'Your payment did not go through. You can try again from the subscription page.',
      data: { subscriptionId: res.subscription_id },
    });
  }
  return { ignored: !!res.ignored };
}

async function findOrder(deps: Deps, userId: string, providerOrderId: string) {
  const o = (await deps.db.query<any>(`select id, amount_minor, status, subscription_id from payment_orders where provider_order_id=$1 and user_id=$2`, [providerOrderId, userId])).rows[0];
  if (!o) throw notFound('Payment order');
  return o;
}

/**
 * Client reports a checkout result. The signature proves Razorpay produced it, and we STILL confirm
 * the payment status and amount with the provider before marking anything paid.
 */
export async function verifyCheckout(deps: Deps, userId: string, v: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
  const order = await findOrder(deps, userId, v.razorpay_order_id);
  const valid = deps.payments.verifyCheckoutSignature({ orderId: v.razorpay_order_id, paymentId: v.razorpay_payment_id, signature: v.razorpay_signature });
  if (!valid) {
    await audit(deps.db, userId, 'payment.signature_invalid', 'payment_order', order.id, { providerPaymentId: v.razorpay_payment_id });
    throw badRequest('Payment signature could not be verified', 'INVALID_SIGNATURE');
  }
  const p = await deps.payments.fetchPayment(v.razorpay_payment_id);
  if (p.orderId !== v.razorpay_order_id || p.amountMinor !== order.amount_minor)
    throw badRequest('Payment does not match this order', 'PAYMENT_MISMATCH');
  if (p.status === 'captured') {
    const r = await applyCapture(deps, { providerOrderId: v.razorpay_order_id, providerPaymentId: p.id, amountMinor: p.amountMinor, method: p.method });
    return { status: 'paid' as const, subscriptionId: r.subscriptionId };
  }
  if (p.status === 'failed') {
    await applyFailure(deps, v.razorpay_order_id, p.id, p.amountMinor, p.errorDescription);
    return { status: 'failed' as const, subscriptionId: order.subscription_id };
  }
  return { status: 'pending' as const, subscriptionId: order.subscription_id };
}

/** Pull the latest state from the provider for an order (used when a webhook was missed). */
export async function reconcileOrder(deps: Deps, userId: string, paymentOrderId: string) {
  const o = (await deps.db.query<any>(`select id, provider_order_id, status, subscription_id from payment_orders where id=$1 and user_id=$2`, [paymentOrderId, userId])).rows[0];
  if (!o) throw notFound('Payment order');
  if (!o.provider_order_id) return { status: o.status as string, changed: false };
  const payments = await deps.payments.fetchOrderPayments(o.provider_order_id);
  let changed = false;
  for (const p of payments) {
    if (p.status === 'captured') changed = !(await applyCapture(deps, { providerOrderId: o.provider_order_id, providerPaymentId: p.id, amountMinor: p.amountMinor, method: p.method })).alreadyProcessed || changed;
    else if (p.status === 'failed') await applyFailure(deps, o.provider_order_id, p.id, p.amountMinor, p.errorDescription);
  }
  const fresh = (await deps.db.query<any>(`select status from payment_orders where id=$1`, [o.id])).rows[0];
  return { status: fresh.status as string, changed };
}

// ---------------------------------------------------------------- webhooks

export async function handleWebhook(deps: Deps, rawBody: Buffer, signature: string | undefined, eventIdHeader: string | undefined) {
  if (!deps.payments.verifyWebhookSignature(rawBody, signature)) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('Invalid JSON', 'INVALID_JSON');
  }
  const eventId = eventIdHeader || crypto.createHash('sha256').update(rawBody).digest('hex');
  const eventType: string = payload.event ?? 'unknown';
  const ins = await deps.db.query<{ id: string }>(
    `insert into payment_webhook_events (provider, event_id, event_type, payload) values ('razorpay',$1,$2,$3) on conflict (provider, event_id) do nothing returning id`,
    [eventId, eventType, JSON.stringify(payload)],
  );
  let rowId = ins.rows[0]?.id;
  if (!rowId) {
    const prev = (await deps.db.query<any>(`select id, status from payment_webhook_events where provider='razorpay' and event_id=$1`, [eventId])).rows[0];
    if (prev.status === 'processed' || prev.status === 'ignored') return { duplicate: true };
    rowId = prev.id; // earlier attempt failed: retry
  }
  try {
    const outcome = await processWebhookEvent(deps, eventType, payload);
    await deps.db.query(`update payment_webhook_events set status=$1, processed_at=now(), error=null where id=$2`, [outcome, rowId]);
    return { duplicate: false, outcome };
  } catch (e: any) {
    await deps.db.query(`update payment_webhook_events set status='failed', error=$1 where id=$2`, [String(e?.message ?? e).slice(0, 500), rowId]);
    throw e; // non-2xx so the provider retries
  }
}

async function processWebhookEvent(deps: Deps, type: string, payload: any): Promise<'processed' | 'ignored'> {
  const pay = payload?.payload?.payment?.entity;
  if ((type === 'payment.captured' || type === 'order.paid') && pay) {
    const known = (await deps.db.query(`select 1 from payment_orders where provider_order_id=$1`, [pay.order_id])).rows[0];
    if (!known) return 'ignored';
    await applyCapture(deps, { providerOrderId: pay.order_id, providerPaymentId: pay.id, amountMinor: pay.amount, method: pay.method });
    return 'processed';
  }
  if (type === 'payment.failed' && pay) {
    const known = (await deps.db.query(`select 1 from payment_orders where provider_order_id=$1`, [pay.order_id])).rows[0];
    if (!known) return 'ignored';
    await applyFailure(deps, pay.order_id, pay.id, pay.amount, pay.error_description);
    return 'processed';
  }
  if (type.startsWith('refund.') && payload?.payload?.refund?.entity) {
    const paymentId = payload.payload.refund.entity.payment_id;
    const exists = (await deps.db.query(`select 1 from payments where provider_payment_id=$1`, [paymentId])).rows[0];
    if (!exists) return 'ignored';
    const p = await deps.payments.fetchPayment(paymentId);
    if (p.amountRefundedMinor > 0) await deps.db.query(`select fn_apply_refund($1,$2)`, [paymentId, p.amountRefundedMinor]);
    return 'processed';
  }
  return 'ignored';
}

// ---------------------------------------------------------------- refunds (admin)

export async function refundPayment(deps: Deps, actorId: string, paymentId: string, amountMinor?: number) {
  const p = (await deps.db.query<any>(`select id, user_id, provider_payment_id, amount_minor, refunded_minor, status from payments where id=$1`, [paymentId])).rows[0];
  if (!p) throw notFound('Payment');
  if (!['captured', 'partially_refunded'].includes(p.status)) throw conflict('Only captured payments can be refunded', 'INVALID_STATE');
  const amount = amountMinor ?? p.amount_minor - p.refunded_minor;
  if (amount <= 0 || amount > p.amount_minor - p.refunded_minor) throw unprocessable('Refund amount exceeds the refundable balance', 'REFUND_EXCEEDS');
  const r = await deps.payments.refund({ paymentId: p.provider_payment_id, amountMinor: amount });
  await deps.db.query(`select fn_apply_refund($1,$2)`, [p.provider_payment_id, p.refunded_minor + amount]);
  await audit(deps.db, actorId, 'payment.refund_requested', 'payment', p.id, { amountMinor: amount, providerRefundId: r.id });
  await deps.notifier.notify(deps.db, {
    userId: p.user_id, type: 'payment.refund', category: 'paymentUpdates', title: 'Refund initiated',
    body: `A refund of ${formatINR(amount)} has been initiated to your original payment method.`, data: { paymentId: p.id },
  });
  return { refundId: r.id, status: r.status, amountMinor: amount };
}

// ---------------------------------------------------------------- history + receipts

export async function listPayments(deps: Deps, userId: string, page: number, pageSize: number) {
  const total = (await deps.db.query<{ n: number }>(`select count(*)::int n from payment_orders where user_id=$1`, [userId])).rows[0].n;
  const r = await deps.db.query(
    `select o.id, o.subscription_id, o.amount_minor, o.subtotal_minor, o.discount_minor, o.status order_status, o.period_start::text period_start,
            o.period_end::text period_end, o.created_at,
            p.id payment_id, p.provider_payment_id, p.status payment_status, p.method, p.failure_reason, p.refunded_minor,
            i.id invoice_id, i.invoice_number
     from payment_orders o
     left join lateral (select * from payments where payment_order_id=o.id order by created_at desc limit 1) p on true
     left join invoices i on i.payment_id = p.id
     where o.user_id=$1 order by o.created_at desc limit $2 offset $3`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  const rows = camel<any[]>(r.rows).map((x) => ({
    ...x,
    // One status the app can show: refund > captured > failed > pending
    status: x.paymentStatus === 'refunded' || x.paymentStatus === 'partially_refunded' ? x.paymentStatus
      : x.paymentStatus === 'captured' ? 'paid' : x.paymentStatus === 'failed' ? 'failed' : x.orderStatus === 'expired' ? 'expired' : 'pending',
  }));
  return { items: rows, total };
}

export async function listInvoices(deps: Deps, userId: string, page: number, pageSize: number) {
  const total = (await deps.db.query<{ n: number }>(`select count(*)::int n from invoices where user_id=$1`, [userId])).rows[0].n;
  const r = await deps.db.query(
    `select id, invoice_number, amount_minor, subscription_id, issued_at from invoices where user_id=$1 order by issued_at desc limit $2 offset $3`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  return { items: camel(r.rows), total };
}

export async function getInvoice(deps: Deps, userId: string, id: string) {
  const r = await deps.db.query(
    `select i.id, i.invoice_number, i.amount_minor, i.lines, i.issued_at, p.provider_payment_id, p.method, p.status payment_status, p.refunded_minor,
            pr.full_name, pr.phone, pr.email
     from invoices i join payments p on p.id=i.payment_id join profiles pr on pr.id=i.user_id where i.id=$1 and i.user_id=$2`,
    [id, userId],
  );
  if (!r.rows[0]) throw notFound('Invoice');
  return camel<any>(r.rows[0]);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderReceiptHtml(inv: any): string {
  const lines = inv.lines ?? {};
  const rows = (lines.items ?? [])
    .map((i: any) => `<tr><td>${esc(i.name)}</td><td class="r">${esc(i.quantity)} / delivery</td><td class="r">${formatINR(i.unitPriceMinor)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv.invoiceNumber)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#17301f;margin:32px;max-width:640px}h1{color:#1f5c3a;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:8px 0;border-bottom:1px solid #e8e4d6}.r{text-align:right}.muted{color:#6b7a70;font-size:13px}.total td{font-weight:700;border-bottom:0}</style></head><body>
<h1>Receipt</h1><p class="muted">${esc(inv.invoiceNumber)} &middot; ${new Date(inv.issuedAt).toISOString().slice(0, 10)}</p>
<p>${esc(inv.fullName)}<br><span class="muted">${esc(inv.phone ?? inv.email ?? '')}</span></p>
<p class="muted">Billing period ${esc(lines.periodStart)} to ${esc(lines.periodEnd)}</p>
<table>${rows}
<tr><td colspan="2">Subtotal</td><td class="r">${formatINR(lines.subtotalMinor ?? inv.amountMinor)}</td></tr>
<tr><td colspan="2">Discounts</td><td class="r">- ${formatINR(lines.discountMinor ?? 0)}</td></tr>
<tr class="total"><td colspan="2">Total paid</td><td class="r">${formatINR(inv.amountMinor)}</td></tr></table>
<p class="muted">Payment reference: ${esc(inv.providerPaymentId)} (${esc(inv.method ?? 'online')})${inv.refundedMinor ? ` &middot; Refunded: ${formatINR(inv.refundedMinor)}` : ''}</p>
<p class="muted">Amounts are in Indian Rupees. This receipt is a payment confirmation, not a GST tax invoice.</p></body></html>`;
}
