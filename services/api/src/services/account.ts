import type { z } from 'zod';
import type { notificationPrefsInput } from '@milk/validation';
import { camel } from '../db';
import type { Deps } from '../deps';
import { notFound } from '../errors';
import { audit } from './subscriptions';

export async function getMe(deps: Deps, userId: string) {
  const r = await deps.db.query(
    `select id, full_name, phone, email, role, notification_prefs, profile_completed, created_at from profiles where id=$1`,
    [userId],
  );
  if (!r.rows[0]) throw notFound('Profile');
  return camel(r.rows[0]);
}

export async function updateMe(deps: Deps, userId: string, v: { fullName: string; email?: string }) {
  await deps.db.query(
    `update profiles set full_name=$1, email=coalesce(nullif($2,''), email), profile_completed=true where id=$3`,
    [v.fullName, v.email ?? '', userId],
  );
  return getMe(deps, userId);
}

export async function updatePrefs(deps: Deps, userId: string, prefs: z.infer<typeof notificationPrefsInput>) {
  await deps.db.query(`update profiles set notification_prefs=$1 where id=$2`, [JSON.stringify(prefs), userId]);
  return getMe(deps, userId);
}

export async function setPushToken(deps: Deps, userId: string, token: string | null) {
  await deps.db.query(`update profiles set push_token=$1 where id=$2`, [token, userId]);
}

/** Anonymises personal data, cancels subscriptions, keeps financial records, then removes the auth user. */
export async function deleteAccount(deps: Deps, userId: string) {
  await deps.db.tx(async (q) => {
    await q.query(`select fn_delete_account($1)`, [userId]);
  });
  await audit(deps.db, userId, 'account.deletion_completed', 'profile', userId);
  if (deps.deleteAuthUser) await deps.deleteAuthUser(userId);
  return { deleted: true, authUserRemoved: !!deps.deleteAuthUser };
}

// ---- notifications
export async function listNotifications(deps: Deps, userId: string, page: number, pageSize: number) {
  const r = await deps.db.query(
    `select id, type, title, body, data, read_at, created_at from notifications where user_id=$1 order by created_at desc limit $2 offset $3`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  const c = (await deps.db.query<{ total: number; unread: number }>(
    `select count(*)::int total, count(*) filter (where read_at is null)::int unread from notifications where user_id=$1`, [userId])).rows[0];
  return { items: camel(r.rows), total: c.total, unread: c.unread };
}
export async function markRead(deps: Deps, userId: string, id: string) {
  const r = await deps.db.query(`update notifications set read_at=coalesce(read_at, now()) where id=$1 and user_id=$2`, [id, userId]);
  if (r.rowCount === 0) throw notFound('Notification');
}
export async function markAllRead(deps: Deps, userId: string) {
  await deps.db.query(`update notifications set read_at=now() where user_id=$1 and read_at is null`, [userId]);
}

// ---- support
export async function listTickets(deps: Deps, userId: string) {
  const r = await deps.db.query(`select id, category, subject, message, status, created_at from support_tickets where user_id=$1 order by created_at desc limit 50`, [userId]);
  return camel(r.rows);
}
export async function createTicket(deps: Deps, userId: string, t: { category: string; subject: string; message: string }) {
  const r = await deps.db.query(
    `insert into support_tickets (user_id, category, subject, message) values ($1,$2,$3,$4) returning id, category, subject, message, status, created_at`,
    [userId, t.category, t.subject, t.message],
  );
  return camel(r.rows[0]);
}

export const FAQS = [
  { q: 'What time will my milk arrive?', a: 'Deliveries arrive in your zone\'s morning window, shown on the home screen and in your delivery details.' },
  { q: 'Until when can I pause, skip or change a delivery?', a: 'Changes for a day are accepted until the evening cutoff (shown in your subscription, typically 9 PM) the day before.' },
  { q: 'What happens to the money for skipped or paused days?', a: 'You prepay for a number of deliveries. Skipped and paused days are not consumed, so your prepaid deliveries simply last longer.' },
  { q: 'Is my subscription renewed automatically?', a: 'Not yet. Subscriptions are prepaid for 30 days and you renew manually when fewer than two weeks of deliveries remain.' },
  { q: 'How do refunds work?', a: 'If you cancel with unused prepaid deliveries, we open a refund review for you. Approved refunds go back to your original payment method.' },
  { q: 'Which areas do you deliver to?', a: 'Enter your PIN code when adding an address; we tell you instantly whether it is serviceable.' },
];
