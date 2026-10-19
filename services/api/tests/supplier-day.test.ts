import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createCtx, uid, validAddress, type Ctx } from './harness';

/**
 * The supplier's day view must make it obvious who gets milk and who must NOT (and why),
 * plus heads-up tags such as "new customer" or "pausing from tomorrow".
 */
describe('supplier day: who to deliver, who not, and why', () => {
  let ctx: Ctx;
  let supplierId: string;
  const customers = { asha: uid(201), ravi: uid(202), meena: uid(203), kiran: uid(204), dev: uid(205) };
  const sub: Record<string, string> = {};
  const day = async (date: string) => (await ctx.as(supplierId).get(`/supplier/day?date=${date}`)).body.data;
  const names = (list: any[]) => list.map((x) => x.customerName).sort();

  async function subscribe(userId: string, name: string, key: string, opts: { frequency?: string; startDate?: string } = {}) {
    await ctx.pg.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [userId]);
    await ctx.as(userId).put('/me').send({ fullName: name });
    const addr = (await ctx.as(userId).post('/addresses').send({ ...validAddress, recipientName: name, postalCode: '560011' })).body.data;
    const prods = (await request(ctx.app).get('/api/v1/products?pageSize=50')).body.data as any[];
    const v = prods.flatMap((p) => p.variants).find((x: any) => x.sku === 'CM-500');
    const c = await ctx.as(userId).post('/subscriptions').send({
      items: [{ variantId: v.id, quantity: 1 }], addressId: addr.id,
      schedule: { frequency: opts.frequency ?? 'daily', startDate: opts.startDate ?? '2026-03-11' }, acceptTerms: true, idempotencyKey: key,
    });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    await ctx.as(userId).post('/payments/verify').send(ctx.provider.pay(c.body.data.checkout.providerOrderId));
    return c.body.data.subscription.id as string;
  }

  beforeAll(async () => {
    ctx = await createCtx(); // clock: 2026-03-10 15:30 IST
    const area = (await ctx.as(ADMIN).post('/admin/zones').send({ name: 'Jayanagar', postalCodes: ['560011'], windowStart: '05:30', windowEnd: '07:30', cutoffTime: '21:00' })).body.data.id;
    supplierId = (await ctx.as(ADMIN).post('/admin/suppliers').send({ phone: '+919811100009', fullName: 'Area Supplier', zoneIds: [area] })).body.data.id;
    sub.asha = await subscribe(customers.asha, 'Asha', 'k-asha-0001');
    sub.ravi = await subscribe(customers.ravi, 'Ravi', 'k-ravi-0001');
    sub.meena = await subscribe(customers.meena, 'Meena', 'k-meena-001');
    sub.kiran = await subscribe(customers.kiran, 'Kiran', 'k-kiran-001');
    sub.dev = await subscribe(customers.dev, 'Dev', 'k-dev-00001', { startDate: '2026-03-13' });

    await ctx.as(customers.ravi).post(`/subscriptions/${sub.ravi}/pause`).send({ from: '2026-03-12', until: '2026-03-14' }); // Ravi: 12th to 14th
    await ctx.as(customers.meena).post(`/subscriptions/${sub.meena}/skip`).send({ date: '2026-03-12' }); // Meena skips the 12th
    await ctx.as(customers.kiran).post(`/subscriptions/${sub.kiran}/pause`).send({ from: '2026-03-13' }); // Kiran: until resumed
  });

  it('day 11: everyone delivers; heads-up for tomorrow\'s pause and skip', async () => {
    const d = await day('2026-03-11');
    expect(names(d.deliveries)).toEqual(['Asha', 'Kiran', 'Meena', 'Ravi']);
    expect(d.notToday).toEqual([]);
    const tags = Object.fromEntries(d.deliveries.map((x: any) => [x.customerName, x.tags]));
    expect(tags.Asha).toEqual(['new_customer']);
    expect(tags.Ravi).toEqual(['new_customer', 'pausing_from_tomorrow']);
    expect(tags.Meena).toEqual(['new_customer', 'skipping_tomorrow']);
  });

  it('day 12: paused and skipped customers are listed as "do not deliver" with the reason', async () => {
    const d = await day('2026-03-12');
    expect(names(d.deliveries)).toEqual(['Asha', 'Kiran']);
    const not = Object.fromEntries(d.notToday.map((x: any) => [x.customerName, x]));
    expect(not.Ravi).toMatchObject({ reason: 'paused', pausedUntil: '2026-03-14', postalCode: '560011', items: '1 x Farm Fresh Cow Milk 500 ml' });
    expect(not.Meena).toMatchObject({ reason: 'skipped' });
    expect(d.notToday[0].reason).toBe('paused'); // paused first, then skipped
    expect(d.counts).toMatchObject({ not_paused: 1, not_skipped: 1, skipped: 1 });
    expect(d.totals[0].quantity).toBe(2); // the load sheet excludes them
    expect(d.deliveries.find((x: any) => x.customerName === 'Kiran').tags).toContain('pausing_from_tomorrow');
  });

  it('day 13: indefinite pause shows "until resumed", and a new customer starts', async () => {
    const d = await day('2026-03-13');
    const not = Object.fromEntries(d.notToday.map((x: any) => [x.customerName, x]));
    expect(not.Kiran).toMatchObject({ reason: 'paused', pausedUntil: null });
    expect(not.Ravi.reason).toBe('paused');
    expect(d.deliveries.find((x: any) => x.customerName === 'Dev').tags).toContain('new_customer');
  });

  it('day 15: Ravi is back from his pause', async () => {
    const d = await day('2026-03-15');
    expect(d.deliveries.find((x: any) => x.customerName === 'Ravi').tags).toContain('back_from_pause');
  });

  it('a cancelled customer shows as "stopped" for a week so the supplier stops delivering', async () => {
    await ctx.as(customers.asha).post(`/subscriptions/${sub.asha}/cancel`).send({ reason: 'Moving' });
    const d = await day('2026-03-16');
    expect(d.deliveries.some((x: any) => x.customerName === 'Asha')).toBe(false);
    expect(d.notToday.find((x: any) => x.customerName === 'Asha')).toMatchObject({ reason: 'stopped', stoppedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }); // DB stamps the real date
  });

  it('when prepaid deliveries run out: "last prepaid" on the final day, then "renewal due"', async () => {
    // Dev has 30 prepaid daily deliveries from the 13th: the last one is on April 11th.
    await day('2026-04-11');
    const last = await day('2026-04-11');
    expect(last.deliveries.find((x: any) => x.customerName === 'Dev').tags).toContain('last_prepaid');
    const after = await day('2026-04-12');
    expect(after.deliveries.some((x: any) => x.customerName === 'Dev')).toBe(false);
    expect(after.notToday.find((x: any) => x.customerName === 'Dev')).toMatchObject({ reason: 'renewal_due' });
  });

  it('weekday customers are not listed on their off days', async () => {
    const id = uid(206);
    await subscribe(id, 'Weekday Wendy', 'k-wendy-0001', { frequency: 'alternate_days', startDate: '2026-03-11' });
    expect((await day('2026-03-17')).deliveries.some((x: any) => x.customerName === 'Weekday Wendy')).toBe(true); // 11,13,15,17
    const off = await day('2026-03-18');
    expect(off.deliveries.some((x: any) => x.customerName === 'Weekday Wendy')).toBe(false);
    expect(off.notToday.some((x: any) => x.customerName === 'Weekday Wendy')).toBe(false); // simply not their day
  });
});
