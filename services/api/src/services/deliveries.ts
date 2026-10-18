import { addDays, diffDays, isBeforeCutoff, zonedNow, type ISODate } from '@milk/shared';
import { camel } from '../db';
import type { Deps } from '../deps';
import { badRequest, conflict, notFound } from '../errors';
import { audit } from './subscriptions';

const SELECT = `d.id, d.subscription_id, d.delivery_date::text delivery_date, d.status, to_char(d.window_start,'HH24:MI') window_start,
  to_char(d.window_end,'HH24:MI') window_end, d.instructions, d.total_minor, d.delivered_at, d.failure_reason,
  a.label address_label, a.line1 address_line1, a.city address_city, a.postal_code address_postal_code,
  coalesce(to_char(z.cutoff_time,'HH24:MI'),'21:00') cutoff_time, coalesce(z.timezone,'Asia/Kolkata') timezone,
  coalesce((select json_agg(json_build_object('variantId', di.variant_id, 'name', di.name, 'quantity', di.quantity, 'unitPriceMinor', di.unit_price_minor))
    from delivery_items di where di.delivery_id = d.id), '[]') items`;
const FROM = `from deliveries d join addresses a on a.id=d.address_id left join delivery_zones z on z.id=a.zone_id`;

function decorate(deps: Deps, row: any) {
  const d = camel<any>(row);
  const beforeCutoff = isBeforeCutoff(d.deliveryDate, deps.now(), d.cutoffTime, d.timezone);
  // Without a scheduler nothing flips scheduled -> pending, so derive it: past cutoff = being prepared.
  const displayStatus = d.status === 'scheduled' && !beforeCutoff ? 'pending' : d.status;
  return { ...d, displayStatus, canModify: d.status === 'scheduled' && beforeCutoff };
}

export async function listDeliveries(deps: Deps, userId: string, f: { from: ISODate; to: ISODate; subscriptionId?: string }) {
  if (diffDays(f.to, f.from) < 0) throw badRequest('`to` must be on or after `from`', 'INVALID_RANGE');
  if (diffDays(f.to, f.from) > 62) throw badRequest('Range cannot exceed 62 days', 'INVALID_RANGE');
  const params: unknown[] = [userId, f.from, f.to];
  let extra = '';
  if (f.subscriptionId) { params.push(f.subscriptionId); extra = ' and d.subscription_id = $4'; }
  const r = await deps.db.query(`select ${SELECT} ${FROM} where d.user_id=$1 and d.delivery_date between $2 and $3${extra} order by d.delivery_date, d.created_at`, params);
  return r.rows.map((x) => decorate(deps, x));
}

export async function upcoming(deps: Deps, userId: string, limit = 5) {
  const today = zonedNow(deps.now()).date;
  const r = await deps.db.query(
    `select ${SELECT} ${FROM} where d.user_id=$1 and d.delivery_date >= $2 and d.status in ('scheduled','pending','out_for_delivery') order by d.delivery_date limit $3`,
    [userId, today, limit],
  );
  return r.rows.map((x) => decorate(deps, x));
}

export async function getDelivery(deps: Deps, userId: string, id: string) {
  const r = await deps.db.query(`select ${SELECT} ${FROM} where d.id=$1 and d.user_id=$2`, [id, userId]);
  if (!r.rows[0]) throw notFound('Delivery');
  return decorate(deps, r.rows[0]);
}

/** Operations endpoint (admin role): move a delivery through its lifecycle. Failed deliveries are credited back. */
export async function setDeliveryStatus(deps: Deps, actorId: string, id: string, status: 'pending' | 'out_for_delivery' | 'delivered' | 'failed' | 'cancelled', reason?: string) {
  const ALLOWED: Record<string, string[]> = {
    scheduled: ['pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled'],
    pending: ['out_for_delivery', 'delivered', 'failed', 'cancelled'],
    out_for_delivery: ['delivered', 'failed'],
  };
  const out = await deps.db.tx(async (q) => {
    const d = (await q.query<any>(`select id, subscription_id, user_id, status, delivery_date::text delivery_date from deliveries where id=$1 for update`, [id])).rows[0];
    if (!d) throw notFound('Delivery');
    if (!ALLOWED[d.status]?.includes(status)) throw conflict(`Cannot move a ${d.status} delivery to ${status}`, 'INVALID_TRANSITION');
    await q.query(`update deliveries set status=$1, delivered_at = case when $1='delivered' then now() else delivered_at end, failure_reason=$2 where id=$3`, [status, reason ?? null, id]);
    if (status === 'failed' || status === 'cancelled') await q.query(`update subscriptions set delivery_balance = delivery_balance + 1 where id=$1 and status <> 'cancelled'`, [d.subscription_id]);
    await audit(q, actorId, `delivery.${status}`, 'delivery', id, { reason });
    return d;
  });
  const titles: Record<string, string> = { delivered: 'Delivered', failed: 'Delivery issue', out_for_delivery: 'Out for delivery', cancelled: 'Delivery cancelled', pending: 'Preparing your order' };
  await deps.notifier.notify(deps.db, {
    userId: out.user_id, type: `delivery.${status}`, category: 'deliveryUpdates', title: titles[status],
    body: status === 'failed' ? 'We could not deliver today. The delivery has been credited back to your plan.' : `Your delivery for ${out.delivery_date} is now: ${titles[status].toLowerCase()}.`,
    data: { deliveryId: id },
  });
  return { id, status };
}

export { addDays };
