import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import type { AuthUser, TokenVerifier } from '../src/auth';
import type { Config } from '../src/config';
import type { Db, Queryable } from '../src/db';
import type { Deps } from '../src/deps';
import { createLogger } from '../src/logger';
import { Notifier, type PushSender } from '../src/notify';
import { hmacHex, safeEqualHex, UnconfiguredProvider, type PaymentProvider, type ProviderPayment } from '../src/payments/provider';

export const CHECKOUT_SECRET = 'test_key_secret';
export const WEBHOOK_SECRET = 'test_webhook_secret';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase');

export function pgliteDb(pg: PGlite): Db {
  const wrap = (x: { query: PGlite['query'] }): Queryable => ({
    async query(sql, params) {
      const r = await x.query<any>(sql, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction(async (tx) => fn(wrap(tx as any))),
    close: async () => undefined,
  };
}

/** Test provider with REAL HMAC verification; only the network calls are replaced. */
export class TestProvider implements PaymentProvider {
  readonly name = 'razorpay';
  orders = new Map<string, { amount: number }>();
  payments = new Map<string, ProviderPayment>();
  refunds: { paymentId: string; amountMinor: number }[] = [];
  private n = 0;
  isConfigured() { return true; }
  publicKey() { return 'rzp_test_key'; }
  async createOrder(a: { amountMinor: number }) {
    const id = `order_T${++this.n}`;
    this.orders.set(id, { amount: a.amountMinor });
    return { id };
  }
  verifyCheckoutSignature(a: { orderId: string; paymentId: string; signature: string }) {
    return safeEqualHex(hmacHex(CHECKOUT_SECRET, `${a.orderId}|${a.paymentId}`), a.signature);
  }
  verifyWebhookSignature(raw: Buffer, sig: string | undefined) {
    return !!sig && safeEqualHex(hmacHex(WEBHOOK_SECRET, raw), sig);
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('unknown payment ' + id);
    return p;
  }
  async fetchOrderPayments(orderId: string) { return [...this.payments.values()].filter((p) => p.orderId === orderId); }
  async refund(a: { paymentId: string; amountMinor: number }) {
    this.refunds.push(a);
    return { id: 'rfnd_1', status: 'processed' };
  }
  /** Simulates what Razorpay Checkout does on the device. */
  pay(orderId: string, opts: { status?: ProviderPayment['status']; amountMinor?: number; id?: string } = {}) {
    const id = opts.id ?? `pay_T${this.payments.size + 1}`;
    this.payments.set(id, {
      id, orderId, amountMinor: opts.amountMinor ?? this.orders.get(orderId)!.amount, status: opts.status ?? 'captured',
      method: 'upi', amountRefundedMinor: 0, errorDescription: opts.status === 'failed' ? 'Payment declined by bank' : undefined,
    });
    return { razorpay_order_id: orderId, razorpay_payment_id: id, razorpay_signature: hmacHex(CHECKOUT_SECRET, `${orderId}|${id}`) };
  }
  webhook(event: string, payment: ProviderPayment, eventId: string) {
    const body = JSON.stringify({
      event, payload: { payment: { entity: { id: payment.id, order_id: payment.orderId, amount: payment.amountMinor, method: payment.method, error_description: payment.errorDescription } } },
    });
    return { body, signature: hmacHex(WEBHOOK_SECRET, body), eventId };
  }
}

class FakeVerifier implements TokenVerifier {
  async verify(token: string): Promise<AuthUser | null> {
    const m = /^user:([0-9a-f-]{36})$/.exec(token);
    return m ? { id: m[1], phone: null, email: null } : null;
  }
}

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const U1 = uid(1);
export const U2 = uid(2);
export const ADMIN = uid(99);

export interface Ctx {
  pg: PGlite; app: Express; deps: Deps; provider: TestProvider; clock: { now: Date };
  as: (userId: string) => { get: (p: string) => request.Test; post: (p: string) => request.Test; put: (p: string) => request.Test; patch: (p: string) => request.Test; delete: (p: string) => request.Test };
  pushes: { token: string; title: string }[];
}

export async function createCtx(opts: { payments?: 'test' | 'unconfigured' } = {}): Promise<Ctx> {
  const pg = new PGlite();
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), phone text, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  for (const f of readdirSync(join(root, 'migrations')).sort()) await pg.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  await pg.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  for (const id of [U1, U2, ADMIN]) await pg.exec(`insert into auth.users (id) values ('${id}')`);
  await pg.exec(`update profiles set role='admin' where id='${ADMIN}'`);
  await pg.exec(`update coupons set valid_from = '2020-01-01'`); // seeded with now(); tests run on a fake clock

  const log = createLogger('silent');
  const provider = new TestProvider();
  const pushes: { token: string; title: string }[] = [];
  const push: PushSender = { async send(token, title) { pushes.push({ token, title }); return true; } };
  const clock = { now: new Date('2026-03-10T10:00:00Z') }; // 15:30 IST, before the 21:00 cutoff
  const config: Config = { NODE_ENV: 'test', PORT: 0, LOG_LEVEL: 'silent', CORS_ORIGINS: '*', DATABASE_URL: 'x', SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'anon-key-placeholder' };
  const deps: Deps = {
    db: pgliteDb(pg), verifier: new FakeVerifier(), log, config, now: () => clock.now,
    payments: opts.payments === 'unconfigured' ? new UnconfiguredProvider() : provider,
    notifier: new Notifier(push, log),
  };
  const app = createApp(deps, { rateLimit: false });
  const as = (userId: string) => {
    const t = `Bearer user:${userId}`;
    return {
      get: (p: string) => request(app).get('/api/v1' + p).set('Authorization', t),
      post: (p: string) => request(app).post('/api/v1' + p).set('Authorization', t),
      put: (p: string) => request(app).put('/api/v1' + p).set('Authorization', t),
      patch: (p: string) => request(app).patch('/api/v1' + p).set('Authorization', t),
      delete: (p: string) => request(app).delete('/api/v1' + p).set('Authorization', t),
    };
  };
  return { pg, app, deps, provider, clock, as, pushes };
}

export const validAddress = {
  label: 'Home', recipientName: 'Asha Rao', phone: '+919876543210', line1: '12 MG Road', city: 'Bengaluru', postalCode: '560001',
};

/** Creates an address and a paid, active daily subscription starting tomorrow. */
export async function activeSubscription(ctx: Ctx, userId = U1, extra: { items?: { sku: string; quantity: number }[]; frequency?: string; weekdays?: number[]; key?: string } = {}) {
  const api = ctx.as(userId);
  const addr = (await api.post('/addresses').send(validAddress)).body.data;
  const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
  const variant = (sku: string) => prods.flatMap((p) => p.variants).find((v: any) => v.sku === sku).id as string;
  const items = (extra.items ?? [{ sku: 'CM-500', quantity: 2 }]).map((i) => ({ variantId: variant(i.sku), quantity: i.quantity }));
  const body = {
    items, addressId: addr.id, acceptTerms: true, idempotencyKey: extra.key ?? `key-${userId}-${Math.random()}`,
    schedule: { frequency: extra.frequency ?? 'daily', startDate: '2026-03-11', ...(extra.weekdays ? { weekdays: extra.weekdays } : {}) },
  };
  const created = await api.post('/subscriptions').send(body);
  if (created.status !== 201) throw new Error('create failed: ' + JSON.stringify(created.body));
  const { checkout, subscription } = created.body.data;
  const proof = ctx.provider.pay(checkout.providerOrderId);
  const verified = await api.post('/payments/verify').send(proof);
  if (verified.body.data?.status !== 'paid') throw new Error('verify failed: ' + JSON.stringify(verified.body));
  return { addr, variant, body, subId: subscription.id as string, checkout, proof, prods };
}
