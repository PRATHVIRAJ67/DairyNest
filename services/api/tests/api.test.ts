import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { ADMIN, U1, U2, activeSubscription, createCtx, uid, validAddress, type Ctx } from './harness';

const getDelivery = async (ctx: Ctx, subId: string, from = '2026-03-11', to = '2026-03-31') =>
  (await ctx.as(U1).get(`/deliveries?from=${from}&to=${to}&subscriptionId=${subId}`)).body.data as any[];

describe('platform: config, headers, docs, validation', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createCtx(); });

  it('environment validation rejects missing required variables', () => {
    expect(() => loadConfig({} as any)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'k'.repeat(20), NODE_ENV: 'production' } as any)).toThrow(/CORS_ORIGINS/);
  });
  it('health is public, has request id and security headers', async () => {
    const r = await request(ctx.app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('serves OpenAPI and unknown routes use the error format', async () => {
    const spec = await request(ctx.app).get('/api/v1/openapi.json');
    expect(spec.body.openapi).toBe('3.0.3');
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(20);
    const nf = await ctx.as(U1).get('/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
  it('malformed JSON returns a clean 400', async () => {
    const r = await request(ctx.app).post('/api/v1/addresses').set('Authorization', `Bearer user:${U1}`).set('Content-Type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });
});

describe('authentication and authorization', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createCtx(); });

  it('rejects missing and invalid tokens', async () => {
    expect((await request(ctx.app).get('/api/v1/me')).status).toBe(401);
    expect((await request(ctx.app).get('/api/v1/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await request(ctx.app).get('/api/v1/subscriptions')).status).toBe(401);
  });
  it('valid token returns the profile', async () => {
    const r = await ctx.as(U1).get('/me');
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(U1);
    expect(r.body.data.role).toBe('customer');
  });
  it('customers are forbidden from admin operations; admins are allowed past the role check', async () => {
    const id = uid(555);
    expect((await ctx.as(U1).patch(`/admin/deliveries/${id}/status`).send({ status: 'delivered' })).status).toBe(403);
    expect((await ctx.as(U1).post(`/admin/payments/${id}/refund`).send({})).status).toBe(403);
    expect((await ctx.as(ADMIN).patch(`/admin/deliveries/${id}/status`).send({ status: 'delivered' })).status).toBe(404);
  });
  it('role cannot be self-escalated through the profile endpoint', async () => {
    await ctx.as(U1).put('/me').send({ fullName: 'Asha Rao', role: 'admin' });
    expect((await ctx.as(U1).get('/me')).body.data.role).toBe('customer');
  });
});

describe('product catalog', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createCtx(); });

  it('lists products with variants and pagination meta (public)', async () => {
    const r = await request(ctx.app).get('/api/v1/products?pageSize=3');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(3);
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 3, total: 7 });
    expect(r.body.data[0].variants.length).toBeGreaterThan(0);
    expect(typeof r.body.data[0].variants[0].priceMinor).toBe('number');
  });
  it('filters by category, featured flag and search', async () => {
    const curd = await request(ctx.app).get('/api/v1/products?category=curd');
    expect(curd.body.data.map((p: any) => p.category)).toEqual(['curd', 'curd', 'curd']);
    expect((await request(ctx.app).get('/api/v1/products?featured=true')).body.meta.total).toBe(3);
    expect((await request(ctx.app).get('/api/v1/products?q=greek')).body.data[0].slug).toBe('greek-curd');
  });
  it('product detail by slug and unknown product', async () => {
    const r = await request(ctx.app).get('/api/v1/products/set-curd');
    expect(r.body.data.variants).toHaveLength(3);
    expect((await request(ctx.app).get('/api/v1/products/does-not-exist')).status).toBe(404);
  });
  it('validates query parameters', async () => {
    const r = await request(ctx.app).get('/api/v1/products?page=0&category=cheese');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.length).toBeGreaterThan(0);
  });
  it('serviceability check', async () => {
    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=560001')).body.data.serviceable).toBe(true);
    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=999999')).body.data.serviceable).toBe(false);
    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=abc')).status).toBe(400);
  });
});

describe('addresses', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createCtx(); });

  it('validates input, sets the first address as default, links the zone', async () => {
    expect((await ctx.as(U1).post('/addresses').send({ ...validAddress, postalCode: '12345' })).status).toBe(400);
    expect((await ctx.as(U1).post('/addresses').send({ ...validAddress, phone: '123' })).status).toBe(400);
    const a = await ctx.as(U1).post('/addresses').send(validAddress);
    expect(a.status).toBe(201);
    expect(a.body.data.isDefault).toBe(true);
    expect(a.body.data.zoneId).toBeTruthy();
    const b = await ctx.as(U1).post('/addresses').send({ ...validAddress, label: 'Office', isDefault: true });
    expect(b.body.data.isDefault).toBe(true);
    const list = (await ctx.as(U1).get('/addresses')).body.data;
    expect(list.filter((x: any) => x.isDefault)).toHaveLength(1);
  });
  it('edit, set default, and delete re-assigns default', async () => {
    const list = (await ctx.as(U1).get('/addresses')).body.data;
    const [def, other] = [list.find((x: any) => x.isDefault), list.find((x: any) => !x.isDefault)];
    const patched = await ctx.as(U1).patch(`/addresses/${other.id}`).send({ landmark: 'Near metro', postalCode: '999999' });
    expect(patched.body.data.landmark).toBe('Near metro');
    expect(patched.body.data.zoneId).toBeNull();
    await ctx.as(U1).post(`/addresses/${other.id}/default`).send();
    expect((await ctx.as(U1).delete(`/addresses/${other.id}`)).status).toBe(204);
    const after = (await ctx.as(U1).get('/addresses')).body.data;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(def.id);
    expect(after[0].isDefault).toBe(true);
  });
});

describe('customer data isolation', () => {
  let ctx: Ctx; let subId: string; let addrId: string; let invoiceId: string;
  beforeAll(async () => {
    ctx = await createCtx();
    const s = await activeSubscription(ctx, U1);
    subId = s.subId; addrId = s.addr.id;
    invoiceId = (await ctx.as(U1).get('/invoices')).body.data[0].id;
  });

  it('another customer sees none of the owner data', async () => {
    const b = ctx.as(U2);
    expect((await b.get('/addresses')).body.data).toEqual([]);
    expect((await b.get('/subscriptions')).body.data).toEqual([]);
    expect((await b.get('/payments')).body.data).toEqual([]);
    expect((await b.get('/invoices')).body.data).toEqual([]);
    expect((await b.get('/deliveries?from=2026-03-01&to=2026-03-31')).body.data).toEqual([]);
  });
  it('guessing ids returns 404 for every resource and every mutation', async () => {
    const b = ctx.as(U2);
    const dels = await getDelivery(ctx, subId);
    expect((await b.get(`/subscriptions/${subId}`)).status).toBe(404);
    expect((await b.get(`/subscriptions/${subId}/history`)).status).toBe(404);
    expect((await b.post(`/subscriptions/${subId}/pause`).send({})).status).toBe(404);
    expect((await b.post(`/subscriptions/${subId}/resume`).send()).status).toBe(404);
    expect((await b.post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-12' })).status).toBe(404);
    expect((await b.post(`/subscriptions/${subId}/cancel`).send({})).status).toBe(404);
    expect((await b.patch(`/subscriptions/${subId}/items`).send({ items: [{ variantId: uid(1), quantity: 1 }] })).status).toBe(404);
    expect((await b.post(`/subscriptions/${subId}/deliveries/generate`).send({})).status).toBe(404);
    expect((await b.get(`/deliveries/${dels[0].id}`)).status).toBe(404);
    expect((await b.get(`/invoices/${invoiceId}`)).status).toBe(404);
    expect((await b.get(`/invoices/${invoiceId}/receipt`)).status).toBe(404);
    expect((await b.patch(`/addresses/${addrId}`).send({ label: 'pwned' })).status).toBe(404);
    expect((await b.delete(`/addresses/${addrId}`)).status).toBe(404);
  });
  it('cannot subscribe using another customer address', async () => {
    const prods = (await request(ctx.app).get('/api/v1/products')).body.data;
    const r = await ctx.as(U2).post('/subscriptions/quote').send({
      items: [{ variantId: prods[0].variants[0].id, quantity: 1 }], addressId: addrId, schedule: { frequency: 'daily', startDate: '2026-03-11' },
    });
    expect(r.status).toBe(404);
  });
  it('the owner data is unchanged after the attacks', async () => {
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('active');
    expect((await ctx.as(U1).get(`/addresses`)).body.data[0].label).toBe('Home');
  });
});

describe('quotes, coupons and subscription creation', () => {
  let ctx: Ctx; let addrId: string; let variantId: string;
  const quoteBody = (o: any = {}) => ({
    items: [{ variantId, quantity: 2 }], addressId: addrId, schedule: { frequency: 'daily', startDate: '2026-03-11' }, ...o,
  });
  beforeAll(async () => {
    ctx = await createCtx();
    addrId = (await ctx.as(U1).post('/addresses').send(validAddress)).body.data.id;
    const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
    variantId = prods.flatMap((p) => p.variants).find((v: any) => v.sku === 'CM-500').id;
  });

  it('prices on the server in integer paise', async () => {
    const q = (await ctx.as(U1).post('/subscriptions/quote').send(quoteBody())).body.data;
    expect(q).toMatchObject({ deliveries: 30, perDeliveryMinor: 6000, subtotalMinor: 180000, planDiscountMinor: 5400, couponDiscountMinor: 0, totalMinor: 174600 });
    expect(q.earliestStartDate).toBe('2026-03-11');
  });
  it('ignores client supplied prices and totals', async () => {
    const q = (await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ totalMinor: 1, items: [{ variantId, quantity: 2, unitPriceMinor: 1 }] }))).body.data;
    expect(q.totalMinor).toBe(174600);
  });
  it('alternate-day and weekday schedules change the delivery count', async () => {
    const alt = (await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ schedule: { frequency: 'alternate_days', startDate: '2026-03-11' } }))).body.data;
    expect(alt.deliveries).toBe(15);
    const wk = (await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ schedule: { frequency: 'weekdays', weekdays: [1], startDate: '2026-03-11' } }))).body.data;
    expect(wk.deliveries).toBe(4);
  });
  it('applies a valid coupon with caps and rejects bad ones', async () => {
    const q = (await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ couponCode: 'welcome10' }))).body.data;
    expect(q.couponDiscountMinor).toBe(15000);
    expect(q.totalMinor).toBe(159600);
    const bad = await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ couponCode: 'NOPE123' }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('COUPON_INVALID');
    expect((await ctx.as(U1).post('/coupons/validate').send({ code: 'FRESH50' })).body.data.code).toBe('FRESH50');
  });
  it('enforces the delivery cutoff on the start date', async () => {
    const early = await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ schedule: { frequency: 'daily', startDate: '2026-03-10' } }));
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('START_DATE_TOO_EARLY');
    ctx.clock.now = new Date('2026-03-10T16:00:00Z'); // 21:30 IST, cutoff passed
    const tomorrow = await ctx.as(U1).post('/subscriptions/quote').send(quoteBody());
    expect(tomorrow.body.error.code).toBe('START_DATE_TOO_EARLY');
    expect(tomorrow.body.error.details.earliest).toBe('2026-03-12');
    ctx.clock.now = new Date('2026-03-10T10:00:00Z');
  });
  it('rejects unserviceable addresses, unavailable variants and invalid schedules', async () => {
    const far = (await ctx.as(U1).post('/addresses').send({ ...validAddress, label: 'Far', postalCode: '999999' })).body.data;
    expect((await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ addressId: far.id }))).body.error.code).toBe('NOT_SERVICEABLE');
    await ctx.pg.exec(`update product_variants set is_available=false where sku='CM-500'`);
    expect((await ctx.as(U1).post('/subscriptions/quote').send(quoteBody())).body.error.code).toBe('VARIANT_UNAVAILABLE');
    await ctx.pg.exec(`update product_variants set is_available=true where sku='CM-500'`);
    expect((await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ schedule: { frequency: 'weekdays', startDate: '2026-03-11' } }))).status).toBe(400);
    expect((await ctx.as(U1).post('/subscriptions/quote').send(quoteBody({ items: [{ variantId, quantity: 0 }] }))).status).toBe(400);
  });
  it('creating a subscription requires accepted terms', async () => {
    const r = await ctx.as(U1).post('/subscriptions').send({ ...quoteBody(), idempotencyKey: 'abcdefgh', acceptTerms: false });
    expect(r.status).toBe(400);
  });
  it('creates a pending subscription + payment order, idempotently, without delivering anything', async () => {
    const body = { ...quoteBody(), idempotencyKey: 'create-key-1', acceptTerms: true };
    const a = await ctx.as(U1).post('/subscriptions').send(body);
    expect(a.status).toBe(201);
    expect(a.body.data.subscription.status).toBe('pending_payment');
    expect(a.body.data.checkout).toMatchObject({ amountMinor: 174600, currency: 'INR', keyId: 'rzp_test_key' });
    const b = await ctx.as(U1).post('/subscriptions').send(body);
    expect(b.status).toBe(200);
    expect(b.body.data.subscription.id).toBe(a.body.data.subscription.id);
    expect(b.body.data.checkout.providerOrderId).toBe(a.body.data.checkout.providerOrderId);
    const rows = await ctx.pg.query<any>(`select (select count(*)::int from subscriptions) s, (select count(*)::int from payment_orders) o, (select count(*)::int from deliveries) d`);
    expect(rows.rows[0]).toEqual({ s: 1, o: 1, d: 0 });
  });
  it('a pending-payment subscription cannot be paused, skipped or renewed', async () => {
    const id = (await ctx.as(U1).get('/subscriptions')).body.data[0].id;
    expect((await ctx.as(U1).post(`/subscriptions/${id}/pause`).send({})).body.error.code).toBe('INVALID_STATE');
    expect((await ctx.as(U1).post(`/subscriptions/${id}/skip`).send({ date: '2026-03-12' })).body.error.code).toBe('INVALID_STATE');
    expect((await ctx.as(U1).post(`/subscriptions/${id}/renew`).send()).body.error.code).toBe('INVALID_STATE');
  });
  it('the checkout can be re-opened for an unpaid subscription', async () => {
    const id = (await ctx.as(U1).get('/subscriptions')).body.data[0].id;
    const c = await ctx.as(U1).post(`/subscriptions/${id}/checkout`).send();
    expect(c.status).toBe(200);
    expect(c.body.data.amountMinor).toBe(174600);
  });
});

describe('payments unconfigured', () => {
  it('returns PAYMENT_NOT_CONFIGURED and creates nothing', async () => {
    const ctx = await createCtx({ payments: 'unconfigured' });
    const addr = (await ctx.as(U1).post('/addresses').send(validAddress)).body.data;
    const prods = (await request(ctx.app).get('/api/v1/products')).body.data;
    const r = await ctx.as(U1).post('/subscriptions').send({
      items: [{ variantId: prods[0].variants[0].id, quantity: 1 }], addressId: addr.id, schedule: { frequency: 'daily', startDate: '2026-03-11' },
      acceptTerms: true, idempotencyKey: 'no-pay-key',
    });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
    expect((await ctx.pg.query<any>(`select count(*)::int c from subscriptions`)).rows[0].c).toBe(0);
    expect((await request(ctx.app).get('/api/v1/health')).body.data.paymentsConfigured).toBe(false);
  });
});

describe('payment verification, webhooks, invoices', () => {
  let ctx: Ctx; let subId: string; let checkout: any; let addr: any; let body: any;
  beforeAll(async () => {
    ctx = await createCtx();
    addr = (await ctx.as(U1).post('/addresses').send(validAddress)).body.data;
    const prods = (await request(ctx.app).get('/api/v1/products')).body.data;
    body = {
      items: [{ variantId: prods[0].variants[0].id, quantity: 2 }], addressId: addr.id, schedule: { frequency: 'daily', startDate: '2026-03-11' },
      acceptTerms: true, idempotencyKey: 'pay-key-1',
    };
    const c = (await ctx.as(U1).post('/subscriptions').send(body)).body.data;
    subId = c.subscription.id; checkout = c.checkout;
  });

  it('a forged signature never activates the subscription', async () => {
    const proof = ctx.provider.pay(checkout.providerOrderId);
    const r = await ctx.as(U1).post('/payments/verify').send({ ...proof, razorpay_signature: 'f'.repeat(64) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_SIGNATURE');
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('pending_payment');
  });
  it('a valid signature for a different order or customer is rejected', async () => {
    const proof = ctx.provider.pay(checkout.providerOrderId);
    expect((await ctx.as(U2).post('/payments/verify').send(proof)).status).toBe(404);
    expect((await ctx.as(U1).post('/payments/verify').send({ ...proof, razorpay_order_id: 'order_unknown' })).status).toBe(404);
  });
  it('the client cannot claim success: payment must be captured at the provider for the exact amount', async () => {
    const wrongAmount = ctx.provider.pay(checkout.providerOrderId, { amountMinor: 100, id: 'pay_cheap' });
    expect((await ctx.as(U1).post('/payments/verify').send(wrongAmount)).body.error.code).toBe('PAYMENT_MISMATCH');
    const authorizedOnly = ctx.provider.pay(checkout.providerOrderId, { status: 'authorized', id: 'pay_auth' });
    expect((await ctx.as(U1).post('/payments/verify').send(authorizedOnly)).body.data.status).toBe('pending');
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('pending_payment');
  });
  it('failed payments are recorded, notify the customer and keep the subscription pending', async () => {
    const failed = ctx.provider.pay(checkout.providerOrderId, { status: 'failed', id: 'pay_failed' });
    const r = await ctx.as(U1).post('/payments/verify').send(failed);
    expect(r.body.data.status).toBe('failed');
    const hist = (await ctx.as(U1).get('/payments')).body.data;
    expect(hist[0]).toMatchObject({ status: 'failed', failureReason: 'Payment declined by bank' });
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('pending_payment');
    const n = (await ctx.as(U1).get('/notifications')).body.data;
    expect(n.some((x: any) => x.type === 'payment.failed')).toBe(true);
    // the order remains retryable
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/checkout`).send()).status).toBe(200);
  });
  it('a verified capture activates the subscription, issues one invoice and schedules deliveries', async () => {
    const proof = ctx.provider.pay(checkout.providerOrderId, { id: 'pay_good' });
    const r = await ctx.as(U1).post('/payments/verify').send(proof);
    expect(r.body.data).toMatchObject({ status: 'paid', subscriptionId: subId });
    const sub = (await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data;
    expect(sub.status).toBe('active');
    expect(sub.billing.prepaidDeliveriesRemaining).toBe(16);
    expect(sub.nextDelivery.deliveryDate).toBe('2026-03-11');
    expect((await getDelivery(ctx, subId))).toHaveLength(14);
    const inv = (await ctx.as(U1).get('/invoices')).body.data;
    expect(inv).toHaveLength(1);
    expect(inv[0].amountMinor).toBe(checkout.amountMinor);
  });
  it('replaying verification and webhooks never double-processes', async () => {
    const proof = { razorpay_order_id: checkout.providerOrderId, razorpay_payment_id: 'pay_good', razorpay_signature: ctx.provider.pay(checkout.providerOrderId, { id: 'pay_good' }).razorpay_signature };
    expect((await ctx.as(U1).post('/payments/verify').send(proof)).body.data.status).toBe('paid');
    const wh = ctx.provider.webhook('payment.captured', await ctx.provider.fetchPayment('pay_good'), 'evt_1');
    const send = () => request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json')
      .set('x-razorpay-signature', wh.signature).set('x-razorpay-event-id', wh.eventId).send(wh.body);
    const first = await send();
    expect(first.status).toBe(200);
    const second = await send();
    expect(second.body.data.duplicate).toBe(true);
    const c = (await ctx.pg.query<any>(`select (select count(*)::int from invoices) i, (select count(*)::int from payments where status='captured') p, (select count(*)::int from payment_webhook_events) w`)).rows[0];
    expect(c).toEqual({ i: 1, p: 1, w: 1 });
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.billing.prepaidDeliveriesRemaining).toBe(16);
  });
  it('webhooks with a bad signature are rejected and not stored', async () => {
    const wh = ctx.provider.webhook('payment.captured', await ctx.provider.fetchPayment('pay_good'), 'evt_bad');
    const r = await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', 'deadbeef').send(wh.body);
    expect(r.status).toBe(401);
    const none = await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').send(wh.body);
    expect(none.status).toBe(401);
    expect((await ctx.pg.query<any>(`select count(*)::int c from payment_webhook_events where event_id='evt_bad'`)).rows[0].c).toBe(0);
  });
  it('the signature is computed over the exact raw bytes (whitespace changes break it)', async () => {
    const wh = ctx.provider.webhook('payment.captured', await ctx.provider.fetchPayment('pay_good'), 'evt_ws');
    const reformatted = JSON.stringify(JSON.parse(wh.body), null, 2);
    const r = await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.signature).send(reformatted);
    expect(r.status).toBe(401);
  });
  it('a late payment.failed webhook cannot undo a captured payment', async () => {
    const p = { ...(await ctx.provider.fetchPayment('pay_good')) };
    const wh = ctx.provider.webhook('payment.failed', p, 'evt_late_fail');
    const r = await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.signature).set('x-razorpay-event-id', wh.eventId).send(wh.body);
    expect(r.status).toBe(200);
    expect((await ctx.as(U1).get('/payments')).body.data[0].status).toBe('paid');
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('active');
  });
  it('webhooks for unknown orders are acknowledged and ignored', async () => {
    const p = { id: 'pay_x', orderId: 'order_not_ours', amountMinor: 100, status: 'captured' as const, amountRefundedMinor: 0 };
    const wh = ctx.provider.webhook('payment.captured', p, 'evt_unknown');
    const r = await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.signature).set('x-razorpay-event-id', wh.eventId).send(wh.body);
    expect(r.body.data.outcome).toBe('ignored');
  });
  it('a missed client callback is recovered by webhook alone (order paid without verify)', async () => {
    const other = (await ctx.as(U1).post('/subscriptions').send({ ...body, idempotencyKey: 'pay-key-2', schedule: { frequency: 'daily', startDate: '2026-03-12' } })).body.data;
    ctx.provider.pay(other.checkout.providerOrderId, { id: 'pay_wh_only' });
    const wh = ctx.provider.webhook('payment.captured', await ctx.provider.fetchPayment('pay_wh_only'), 'evt_wh_only');
    await request(ctx.app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', wh.signature).set('x-razorpay-event-id', wh.eventId).send(wh.body);
    expect((await ctx.as(U1).get(`/subscriptions/${other.subscription.id}`)).body.data.status).toBe('active');
  });
  it('reconcile pulls provider state when nothing arrived', async () => {
    const other = (await ctx.as(U1).post('/subscriptions').send({ ...body, idempotencyKey: 'pay-key-3', schedule: { frequency: 'daily', startDate: '2026-03-13' } })).body.data;
    ctx.provider.pay(other.checkout.providerOrderId, { id: 'pay_recon' });
    const r = await ctx.as(U1).post(`/payments/orders/${other.checkout.paymentOrderId}/reconcile`).send();
    expect(r.body.data).toMatchObject({ status: 'paid', changed: true });
    expect((await ctx.as(U1).post(`/payments/orders/${other.checkout.paymentOrderId}/reconcile`).send()).body.data.changed).toBe(false);
    expect((await ctx.as(U2).post(`/payments/orders/${other.checkout.paymentOrderId}/reconcile`).send()).status).toBe(404);
  });
  it('payment history, invoice detail and downloadable receipt', async () => {
    const hist = (await ctx.as(U1).get('/payments')).body;
    expect(hist.meta.total).toBeGreaterThanOrEqual(3);
    const paid = hist.data.find((p: any) => p.providerPaymentId === 'pay_good');
    expect(paid).toMatchObject({ status: 'paid', method: 'upi', amountMinor: 174600 });
    const inv = (await ctx.as(U1).get(`/invoices/${paid.invoiceId}`)).body.data;
    expect(inv.invoiceNumber).toMatch(/^INV-\d{4}-\d+$/);
    const rec = await ctx.as(U1).get(`/invoices/${paid.invoiceId}/receipt`);
    expect(rec.headers['content-disposition']).toContain('attachment');
    expect(rec.text).toContain(inv.invoiceNumber);
    expect(rec.text).toContain('₹1,746');
  });
  it('admin refunds are bounded and customers cannot refund', async () => {
    const hist = (await ctx.as(U1).get('/payments')).body.data;
    const paid = hist.find((p: any) => p.providerPaymentId === 'pay_good');
    expect((await ctx.as(U1).post(`/admin/payments/${paid.paymentId}/refund`).send({})).status).toBe(403);
    expect((await ctx.as(ADMIN).post(`/admin/payments/${paid.paymentId}/refund`).send({ amountMinor: 999999999 })).body.error.code).toBe('REFUND_EXCEEDS');
    const ok = await ctx.as(ADMIN).post(`/admin/payments/${paid.paymentId}/refund`).send({ amountMinor: 10000 });
    expect(ok.body.data.amountMinor).toBe(10000);
    expect(ctx.provider.refunds).toEqual([{ paymentId: 'pay_good', amountMinor: 10000 }]);
    expect((await ctx.as(U1).get('/payments')).body.data.find((p: any) => p.providerPaymentId === 'pay_good').status).toBe('partially_refunded');
  });
});

describe('subscription lifecycle', () => {
  let ctx: Ctx; let subId: string;
  beforeAll(async () => {
    ctx = await createCtx();
    subId = (await activeSubscription(ctx, U1)).subId;
  });
  const sub = async () => (await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data;

  it('generating deliveries again creates no duplicates', async () => {
    const before = await getDelivery(ctx, subId);
    expect(before).toHaveLength(14);
    const again = await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({});
    expect(again.body.data.created).toBe(0);
    expect(await getDelivery(ctx, subId)).toHaveLength(14);
    const dup = (await ctx.pg.query<any>(`select count(*)::int c from (select subscription_id, delivery_date from deliveries group by 1,2 having count(*)>1) x`)).rows[0].c;
    expect(dup).toBe(0);
  });
  it('concurrent generation requests still produce exactly one delivery per date', async () => {
    await Promise.all([1, 2, 3, 4].map(() => ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 30 })));
    const rows = (await ctx.pg.query<any>(`select count(*)::int c, count(distinct delivery_date)::int d from deliveries where subscription_id='${subId}'`)).rows[0];
    expect(rows.c).toBe(rows.d);
    expect(rows.c).toBe(30); // prepaid balance of 30 deliveries is the hard cap
    expect((await sub()).billing.prepaidDeliveriesRemaining).toBe(0);
  });
  it('deliveries never exceed what was paid for', async () => {
    const r = await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 45 });
    expect(r.body.data.created).toBe(0);
    expect((await getDelivery(ctx, subId, '2026-03-11', '2026-05-10')).length).toBe(30);
  });
  it('skipping credits the delivery back and extends coverage', async () => {
    const s = (await ctx.as(U1).post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-12' })).body.data;
    expect(s.skippedDates).toContain('2026-03-12');
    const d = (await getDelivery(ctx, subId)).find((x) => x.deliveryDate === '2026-03-12');
    expect(d.status).toBe('skipped');
    // balance gained one credit and the next generation extends the tail by one day
    const g = await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 45 });
    expect(g.body.data.created).toBe(1);
    expect((await sub()).billing.prepaidDeliveriesRemaining).toBe(0);
  });
  it('skip rules: duplicates, non-scheduled dates, past cutoff and prepared deliveries', async () => {
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-12' })).body.error.code).toBe('ALREADY_EXCLUDED');
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-10' })).body.error.code).toBe('PAST_CUTOFF');
    const dels = await getDelivery(ctx, subId);
    const d13 = dels.find((x) => x.deliveryDate === '2026-03-13');
    await ctx.as(ADMIN).patch(`/admin/deliveries/${d13.id}/status`).send({ status: 'pending' });
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-13' })).body.error.code).toBe('DELIVERY_PREPARED');
    ctx.clock.now = new Date('2026-03-10T16:00:00Z'); // 21:30 IST: tomorrow's cutoff has passed
    const late = await ctx.as(U1).post(`/subscriptions/${subId}/skip`).send({ date: '2026-03-11' });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('PAST_CUTOFF');
    expect(late.body.error.details.earliest).toBe('2026-03-12');
    ctx.clock.now = new Date('2026-03-10T10:00:00Z');
  });
  it('unskip restores the delivery', async () => {
    await ctx.as(U1).post(`/subscriptions/${subId}/unskip`).send({ date: '2026-03-12' });
    const d = (await getDelivery(ctx, subId)).find((x) => x.deliveryDate === '2026-03-12');
    expect(d.status).toBe('scheduled');
  });
  it('the calendar derives "pending" (being prepared) once the cutoff has passed', async () => {
    ctx.clock.now = new Date('2026-03-10T16:00:00Z');
    const d = (await getDelivery(ctx, subId)).find((x) => x.deliveryDate === '2026-03-11');
    expect(d.status).toBe('scheduled');
    expect(d.displayStatus).toBe('pending');
    expect(d.canModify).toBe(false);
    ctx.clock.now = new Date('2026-03-10T10:00:00Z');
    const d2 = (await getDelivery(ctx, subId)).find((x) => x.deliveryDate === '2026-03-11');
    expect(d2.canModify).toBe(true);
    expect(d2.items[0]).toMatchObject({ quantity: 2, unitPriceMinor: 3000 });
  });
  it('pause releases upcoming deliveries and restores prepaid balance', async () => {
    const before = (await sub()).billing.prepaidDeliveriesRemaining;
    const p = (await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({ from: '2026-03-15', until: '2026-03-20' })).body.data;
    expect(p.status).toBe('active'); // pause starts in the future
    expect(p.pauses[0]).toMatchObject({ startsOn: '2026-03-15', endsOn: '2026-03-20' });
    const dates = (await getDelivery(ctx, subId)).map((d) => d.deliveryDate);
    expect(dates.filter((d) => d >= '2026-03-15' && d <= '2026-03-20')).toEqual([]);
    expect((await sub()).billing.prepaidDeliveriesRemaining).toBe(before + 6);
  });
  it('overlapping pauses and past-cutoff pause starts are rejected', async () => {
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({ from: '2026-03-18', until: '2026-03-22' })).body.error.code).toBe('PAUSE_OVERLAP');
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({ from: '2026-03-10' })).body.error.code).toBe('PAST_CUTOFF');
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({ from: '2026-03-25', until: '2026-03-24' })).body.error.code).toBe('INVALID_RANGE');
  });
  it('regeneration never schedules paused dates', async () => {
    await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 45 });
    const dates = (await getDelivery(ctx, subId, '2026-03-11', '2026-05-10')).map((d) => d.deliveryDate);
    expect(dates.filter((d) => d >= '2026-03-15' && d <= '2026-03-20')).toEqual([]);
  });
  it('an indefinite pause starting now marks the subscription paused; double pause is blocked', async () => {
    await ctx.as(U1).post(`/subscriptions/${subId}/resume`).send(); // clear the earlier scheduled pause
    const p = (await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({})).body.data;
    expect(p.status).toBe('paused');
    expect(p.pauses[0].endsOn).toBeNull();
    expect(p.actions.canResume).toBe(true);
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({})).body.error.code).toBe('INVALID_STATE');
    expect((await getDelivery(ctx, subId)).filter((d) => d.status === 'scheduled')).toHaveLength(0);
  });
  it('resume reactivates and regenerates deliveries', async () => {
    const r = (await ctx.as(U1).post(`/subscriptions/${subId}/resume`).send()).body.data;
    expect(r.status).toBe('active');
    expect((await getDelivery(ctx, subId)).filter((d) => d.status === 'scheduled').length).toBeGreaterThan(0);
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/resume`).send()).body.error.code).toBe('NOT_PAUSED');
  });
  it('a pause with an end date resumes automatically without any scheduler', async () => {
    await ctx.as(U1).post(`/subscriptions/${subId}/pause`).send({ until: '2026-03-12' });
    expect((await sub()).status).toBe('paused');
    ctx.clock.now = new Date('2026-03-12T10:00:00Z'); // eff = 03-13 > pause end
    expect((await sub()).status).toBe('active');
    ctx.clock.now = new Date('2026-03-10T10:00:00Z');
    await ctx.as(U1).post(`/subscriptions/${subId}/resume`).send(); // the pause window is still ahead on the 10th
    expect((await sub()).status).toBe('active');
  });
  it('quantity changes apply to upcoming deliveries only and are recorded in history', async () => {
    const prods = (await request(ctx.app).get('/api/v1/products')).body.data as any[];
    const a2 = prods.flatMap((p) => p.variants).find((v: any) => v.sku === 'A2-1000');
    await ctx.as(U1).patch(`/subscriptions/${subId}/items`).send({ items: [{ variantId: a2.id, quantity: 3 }] });
    const dels = await getDelivery(ctx, subId);
    const upcoming = dels.find((d) => d.status === 'scheduled');
    expect(upcoming.items[0]).toMatchObject({ quantity: 3, unitPriceMinor: 8500 });
    expect(upcoming.totalMinor).toBe(25500);
    const hist = (await ctx.as(U1).get(`/subscriptions/${subId}/history`)).body.data;
    expect(hist.map((h: any) => h.action)).toContain('subscription.items_changed');
    expect((await ctx.as(U1).patch(`/subscriptions/${subId}/items`).send({ items: [{ variantId: a2.id, quantity: 99 }] })).status).toBe(400);
  });
  it('frequency and address changes', async () => {
    const r = await ctx.as(U1).patch(`/subscriptions/${subId}/schedule`).send({ frequency: 'weekdays', weekdays: [1, 3, 5], startDate: '2026-03-16' });
    expect(r.body.data).toMatchObject({ frequency: 'weekdays', weekdays: [1, 3, 5] });
    const days = (await getDelivery(ctx, subId, '2026-03-16', '2026-04-30')).filter((d) => d.status === 'scheduled').map((d) => new Date(d.deliveryDate + 'T00:00:00Z').getUTCDay());
    expect(days.every((d) => [1, 3, 5].includes(d))).toBe(true);
    expect((await ctx.as(U1).patch(`/subscriptions/${subId}/schedule`).send({ frequency: 'daily', startDate: '2026-03-09' })).body.error.code).toBe('PAST_CUTOFF');
    const a2 = (await ctx.as(U1).post('/addresses').send({ ...validAddress, label: 'Parents', line1: '5 Brigade Road' })).body.data;
    const moved = (await ctx.as(U1).patch(`/subscriptions/${subId}/address`).send({ addressId: a2.id })).body.data;
    expect(moved.address.label).toBe('Parents');
    expect((await ctx.as(U1).patch(`/subscriptions/${subId}/address`).send({ addressId: uid(77) })).status).toBe(404);
    expect((await ctx.as(U1).delete(`/addresses/${a2.id}`)).body.error.code).toBe('ADDRESS_IN_USE');
  });
  it('admin lifecycle: failed deliveries are credited back, delivered is final', async () => {
    const before = (await sub()).billing.prepaidDeliveriesRemaining;
    const d = (await getDelivery(ctx, subId)).find((x) => x.status === 'scheduled');
    expect((await ctx.as(ADMIN).patch(`/admin/deliveries/${d.id}/status`).send({ status: 'failed', reason: 'Gate locked' })).status).toBe(200);
    expect((await sub()).billing.prepaidDeliveriesRemaining).toBe(before + 1);
    expect((await ctx.as(ADMIN).patch(`/admin/deliveries/${d.id}/status`).send({ status: 'delivered' })).body.error.code).toBe('INVALID_TRANSITION');
    const d2 = (await getDelivery(ctx, subId)).find((x) => x.status === 'scheduled');
    await ctx.as(ADMIN).patch(`/admin/deliveries/${d2.id}/status`).send({ status: 'delivered' });
    expect((await ctx.as(U1).get(`/deliveries/${d2.id}`)).body.data.status).toBe('delivered');
    expect((await ctx.as(U1).get('/notifications')).body.data.some((n: any) => n.type === 'delivery.delivered')).toBe(true);
  });
  it('cancel stops future deliveries, opens a refund review and blocks further changes', async () => {
    const r = await ctx.as(U1).post(`/subscriptions/${subId}/cancel`).send({ reason: 'Moving away' });
    expect(r.body.data.status).toBe('cancelled');
    expect(r.body.data.cancellation.refundReviewTicketCreated).toBe(true);
    expect((await getDelivery(ctx, subId)).filter((d) => d.status === 'scheduled')).toHaveLength(0);
    expect((await ctx.as(U1).get('/support/tickets')).body.data[0].subject).toMatch(/Refund review/);
    for (const [method, path, payload] of [
      ['post', 'pause', {}], ['post', 'resume', {}], ['post', 'skip', { date: '2026-04-01' }], ['post', 'deliveries/generate', {}],
    ] as const) {
      const x = await (ctx.as(U1) as any)[method](`/subscriptions/${subId}/${path}`).send(payload);
      expect(x.status, path).toBe(409);
    }
    expect((await ctx.as(U1).patch(`/subscriptions/${subId}/items`).send({ items: [{ variantId: uid(3), quantity: 1 }] })).status).toBe(409);
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/cancel`).send({})).status).toBe(200); // idempotent
  });
});

describe('renewal, past due and coupon redemption', () => {
  it('renewal is blocked while plenty of prepaid deliveries remain, then priced and paid manually', async () => {
    const ctx = await createCtx();
    const { subId, body } = await activeSubscription(ctx, U1, { frequency: 'daily', key: 'renewal-key-1' });
    expect((await ctx.as(U1).post(`/subscriptions/${subId}/renew`).send()).body.error.code).toBe('RENEWAL_TOO_EARLY');
    await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 45 }); // balance 0
    const c = await ctx.as(U1).post(`/subscriptions/${subId}/renew`).send();
    expect(c.status).toBe(200);
    expect(c.body.data.amountMinor).toBe(180000); // 30 more daily deliveries starting after the last paid one
    const again = await ctx.as(U1).post(`/subscriptions/${subId}/renew`).send();
    expect(again.body.data.paymentOrderId).toBe(c.body.data.paymentOrderId); // reuses the open order
    const proof = ctx.provider.pay(c.body.data.providerOrderId);
    expect((await ctx.as(U1).post('/payments/verify').send(proof)).body.data.status).toBe('paid');
    const s = (await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data;
    expect(s.billing.prepaidDeliveriesRemaining).toBe(30);
    expect(s.billing.autoDebit).toBe(false);
    expect(body.acceptTerms).toBe(true);
  });
  it('an active subscription with no prepaid deliveries left becomes past due; renewing reactivates it', async () => {
    const ctx = await createCtx();
    const { subId } = await activeSubscription(ctx, U1, { key: 'pastdue-key-1' });
    await ctx.as(U1).post(`/subscriptions/${subId}/deliveries/generate`).send({ days: 45 });
    ctx.clock.now = new Date('2026-05-15T10:00:00Z'); // all 30 deliveries are in the past
    const s = (await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data;
    expect(s.status).toBe('past_due');
    expect(s.actions.canPay).toBe(true);
    const c = await ctx.as(U1).post(`/subscriptions/${subId}/renew`).send();
    await ctx.as(U1).post('/payments/verify').send(ctx.provider.pay(c.body.data.providerOrderId));
    expect((await ctx.as(U1).get(`/subscriptions/${subId}`)).body.data.status).toBe('active');
  });
  it('coupon per-user limits are enforced after redemption', async () => {
    const ctx = await createCtx();
    const api = ctx.as(U1);
    const addr = (await api.post('/addresses').send(validAddress)).body.data;
    const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
    const v = prods.flatMap((p) => p.variants).find((x: any) => x.sku === 'CM-500').id;
    const mk = (key: string) => ({ items: [{ variantId: v, quantity: 2 }], addressId: addr.id, schedule: { frequency: 'daily', startDate: '2026-03-11' }, couponCode: 'WELCOME10', acceptTerms: true, idempotencyKey: key });
    const first = (await api.post('/subscriptions').send(mk('coupon-key-1'))).body.data;
    expect(first.checkout.amountMinor).toBe(159600);
    // not redeemed until payment is captured
    expect((await api.post('/subscriptions/quote').send(mk('x'))).status).toBe(200);
    await api.post('/payments/verify').send(ctx.provider.pay(first.checkout.providerOrderId));
    const second = await api.post('/subscriptions/quote').send(mk('x'));
    expect(second.body.error.code).toBe('COUPON_ALREADY_USED');
  });
});

describe('notifications, support, preferences, account deletion', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createCtx(); });

  it('notification history, unread counts and mark read', async () => {
    await activeSubscription(ctx, U1);
    const list = await ctx.as(U1).get('/notifications');
    expect(list.body.meta.unread).toBeGreaterThan(0);
    const first = list.body.data[0];
    await ctx.as(U1).post(`/notifications/${first.id}/read`).send();
    expect((await ctx.as(U1).get('/notifications')).body.meta.unread).toBe(list.body.meta.unread - 1);
    expect((await ctx.as(U2).post(`/notifications/${first.id}/read`).send()).status).toBe(404);
    await ctx.as(U1).post('/notifications/read-all').send();
    expect((await ctx.as(U1).get('/notifications')).body.meta.unread).toBe(0);
  });
  it('email and sms are honestly recorded as not configured; push is only sent when enabled with a token', async () => {
    const n = (await ctx.as(U1).get('/notifications')).body.data[0];
    expect(n.data.delivery).toMatchObject({ email: 'not_configured', sms: 'not_configured' });
    await ctx.as(U1).put('/me/push-token').send({ token: 'ExponentPushToken[abcdefghij]' });
    await ctx.as(U1).post('/subscriptions/00000000-0000-4000-8000-000000000001/cancel').send({});
    const before = ctx.pushes.length;
    const s2 = await activeSubscription(ctx, U1, { key: 'push-key-1' });
    expect(ctx.pushes.length).toBeGreaterThan(before);
    expect(ctx.pushes[0].token).toBe('ExponentPushToken[abcdefghij]');
    expect(s2.subId).toBeTruthy();
  });
  it('category preferences suppress notifications', async () => {
    const prefs = { push: true, email: false, sms: false, deliveryUpdates: true, paymentUpdates: false, promotions: false };
    expect((await ctx.as(U1).put('/me/notification-preferences').send(prefs)).body.data.notificationPrefs.paymentUpdates).toBe(false);
    const before = (await ctx.as(U1).get('/notifications')).body.meta.total;
    await activeSubscription(ctx, U1, { key: 'prefs-key-1' });
    expect((await ctx.as(U1).get('/notifications')).body.meta.total).toBe(before);
    expect((await ctx.as(U1).put('/me/notification-preferences').send({ push: true })).status).toBe(400);
  });
  it('support tickets validate and stay private; FAQs are public', async () => {
    expect((await ctx.as(U1).post('/support/tickets').send({ category: 'delivery', subject: 'Hi', message: 'short' })).status).toBe(400);
    const t = await ctx.as(U1).post('/support/tickets').send({ category: 'delivery', subject: 'Missed delivery', message: 'My milk did not arrive this morning.' });
    expect(t.status).toBe(201);
    expect(t.body.data.status).toBe('open');
    expect((await ctx.as(U1).get('/support/tickets')).body.data.some((x: any) => x.id === t.body.data.id)).toBe(true);
    expect((await ctx.as(U2).get('/support/tickets')).body.data).toEqual([]);
    expect((await request(ctx.app).get('/api/v1/support/faqs')).body.data.length).toBeGreaterThan(3);
  });
  it('profile creation', async () => {
    expect((await ctx.as(U2).put('/me').send({ fullName: 'A' })).status).toBe(400);
    const me = await ctx.as(U2).put('/me').send({ fullName: 'Ravi Kumar', email: 'ravi@example.com' });
    expect(me.body.data).toMatchObject({ fullName: 'Ravi Kumar', email: 'ravi@example.com', profileCompleted: true });
  });
  it('account deletion needs explicit confirmation, anonymises data and revokes access', async () => {
    const removed: string[] = [];
    ctx.deps.deleteAuthUser = async (id) => { removed.push(id); };
    await activeSubscription(ctx, U2, { key: 'delete-key-1' });
    expect((await ctx.as(U2).post('/me/delete').send({})).status).toBe(400);
    expect((await ctx.as(U2).post('/me/delete').send({ confirm: 'delete' })).status).toBe(400);
    const r = await ctx.as(U2).post('/me/delete').send({ confirm: 'DELETE' });
    expect(r.body.data).toEqual({ deleted: true, authUserRemoved: true });
    expect(removed).toEqual([U2]);
    const p = (await ctx.pg.query<any>(`select full_name, phone, email, deleted_at is not null d from profiles where id='${U2}'`)).rows[0];
    expect(p).toEqual({ full_name: '', phone: null, email: null, d: true });
    expect((await ctx.pg.query<any>(`select status from subscriptions where user_id='${U2}'`)).rows[0].status).toBe('cancelled');
    expect((await ctx.pg.query<any>(`select count(*)::int c from invoices where user_id='${U2}'`)).rows[0].c).toBe(1); // financial records retained
    expect((await ctx.as(U2).get('/me')).status).toBe(403);
    expect((await ctx.pg.query<any>(`select count(*)::int c from audit_logs where action='account.deleted'`)).rows[0].c).toBe(1);
  });
});
