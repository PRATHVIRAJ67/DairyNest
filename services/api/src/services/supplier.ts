/**
 * Supplier operations. A supplier serves one or more zones (areas) and only ever sees data for those zones.
 * Admins (owners) pass the same checks with access to every zone.
 */
import { addDays, diffDays, earliestChangeableDate, isBeforeCutoff, isScheduledOn, zonedNow, type ISODate } from '@milk/shared';
import { camel, type Queryable } from '../db';
import type { Deps } from '../deps';
import { badRequest, forbidden, notFound } from '../errors';
import { setDeliveryStatus } from './deliveries';
import { generateDeliveries, SUB_COLS, SUB_FROM, syncStatus, type SubRow } from './subscriptions';

export interface Actor { userId: string; role: 'customer' | 'supplier' | 'admin' }

/** Zone ids the actor may see. Admins: all zones. Optional `zoneId` narrows (and must be allowed). */
export async function allowedZones(q: Queryable, actor: Actor, zoneId?: string): Promise<string[]> {
  const rows =
    actor.role === 'admin'
      ? (await q.query<{ id: string }>(`select id from delivery_zones order by name`)).rows
      : (await q.query<{ id: string }>(`select zone_id id from supplier_zones where supplier_id = $1`, [actor.userId])).rows;
  const ids = rows.map((r) => r.id);
  if (zoneId) {
    if (!ids.includes(zoneId)) throw forbidden('You do not serve this area');
    return [zoneId];
  }
  return ids;
}

export async function myZones(deps: Deps, actor: Actor) {
  const ids = await allowedZones(deps.db, actor);
  if (!ids.length) return [];
  const r = await deps.db.query(
    `select z.id, z.name, z.postal_codes, to_char(z.window_start,'HH24:MI') window_start, to_char(z.window_end,'HH24:MI') window_end,
            to_char(z.cutoff_time,'HH24:MI') cutoff_time, z.timezone, z.is_active,
            (select count(*)::int from subscriptions s join addresses a on a.id = s.address_id
              where a.zone_id = z.id and s.status in ('active','paused')) active_subscriptions
     from delivery_zones z where z.id = any($1::uuid[]) order by z.name`,
    [ids],
  );
  return camel(r.rows);
}

/**
 * Makes sure every active subscription in the zones has its delivery for `date` (when it is still in the future).
 * Idempotent and bounded by each customer's prepaid balance. This replaces a scheduler: opening a day prepares it.
 */
async function prepareDay(deps: Deps, zoneIds: string[], date: ISODate) {
  const subs = (await deps.db.query<{ id: string }>(
    `select s.id from subscriptions s join addresses a on a.id = s.address_id
     where a.zone_id = any($1::uuid[]) and s.status = 'active' and s.start_date <= $2`,
    [zoneIds, date],
  )).rows;
  let created = 0;
  for (const { id } of subs) {
    created += await deps.db.tx(async (q) => {
      const row = (await q.query<SubRow>(`select ${SUB_COLS} ${SUB_FROM} where s.id = $1 for update of s`, [id])).rows[0];
      if (!row) return 0;
      const sub = await syncStatus(deps, q, row);
      const eff = earliestChangeableDate(deps.now(), sub.cutoff_time, sub.timezone);
      const ahead = diffDays(date, eff);
      if (ahead < 0) return 0; // past the cutoff: the list for that day is final
      return (await generateDeliveries(deps, q, sub, Math.min(ahead + 1, 45))).created;
    });
  }
  return created;
}

const DELIVERY_COLS = `d.id, d.subscription_id, d.delivery_date::text delivery_date, d.status, d.total_minor, d.instructions,
  d.delivered_at, d.failure_reason, to_char(d.window_start,'HH24:MI') window_start, to_char(d.window_end,'HH24:MI') window_end,
  z.id zone_id, z.name zone_name, coalesce(to_char(z.cutoff_time,'HH24:MI'),'21:00') cutoff_time, coalesce(z.timezone,'Asia/Kolkata') timezone,
  p.full_name customer_name, a.recipient_name, a.phone, a.label address_label, a.line1, a.line2, a.landmark, a.city, a.postal_code,
  coalesce((select json_agg(json_build_object('variantId', di.variant_id, 'name', di.name, 'quantity', di.quantity) order by di.name)
    from delivery_items di where di.delivery_id = d.id), '[]') items`;
const DELIVERY_FROM = `from deliveries d join addresses a on a.id = d.address_id join delivery_zones z on z.id = a.zone_id
  join profiles p on p.id = d.user_id`;

export type NotTodayReason = 'paused' | 'skipped' | 'holiday' | 'renewal_due' | 'stopped';
export type DeliveryTag = 'new_customer' | 'back_from_pause' | 'last_prepaid' | 'pausing_from_tomorrow' | 'skipping_tomorrow';

/**
 * Everything a supplier needs for one day:
 *  - deliveries: who to deliver to (with heads-up tags such as "new customer" or "last prepaid delivery")
 *  - notToday: customers who would normally get a delivery that day but must NOT, with the reason
 *  - totals: the load sheet
 */
export async function day(deps: Deps, actor: Actor, date: ISODate, zoneId?: string) {
  const zones = await allowedZones(deps.db, actor, zoneId);
  if (!zones.length) return { date, prepared: 0, totals: [], counts: {}, deliveries: [], notToday: [], valueMinor: 0 };
  const prepared = await prepareDay(deps, zones, date);
  const r = await deps.db.query(
    `select ${DELIVERY_COLS} ${DELIVERY_FROM}
     where d.delivery_date = $1 and a.zone_id = any($2::uuid[]) and d.status <> 'cancelled'
     order by z.name, a.postal_code, a.line1, a.line2`,
    [date, zones],
  );
  const rows = r.rows.map((row) => {
    const d = camel<any>(row);
    const beforeCutoff = isBeforeCutoff(d.deliveryDate, deps.now(), d.cutoffTime, d.timezone);
    return {
      ...d,
      displayStatus: d.status === 'scheduled' && !beforeCutoff ? 'pending' : d.status,
      editableByCustomer: d.status === 'scheduled' && beforeCutoff,
      tags: [] as DeliveryTag[],
    };
  });
  const bySub = new Map<string, any>(rows.map((d) => [d.subscriptionId, d]));

  // Every subscription that could have been delivered on this day, to explain the ones that are not.
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const subs = (await deps.db.query<any>(
    `select s.id, s.status, s.frequency, s.weekdays, s.schedule_anchor::text schedule_anchor, s.start_date::text start_date,
            s.delivery_balance, (s.cancelled_at at time zone 'Asia/Kolkata')::date::text cancelled_on,
            p.full_name customer_name, a.recipient_name, a.phone, a.line1, a.line2, a.landmark, a.postal_code, a.zone_id, z.name zone_name,
            coalesce((select string_agg(si.quantity || ' x ' || pr.name || ' ' || v.size_label, ', ' order by pr.name)
              from subscription_items si join product_variants v on v.id = si.variant_id join products pr on pr.id = v.product_id
              where si.subscription_id = s.id), '') items,
            (select min(d.delivery_date)::text from deliveries d where d.subscription_id = s.id and d.status not in ('cancelled','skipped')) first_delivery,
            exists (select 1 from deliveries d where d.subscription_id = s.id and d.delivery_date > $2
              and d.status in ('scheduled','pending','out_for_delivery')) has_later
     from subscriptions s join addresses a on a.id = s.address_id join delivery_zones z on z.id = a.zone_id join profiles p on p.id = s.user_id
     where a.zone_id = any($1::uuid[]) and s.start_date <= $2
       and (s.status in ('active','paused','past_due') or (s.status = 'cancelled' and s.cancelled_at >= ($2::date - 7)))`,
    [zones, date],
  )).rows;
  const ids = subs.map((x) => x.id);
  const pauses = ids.length
    ? (await deps.db.query<{ subscription_id: string; s: string; e: string | null }>(
        `select subscription_id, starts_on::text s, ends_on::text e from subscription_pauses
         where subscription_id = any($1::uuid[]) and ended_early_at is null and starts_on <= $3 and (ends_on is null or ends_on >= $2)`,
        [ids, prev, next],
      )).rows
    : [];
  const skips = ids.length
    ? (await deps.db.query<{ subscription_id: string; d: string }>(
        `select subscription_id, skip_date::text d from subscription_skipped_dates where subscription_id = any($1::uuid[]) and skip_date in ($2, $3)`,
        [ids, date, next],
      )).rows
    : [];
  const holidayZones = new Set(
    (await deps.db.query<{ zone_id: string | null }>(`select zone_id from holidays where holiday_date = $1`, [date])).rows.map((h) => h.zone_id ?? '*'),
  );

  const covering = (id: string, d: ISODate) => pauses.find((p) => p.subscription_id === id && p.s <= d && (p.e === null || p.e >= d));
  const notToday: any[] = [];
  for (const sub of subs) {
    const delivery = bySub.get(sub.id);
    const rule = { frequency: sub.frequency, startDate: sub.schedule_anchor, weekdays: sub.weekdays ?? undefined };
    if (delivery && delivery.status !== 'skipped') {
      const t: DeliveryTag[] = delivery.tags;
      if (sub.first_delivery === date) t.push('new_customer');
      if (pauses.some((p) => p.subscription_id === sub.id && p.e === prev)) t.push('back_from_pause');
      if (sub.delivery_balance === 0 && !sub.has_later && sub.status !== 'cancelled') t.push('last_prepaid');
      const pauseTomorrow = covering(sub.id, next);
      if (pauseTomorrow && pauseTomorrow.s === next) t.push('pausing_from_tomorrow');
      else if (skips.some((k) => k.subscription_id === sub.id && k.d === next)) t.push('skipping_tomorrow');
      continue;
    }
    if (!delivery && !isScheduledOn(rule, date)) continue; // not one of this customer's delivery days
    const pause = covering(sub.id, date);
    let reason: NotTodayReason | null = null;
    let until: string | null = null;
    if (sub.status === 'cancelled') reason = 'stopped';
    else if (delivery?.status === 'skipped' || skips.some((k) => k.subscription_id === sub.id && k.d === date)) reason = 'skipped';
    else if (pause) {
      reason = 'paused';
      until = pause.e;
    } else if (holidayZones.has('*') || holidayZones.has(sub.zone_id)) reason = 'holiday';
    else if (sub.status === 'past_due' || sub.delivery_balance === 0) reason = 'renewal_due';
    if (!reason) continue;
    notToday.push({
      subscriptionId: sub.id, reason, pausedUntil: until, stoppedOn: reason === 'stopped' ? sub.cancelled_on : null,
      customerName: sub.customer_name, recipientName: sub.recipient_name, phone: sub.phone, line1: sub.line1, line2: sub.line2,
      landmark: sub.landmark, postalCode: sub.postal_code, zoneId: sub.zone_id, zoneName: sub.zone_name, items: sub.items,
    });
  }
  const order: NotTodayReason[] = ['paused', 'skipped', 'stopped', 'renewal_due', 'holiday'];
  notToday.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || a.zoneName.localeCompare(b.zoneName) || a.postalCode.localeCompare(b.postalCode));

  // Load sheet: only deliveries that will actually go out.
  const deliveries = rows.filter((d) => d.status !== 'skipped');
  const totals = new Map<string, { variantId: string; name: string; quantity: number }>();
  const counts: Record<string, number> = {};
  let valueMinor = 0;
  for (const d of deliveries) {
    counts[d.displayStatus] = (counts[d.displayStatus] ?? 0) + 1;
    if (d.status === 'failed') continue;
    valueMinor += d.totalMinor;
    for (const i of d.items as { variantId: string; name: string; quantity: number }[]) {
      const t = totals.get(i.variantId) ?? { variantId: i.variantId, name: i.name, quantity: 0 };
      t.quantity += i.quantity;
      totals.set(i.variantId, t);
    }
  }
  for (const n of notToday) counts[`not_${n.reason}`] = (counts[`not_${n.reason}`] ?? 0) + 1;
  counts.skipped = notToday.filter((n) => n.reason === 'skipped').length;
  return {
    date, prepared, valueMinor, counts,
    totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
    deliveries,
    notToday,
  };
}

const SUPPLIER_STATUSES = ['out_for_delivery', 'delivered', 'failed'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

async function assertDeliveryInZones(deps: Deps, actor: Actor, deliveryId: string) {
  const zones = await allowedZones(deps.db, actor);
  const r = await deps.db.query<{ zone_id: string | null }>(
    `select a.zone_id from deliveries d join addresses a on a.id = d.address_id where d.id = $1`,
    [deliveryId],
  );
  // Same answer for "missing" and "not yours": ids from other areas reveal nothing.
  if (!r.rows[0] || !r.rows[0].zone_id || !zones.includes(r.rows[0].zone_id)) throw notFound('Delivery');
}

export async function setStatus(deps: Deps, actor: Actor, deliveryId: string, status: SupplierStatus, reason?: string) {
  if (!SUPPLIER_STATUSES.includes(status)) throw badRequest('Unsupported status', 'INVALID_STATUS');
  if (status === 'failed' && !reason?.trim()) throw badRequest('Tell the customer why the delivery failed', 'REASON_REQUIRED');
  await assertDeliveryInZones(deps, actor, deliveryId);
  return setDeliveryStatus(deps, actor.userId, deliveryId, status, reason);
}

/** Bulk update (e.g. "mark all delivered"). Each delivery is checked and applied on its own; failures are reported. */
export async function setStatusBulk(deps: Deps, actor: Actor, ids: string[], status: SupplierStatus) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      await setStatus(deps, actor, id, status);
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message ?? 'Failed' });
    }
  }
  return { updated: results.filter((r) => r.ok).length, results };
}

export async function customers(deps: Deps, actor: Actor, f: { zoneId?: string; status?: string; q?: string }) {
  const zones = await allowedZones(deps.db, actor, f.zoneId);
  if (!zones.length) return [];
  const params: unknown[] = [zones];
  let where = `a.zone_id = any($1::uuid[])`;
  if (f.status) { params.push(f.status); where += ` and s.status = $${params.length}`; }
  if (f.q) { params.push(`%${f.q.replace(/[%_]/g, '')}%`); where += ` and (p.full_name ilike $${params.length} or a.line1 ilike $${params.length} or a.phone ilike $${params.length})`; }
  const today = zonedNow(deps.now()).date;
  params.push(today);
  const r = await deps.db.query(
    `select s.id subscription_id, s.status, s.frequency, s.weekdays, s.start_date::text start_date, s.delivery_balance,
            p.full_name customer_name, a.recipient_name, a.phone, a.line1, a.line2, a.landmark, a.city, a.postal_code,
            z.name zone_name, a.delivery_instructions,
            coalesce((select string_agg(si.quantity || ' x ' || pr.name || ' ' || v.size_label, ', ' order by pr.name)
              from subscription_items si join product_variants v on v.id = si.variant_id join products pr on pr.id = v.product_id
              where si.subscription_id = s.id), '') items,
            (select min(d.delivery_date)::text from deliveries d where d.subscription_id = s.id and d.delivery_date >= $${params.length}
              and d.status in ('scheduled','pending','out_for_delivery')) next_delivery
     from subscriptions s join addresses a on a.id = s.address_id join delivery_zones z on z.id = a.zone_id join profiles p on p.id = s.user_id
     where ${where} order by z.name, a.postal_code, a.line1 limit 500`,
    params,
  );
  return camel(r.rows);
}

export async function reports(deps: Deps, actor: Actor, from: ISODate, to: ISODate, zoneId?: string) {
  if (diffDays(to, from) < 0 || diffDays(to, from) > 92) throw badRequest('Choose a range of up to 3 months', 'INVALID_RANGE');
  const zones = await allowedZones(deps.db, actor, zoneId);
  if (!zones.length) return { days: [], products: [], totals: { delivered: 0, failed: 0, skipped: 0, valueMinor: 0 } };
  const days = (await deps.db.query(
    `select d.delivery_date::text date,
            count(*) filter (where d.status = 'delivered')::int delivered,
            count(*) filter (where d.status = 'failed')::int failed,
            count(*) filter (where d.status = 'skipped')::int skipped,
            coalesce(sum(d.total_minor) filter (where d.status = 'delivered'), 0)::int value_minor
     from deliveries d join addresses a on a.id = d.address_id
     where a.zone_id = any($1::uuid[]) and d.delivery_date between $2 and $3
     group by d.delivery_date order by d.delivery_date`,
    [zones, from, to],
  )).rows;
  const products = (await deps.db.query(
    `select di.name, sum(di.quantity)::int quantity
     from deliveries d join addresses a on a.id = d.address_id join delivery_items di on di.delivery_id = d.id
     where a.zone_id = any($1::uuid[]) and d.delivery_date between $2 and $3 and d.status = 'delivered'
     group by di.name order by quantity desc`,
    [zones, from, to],
  )).rows;
  const c = camel<any[]>(days);
  return {
    days: c,
    products: camel(products),
    totals: c.reduce((t, d) => ({ delivered: t.delivered + d.delivered, failed: t.failed + d.failed, skipped: t.skipped + d.skipped, valueMinor: t.valueMinor + d.valueMinor }),
      { delivered: 0, failed: 0, skipped: 0, valueMinor: 0 }),
  };
}

