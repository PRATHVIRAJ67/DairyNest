import {
  BILLING_PERIOD_DAYS,
  addDays,
  canTransition,
  couponDiscount,
  diffDays,
  earliestChangeableDate,
  isBeforeCutoff,
  isScheduledOn,
  priceSubscription,
  scheduledDates,
  zonedNow,
  type CouponRule,
  type ISODate,
  type PriceBreakdown,
  type ScheduleRule,
  type SubscriptionStatus,
} from '@milk/shared';
import type { CreateSubscriptionInput, QuoteInput } from '@milk/validation';
import { camel, type Db, type Queryable } from '../db';
import type { Deps } from '../deps';
import { badRequest, conflict, notFound, unprocessable } from '../errors';
import { paymentsNotConfigured } from '../payments/provider';

const DEFAULT_CUTOFF = '21:00';
const DEFAULT_TZ = 'Asia/Kolkata';
const MAX_START_AHEAD_DAYS = 60;
export const GENERATE_HORIZON_DAYS = 14;

export const SUB_COLS = `s.id, s.user_id, s.plan_id, s.address_id, s.status, s.frequency, s.weekdays,
  s.start_date::text start_date, s.schedule_anchor::text schedule_anchor,
  s.current_period_start::text current_period_start, s.current_period_end::text current_period_end,
  s.paid_through::text paid_through, s.delivery_balance, s.coupon_id, s.cancelled_at, s.cancel_reason, s.created_at,
  a.zone_id, coalesce(to_char(z.cutoff_time,'HH24:MI'), '${DEFAULT_CUTOFF}') cutoff_time,
  coalesce(z.timezone, '${DEFAULT_TZ}') timezone`;
const SUB_FROM = `from subscriptions s join addresses a on a.id = s.address_id left join delivery_zones z on z.id = a.zone_id`;

export interface SubRow {
  id: string; user_id: string; plan_id: string | null; address_id: string; status: SubscriptionStatus;
  frequency: 'daily' | 'alternate_days' | 'weekdays'; weekdays: number[] | null; start_date: ISODate;
  schedule_anchor: ISODate; current_period_start: ISODate | null; current_period_end: ISODate | null;
  paid_through: ISODate | null; delivery_balance: number; coupon_id: string | null;
  cancelled_at: Date | null; cancel_reason: string | null; created_at: Date;
  zone_id: string | null; cutoff_time: string; timezone: string;
}

export const ruleOf = (s: Pick<SubRow, 'frequency' | 'schedule_anchor' | 'weekdays'>): ScheduleRule => ({
  frequency: s.frequency, startDate: s.schedule_anchor, weekdays: s.weekdays ?? undefined,
});

export async function audit(q: Queryable, actor: string | null, action: string, entity: string, entityId: string, metadata: object = {}) {
  await q.query(`insert into audit_logs (actor_id, action, entity, entity_id, metadata) values ($1,$2,$3,$4,$5)`, [
    actor, action, entity, entityId, JSON.stringify(metadata),
  ]);
}

export async function loadOwned(q: Queryable, userId: string, id: string, lock = false): Promise<SubRow> {
  // Ownership is part of the WHERE clause: another customer's id is indistinguishable from a missing one.
  const r = await q.query<SubRow>(
    `select ${SUB_COLS} ${SUB_FROM} where s.id = $1 and s.user_id = $2 ${lock ? 'for update of s' : ''}`,
    [id, userId],
  );
  if (!r.rows[0]) throw notFound('Subscription');
  return r.rows[0];
}

const changeDate = (deps: Deps, s: Pick<SubRow, 'cutoff_time' | 'timezone'>) =>
  earliestChangeableDate(deps.now(), s.cutoff_time, s.timezone);

// ---------------------------------------------------------------- quoting

async function resolveCoupon(q: Queryable, code: string, userId: string, subtotal: number, now: Date) {
  const r = await q.query<any>(`select * from coupons where code = $1 and is_active`, [code]);
  const c = r.rows[0];
  if (!c) throw unprocessable('This coupon code is not valid', 'COUPON_INVALID');
  if (new Date(c.valid_from) > now || (c.valid_to && new Date(c.valid_to) < now))
    throw unprocessable('This coupon has expired or is not active yet', 'COUPON_EXPIRED');
  if (c.usage_limit) {
    const used = (await q.query<{ n: number }>(`select count(*)::int n from coupon_redemptions where coupon_id=$1`, [c.id])).rows[0].n;
    if (used >= c.usage_limit) throw unprocessable('This coupon has been fully redeemed', 'COUPON_EXHAUSTED');
  }
  const mine = (await q.query<{ n: number }>(`select count(*)::int n from coupon_redemptions where coupon_id=$1 and user_id=$2`, [c.id, userId])).rows[0].n;
  if (mine >= c.per_user_limit) throw unprocessable('You have already used this coupon', 'COUPON_ALREADY_USED');
  if (subtotal < c.min_order_minor) throw unprocessable(`Add more items: this coupon needs a minimum order of ₹${c.min_order_minor / 100}`, 'COUPON_MIN_ORDER');
  const rule: CouponRule = { discountType: c.discount_type, value: c.value, maxDiscountMinor: c.max_discount_minor, minOrderMinor: c.min_order_minor };
  return { id: c.id as string, code: c.code as string, description: c.description as string, rule };
}

export async function validateCoupon(deps: Deps, userId: string, code: string, subtotalMinor?: number) {
  // Without a subtotal we can only check the code itself, so the minimum-order rule is skipped.
  const c = await resolveCoupon(deps.db, code, userId, subtotalMinor ?? Number.MAX_SAFE_INTEGER, deps.now());
  return { code: c.code, description: c.description, discountMinor: subtotalMinor != null ? couponDiscount(subtotalMinor, c.rule) : null };
}

function mergeItems(items: { variantId: string; quantity: number }[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.variantId, (m.get(i.variantId) ?? 0) + i.quantity);
  return [...m].map(([variantId, quantity]) => {
    if (quantity > 20) throw badRequest('Maximum 20 per item', 'QUANTITY_LIMIT');
    return { variantId, quantity };
  });
}

async function loadVariants(q: Queryable, items: { variantId: string; quantity: number }[]) {
  const ids = items.map((i) => i.variantId);
  const r = await q.query<any>(
    `select v.id, v.price_minor, v.is_available, p.is_active, p.name pname, v.name vname, v.size_label
     from product_variants v join products p on p.id = v.product_id where v.id = any($1::uuid[])`,
    [ids],
  );
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  return items.map((i) => {
    const v = byId.get(i.variantId);
    if (!v || !v.is_active) throw unprocessable('A selected product is no longer available', 'PRODUCT_UNAVAILABLE');
    if (!v.is_available) throw unprocessable(`${v.pname} (${v.vname}) is currently unavailable`, 'VARIANT_UNAVAILABLE');
    return { variantId: i.variantId, quantity: i.quantity, unitPriceMinor: v.price_minor as number, name: `${v.pname} - ${v.vname}` };
  });
}

async function holidaysIn(q: Queryable, zoneId: string | null, from: ISODate, to: ISODate): Promise<ISODate[]> {
  const r = await q.query<{ d: string }>(
    `select holiday_date::text d from holidays where holiday_date between $1 and $2 and (zone_id is null or zone_id = $3)`,
    [from, to, zoneId],
  );
  return r.rows.map((x) => x.d);
}

export interface Quote extends PriceBreakdown {
  items: { variantId: string; quantity: number; unitPriceMinor: number; name: string }[];
  couponCode: string | null; couponId: string | null; couponDescription: string | null;
  planDiscountBps: number; earliestStartDate: ISODate; cutoffTime: string; zoneId: string; addressId: string;
  schedule: { frequency: string; weekdays?: number[]; startDate: ISODate };
}

export async function buildQuote(q: Queryable, deps: Deps, userId: string, input: QuoteInput): Promise<Quote> {
  const addr = (await q.query<any>(`select id, zone_id from addresses where id=$1 and user_id=$2 and deleted_at is null`, [input.addressId, userId])).rows[0];
  if (!addr) throw notFound('Address');
  if (!addr.zone_id) throw unprocessable('We do not deliver to this PIN code yet', 'NOT_SERVICEABLE');
  const zone = (await q.query<any>(`select id, to_char(cutoff_time,'HH24:MI') cutoff_time, timezone from delivery_zones where id=$1 and is_active`, [addr.zone_id])).rows[0];
  if (!zone) throw unprocessable('We do not deliver to this PIN code yet', 'NOT_SERVICEABLE');

  const earliest = earliestChangeableDate(deps.now(), zone.cutoff_time, zone.timezone);
  const { startDate, frequency, weekdays } = input.schedule;
  if (diffDays(startDate, earliest) < 0)
    throw unprocessable(`The earliest start date is ${earliest} (orders close at ${zone.cutoff_time} the evening before)`, 'START_DATE_TOO_EARLY', { earliest });
  if (diffDays(startDate, zonedNow(deps.now(), zone.timezone).date) > MAX_START_AHEAD_DAYS)
    throw unprocessable(`Start date must be within ${MAX_START_AHEAD_DAYS} days`, 'START_DATE_TOO_LATE');

  const items = await loadVariants(q, mergeItems(input.items));
  const rule: ScheduleRule = { frequency, startDate, weekdays: frequency === 'weekdays' ? [...new Set(weekdays!)].sort() : undefined };
  const periodEnd = addDays(startDate, BILLING_PERIOD_DAYS - 1);
  const holidays = await holidaysIn(q, zone.id, startDate, periodEnd);
  const plan = (await q.query<any>(`select discount_bps from subscription_plans where frequency=$1 and is_active order by code limit 1`, [frequency])).rows[0];
  const planDiscountBps = plan?.discount_bps ?? 0;
  const base = priceSubscription({ items, rule, planDiscountBps, holidays });
  if (base.deliveries === 0) throw unprocessable('No deliveries fall within the first billing period for this schedule', 'NO_DELIVERIES');

  let coupon: Awaited<ReturnType<typeof resolveCoupon>> | null = null;
  if (input.couponCode) coupon = await resolveCoupon(q, input.couponCode, userId, base.totalMinor, deps.now());
  let price = priceSubscription({ items, rule, planDiscountBps, holidays, coupon: coupon?.rule });
  // Payment providers reject tiny/zero orders: never let a coupon take the total below ₹1.
  if (price.totalMinor < 100) {
    const reduce = 100 - price.totalMinor;
    price = { ...price, couponDiscountMinor: Math.max(0, price.couponDiscountMinor - reduce), totalMinor: 100 };
  }
  return {
    ...price, items, couponCode: coupon?.code ?? null, couponId: coupon?.id ?? null, couponDescription: coupon?.description ?? null,
    planDiscountBps, earliestStartDate: earliest, cutoffTime: zone.cutoff_time, zoneId: zone.id, addressId: addr.id,
    schedule: { frequency, weekdays: rule.weekdays, startDate },
  };
}

export const quoteSubscription = (deps: Deps, userId: string, input: QuoteInput) => buildQuote(deps.db, deps, userId, input);

// ---------------------------------------------------------------- creation + checkout

export interface Checkout {
  subscriptionId: string; paymentOrderId: string; providerOrderId: string; amountMinor: number; currency: 'INR'; keyId: string;
}

async function ensureProviderOrder(deps: Deps, orderId: string, userId: string): Promise<Checkout> {
  const o = (await deps.db.query<any>(`select * from payment_orders where id=$1 and user_id=$2`, [orderId, userId])).rows[0];
  if (!o) throw notFound('Payment order');
  let providerOrderId: string | null = o.provider_order_id;
  if (!providerOrderId) {
    const created = await deps.payments.createOrder({
      amountMinor: o.amount_minor,
      receipt: o.id.replace(/-/g, '').slice(0, 30),
      notes: { paymentOrderId: o.id, subscriptionId: o.subscription_id ?? '' },
    });
    providerOrderId = created.id;
    await deps.db.query(`update payment_orders set provider_order_id=$1 where id=$2 and provider_order_id is null`, [providerOrderId, o.id]);
    const cur = (await deps.db.query<any>(`select provider_order_id from payment_orders where id=$1`, [o.id])).rows[0];
    providerOrderId = cur.provider_order_id; // another request may have won the race
  }
  return {
    subscriptionId: o.subscription_id, paymentOrderId: o.id, providerOrderId: providerOrderId!, amountMinor: o.amount_minor,
    currency: 'INR', keyId: deps.payments.publicKey()!,
  };
}

export async function createSubscription(deps: Deps, userId: string, input: CreateSubscriptionInput) {
  if (!deps.payments.isConfigured()) throw paymentsNotConfigured();
  const attempt = () =>
    deps.db.tx(async (q) => {
      const existing = (await q.query<any>(`select id from subscriptions where user_id=$1 and idempotency_key=$2`, [userId, input.idempotencyKey])).rows[0];
      if (existing) {
        const o = (await q.query<any>(`select id from payment_orders where subscription_id=$1 order by created_at desc limit 1`, [existing.id])).rows[0];
        return { subscriptionId: existing.id as string, orderId: o?.id as string | undefined, replay: true };
      }
      const quote = await buildQuote(q, deps, userId, input);
      const sub = (await q.query<any>(
        `insert into subscriptions (user_id, plan_id, address_id, status, frequency, weekdays, start_date, schedule_anchor, idempotency_key, coupon_id)
         values ($1,(select id from subscription_plans where frequency=$2 and is_active order by code limit 1),$3,'pending_payment',$2,$4,$5,$5,$6,$7) returning id`,
        [userId, input.schedule.frequency, quote.addressId, quote.schedule.weekdays ?? null, quote.schedule.startDate, input.idempotencyKey, quote.couponId],
      )).rows[0];
      for (const i of quote.items) {
        await q.query(`insert into subscription_items (subscription_id, variant_id, quantity, unit_price_minor) values ($1,$2,$3,$4)`, [sub.id, i.variantId, i.quantity, i.unitPriceMinor]);
      }
      const order = (await q.query<any>(
        `insert into payment_orders (user_id, subscription_id, amount_minor, subtotal_minor, discount_minor, coupon_id, period_start, period_end, deliveries_count)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [userId, sub.id, quote.totalMinor, quote.subtotalMinor, quote.planDiscountMinor + quote.couponDiscountMinor, quote.couponId, quote.periodStart, quote.periodEnd, quote.deliveries],
      )).rows[0];
      await audit(q, userId, 'subscription.created', 'subscription', sub.id, { totalMinor: quote.totalMinor, deliveries: quote.deliveries });
      return { subscriptionId: sub.id as string, orderId: order.id as string, replay: false };
    });
  let r;
  try {
    r = await attempt();
  } catch (e: any) {
    if (e?.code === '23505') r = await attempt(); // concurrent duplicate idempotency key: replay path
    else throw e;
  }
  if (!r.orderId) throw conflict('Subscription exists without a payment order', 'NO_PAYMENT_ORDER');
  const checkout = await ensureProviderOrder(deps, r.orderId, userId);
  return { subscription: await getSubscription(deps, userId, r.subscriptionId), checkout, replay: r.replay };
}

/** Re-open checkout for an unpaid first period (or a renewal that has not been paid). */
export async function getCheckout(deps: Deps, userId: string, subscriptionId: string) {
  if (!deps.payments.isConfigured()) throw paymentsNotConfigured();
  const sub = await loadOwned(deps.db, userId, subscriptionId);
  if (sub.status === 'cancelled') throw conflict('This subscription is cancelled', 'SUBSCRIPTION_CANCELLED');
  const o = (await deps.db.query<any>(`select id from payment_orders where subscription_id=$1 and status='created' order by created_at desc limit 1`, [sub.id])).rows[0];
  if (!o) throw conflict('There is nothing to pay for this subscription right now', 'NOTHING_TO_PAY');
  return ensureProviderOrder(deps, o.id, userId);
}

/** Prepaid renewal for the next 30-day period. Recurring auto-debit is NOT configured. */
export async function createRenewal(deps: Deps, userId: string, subscriptionId: string) {
  if (!deps.payments.isConfigured()) throw paymentsNotConfigured();
  const orderId = await deps.db.tx(async (q) => {
    const sub = await loadOwned(q, userId, subscriptionId, true);
    if (!['active', 'paused', 'past_due'].includes(sub.status)) throw conflict('This subscription cannot be renewed right now', 'INVALID_STATE');
    const open = (await q.query<any>(`select id from payment_orders where subscription_id=$1 and status='created' order by created_at desc limit 1`, [sub.id])).rows[0];
    if (open) return open.id as string;
    if (sub.delivery_balance > GENERATE_HORIZON_DAYS)
      throw unprocessable('You still have plenty of prepaid deliveries. You can renew when fewer than 2 weeks remain.', 'RENEWAL_TOO_EARLY');
    const eff = changeDate(deps, sub);
    const from = diffDays(sub.paid_through ?? eff, eff) >= 0 ? addDays(sub.paid_through ?? eff, 1) : eff;
    const to = addDays(from, BILLING_PERIOD_DAYS - 1);
    const items = (await q.query<any>(`select si.quantity, v.price_minor, v.is_available from subscription_items si join product_variants v on v.id=si.variant_id where si.subscription_id=$1`, [sub.id])).rows;
    if (items.some((i) => !i.is_available)) throw unprocessable('A product in this subscription is currently unavailable. Update your items first.', 'VARIANT_UNAVAILABLE');
    const excl = await excludedDates(q, sub, from, to);
    const dates = scheduledDates(ruleOf(sub), from, to, excl);
    const perDelivery = items.reduce((t, i) => t + i.price_minor * i.quantity, 0);
    const subtotal = perDelivery * dates.length;
    if (dates.length === 0) throw unprocessable('No deliveries fall in the next period', 'NO_DELIVERIES');
    const o = (await q.query<any>(
      `insert into payment_orders (user_id, subscription_id, amount_minor, subtotal_minor, discount_minor, period_start, period_end, deliveries_count)
       values ($1,$2,$3,$3,0,$4,$5,$6) returning id`,
      [userId, sub.id, Math.max(subtotal, 100), from, to, dates.length],
    )).rows[0];
    await audit(q, userId, 'subscription.renewal_requested', 'subscription', sub.id, { amountMinor: subtotal });
    return o.id as string;
  });
  return ensureProviderOrder(deps, orderId, userId);
}

// ---------------------------------------------------------------- derived state

/** Dates (within [from,to]) that must not receive deliveries: skips, holidays, pause windows. */
export async function excludedDates(q: Queryable, sub: Pick<SubRow, 'id' | 'zone_id'>, from: ISODate, to: ISODate): Promise<Set<ISODate>> {
  const ex = new Set<ISODate>();
  const skips = await q.query<{ d: string }>(`select skip_date::text d from subscription_skipped_dates where subscription_id=$1 and skip_date between $2 and $3`, [sub.id, from, to]);
  skips.rows.forEach((r) => ex.add(r.d));
  (await holidaysIn(q, sub.zone_id, from, to)).forEach((d) => ex.add(d));
  const pauses = await q.query<{ s: string; e: string | null }>(
    `select starts_on::text s, ends_on::text e from subscription_pauses where subscription_id=$1 and ended_early_at is null and starts_on <= $3 and (ends_on is null or ends_on >= $2)`,
    [sub.id, from, to],
  );
  for (const p of pauses.rows) {
    for (let d = from; diffDays(d, to) <= 0; d = addDays(d, 1)) {
      if (diffDays(d, p.s) >= 0 && (p.e === null || diffDays(d, p.e) <= 0)) ex.add(d);
    }
  }
  return ex;
}

async function setStatus(q: Queryable, sub: SubRow, to: SubscriptionStatus, actor: string | null, extra: object = {}) {
  if (sub.status === to) return;
  if (!canTransition(sub.status, to)) throw conflict(`Cannot change a ${sub.status.replace('_', ' ')} subscription to ${to.replace('_', ' ')}`, 'INVALID_TRANSITION');
  await q.query(`update subscriptions set status=$1 where id=$2`, [to, sub.id]);
  await audit(q, actor, `subscription.${to}`, 'subscription', sub.id, { from: sub.status, ...extra });
  sub.status = to;
}

/** Lazy reconciliation (no scheduler): paused windows that have started/ended and exhausted prepaid balance. */
export async function syncStatus(deps: Deps, q: Queryable, sub: SubRow): Promise<SubRow> {
  if (sub.status === 'cancelled' || sub.status === 'pending_payment') return sub;
  const eff = changeDate(deps, sub);
  const today = zonedNow(deps.now(), sub.timezone).date;
  const pauses = (await q.query<{ s: string; e: string | null }>(
    `select starts_on::text s, ends_on::text e from subscription_pauses where subscription_id=$1 and ended_early_at is null`, [sub.id])).rows;
  const covering = pauses.some((p) => diffDays(p.s, eff) <= 0 && (p.e === null || diffDays(p.e, eff) >= 0));
  if (sub.status === 'active' && covering) await setStatus(q, sub, 'paused', null, { auto: true });
  else if (sub.status === 'paused' && !covering) await setStatus(q, sub, 'active', null, { auto: true });
  if (sub.status === 'active' && sub.delivery_balance === 0) {
    const upcoming = (await q.query<{ n: number }>(`select count(*)::int n from deliveries where subscription_id=$1 and delivery_date >= $2 and status in ('scheduled','pending','out_for_delivery')`, [sub.id, today])).rows[0].n;
    if (upcoming === 0) await setStatus(q, sub, 'past_due', null, { reason: 'prepaid_deliveries_exhausted' });
  }
  return sub;
}

// ---------------------------------------------------------------- reads

export async function getSubscription(deps: Deps, userId: string, id: string) {
  const sub = await deps.db.tx(async (q) => syncStatus(deps, q, await loadOwned(q, userId, id, true)));
  return buildDetail(deps, deps.db, sub);
}

async function buildDetail(deps: Deps, q: Queryable, sub: SubRow) {
  const today = zonedNow(deps.now(), sub.timezone).date;
  const eff = changeDate(deps, sub);
  const [items, pauses, skips, addr, next, lastOrder, lastPay] = await Promise.all([
    q.query(`select si.variant_id, si.quantity, si.unit_price_minor, v.name variant_name, v.size_label, p.name product_name, p.image_url, p.category
             from subscription_items si join product_variants v on v.id=si.variant_id join products p on p.id=v.product_id where si.subscription_id=$1 order by p.sort_order`, [sub.id]),
    q.query(`select id, starts_on::text starts_on, ends_on::text ends_on, ended_early_at from subscription_pauses where subscription_id=$1 order by starts_on desc`, [sub.id]),
    q.query<{ d: string }>(`select skip_date::text d from subscription_skipped_dates where subscription_id=$1 and skip_date >= $2 order by skip_date`, [sub.id, today]),
    q.query(`select id, label, recipient_name, line1, line2, landmark, city, postal_code from addresses where id=$1`, [sub.address_id]),
    q.query(`select id, delivery_date::text delivery_date, status, to_char(window_start,'HH24:MI') window_start, to_char(window_end,'HH24:MI') window_end
             from deliveries where subscription_id=$1 and delivery_date >= $2 and status in ('scheduled','pending','out_for_delivery') order by delivery_date limit 1`, [sub.id, today]),
    q.query(`select id, status, amount_minor, period_start::text period_start, period_end::text period_end from payment_orders where subscription_id=$1 order by created_at desc limit 1`, [sub.id]),
    q.query(`select p.status, p.failure_reason, p.provider_payment_id from payments p join payment_orders o on o.id=p.payment_order_id where o.subscription_id=$1 order by p.created_at desc limit 1`, [sub.id]),
  ]);
  const itemRows = camel<any[]>(items.rows);
  const perDelivery = itemRows.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0);
  const activePauses = camel<any[]>(pauses.rows).filter((p) => !p.endedEarlyAt && (p.endsOn === null || diffDays(p.endsOn, today) >= 0));
  const status = sub.status;
  const live = status === 'active' || status === 'paused' || status === 'past_due';
  return {
    id: sub.id, status, frequency: sub.frequency, weekdays: sub.weekdays, startDate: sub.start_date, scheduleAnchor: sub.schedule_anchor,
    createdAt: sub.created_at, cancelledAt: sub.cancelled_at, cancelReason: sub.cancel_reason,
    items: itemRows, perDeliveryMinor: perDelivery, address: camel(addr.rows[0]),
    pauses: activePauses, skippedDates: skips.rows.map((r) => r.d),
    nextDelivery: next.rows[0] ? camel(next.rows[0]) : null,
    billing: {
      model: 'prepaid_manual_renewal', autoDebit: false, prepaidDeliveriesRemaining: sub.delivery_balance, coveredThrough: sub.paid_through,
      currentPeriodStart: sub.current_period_start, currentPeriodEnd: sub.current_period_end,
      lastOrder: lastOrder.rows[0] ? camel(lastOrder.rows[0]) : null, lastPayment: lastPay.rows[0] ? camel(lastPay.rows[0]) : null,
      renewalDue: live && sub.delivery_balance <= GENERATE_HORIZON_DAYS,
    },
    rules: { cutoffTime: sub.cutoff_time, timezone: sub.timezone, earliestChangeableDate: eff },
    actions: {
      canPause: status === 'active', canResume: status === 'paused' || (status === 'active' && activePauses.length > 0),
      canSkip: status === 'active', canEdit: status === 'active' || status === 'paused', canCancel: status !== 'cancelled',
      canPay: status === 'pending_payment' || status === 'past_due', canRenew: live,
    },
  };
}

export async function listSubscriptions(deps: Deps, userId: string, status?: string) {
  const ids = (await deps.db.query<{ id: string }>(
    `select id from subscriptions where user_id=$1 ${status ? 'and status=$2' : ''} order by created_at desc limit 50`,
    status ? [userId, status] : [userId],
  )).rows;
  const out = [];
  for (const { id } of ids) out.push(await getSubscription(deps, userId, id));
  if (status) return out.filter((s) => s.status === status);
  return out;
}

export async function subscriptionHistory(deps: Deps, userId: string, id: string) {
  await loadOwned(deps.db, userId, id);
  const r = await deps.db.query(`select id, action, metadata, created_at from audit_logs where entity='subscription' and entity_id=$1 order by id desc limit 100`, [id]);
  return camel(r.rows);
}

// ---------------------------------------------------------------- deliveries

/** Insert upcoming deliveries for prepaid balance. Idempotent: safe to call any number of times. */
export async function generateDeliveries(deps: Deps, q: Queryable, sub: SubRow, horizonDays = GENERATE_HORIZON_DAYS) {
  if (sub.status !== 'active') return { created: 0, from: null as ISODate | null, to: null as ISODate | null };
  const eff = changeDate(deps, sub);
  const from = diffDays(sub.start_date, eff) > 0 ? sub.start_date : eff;
  const to = addDays(from, horizonDays - 1);
  const ex = await excludedDates(q, sub, from, to);
  const dates = scheduledDates(ruleOf(sub), from, to, ex);
  if (dates.length === 0) return { created: 0, from, to };
  const r = await q.query<{ n: number }>(`select fn_insert_deliveries($1, $2::date[]) n`, [sub.id, dates]);
  return { created: r.rows[0].n, from, to };
}

export async function generateForUser(deps: Deps, userId: string, id: string, days?: number) {
  const horizon = Math.min(Math.max(days ?? GENERATE_HORIZON_DAYS, 1), 45);
  return deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status !== 'active') throw conflict('Deliveries can only be generated for active subscriptions', 'INVALID_STATE');
    const r = await generateDeliveries(deps, q, sub, horizon);
    const left = (await q.query<{ b: number }>(`select delivery_balance b from subscriptions where id=$1`, [sub.id])).rows[0].b;
    return { ...r, prepaidDeliveriesRemaining: left };
  });
}

/** Remove not-yet-prepared deliveries from `from` onward and give their prepaid value back to the balance. */
async function releaseScheduled(q: Queryable, subId: string, from: ISODate, to?: ISODate | null) {
  const r = await q.query<{ n: number }>(
    `with del as (delete from deliveries where subscription_id=$1 and status='scheduled' and delivery_date >= $2 and ($3::date is null or delivery_date <= $3) returning id)
     select count(*)::int n from del`,
    [subId, from, to ?? null],
  );
  const n = r.rows[0].n;
  if (n > 0) await q.query(`update subscriptions set delivery_balance = delivery_balance + $1 where id=$2`, [n, subId]);
  return n;
}

// ---------------------------------------------------------------- lifecycle actions

export async function pauseSubscription(deps: Deps, userId: string, id: string, input: { from?: ISODate; until?: ISODate | null }) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status !== 'active') throw conflict(sub.status === 'paused' ? 'This subscription is already paused. Resume it first to change the pause.' : `A ${sub.status.replace('_', ' ')} subscription cannot be paused`, 'INVALID_STATE');
    const eff = changeDate(deps, sub);
    const from = input.from ?? eff;
    if (diffDays(from, eff) < 0) throw unprocessable(`Deliveries before ${eff} are already being prepared. Pause can start from ${eff}.`, 'PAST_CUTOFF', { earliest: eff });
    const until = input.until ?? null;
    if (until && diffDays(until, from) < 0) throw badRequest('Pause end date must be on or after the start date', 'INVALID_RANGE');
    if (until && diffDays(until, from) > 365) throw badRequest('Pause cannot be longer than 365 days', 'INVALID_RANGE');
    const overlap = await q.query(
      `select 1 from subscription_pauses where subscription_id=$1 and ended_early_at is null and (ends_on is null or ends_on >= $2) and ($3::date is null or starts_on <= $3) limit 1`,
      [sub.id, from, until],
    );
    if (overlap.rows[0]) throw conflict('A pause already covers some of these dates', 'PAUSE_OVERLAP');
    await q.query(`insert into subscription_pauses (subscription_id, starts_on, ends_on) values ($1,$2,$3)`, [sub.id, from, until]);
    const released = await releaseScheduled(q, sub.id, from, until);
    await audit(q, userId, 'subscription.pause_requested', 'subscription', sub.id, { from, until, releasedDeliveries: released });
    await syncStatus(deps, q, sub);
  });
  return getSubscription(deps, userId, id);
}

export async function resumeSubscription(deps: Deps, userId: string, id: string) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    const eff = changeDate(deps, sub);
    const open = (await q.query<{ id: string; s: string; e: string | null }>(
      `select id, starts_on::text s, ends_on::text e from subscription_pauses where subscription_id=$1 and ended_early_at is null and (ends_on is null or ends_on >= $2) for update`,
      [sub.id, eff],
    )).rows;
    if (sub.status === 'cancelled') throw conflict('This subscription is cancelled', 'INVALID_STATE');
    if (open.length === 0) throw conflict('This subscription is not paused', 'NOT_PAUSED');
    for (const p of open) {
      if (diffDays(p.s, eff) >= 0) await q.query(`update subscription_pauses set ended_early_at=now() where id=$1`, [p.id]);
      else await q.query(`update subscription_pauses set ends_on=$1 where id=$2`, [addDays(eff, -1), p.id]);
    }
    await q.query(`update subscriptions set status = case when status='paused' then 'active' else status end where id=$1`, [sub.id]);
    sub.status = sub.status === 'paused' ? 'active' : sub.status;
    await audit(q, userId, 'subscription.resumed', 'subscription', sub.id, { effectiveFrom: eff });
    if (sub.status === 'active') await generateDeliveries(deps, q, sub);
  });
  return getSubscription(deps, userId, id);
}

export async function skipDelivery(deps: Deps, userId: string, id: string, date: ISODate) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status !== 'active') throw conflict('Only active subscriptions can skip a delivery', 'INVALID_STATE');
    const eff = changeDate(deps, sub);
    if (!isBeforeCutoff(date, deps.now(), sub.cutoff_time, sub.timezone))
      throw unprocessable(`The cutoff for ${date} has passed (orders close at ${sub.cutoff_time} the evening before). Earliest skippable date: ${eff}.`, 'PAST_CUTOFF', { earliest: eff });
    if (!isScheduledOn(ruleOf(sub), date)) throw unprocessable('No delivery is scheduled on that date', 'NOT_SCHEDULED');
    const ex = await excludedDates(q, sub, date, date);
    if (ex.has(date)) throw conflict('That date is already skipped, paused or a holiday', 'ALREADY_EXCLUDED');
    const d = (await q.query<any>(`select id, status from deliveries where subscription_id=$1 and delivery_date=$2 for update`, [sub.id, date])).rows[0];
    if (d && d.status !== 'scheduled') throw conflict('This delivery is already prepared and cannot be skipped', 'DELIVERY_PREPARED');
    await q.query(`insert into subscription_skipped_dates (subscription_id, skip_date) values ($1,$2) on conflict do nothing`, [sub.id, date]);
    if (d) {
      await q.query(`update deliveries set status='skipped' where id=$1`, [d.id]);
      await q.query(`update subscriptions set delivery_balance = delivery_balance + 1 where id=$1`, [sub.id]);
    } else {
      const a = (await q.query<any>(`select address_id from subscriptions where id=$1`, [sub.id])).rows[0];
      await q.query(`insert into deliveries (subscription_id, user_id, address_id, delivery_date, status) values ($1,$2,$3,$4,'skipped') on conflict do nothing`, [sub.id, userId, a.address_id, date]);
    }
    await audit(q, userId, 'subscription.delivery_skipped', 'subscription', sub.id, { date });
  });
  return getSubscription(deps, userId, id);
}

export async function unskipDelivery(deps: Deps, userId: string, id: string, date: ISODate) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (!isBeforeCutoff(date, deps.now(), sub.cutoff_time, sub.timezone)) throw unprocessable('The cutoff for that date has passed', 'PAST_CUTOFF');
    const del = await q.query(`delete from subscription_skipped_dates where subscription_id=$1 and skip_date=$2`, [sub.id, date]);
    if (del.rowCount === 0) throw notFound('Skipped delivery');
    await q.query(`delete from deliveries where subscription_id=$1 and delivery_date=$2 and status='skipped'`, [sub.id, date]);
    // The earlier skip credited one delivery back to the balance (or none for a placeholder); re-generation consumes it again.
    // Take the date back: it needs one prepaid credit. If coverage was already extended into the credit,
    // free it by releasing the latest not-yet-prepared delivery.
    const bal = (await q.query<{ b: number }>(`select delivery_balance b from subscriptions where id=$1`, [sub.id])).rows[0].b;
    if (bal < 1) {
      const freed = await q.query(`delete from deliveries where id = (select id from deliveries where subscription_id=$1 and status='scheduled' order by delivery_date desc limit 1) returning id`, [sub.id]);
      if (freed.rowCount === 0) throw conflict('There is no prepaid delivery available to restore this date. Renew your plan first.', 'NO_CREDIT');
      await q.query(`update subscriptions set delivery_balance = delivery_balance + 1 where id=$1`, [sub.id]);
    }
    await audit(q, userId, 'subscription.delivery_unskipped', 'subscription', sub.id, { date });
    if (sub.status === 'active') await generateDeliveries(deps, q, sub);
  });
  return getSubscription(deps, userId, id);
}

export async function updateItems(deps: Deps, userId: string, id: string, rawItems: { variantId: string; quantity: number }[]) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status !== 'active' && sub.status !== 'paused') throw conflict('Items can only be changed on active or paused subscriptions', 'INVALID_STATE');
    const items = await loadVariants(q, mergeItems(rawItems));
    await q.query(`delete from subscription_items where subscription_id=$1`, [sub.id]);
    for (const i of items) await q.query(`insert into subscription_items (subscription_id, variant_id, quantity, unit_price_minor) values ($1,$2,$3,$4)`, [sub.id, i.variantId, i.quantity, i.unitPriceMinor]);
    const eff = changeDate(deps, sub);
    const released = await releaseScheduled(q, sub.id, eff);
    await audit(q, userId, 'subscription.items_changed', 'subscription', sub.id, { effectiveFrom: eff, items: items.map((i) => ({ v: i.variantId, q: i.quantity })), releasedDeliveries: released });
    if (sub.status === 'active') await generateDeliveries(deps, q, sub);
  });
  return getSubscription(deps, userId, id);
}

export async function updateSchedule(deps: Deps, userId: string, id: string, s: { frequency: 'daily' | 'alternate_days' | 'weekdays'; weekdays?: number[]; startDate: ISODate }) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status !== 'active' && sub.status !== 'paused') throw conflict('The schedule can only be changed on active or paused subscriptions', 'INVALID_STATE');
    const eff = changeDate(deps, sub);
    if (diffDays(s.startDate, eff) < 0) throw unprocessable(`The new schedule can start from ${eff}`, 'PAST_CUTOFF', { earliest: eff });
    const released = await releaseScheduled(q, sub.id, eff);
    const weekdays = s.frequency === 'weekdays' ? [...new Set(s.weekdays!)].sort() : null;
    await q.query(`update subscriptions set frequency=$1, weekdays=$2, schedule_anchor=$3 where id=$4`, [s.frequency, weekdays, s.startDate, sub.id]);
    sub.frequency = s.frequency; sub.weekdays = weekdays; sub.schedule_anchor = s.startDate;
    await audit(q, userId, 'subscription.schedule_changed', 'subscription', sub.id, { ...s, releasedDeliveries: released });
    if (sub.status === 'active') await generateDeliveries(deps, q, sub);
  });
  return getSubscription(deps, userId, id);
}

export async function updateAddress(deps: Deps, userId: string, id: string, addressId: string) {
  await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status === 'cancelled') throw conflict('This subscription is cancelled', 'INVALID_STATE');
    const a = (await q.query<any>(`select id, zone_id, delivery_instructions from addresses where id=$1 and user_id=$2 and deleted_at is null`, [addressId, userId])).rows[0];
    if (!a) throw notFound('Address');
    if (!a.zone_id) throw unprocessable('We do not deliver to this PIN code yet', 'NOT_SERVICEABLE');
    const eff = changeDate(deps, sub);
    const released = await releaseScheduled(q, sub.id, eff);
    await q.query(`update subscriptions set address_id=$1 where id=$2`, [addressId, sub.id]);
    sub.address_id = addressId; sub.zone_id = a.zone_id;
    await audit(q, userId, 'subscription.address_changed', 'subscription', sub.id, { addressId, effectiveFrom: eff, releasedDeliveries: released });
    if (sub.status === 'active') {
      const z = (await q.query<any>(`select to_char(cutoff_time,'HH24:MI') c, timezone from delivery_zones where id=$1`, [a.zone_id])).rows[0];
      sub.cutoff_time = z.c; sub.timezone = z.timezone;
      await generateDeliveries(deps, q, sub);
    }
  });
  return getSubscription(deps, userId, id);
}

export async function cancelSubscription(deps: Deps, userId: string, id: string, reason?: string) {
  const unused = await deps.db.tx(async (q) => {
    const sub = await syncStatus(deps, q, await loadOwned(q, userId, id, true));
    if (sub.status === 'cancelled') return { balance: 0, subscriptionId: sub.id, alreadyCancelled: true };
    const eff = changeDate(deps, sub);
    const cancelled = await q.query<{ n: number }>(
      `with u as (update deliveries set status='cancelled' where subscription_id=$1 and status='scheduled' and delivery_date >= $2 returning id) select count(*)::int n from u`,
      [sub.id, eff],
    );
    const balance = sub.delivery_balance + cancelled.rows[0].n;
    await setStatus(q, sub, 'cancelled', userId, { reason });
    await q.query(`update subscriptions set cancelled_at=now(), cancel_reason=$1, delivery_balance=0 where id=$2`, [reason ?? null, sub.id]);
    await q.query(`update payment_orders set status='expired' where subscription_id=$1 and status='created'`, [sub.id]);
    if (balance > 0) {
      await q.query(
        `insert into support_tickets (user_id, category, subject, message) values ($1,'payment',$2,$3)`,
        [userId, 'Refund review: unused prepaid deliveries', `Subscription ${sub.id} was cancelled with ${balance} prepaid deliveries unused. Please review for a refund of the unused amount.`],
      );
    }
    return { balance, subscriptionId: sub.id, alreadyCancelled: false };
  });
  const detail = await getSubscription(deps, userId, id);
  return { ...detail, cancellation: { unusedPrepaidDeliveries: unused.balance, refundReviewTicketCreated: unused.balance > 0 } };
}

export { activateAfterCapture };

/** After a captured payment: schedule the first deliveries. Called by the payment service. */
async function activateAfterCapture(deps: Deps, subscriptionId: string) {
  await deps.db.tx(async (q) => {
    const r = await q.query<SubRow>(`select ${SUB_COLS} ${SUB_FROM} where s.id=$1 for update of s`, [subscriptionId]);
    if (r.rows[0]?.status === 'active') await generateDeliveries(deps, q, r.rows[0]);
  });
}

export type { Db };
