// Makes a phone number an OWNER (admin) of the dashboard. Owners manage areas, suppliers and products.
// Usage (repo root): node services/api/scripts/make-owner.mjs +919876543210 "Your Name"
// Reads DATABASE_URL from the repo-root .env. If the number has never signed in, its account is created now
// and becomes theirs on first sign-in (same account id the test login and Supabase OTP will use).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const [phone, name = 'Owner'] = process.argv.slice(2);
if (!/^\+91[6-9]\d{9}$/.test(phone ?? '')) {
  console.error('Usage: node services/api/scripts/make-owner.mjs +91XXXXXXXXXX "Name"');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const url = /^DATABASE_URL=(.*)$/m.exec(readFileSync(join(root, '.env'), 'utf8'))?.[1];
if (!url) throw new Error('DATABASE_URL missing in .env');

// Must match testUserId() in services/api/src/testing.ts
const h = createHash('sha1').update(`dailydairy-test:${phone}`).digest('hex');
const fallbackId = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;

const c = new pg.Client({ connectionString: url.replace(':6543/', ':5432/'), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query('begin');
  const bare = phone.slice(1);
  let id = (await c.query('select id from auth.users where phone in ($1, $2) limit 1', [bare, phone])).rows[0]?.id;
  if (!id) {
    id = fallbackId;
    await c.query(
      `insert into auth.users (id, phone, aud, role, created_at, updated_at, phone_confirmed_at)
       values ($1, $2, 'authenticated', 'authenticated', now(), now(), now()) on conflict (id) do nothing`,
      [id, bare],
    );
  }
  await c.query(
    `insert into public.profiles (id, phone, full_name, role, profile_completed) values ($1, $2, $3, 'admin', true)
     on conflict (id) do update set role = 'admin', full_name = excluded.full_name, phone = excluded.phone, profile_completed = true`,
    [id, phone, name],
  );
  await c.query('delete from public.supplier_zones where supplier_id = $1', [id]);
  await c.query(`insert into public.audit_logs (actor_id, action, entity, entity_id) values ($1, 'owner.granted', 'profile', $2)`, [id, id]);
  await c.query('commit');
  console.log(`✔ ${phone} (${name}) is now an owner. Sign in to the dashboard with this number.`);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  await c.end();
}
