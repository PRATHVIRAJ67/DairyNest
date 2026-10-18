import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayProvider, UnconfiguredProvider } from '../src/payments/provider';

const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex');

describe('RazorpayProvider signature verification', () => {
  const p = new RazorpayProvider('rzp_test_x', 'key_secret', 'wh_secret');

  it('accepts the documented order_id|payment_id HMAC and rejects tampering', () => {
    const sig = hmac('key_secret', 'order_1|pay_1');
    expect(p.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig })).toBe(true);
    expect(p.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig })).toBe(false);
    expect(p.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig.slice(0, -1) + '0' })).toBe(false);
    expect(p.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: '' })).toBe(false);
  });
  it('verifies webhooks over the raw body with the webhook secret (not the key secret)', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(p.verifyWebhookSignature(body, hmac('wh_secret', body.toString()))).toBe(true);
    expect(p.verifyWebhookSignature(body, hmac('key_secret', body.toString()))).toBe(false);
    expect(p.verifyWebhookSignature(body, undefined)).toBe(false);
  });
  it('rejects webhooks when no webhook secret is configured', () => {
    const q = new RazorpayProvider('k', 's', undefined);
    const body = Buffer.from('{}');
    expect(q.verifyWebhookSignature(body, hmac('', body.toString()))).toBe(false);
  });
  it('creates orders through the REST API with basic auth and integer paise', async () => {
    let seen: any;
    const fakeFetch = (async (url: string, init: any) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ id: 'order_abc' }) };
    }) as any;
    const r = await new RazorpayProvider('rzp_test_x', 'sec', undefined, fakeFetch).createOrder({ amountMinor: 174600, receipt: 'r1' });
    expect(r.id).toBe('order_abc');
    expect(seen.url).toBe('https://api.razorpay.com/v1/orders');
    expect(JSON.parse(seen.init.body)).toMatchObject({ amount: 174600, currency: 'INR' });
    expect(seen.init.headers.Authorization).toBe('Basic ' + Buffer.from('rzp_test_x:sec').toString('base64'));
  });
  it('surfaces provider errors as 502 without leaking internals', async () => {
    const fakeFetch = (async () => ({ ok: false, json: async () => ({ error: { description: 'Authentication failed' } }) })) as any;
    await expect(new RazorpayProvider('k', 's', undefined, fakeFetch).createOrder({ amountMinor: 100, receipt: 'r' })).rejects.toMatchObject({ status: 502 });
  });
  it('the unconfigured provider never verifies anything', () => {
    const u = new UnconfiguredProvider();
    expect(u.verifyCheckoutSignature()).toBe(false);
    expect(u.verifyWebhookSignature()).toBe(false);
    expect(u.isConfigured()).toBe(false);
  });
});
