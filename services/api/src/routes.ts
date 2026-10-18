import { Router } from 'express';
import { z } from 'zod';
import {
  addressInput, addressUpdate, calendarQuery, couponValidateInput, createSubscriptionInput, deleteAccountInput,
  notificationPrefsInput, paginationQuery, pauseInput, productsQuery, profileUpdate, pushTokenInput, quoteInput,
  serviceabilityQuery, skipInput, supportTicketInput, updateAddressInput, updateFrequencyInput, updateItemsInput,
  uuid, verifyPaymentInput,
} from '@milk/validation';
import { authenticate, requireRole } from './auth';
import type { Deps } from './deps';
import { forbidden, notFound } from './errors';
import { asyncHandler, ok, validate } from './http';
import * as account from './services/account';
import * as addresses from './services/addresses';
import * as catalog from './services/catalog';
import * as deliveries from './services/deliveries';
import * as payments from './services/payments';
import * as subs from './services/subscriptions';
import { buildTestRouter } from './testing';

const idParam = z.object({ id: uuid });
const pageQuery = paginationQuery;

export function buildRouter(deps: Deps): Router {
  const r = Router();
  const auth = authenticate(deps.verifier, deps.db);
  const uid = (req: any) => req.auth!.userId as string;

  // Testing-only routes (test login, simulated payments). Mounted only when configured.
  r.use(buildTestRouter(deps));

  // ---------------- public
  r.get('/health', asyncHandler(async (_req, res) => {
    await deps.db.query('select 1');
    ok(res, { status: 'ok', paymentsConfigured: deps.payments.isConfigured(), time: deps.now().toISOString() });
  }));
  r.get('/products', validate(productsQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await catalog.listProducts(deps.db, q);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/products/:idOrSlug', asyncHandler(async (req, res) => ok(res, await catalog.getProduct(deps.db, req.params.idOrSlug))));
  r.get('/plans', asyncHandler(async (_req, res) => ok(res, await catalog.listPlans(deps.db))));
  r.get('/serviceability', validate(serviceabilityQuery, 'query'), asyncHandler(async (req, res) =>
    ok(res, await catalog.serviceability(deps.db, (req.query as any).postalCode))));
  r.get('/support/faqs', (_req, res) => ok(res, account.FAQS));

  // Razorpay webhook: raw body is captured by the JSON parser's verify hook in app.ts.
  r.post('/webhooks/razorpay', asyncHandler(async (req, res) => {
    const out = await payments.handleWebhook(
      deps, req.rawBody ?? Buffer.from(''), req.header('x-razorpay-signature'), req.header('x-razorpay-event-id') ?? undefined,
    );
    ok(res, out);
  }));

  // ---------------- authenticated
  r.use(auth);

  r.get('/me', asyncHandler(async (req, res) => ok(res, await account.getMe(deps, uid(req)))));
  r.put('/me', validate(profileUpdate), asyncHandler(async (req, res) => ok(res, await account.updateMe(deps, uid(req), req.body))));
  r.put('/me/notification-preferences', validate(notificationPrefsInput), asyncHandler(async (req, res) =>
    ok(res, await account.updatePrefs(deps, uid(req), req.body))));
  r.put('/me/push-token', validate(pushTokenInput), asyncHandler(async (req, res) => {
    await account.setPushToken(deps, uid(req), req.body.token);
    ok(res, { saved: true });
  }));
  r.delete('/me/push-token', asyncHandler(async (req, res) => { await account.setPushToken(deps, uid(req), null); ok(res, { removed: true }); }));
  r.post('/me/delete', validate(deleteAccountInput), asyncHandler(async (req, res) => ok(res, await account.deleteAccount(deps, uid(req)))));

  // addresses
  r.get('/addresses', asyncHandler(async (req, res) => ok(res, await addresses.listAddresses(deps.db, uid(req)))));
  r.post('/addresses', validate(addressInput), asyncHandler(async (req, res) => ok(res, await addresses.createAddress(deps.db, uid(req), req.body), undefined, 201)));
  r.patch('/addresses/:id', validate(idParam, 'params'), validate(addressUpdate), asyncHandler(async (req, res) =>
    ok(res, await addresses.updateAddress(deps.db, uid(req), req.params.id, req.body))));
  r.post('/addresses/:id/default', validate(idParam, 'params'), asyncHandler(async (req, res) =>
    ok(res, await addresses.updateAddress(deps.db, uid(req), req.params.id, { isDefault: true }))));
  r.delete('/addresses/:id', validate(idParam, 'params'), asyncHandler(async (req, res) => {
    await addresses.deleteAddress(deps.db, uid(req), req.params.id);
    res.status(204).end();
  }));

  // coupons
  r.post('/coupons/validate', validate(couponValidateInput), asyncHandler(async (req, res) =>
    ok(res, await subs.validateCoupon(deps, uid(req), req.body.code, req.body.subtotalMinor))));

  // subscriptions
  r.post('/subscriptions/quote', validate(quoteInput), asyncHandler(async (req, res) => ok(res, await subs.quoteSubscription(deps, uid(req), req.body))));
  r.post('/subscriptions', validate(createSubscriptionInput), asyncHandler(async (req, res) => {
    const out = await subs.createSubscription(deps, uid(req), req.body);
    ok(res, out, undefined, out.replay ? 200 : 201);
  }));
  r.get('/subscriptions', asyncHandler(async (req, res) => ok(res, await subs.listSubscriptions(deps, uid(req), (req.query.status as string) || undefined))));
  const sid = validate(idParam, 'params');
  r.get('/subscriptions/:id', sid, asyncHandler(async (req, res) => ok(res, await subs.getSubscription(deps, uid(req), req.params.id))));
  r.get('/subscriptions/:id/history', sid, asyncHandler(async (req, res) => ok(res, await subs.subscriptionHistory(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/checkout', sid, asyncHandler(async (req, res) => ok(res, await subs.getCheckout(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/renew', sid, asyncHandler(async (req, res) => ok(res, await subs.createRenewal(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/pause', sid, validate(pauseInput), asyncHandler(async (req, res) => ok(res, await subs.pauseSubscription(deps, uid(req), req.params.id, req.body))));
  r.post('/subscriptions/:id/resume', sid, asyncHandler(async (req, res) => ok(res, await subs.resumeSubscription(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/skip', sid, validate(skipInput), asyncHandler(async (req, res) => ok(res, await subs.skipDelivery(deps, uid(req), req.params.id, req.body.date))));
  r.post('/subscriptions/:id/unskip', sid, validate(skipInput), asyncHandler(async (req, res) => ok(res, await subs.unskipDelivery(deps, uid(req), req.params.id, req.body.date))));
  r.patch('/subscriptions/:id/items', sid, validate(updateItemsInput), asyncHandler(async (req, res) => ok(res, await subs.updateItems(deps, uid(req), req.params.id, req.body.items))));
  r.patch('/subscriptions/:id/schedule', sid, validate(updateFrequencyInput), asyncHandler(async (req, res) => ok(res, await subs.updateSchedule(deps, uid(req), req.params.id, req.body))));
  r.patch('/subscriptions/:id/address', sid, validate(updateAddressInput), asyncHandler(async (req, res) => ok(res, await subs.updateAddress(deps, uid(req), req.params.id, req.body.addressId))));
  r.post('/subscriptions/:id/cancel', sid, validate(z.object({ reason: z.string().trim().max(300).optional() })), asyncHandler(async (req, res) =>
    ok(res, await subs.cancelSubscription(deps, uid(req), req.params.id, req.body.reason))));
  r.post('/subscriptions/:id/deliveries/generate', sid, validate(z.object({ days: z.number().int().min(1).max(45).optional() })), asyncHandler(async (req, res) =>
    ok(res, await subs.generateForUser(deps, uid(req), req.params.id, req.body.days))));

  // deliveries
  r.get('/deliveries', validate(calendarQuery, 'query'), asyncHandler(async (req, res) => ok(res, await deliveries.listDeliveries(deps, uid(req), req.query as any))));
  r.get('/deliveries/upcoming', asyncHandler(async (req, res) => ok(res, await deliveries.upcoming(deps, uid(req)))));
  r.get('/deliveries/:id', sid, asyncHandler(async (req, res) => ok(res, await deliveries.getDelivery(deps, uid(req), req.params.id))));

  // payments
  r.post('/payments/verify', validate(verifyPaymentInput), asyncHandler(async (req, res) => ok(res, await payments.verifyCheckout(deps, uid(req), req.body))));
  r.post('/payments/orders/:id/reconcile', sid, asyncHandler(async (req, res) => ok(res, await payments.reconcileOrder(deps, uid(req), req.params.id))));
  r.get('/payments', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await payments.listPayments(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/invoices', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await payments.listInvoices(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/invoices/:id', sid, asyncHandler(async (req, res) => ok(res, await payments.getInvoice(deps, uid(req), req.params.id))));
  r.get('/invoices/:id/receipt', sid, asyncHandler(async (req, res) => {
    const inv = await payments.getInvoice(deps, uid(req), req.params.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.html"`);
    res.send(payments.renderReceiptHtml(inv));
  }));

  // notifications
  r.get('/notifications', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total, unread } = await account.listNotifications(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total, unread });
  }));
  r.post('/notifications/read-all', asyncHandler(async (req, res) => { await account.markAllRead(deps, uid(req)); ok(res, { done: true }); }));
  r.post('/notifications/:id/read', sid, asyncHandler(async (req, res) => { await account.markRead(deps, uid(req), req.params.id); ok(res, { done: true }); }));

  // support
  r.get('/support/tickets', asyncHandler(async (req, res) => ok(res, await account.listTickets(deps, uid(req)))));
  r.post('/support/tickets', validate(supportTicketInput), asyncHandler(async (req, res) => ok(res, await account.createTicket(deps, uid(req), req.body), undefined, 201)));

  // ---------------- operations (admin role only; there is no admin UI in this release)
  const admin = Router();
  admin.use(requireRole('admin'));
  admin.patch('/deliveries/:id/status', sid, validate(z.object({
    status: z.enum(['pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled']), reason: z.string().max(300).optional(),
  })), asyncHandler(async (req, res) => ok(res, await deliveries.setDeliveryStatus(deps, uid(req), req.params.id, req.body.status, req.body.reason))));
  admin.post('/payments/:id/refund', sid, validate(z.object({ amountMinor: z.number().int().positive().optional() })), asyncHandler(async (req, res) =>
    ok(res, await payments.refundPayment(deps, uid(req), req.params.id, req.body.amountMinor))));
  r.use('/admin', admin);

  return r;
}

export { forbidden, notFound };
