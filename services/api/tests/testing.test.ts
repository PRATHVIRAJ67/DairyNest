import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { issueTestToken, readTestToken, testUserId } from '../src/testing';
import { createCtx, validAddress, type Ctx } from './harness';

const CODE = '482916';
const SECRET = 's'.repeat(40);
const PHONE = '+919876500111';

const login = (ctx: Ctx, phone = PHONE, code = CODE) =>
  request(ctx.app).post('/api/v1/auth/test-login').send({ phone, code });
const as = (ctx: Ctx, token: string) => ({
  get: (p: string) => request(ctx.app).get('/api/v1' + p).set('Authorization', `Bearer ${token}`),
  post: (p: string) => request(ctx.app).post('/api/v1' + p).set('Authorization', `Bearer ${token}`),
});

describe('testing mode is off by default', () => {
  it('has no test routes and refuses test tokens', async () => {
    const ctx = await createCtx();
    expect((await login(ctx)).status).toBe(401); // route absent: falls through to the authenticated router
    const t = issueTestToken(SECRET, PHONE, new Date()).token;
    expect((await as(ctx, t).get('/me')).status).toBe(401);
    expect((await as(ctx, 'x').post('/test/pay').send({ providerOrderId: 'order_x' })).status).toBe(401);
  });
  it('config validates the test settings', () => {
    const base = { DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'k'.repeat(20) };
    expect(() => loadConfig({ ...base, TEST_LOGIN_CODE: '12345' } as any)).toThrow(/6 digits/);
    expect(() => loadConfig({ ...base, TEST_SESSION_SECRET: 'short' } as any)).toThrow(/32 characters/);
    expect(loadConfig(base as any).PAYMENTS_MODE).toBe('razorpay');
  });
});

describe('test sessions', () => {
  it('round-trips, and rejects tampering, other secrets and expiry', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    const { token } = issueTestToken(SECRET, PHONE, now);
    expect(readTestToken(SECRET, token, now)).toEqual({ id: testUserId(PHONE), phone: PHONE, email: null });
    expect(readTestToken('o'.repeat(40), token, now)).toBeNull();
    const [, body, sig] = token.split('.');
    const forged = Buffer.from('+919999999999|9999999999').toString('base64url');
    expect(readTestToken(SECRET, `test.${forged}.${sig}`, now)).toBeNull();
    expect(readTestToken(SECRET, `test.${body}.${'0'.repeat(64)}`, now)).toBeNull();
    expect(readTestToken(SECRET, token, new Date('2026-12-01T00:00:00Z'))).toBeNull(); // 30-day expiry
  });
  it('gives each phone number a stable, distinct user id', () => {
    expect(testUserId(PHONE)).toBe(testUserId(PHONE));
    expect(testUserId(PHONE)).not.toBe(testUserId('+919876500112'));
    expect(testUserId(PHONE)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('test login + simulated payments end to end', () => {
  let ctx: Ctx;
  let token: string;
  beforeAll(async () => { ctx = await createCtx({ testing: { code: CODE, secret: SECRET } }); });

  it('rejects a wrong code and invalid numbers', async () => {
    expect((await login(ctx, PHONE, '000000')).status).toBe(401);
    expect((await login(ctx, '9876500111')).status).toBe(400);
    expect((await login(ctx, PHONE, '12')).status).toBe(400);
  });
  it('signs in, creates the auth user and profile, and the session works', async () => {
    const r = await login(ctx);
    expect(r.status).toBe(200);
    token = r.body.data.accessToken;
    expect(r.body.data.user).toEqual({ id: testUserId(PHONE), phone: PHONE });
    const u = (await ctx.pg.query<any>(`select phone from auth.users where id=$1`, [testUserId(PHONE)])).rows[0];
    expect(u.phone).toBe('919876500111'); // Supabase stores phones without "+"
    const me = await as(ctx, token).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ id: testUserId(PHONE), phone: PHONE });
    expect((await login(ctx)).body.data.user.id).toBe(testUserId(PHONE)); // same number, same customer
  });
  it('a full subscription can be paid with a simulated payment', async () => {
    const api = as(ctx, token);
    const addr = (await api.post('/addresses').send(validAddress)).body.data;
    const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
    const v = prods.flatMap((p) => p.variants).find((x: any) => x.sku === 'CM-500');
    const c = await api.post('/subscriptions').send({
      items: [{ variantId: v.id, quantity: 2 }], addressId: addr.id, schedule: { frequency: 'daily', startDate: '2026-03-11' },
      acceptTerms: true, idempotencyKey: 'testing-mode-1',
    });
    expect(c.status).toBe(201);
    expect(c.body.data.checkout.keyId).toBe('rzp_test_simulated');
    const orderId = c.body.data.checkout.providerOrderId;

    const declined = (await api.post('/test/pay').send({ providerOrderId: orderId, outcome: 'fail' })).body.data;
    expect((await api.post('/payments/verify').send(declined)).body.data.status).toBe('failed');

    const proof = (await api.post('/test/pay').send({ providerOrderId: orderId })).body.data;
    const tampered = { ...proof, razorpay_signature: 'a'.repeat(64) };
    expect((await api.post('/payments/verify').send(tampered)).body.error.code).toBe('INVALID_SIGNATURE');
    expect((await api.post('/payments/verify').send(proof)).body.data.status).toBe('paid');
    const s = (await api.get(`/subscriptions/${c.body.data.subscription.id}`)).body.data;
    expect(s.status).toBe('active');
    expect((await api.post('/test/pay').send({ providerOrderId: orderId })).body.error.code).toBe('ORDER_SETTLED');
  });
  it('another customer cannot pay or see someone else\'s order', async () => {
    const other = (await login(ctx, '+919876500999')).body.data.accessToken;
    const orderId = (await ctx.pg.query<any>(`select provider_order_id from payment_orders limit 1`)).rows[0].provider_order_id;
    expect((await as(ctx, other).post('/test/pay').send({ providerOrderId: orderId })).status).toBe(404);
  });
  it('rate-limits code guessing', async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i++) results.push((await login(ctx, PHONE, String(100000 + i))).status);
    expect(results).toContain(429);
  });
});
