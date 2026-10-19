import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, U1, U2, createCtx, validAddress, type Ctx } from './harness';

/**
 * Owner creates an area and a supplier; a customer in that area subscribes and pays; the supplier sees the day's
 * load and marks deliveries. Suppliers must never see or change another area's data.
 */
describe('owner dashboard + supplier operations', () => {
  let ctx: Ctx;
  let areaId: string;
  let otherAreaId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let subId: string;
  const owner = () => ctx.as(ADMIN);
  const sup = () => ctx.as(supplierId);

  beforeAll(async () => {
    ctx = await createCtx();
  });

  it('only the owner can manage areas, suppliers and products', async () => {
    expect((await ctx.as(U1).get('/admin/zones')).status).toBe(403);
    expect((await ctx.as(U1).post('/admin/zones').send({})).status).toBe(403);
    expect((await ctx.as(U1).get('/supplier/zones')).status).toBe(403);
    expect((await request(ctx.app).get('/api/v1/admin/zones')).status).toBe(401);
  });

  it('a new area links existing customer addresses and becomes serviceable at once', async () => {
    const addr = (await ctx.as(U2).post('/addresses').send({ ...validAddress, postalCode: '560011' })).body.data;
    expect(addr.zoneId).toBeNull();
    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=560011')).body.data.serviceable).toBe(false);

    const r = await owner().post('/admin/zones').send({ name: 'Jayanagar', postalCodes: ['560011', '560041', '560011'], windowStart: '05:30', windowEnd: '07:30', cutoffTime: '21:00' });
    expect(r.status).toBe(201);
    areaId = r.body.data.id;

    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=560011')).body.data.zone.name).toBe('Jayanagar');
    expect((await ctx.as(U2).get('/addresses')).body.data[0].zoneId).toBe(areaId);
    const zones = (await owner().get('/admin/zones')).body.data;
    expect(zones.find((z: any) => z.id === areaId)).toMatchObject({ postalCodes: ['560011', '560041'], customers: 1 });
  });

  it('a PIN code can belong to only one active area; bad input is rejected', async () => {
    const dup = await owner().post('/admin/zones').send({ name: 'Overlap', postalCodes: ['560041'], windowStart: '06:00', windowEnd: '08:00', cutoffTime: '21:00' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PIN_IN_USE');
    expect((await owner().post('/admin/zones').send({ name: 'X', postalCodes: ['12345'], windowStart: '06:00', windowEnd: '08:00', cutoffTime: '21:00' })).status).toBe(400);
    expect((await owner().patch(`/admin/zones/${areaId}`).send({ windowStart: '08:00', windowEnd: '07:00' })).body.error.code).toBe('INVALID_WINDOW');
    const other = await owner().post('/admin/zones').send({ name: 'Basavanagudi', postalCodes: ['560004'], windowStart: '06:00', windowEnd: '08:00', cutoffTime: '21:00' });
    otherAreaId = other.body.data.id;
  });

  it('suppliers are added by phone and assigned areas', async () => {
    const r = await owner().post('/admin/suppliers').send({ phone: '+919811100001', fullName: 'Ravi Dairy', zoneIds: [areaId] });
    expect(r.status).toBe(201);
    supplierId = r.body.data.id;
    otherSupplierId = (await owner().post('/admin/suppliers').send({ phone: '+919811100002', fullName: 'Other Supplier', zoneIds: [otherAreaId] })).body.data.id;
    const list = (await owner().get('/admin/suppliers')).body.data;
    expect(list.find((s: any) => s.id === supplierId)).toMatchObject({ fullName: 'Ravi Dairy', phone: '+919811100001', zones: [{ id: areaId, name: 'Jayanagar' }] });
    expect((await ctx.as(supplierId).get('/me')).body.data.role).toBe('supplier');
    expect((await sup().get('/supplier/zones')).body.data.map((z: any) => z.name)).toEqual(['Jayanagar']);
    expect((await owner().post('/admin/suppliers').send({ phone: '98111', fullName: 'X', zoneIds: [] })).status).toBe(400);
  });

  it('a customer in the area subscribes and pays', async () => {
    const addr = (await ctx.as(U2).get('/addresses')).body.data[0];
    const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
    const v = prods.flatMap((p) => p.variants).find((x: any) => x.sku === 'CM-500');
    const c = await ctx.as(U2).post('/subscriptions').send({
      items: [{ variantId: v.id, quantity: 2 }], addressId: addr.id, schedule: { frequency: 'daily', startDate: '2026-03-11' },
      acceptTerms: true, idempotencyKey: 'supplier-flow-1',
    });
    expect(c.status).toBe(201);
    subId = c.body.data.subscription.id;
    const proof = ctx.provider.pay(c.body.data.checkout.providerOrderId);
    expect((await ctx.as(U2).post('/payments/verify').send(proof)).body.data.status).toBe('paid');
  });

  it('the supplier sees the day load and delivery list for their area only', async () => {
    const d = (await sup().get('/supplier/day?date=2026-03-12')).body.data;
    expect(d.deliveries).toHaveLength(1);
    expect(d.deliveries[0]).toMatchObject({ zoneName: 'Jayanagar', postalCode: '560011', phone: '+919876543210', status: 'scheduled' });
    expect(d.totals).toEqual([expect.objectContaining({ quantity: 2 })]);
    expect(d.valueMinor).toBe(6000);
    // another area's supplier and an unknown area
    expect((await ctx.as(otherSupplierId).get('/supplier/day?date=2026-03-12')).body.data.deliveries).toHaveLength(0);
    expect((await ctx.as(otherSupplierId).get(`/supplier/day?date=2026-03-12&zoneId=${areaId}`)).status).toBe(403);
    // the owner sees every area
    expect((await owner().get('/supplier/day?date=2026-03-12')).body.data.deliveries.length).toBeGreaterThanOrEqual(1);
  });

  it('opening a later day prepares its deliveries (no scheduler needed), within the prepaid balance', async () => {
    const before = (await ctx.pg.query<any>(`select count(*)::int c from deliveries where subscription_id=$1 and delivery_date='2026-03-30'`, [subId])).rows[0].c;
    expect(before).toBe(0);
    const d = (await sup().get('/supplier/day?date=2026-03-30')).body.data;
    expect(d.deliveries).toHaveLength(1);
    const dup = (await ctx.pg.query<any>(`select count(*)::int c, count(distinct delivery_date)::int d from deliveries where subscription_id=$1`, [subId])).rows[0];
    expect(dup.c).toBe(dup.d); // never duplicated
  });

  it('marks deliveries: out for delivery, delivered, failed with reason, and stays inside its area', async () => {
    const day = (await sup().get('/supplier/day?date=2026-03-12')).body.data;
    const id = day.deliveries[0].id;
    expect((await ctx.as(otherSupplierId).patch(`/supplier/deliveries/${id}/status`).send({ status: 'delivered' })).status).toBe(404);
    expect((await ctx.as(U2).patch(`/supplier/deliveries/${id}/status`).send({ status: 'delivered' })).status).toBe(403);
    expect((await sup().patch(`/supplier/deliveries/${id}/status`).send({ status: 'out_for_delivery' })).status).toBe(200);
    expect((await sup().patch(`/supplier/deliveries/${id}/status`).send({ status: 'delivered' })).status).toBe(200);
    expect((await sup().patch(`/supplier/deliveries/${id}/status`).send({ status: 'failed', reason: 'x' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await ctx.as(U2).get(`/deliveries/${id}`)).body.data.status).toBe('delivered');

    const next = (await sup().get('/supplier/day?date=2026-03-13')).body.data.deliveries[0].id;
    expect((await sup().patch(`/supplier/deliveries/${next}/status`).send({ status: 'failed' })).body.error.code).toBe('REASON_REQUIRED');
    const before = (await ctx.as(U2).get(`/subscriptions/${subId}`)).body.data.billing.prepaidDeliveriesRemaining;
    expect((await sup().patch(`/supplier/deliveries/${next}/status`).send({ status: 'failed', reason: 'House locked' })).status).toBe(200);
    expect((await ctx.as(U2).get(`/subscriptions/${subId}`)).body.data.billing.prepaidDeliveriesRemaining).toBe(before + 1); // credited back
    expect((await ctx.as(U2).get('/notifications')).body.data.some((n: any) => n.type === 'delivery.failed')).toBe(true);
  });

  it('bulk "mark all delivered" reports per-delivery results', async () => {
    const ids = (await sup().get('/supplier/day?date=2026-03-14')).body.data.deliveries.map((d: any) => d.id);
    const foreign = (await ctx.pg.query<any>(`select d.id from deliveries d join addresses a on a.id=d.address_id where a.zone_id is distinct from $1 limit 1`, [areaId])).rows[0]?.id;
    const r = (await sup().post('/supplier/deliveries/bulk-status').send({ ids: foreign ? [...ids, foreign] : ids, status: 'delivered' })).body.data;
    expect(r.updated).toBe(ids.length);
    if (foreign) expect(r.results.find((x: any) => x.id === foreign).ok).toBe(false);
  });

  it('customers and reports are scoped to the area', async () => {
    const cs = (await sup().get('/supplier/customers')).body.data;
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ status: 'active', items: '2 x Farm Fresh Cow Milk 500 ml', zoneName: 'Jayanagar' });
    expect((await ctx.as(otherSupplierId).get('/supplier/customers')).body.data).toHaveLength(0);
    const rep = (await sup().get('/supplier/reports?from=2026-03-01&to=2026-03-31')).body.data;
    expect(rep.totals).toMatchObject({ delivered: 2, failed: 1, valueMinor: 12000 });
    expect(rep.products[0]).toMatchObject({ quantity: 4 });
    expect((await sup().get('/supplier/reports?from=2026-01-01&to=2026-12-31')).body.error.code).toBe('INVALID_RANGE');
  });

  it('the owner adds a new product category; customers see it immediately', async () => {
    const r = await owner().post('/admin/products').send({
      name: 'Pure Cow Ghee', description: 'Slow-cooked ghee', category: 'Ghee',
      variants: [{ name: '200 ml jar', sizeLabel: '200 ml', priceMinor: 18000, mrpMinor: 20000 }, { name: '500 ml jar', sizeLabel: '500 ml', priceMinor: 42000, mrpMinor: 45000 }],
    });
    expect(r.status).toBe(201);
    const ghee = (await request(ctx.app).get('/api/v1/products?category=ghee')).body.data;
    expect(ghee).toHaveLength(1);
    expect(ghee[0]).toMatchObject({ slug: 'pure-cow-ghee', category: 'ghee' });
    expect(ghee[0].variants.map((v: any) => v.priceMinor)).toEqual([18000, 42000]);
    expect((await request(ctx.app).get('/api/v1/categories')).body.data.map((c: any) => c.category)).toContain('ghee');

    const vId = ghee[0].variants[0].id;
    expect((await owner().patch(`/admin/variants/${vId}`).send({ priceMinor: 30000 })).body.error.code).toBe('MRP_BELOW_PRICE');
    await owner().patch(`/admin/variants/${vId}`).send({ priceMinor: 17500, isAvailable: false });
    const after = (await request(ctx.app).get('/api/v1/products/pure-cow-ghee')).body.data.variants[0];
    expect(after).toMatchObject({ priceMinor: 17500, isAvailable: false });
    await owner().patch(`/admin/products/${r.body.data.id}`).send({ isActive: false });
    expect((await request(ctx.app).get('/api/v1/products?category=ghee')).body.data).toHaveLength(0);
    expect((await owner().get('/admin/products')).body.data.some((p: any) => p.slug === 'pure-cow-ghee' && !p.isActive)).toBe(true);
    expect((await owner().post('/admin/products').send({ name: 'Bad', category: 'Has Spaces!' })).status).toBe(400);
    expect((await ctx.as(supplierId).post('/admin/products').send({ name: 'Nope', category: 'milk' })).status).toBe(403);
  });

  it('removing a supplier revokes access immediately', async () => {
    await owner().patch(`/admin/suppliers/${supplierId}`).send({ active: false });
    expect((await sup().get('/supplier/day?date=2026-03-12')).status).toBe(403);
    expect((await owner().get('/admin/suppliers')).body.data.some((s: any) => s.id === supplierId)).toBe(false);
    expect((await ctx.as(supplierId).get('/me')).body.data.role).toBe('customer');
  });

  it('deactivating an area makes its PIN codes unserviceable', async () => {
    await owner().patch(`/admin/zones/${otherAreaId}`).send({ isActive: false });
    expect((await request(ctx.app).get('/api/v1/serviceability?postalCode=560004')).body.data.serviceable).toBe(false);
    // and the PIN can now be reused by another area
    expect((await owner().post('/admin/zones').send({ name: 'Basavanagudi New', postalCodes: ['560004'], windowStart: '06:00', windowEnd: '08:00', cutoffTime: '21:00' })).status).toBe(201);
  });

  it('U1 is unaffected by area changes in other PIN codes', async () => {
    expect((await ctx.as(U1).get('/addresses')).body.data).toEqual([]);
  });
});
