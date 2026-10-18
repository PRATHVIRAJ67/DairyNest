# Meadowpail: milk and curd subscription delivery

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

`npm run apk:demo` builds a separate **Meadowpail Demo** app (package `com.meadowpail.app.demo`) in Expo's cloud and prints a download link. It needs a free Expo account: run `npx eas-cli login` once first. The APK talks to the demo API at the address set in `apps/mobile/eas.json`, currently `http://192.168.1.37:4000/api/v1`. Keep `npm run demo:api` running on that computer, and keep the phone on the same Wi-Fi.

## Scripts (repo root)

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Docs

- [docs/SETUP.md](docs/SETUP.md): Supabase, Razorpay, push, running and releasing
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design decisions, data model, business rules, security
- [TASKS.md](TASKS.md): phase checklist and open items
