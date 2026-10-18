# Tasks

Legend: [x] done and verified here, [~] built and tested here but needs your external account to run for real, [ ] not done.

## Phase 1: Setup, architecture, shared logic, design system
- [x] Monorepo with npm workspaces, ESLint, Prettier, strict TypeScript
- [x] Shared money, schedule, cutoff, pricing and state-machine logic (11 tests)
- [x] Zod validation package (4 tests)
- [x] Design tokens, light and dark themes, reusable UI kit (buttons, inputs, cards, product and subscription cards, dialogs, bottom sheets, skeletons, empty and error states, banners)

## Phase 2: Database, RLS, auth
- [x] 3 migrations: 22 tables, constraints, indexes, RLS, atomic functions, seed data
- [x] 22 database tests: constraints, RLS isolation, privilege escalation, idempotent capture, duplicate deliveries, refunds, account deletion
- [~] Supabase project creation and migration: needs your project (only an unrelated project exists in the connected account, and it was not touched)
- [~] Phone OTP login: client and API verification built; needs an SMS provider in Supabase

## Phase 3: API
- [x] Express app, auth middleware, roles, errors, rate limits, security headers, request ids, pino logging, OpenAPI at /api/v1/docs
- [x] Products, plans, serviceability, addresses, coupons, profile, notifications, support
- [x] 76 API tests, including customer isolation on every resource

## Phase 4: Onboarding, auth, home, catalogue (mobile)
- [x] Splash gate, onboarding, phone, OTP, profile setup, home, shop, product details
- [x] Verified: products flow from seeded database through Express to the rendered UI (offline demo API plus web render)

## Phase 5: Checkout and lifecycle
- [x] Server-side quote and creation, idempotency, coupons, start-date cutoff
- [x] Pause (dated, indefinite), resume, skip, undo skip, quantity, frequency, address, cancel, history
- [x] Checkout flow tests (server totals, terms gate, idempotency key, unconfigured payments, coupon errors)

## Phase 6: Calendar and deliveries
- [x] Monthly calendar, filters, delivery details, derived "Being prepared" state, manual delivery generation, duplicate prevention under concurrency

## Phase 7: Payments
- [x] Provider abstraction, Razorpay REST client, signature verification, webhooks, reconciliation, invoices, receipts, refunds
- [~] Live sandbox payment: needs Razorpay test keys and a webhook URL
- [ ] Recurring auto-debit (needs Razorpay Subscriptions or UPI AutoPay approval)

## Phase 8: Notifications, support, settings
- [x] In-app notification history, preferences, support tickets, FAQs, profile, privacy settings, account deletion
- [~] Push delivery: needs a device, EAS project id and a dev build
- [ ] Email and SMS providers

## Phase 9: Integration, accessibility, builds
- [x] 136 automated tests passing (API 76, database 22, shared 11, validation 4, mobile 23)
- [x] Type check, lint (0 errors), API production build, Android and iOS production bundles
- [x] Accessibility basics: labels, roles, states, 44 pt touch targets, text scaling limit
- [ ] Run on a physical device or emulator (not available in this environment)
- [ ] Screen-reader pass on a device

## Open items
- Real product photography
- Legal review of Terms and Privacy
- Production hosting, monitoring and EAS builds
- Admin dashboard, cron jobs and scheduled notifications: intentionally out of scope for this phase
