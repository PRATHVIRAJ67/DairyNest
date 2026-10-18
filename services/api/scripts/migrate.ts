/**
 * Fallback migration runner for when the Supabase CLI is not available.
 * Applies supabase/migrations/*.sql in order against DATABASE_URL, tracking them in public._app_migrations.
 * With --seed it also runs supabase/seed.sql (development only).
 * Prefer `supabase db push` when you have the CLI; do not mix both on the same database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase');
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });

await client.connect();
await client.query(`create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now())`);
const done = new Set((await client.query('select name from public._app_migrations')).rows.map((r) => r.name));
for (const f of readdirSync(join(dir, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) { console.log(`skip   ${f}`); continue; }
  console.log(`apply  ${f}`);
  await client.query('begin');
  try {
    await client.query(readFileSync(join(dir, 'migrations', f), 'utf8'));
    await client.query('insert into public._app_migrations (name) values ($1)', [f]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
if (process.argv.includes('--seed')) {
  console.log('seed   seed.sql');
  await client.query(readFileSync(join(dir, 'seed.sql'), 'utf8'));
}
await client.end();
console.log('done');
