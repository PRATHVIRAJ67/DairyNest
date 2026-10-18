# DailyDairy: milk and curd subscription delivery

A customer app for prepaid milk and curd subscriptions, built as a monorepo.

| Part | Path | Stack |
| --- | --- | --- |
| Mobile app | `apps/mobile` | Expo SDK 57, React Native 0.86, TypeScript, Expo Router, TanStack Query, React Hook Form, Zod, Zustand, Reanimated |
| API | `services/api` | Node 22, Express 4, TypeScript (strict), Zod, pino, OpenAPI at `/api/v1/docs` |
| Database | `supabase/` | Supabase Postgres: migrations, Row Level Security, seed, database tests |
| Shared logic | `packages/shared`, `packages/validation` | Money, schedules, cutoff rules, pricing, state machine, Zod schemas |

Not included by design: admin dashboard, cron jobs, scheduled workers, automatic delivery generation or scheduled notifications.

## Honest status

Everything below was run in this repository. See [TASKS.md](TASKS.md) for the detailed checklist.

| Check | Result |
| --- | --- |
| API integration tests (real migrations on in-process Postgres) | 76 passing |
| Database tests (constraints, RLS, atomic functions) | 22 passing |
| Shared logic and validation tests | 15 passing |
| Mobile tests (auth forms, checkout flow, validation, basket) | 23 passing |
| Type check, lint (0 errors), API build, Android and iOS production bundles | passing |

**Needs your configuration before it works for real** (nothing here can be verified without your accounts):

- A Supabase project, with the migrations applied and a phone (SMS) provider enabled. Real OTP sign-in is untested here.
- Razorpay test keys and a webhook. Without them checkout returns `PAYMENT_NOT_CONFIGURED`. The Razorpay REST calls and signature checks are unit tested against the documented algorithms, but no live sandbox payment was made.
- An EAS project id and a development build for remote push. Push is untested on a device.
- Real product photos. Until uploaded, the app draws vector illustrations.
- Recurring auto-debit is **not** implemented. Plans are prepaid for 30 days and renewed manually.

Start with [docs/SETUP.md](docs/SETUP.md).

## Quick start

```bash
npm install
cp .env.example .env              # fill in Supabase values
cp apps/mobile/.env.example apps/mobile/.env
npm run db:migrate -w @milk/api   # or use the Supabase CLI, see docs/SETUP.md
npm run dev -w @milk/api          # API on :4000, docs at /api/v1/docs
npm start -w @milk/mobile         # Expo
```

## Try it now (demo mode, no accounts needed)

Demo mode runs the real API on an in-memory database. It swaps SMS for the fixed code `123456` and Razorpay for a simulated payment that the server still signature-checks. Data resets when the API stops. Release builds ignore demo mode.

1. `npm install` (once).
2. Terminal 1: `npm run demo:api`.
3. Make sure `apps/mobile/.env` has `EXPO_PUBLIC_DEMO_MODE=1` and `EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000/api/v1`.
4. Terminal 2: `npm run demo:app`, then press `w` for the browser, or scan the QR code with Expo Go on a phone on the same Wi-Fi.
5. Sign in with any 10-digit mobile number and the code `123456`. Serviceable demo PIN codes include `560001`.

## Demo APK for a phone

`npm run apk:demo` builds a separate **DailyDairy Demo** app (package `com.dailydairy.app.demo`) in Expo's cloud and prints a download link. It needs a free Expo account: run `npx eas-cli login` once first. The APK talks to the demo API at the address set in `apps/mobile/eas.json`, currently `http://192.168.1.37:4000/api/v1`. Keep `npm run demo:api` running on that computer, and keep the phone on the same Wi-Fi.

## Test mode (current live setup)

The live backend runs in **test mode** so the app can be tried without SMS or Razorpay:

- **Test login.** Any 10-digit Indian mobile number signs in with one shared 6-digit test code. The code is `TEST_LOGIN_CODE` in the repo-root `.env`, which is gitignored. No SMS is sent. The server issues signed 30-day sessions and creates a real customer per number. Code guessing is rate-limited.
- **Simulated payments.** With `PAYMENTS_MODE=simulated`, checkout uses a stand-in for Razorpay. No money moves, but `/payments/verify` still checks the signature and the amount.
- **Turning it off before launch.** Delete `TEST_LOGIN_CODE`, `TEST_SESSION_SECRET` and `PAYMENTS_MODE` from `.env`. Delete the two secrets in Cloudflare with `npx wrangler secret delete TEST_LOGIN_CODE` and `npx wrangler secret delete TEST_SESSION_SECRET`, run from `services/api`. Configure Supabase phone OTP and Razorpay, then run `npm run cf:deploy`.

## Host on Cloudflare (real Supabase backend)

The API runs as a Cloudflare Worker (`services/api/src/worker.ts`). It reaches Supabase through Hyperdrive, which pools connections over TLS with query caching off. The web app runs on Cloudflare Pages.

1. Fill in the repo-root `.env`: `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key).
2. Run `npx wrangler login` once.
3. Run `npm run cf:deploy`. It creates or reuses the Hyperdrive config, deploys the Worker, uploads secrets, publishes the web app to Pages, sets CORS, and writes the live URLs into the `cloud` APK profile.
4. For a phone build, run `npx eas-cli login` and then `npm run apk:cloud`.

Sign-in uses Supabase phone OTP, so turn on the Phone provider in Supabase first. Test numbers work without sending SMS. Free-plan limits are 100k requests a day for Workers and 3 MB for the Worker bundle. The bundle is about 0.6 MB.

To run locally in the Workers runtime, use `npm run cf:dev -w @milk/api` with secrets in `services/api/.dev.vars`, which is gitignored.

## Online demo (any network)

1. Push this repo to a private GitHub repo.
2. On render.com, choose New > Blueprint and pick the repo. `render.yaml` creates `dailydairy-demo-api`, a free Docker service.
3. Open `https://<service>.onrender.com/api/v1/health`. If the URL differs from `https://dailydairy-demo-api.onrender.com`, update `EXPO_PUBLIC_API_URL` in the `demo-online` profile of `apps/mobile/eas.json`.
4. Run `npx eas-cli login` once, then `npm run apk:demo-online`, and install the APK from the link.

Free Render instances sleep after about 15 idle minutes. The first request then takes about a minute, and demo data resets.

## Scripts (repo root)

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Docs

- [docs/SETUP.md](docs/SETUP.md): Supabase, Razorpay, push, running and releasing
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design decisions, data model, business rules, security
- [TASKS.md](TASKS.md): phase checklist and open items
