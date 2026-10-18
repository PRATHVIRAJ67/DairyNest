import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
let db: PGlite;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

async function as(uid: string | null, sql: string, role = 'authenticated') {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ''}',false);`);
  try {
    return await db.query<any>(sql);
  } finally {
    await db.exec('reset role');
  }
}
async function fails(p: Promise<unknown>, re?: RegExp) {
  await expect(p).rejects.toThrow(re);
}

beforeAll(async () => {
  db = new PGlite();
  // Minimal stand-in for Supabase's auth schema and roles.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), phone text, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  await db.exec(`insert into auth.users (id, phone) values ('${A}','+919876500001'), ('${B}','+919876500002');`);
  const zone = (await db.query<{ id: string }>(`select id from delivery_zones limit 1`)).rows[0].id;
  for (const [u, n] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    await db.exec(`insert into addresses (user_id,label,recipient_name,phone,line1,city,postal_code,is_default,zone_id)
      values ('${u}','Home','${n}','+919876543210','12 MG Road','Bengaluru','560001',true,'${zone}')`);
  }
});

const subSql = (uid: string, key: string) => `
  insert into subscriptions (user_id,address_id,status,frequency,start_date,schedule_anchor,idempotency_key)
  select '${uid}', id, 'pending_payment','daily','2026-04-01','2026-04-01','${key}' from addresses where user_id='${uid}' returning id`;

describe('constraints', () => {
  it('trigger created profiles for new auth users', async () => {
    expect((await db.query<any>(`select count(*)::int c from profiles`)).rows[0]).toEqual({ c: 2 });
  });
  it('rejects invalid postal code and phone', async () => {
    await fails(
      db.exec(`insert into addresses (user_id,label,recipient_name,phone,line1,city,postal_code) values ('${A}','x','x','+919876543210','l','c','012345')`),
    );
    await fails(
      db.exec(`insert into addresses (user_id,label,recipient_name,phone,line1,city,postal_code) values ('${A}','x','x','12345','l','c','560001')`),
    );
  });
  it('allows only one default address per user', async () => {
    await fails(
      db.exec(`insert into addresses (user_id,label,recipient_name,phone,line1,city,postal_code,is_default) values ('${A}','2','x','+919876543210','l','c','560001',true)`),
      /uq_addresses_one_default|duplicate/,
    );
  });
  it('rejects negative money and mrp below price', async () => {
    await fails(
      db.exec(`insert into product_variants (product_id,sku,name,size_label,price_minor,mrp_minor) select id,'X1','n','s',-1,0 from products limit 1`),
    );
    await fails(
      db.exec(`insert into product_variants (product_id,sku,name,size_label,price_minor,mrp_minor) select id,'X2','n','s',500,100 from products limit 1`),
    );
  });
  it('weekdays frequency requires weekdays', async () => {
    await fails(
      db.exec(`insert into subscriptions (user_id,address_id,frequency,start_date,schedule_anchor,idempotency_key) select '${A}',id,'weekdays','2026-04-01','2026-04-01','k-wd' from addresses where user_id='${A}'`),
    );
  });
  it('duplicate idempotency key per user is rejected', async () => {
    await db.exec(subSql(A, 'idem-1'));
    await fails(db.exec(subSql(A, 'idem-1')));
  });
  it('duplicate webhook event ids are rejected', async () => {
    await db.exec(`insert into payment_webhook_events (event_id,event_type,payload) values ('evt1','payment.captured','{}')`);
    await fails(db.exec(`insert into payment_webhook_events (event_id,event_type,payload) values ('evt1','payment.captured','{}')`));
  });
});

describe('row level security', () => {
  it('a customer only sees their own addresses', async () => {
    const r = await as(A, `select recipient_name from addresses`);
    expect(r.rows).toEqual([{ recipient_name: 'A' }]);
  });
  it('changing an id does not leak or modify another customer data', async () => {
    expect((await as(A, `select * from addresses where user_id = '${B}'`)).rows).toHaveLength(0);
    expect((await as(A, `update addresses set label='hacked' where user_id='${B}' returning id`)).rows).toHaveLength(0);
  });
  it('customers cannot escalate role or create subscriptions directly', async () => {
    await fails(as(A, `update profiles set role='admin' where id='${A}'`), /permission denied/);
    await fails(as(A, subSql(A, 'client-direct')), /permission denied/);
  });
  it('subscriptions are isolated per user', async () => {
    const sid = (await db.query<{ id: string }>(`select id from subscriptions where user_id='${A}' limit 1`)).rows[0].id;
    expect((await as(A, `select id from subscriptions`)).rows.map((r: any) => r.id)).toContain(sid);
    expect((await as(B, `select id from subscriptions`)).rows).toHaveLength(0);
  });
  it('anon can read the catalog but not private tables', async () => {
    expect((await as(null, `select count(*)::int c from products`, 'anon')).rows[0]).toEqual({ c: 7 });
    await fails(as(null, `select * from addresses`, 'anon'), /permission denied/);
    await fails(as(A, `select * from payment_webhook_events`), /permission denied/);
    await fails(as(A, `select * from coupons`), /permission denied/);
  });
  it('clients cannot execute payment functions', async () => {
    await fails(as(A, `select fn_apply_refund('x', 1)`), /permission denied/);
  });
});

describe('payment and delivery functions (service role)', () => {
  let subId: string;
  it('setup: order for the pending subscription', async () => {
    subId = (await db.query<{ id: string }>(`select id from subscriptions where user_id='${A}' limit 1`)).rows[0].id;
    const v = (await db.query<{ id: string; price_minor: number }>(`select id, price_minor from product_variants where sku='CM-500'`)).rows[0];
    await db.exec(`insert into subscription_items (subscription_id,variant_id,quantity,unit_price_minor) values ('${subId}','${v.id}',2,${v.price_minor})`);
    await db.exec(`insert into payment_orders (user_id,subscription_id,provider_order_id,amount_minor,subtotal_minor,period_start,period_end,deliveries_count)
      values ('${A}','${subId}','order_TEST1',180000,180000,'2026-04-01','2026-04-30',30)`);
  });
  it('rejects amount mismatch', async () => {
    await fails(as(null, `select fn_apply_payment_capture('order_TEST1','pay_1',100,'upi')`, 'service_role'), /amount_mismatch/);
  });
  it('capture activates the subscription, issues one invoice and is idempotent', async () => {
    const r1 = (await as(null, `select fn_apply_payment_capture('order_TEST1','pay_1',180000,'upi') r`, 'service_role')).rows[0];
    expect(r1.r.already_processed).toBe(false);
    const r2 = (await as(null, `select fn_apply_payment_capture('order_TEST1','pay_1',180000,'upi') r`, 'service_role')).rows[0];
    expect(r2.r.already_processed).toBe(true);
    const s = (await db.query<any>(`select status, delivery_balance b from subscriptions where id='${subId}'`)).rows[0];
    expect(s).toEqual({ status: 'active', b: 30 });
    expect((await db.query<any>(`select count(*)::int c from invoices`)).rows[0].c).toBe(1);
    expect((await db.query<any>(`select count(*)::int c from payments where status='captured'`)).rows[0].c).toBe(1);
  });
  it('a late failure event cannot downgrade a captured payment', async () => {
    await as(null, `select fn_apply_payment_failure('order_TEST1','pay_1',180000,'late')`, 'service_role');
    expect((await db.query<any>(`select status from payments where provider_payment_id='pay_1'`)).rows[0].status).toBe('captured');
  });
  it('inserts deliveries once and honours skips and pauses', async () => {
    await db.exec(`insert into subscription_skipped_dates (subscription_id, skip_date) values ('${subId}','2026-04-03')`);
    await db.exec(`insert into subscription_pauses (subscription_id, starts_on, ends_on) values ('${subId}','2026-04-05','2026-04-06')`);
    const dates = ['2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-04-07'];
    const arr = dates.map((d) => `'${d}'::date`).join(',');
    const n1 = (await as(null, `select fn_insert_deliveries('${subId}', array[${arr}]) n`, 'service_role')).rows[0];
    expect(n1.n).toBe(2);
    const n2 = (await as(null, `select fn_insert_deliveries('${subId}', array['2026-04-02'::date,'2026-04-07'::date]) n`, 'service_role')).rows[0];
    expect(n2.n).toBe(0);
    expect((await db.query<any>(`select count(*)::int c from delivery_items`)).rows[0].c).toBe(2);
    const sub = (await db.query<any>(`select delivery_balance b, paid_through::text pt from subscriptions where id='${subId}'`)).rows[0];
    expect(sub).toEqual({ b: 28, pt: '2026-04-07' });
    await fails(
      db.exec(`insert into deliveries (subscription_id,user_id,address_id,delivery_date) select id,user_id,address_id,'2026-04-02' from subscriptions where id='${subId}'`),
      /duplicate|unique/,
    );
  });
  it('stops scheduling when the prepaid balance is exhausted', async () => {
    await db.exec(`update subscriptions set delivery_balance = 3 where id='${subId}'`);
    const dates = Array.from({ length: 10 }, (_, i) => `'2026-04-${String(10 + i).padStart(2, '0')}'::date`).join(',');
    const n = (await as(null, `select fn_insert_deliveries('${subId}', array[${dates}]) n`, 'service_role')).rows[0];
    expect(n.n).toBe(3);
    expect((await db.query<any>(`select delivery_balance b from subscriptions where id='${subId}'`)).rows[0].b).toBe(0);
  });
  it('rejects deliveries for non-active subscriptions', async () => {
    const other = (await db.query<{ id: string }>(subSql(B, 'idem-b'))).rows[0].id;
    await fails(as(null, `select fn_insert_deliveries('${other}', array['2026-04-02'::date])`, 'service_role'), /subscription_not_active/);
  });
  it('refunds are bounded by the payment amount', async () => {
    await as(null, `select fn_apply_refund('pay_1', 50000)`, 'service_role');
    expect((await db.query<any>(`select status from payments where provider_payment_id='pay_1'`)).rows[0].status).toBe('partially_refunded');
    await fails(as(null, `select fn_apply_refund('pay_1', 999999999)`, 'service_role'), /refund_exceeds_payment/);
  });
  it('account deletion anonymises PII and cancels subscriptions', async () => {
    await as(null, `select fn_delete_account('${A}')`, 'service_role');
    expect((await db.query<any>(`select full_name, phone, deleted_at is not null d from profiles where id='${A}'`)).rows[0]).toEqual({ full_name: '', phone: null, d: true });
    expect((await db.query<any>(`select status from subscriptions where user_id='${A}'`)).rows[0].status).toBe('cancelled');
  });
});
