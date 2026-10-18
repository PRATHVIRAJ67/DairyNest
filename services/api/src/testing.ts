/**
 * TESTING-ONLY features, enabled by configuration and OFF by default. Remove the TEST_* secrets and set
 * PAYMENTS_MODE=razorpay before real customers use the app.
 *
 * 1. Test login (TEST_LOGIN_CODE + TEST_SESSION_SECRET): any Indian mobile number signs in with one shared 6-digit
 *    code instead of an SMS OTP. The server issues an HMAC-signed session token; the user is created in Supabase
 *    auth.users with a stable id per phone number, so real data (profiles, subscriptions) works normally.
 * 2. Simulated payments (PAYMENTS_MODE=simulated): a stand-in for Razorpay. It is stateless, because Cloudflare
 *    Workers may serve each request from a different instance: every payment id carries its order, amount and
 *    status, protected by an HMAC. /payments/verify still checks the checkout signature and the amount.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { indianPhone } from '@milk/validation';
import type { AuthUser, TokenVerifier } from './auth';
import { authenticate } from './auth';
import type { Config } from './config';
import type { Deps } from './deps';
import { badRequest, notFound, unauthorized } from './errors';
import { asyncHandler, ok, validate } from './http';
import { hmacHex, safeEqualHex, type PaymentProvider, type ProviderPayment } from './payments/provider';

const SESSION_DAYS = 30;
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export const testLoginEnabled = (c: Pick<Config, 'TEST_LOGIN_CODE' | 'TEST_SESSION_SECRET'>) => !!(c.TEST_LOGIN_CODE && c.TEST_SESSION_SECRET);

/** Stable auth user id for a phone number (UUID v5 layout from a SHA-1 of the number). */
export function testUserId(phone: string): string {
  const h = crypto.createHash('sha1').update(`dailydairy-test:${phone}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------- sessions

export function issueTestToken(secret: string, phone: string, now: Date) {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86400;
  const body = b64u(`${phone}|${exp}`);
  return { token: `test.${body}.${hmacHex(secret, `session:${body}`)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function readTestToken(secret: string, token: string, now: Date): AuthUser | null {
  const m = /^test\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(token);
  if (!m || !safeEqualHex(hmacHex(secret, `session:${m[1]}`), m[2])) return null;
  const [phone, exp] = unb64u(m[1]).split('|');
  if (!indianPhone.safeParse(phone).success || !(Number(exp) * 1000 > now.getTime())) return null;
  return { id: testUserId(phone), phone, email: null };
}

/** Accepts signed test sessions; everything else goes to the real (Supabase) verifier. */
export function withTestSessions(real: TokenVerifier, secret: string, now: () => Date): TokenVerifier {
  return { verify: async (token) => (token.startsWith('test.') ? readTestToken(secret, token, now()) : real.verify(token)) };
}

// ---------------------------------------------------------------- simulated payments

interface SimPayment { o: string; a: number; s: 'captured' | 'failed' }

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated';
  static readonly KEY = 'rzp_test_simulated';
  constructor(private secret: string) {}
  isConfigured() { return true; }
  publicKey() { return SimulatedPaymentProvider.KEY; }
  async createOrder() { return { id: `order_SIM${crypto.randomBytes(7).toString('hex')}` }; }

  makePayment(orderId: string, amountMinor: number, status: SimPayment['s']) {
    const body = b64u(JSON.stringify({ o: orderId, a: amountMinor, s: status } satisfies SimPayment));
    const id = `pay_SIM_${body}.${hmacHex(this.secret, `pay:${body}`).slice(0, 32)}`;
    return { razorpay_order_id: orderId, razorpay_payment_id: id, razorpay_signature: hmacHex(this.secret, `${orderId}|${id}`) };
  }
  verifyCheckoutSignature(a: { orderId: string; paymentId: string; signature: string }) {
    return safeEqualHex(hmacHex(this.secret, `${a.orderId}|${a.paymentId}`), a.signature);
  }
  verifyWebhookSignature() { return false; } // there are no simulated webhooks
  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const m = /^pay_SIM_([A-Za-z0-9_-]+)\.([0-9a-f]{32})$/.exec(paymentId);
    if (!m || !safeEqualHex(hmacHex(this.secret, `pay:${m[1]}`).slice(0, 32), m[2])) throw badRequest('Unknown payment', 'PAYMENT_NOT_FOUND');
    const p = JSON.parse(unb64u(m[1])) as SimPayment;
    return {
      id: paymentId, orderId: p.o, amountMinor: p.a, status: p.s, method: 'upi', amountRefundedMinor: 0,
      errorDescription: p.s === 'failed' ? 'Payment declined (simulated)' : undefined,
    };
  }
  async fetchOrderPayments() { return []; } // stateless: nothing to list; verification goes through /payments/verify
  async refund() { return { id: `rfnd_SIM${crypto.randomBytes(5).toString('hex')}`, status: 'processed' }; }
}

// ---------------------------------------------------------------- routes

const testLoginBody = z.object({ phone: indianPhone, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const testPayBody = z.object({ providerOrderId: z.string().min(5).max(80), outcome: z.enum(['success', 'fail']).default('success') });

export function buildTestRouter(deps: Deps): Router {
  const r = Router();
  const { TEST_LOGIN_CODE: code, TEST_SESSION_SECRET: secret } = deps.config;

  if (code && secret) {
    // Brute-force guard for the shared code. Counted per client IP (Cloudflare passes it in cf-connecting-ip).
    const limiter = rateLimit({
      windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
      keyGenerator: (req) => String(req.headers['cf-connecting-ip'] ?? req.ip ?? 'unknown'),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in 15 minutes.' } },
    });
    r.post('/auth/test-login', limiter, validate(testLoginBody), asyncHandler(async (req, res) => {
      const { phone, code: given } = req.body as z.infer<typeof testLoginBody>;
      if (!safeEqualHex(hmacHex(secret, given), hmacHex(secret, code))) throw unauthorized('That code is incorrect or has expired');
      const id = testUserId(phone);
      // Same row Supabase Auth would create (phone stored without "+"). The trigger creates the profile.
      await deps.db.query(
        `insert into auth.users (id, phone, aud, role, created_at, updated_at, phone_confirmed_at)
         values ($1, $2, 'authenticated', 'authenticated', now(), now(), now()) on conflict (id) do nothing`,
        [id, phone.slice(1)],
      );
      await deps.db.query(`update profiles set phone = $2 where id = $1 and phone is distinct from $2 and deleted_at is null`, [id, phone]);
      const t = issueTestToken(secret, phone, deps.now());
      ok(res, { accessToken: t.token, expiresAt: t.expiresAt, user: { id, phone } });
    }));
  }

  if (deps.payments instanceof SimulatedPaymentProvider) {
    const sim = deps.payments;
    r.post('/test/pay', authenticate(deps.verifier, deps.db), validate(testPayBody), asyncHandler(async (req, res) => {
      const { providerOrderId, outcome } = req.body as z.infer<typeof testPayBody>;
      const o = (await deps.db.query<{ amount_minor: number; status: string }>(
        `select amount_minor, status from payment_orders where provider_order_id = $1 and user_id = $2`,
        [providerOrderId, req.auth!.userId],
      )).rows[0];
      if (!o) throw notFound('Payment order');
      if (o.status !== 'created') throw badRequest('This order is already settled', 'ORDER_SETTLED');
      ok(res, sim.makePayment(providerOrderId, o.amount_minor, outcome === 'fail' ? 'failed' : 'captured'));
    }));
  }
  return r;
}
