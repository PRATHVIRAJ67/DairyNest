/**
 * OFFLINE DEMO ONLY. Boots the real Express app on an in-memory Postgres (PGlite) with the real migrations and
 * seed data, so you can try the whole app without Supabase or Razorpay accounts.
 *
 * Stand-ins (never use these against real data):
 * - Auth: the bearer token "demo:+91XXXXXXXXXX" signs in as that phone number. The customer is created on first use.
 *   The token "user:<uuid>" is also accepted (used by the automated tests).
 * - Payments: Razorpay is simulated. POST /api/v1/demo/pay returns a correctly signed payment proof,
 *   which the app then sends to the REAL /payments/verify endpoint. Signature checks are not bypassed.
 * - Data lives in memory and is lost when the process stops.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import { authenticate, type AuthUser, type TokenVerifier } from '../src/auth';
import { createCtx, U1 } from '../tests/harness';

if (process.env.NODE_ENV === 'production') throw new Error('local-demo must never run in production');

const port = Number(process.env.PORT ?? 4000);
// PUBLIC_DEMO=1 when the demo is reachable from the internet (e.g. on Render): keep rate limits on.
const publicDemo = process.env.PUBLIC_DEMO === '1';
const ctx = await createCtx({ payments: 'test' });
Object.defineProperty(ctx.deps, 'now', { value: () => new Date() });

/** Stable UUID for a phone number, so the same number always signs in as the same customer. */
function uuidForPhone(phone: string) {
  const h = createHash('sha1').update(`dailydairy-demo:${phone}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const base = ctx.deps.verifier;
const demoVerifier: TokenVerifier = {
  async verify(token: string): Promise<AuthUser | null> {
    const m = /^demo:(\+91[6-9]\d{9})$/.exec(token);
    if (!m) return base.verify(token);
    const id = uuidForPhone(m[1]);
    await ctx.pg.query(`insert into auth.users (id, phone) values ($1, $2) on conflict (id) do nothing`, [id, m[1]]);
    return { id, phone: m[1], email: null };
  },
};
ctx.deps.verifier = demoVerifier;
// The app was built with the original verifier captured in its middleware, so rebuild it with the demo one.
const { createApp } = await import('../src/app');
const api = createApp(ctx.deps, { rateLimit: publicDemo });

const demo = express.Router();
demo.use(express.json());
demo.use(authenticate(demoVerifier, ctx.deps.db));
demo.post('/pay', async (req, res) => {
  const { providerOrderId, outcome } = req.body ?? {};
  if (typeof providerOrderId !== 'string' || !ctx.provider.orders.has(providerOrderId)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown order' } });
    return;
  }
  const proof = ctx.provider.pay(providerOrderId, { status: outcome === 'fail' ? 'failed' : 'captured', id: `pay_DEMO${Date.now()}` });
  res.json({ data: proof });
});

const app = express();
if (publicDemo) app.set('trust proxy', 1); // real client IPs behind the host's proxy, for rate limiting
app.use('/api/v1/demo', demo);
app.use(api);

app.listen(port, '0.0.0.0', () => {
  console.log('');
  console.log('  DailyDairy DEMO API (in-memory database, simulated login and payments)');
  console.log(`  Local:    http://localhost:${port}/api/v1`);
  console.log(`  API docs: http://localhost:${port}/api/v1/docs`);
  console.log('  Sign in with any Indian mobile number and the code 123456.');
  console.log(`  Test token: user:${U1}`);
  console.log('');
});
