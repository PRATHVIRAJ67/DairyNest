# Architecture

```
mobile app (Expo)  --Bearer JWT-->  Express API  --SQL (pg)-->  Supabase Postgres
      |                                  |                            ^
      +-- Supabase Auth (phone OTP) <----+-- verifies token --------+
                                         +-- Razorpay (orders, verification, webhooks)
                                         +-- Expo push service
```

## Key decisions

| Decision | Reason |
| --- | --- |
| API talks to Postgres with `pg`, not supabase-js | Real multi-statement transactions, row locks and SQL functions for money-critical steps. The same code runs against an in-process Postgres in tests, so the 76 API tests exercise the real migrations. |
| API verifies Supabase tokens by asking Supabase Auth | Works for any signing-key setup. The role comes from `profiles`, never from a token claim. |
| API connects with a privileged role | It bypasses RLS, so every query includes the owner id. Another customer's id returns 404. RLS stays on as a second layer for any direct client access, and clients have no write grants on money tables. |
| Money is integer paise | No floating-point in pricing. Percentages use basis points with integer rounding. |
| Pricing only on the server | The app sends ids and quantities. The server prices, validates availability, coupons and cutoff. |
| Prepaid balance, not date arithmetic | See below. |
| Razorpay Checkout in a WebView | Works in Expo Go and dev builds. The device callback is only a hint. |
| No scheduler | Per scope. Idempotent API operations replace cron. |

## Data model

22 tables: `profiles`, `addresses`, `delivery_zones`, `holidays`, `products`, `product_variants`, `subscription_plans`, `subscriptions`, `subscription_items`, `subscription_pauses`, `subscription_skipped_dates`, `deliveries`, `delivery_items`, `payment_orders`, `payments`, `payment_webhook_events`, `invoices`, `coupons`, `coupon_redemptions`, `notifications`, `support_tickets`, `audit_logs`.

Constraints that carry business rules:

- `unique (subscription_id, delivery_date)` prevents duplicate deliveries.
- `unique (user_id, idempotency_key)` makes subscription creation replay-safe.
- `unique (provider, event_id)` makes webhook handling idempotent.
- `unique (provider_payment_id)` and `unique (payment_id)` on invoices prevent double payment or invoice rows.
- One default address per user (partial unique index), postal code and phone check constraints, non-negative money, `mrp >= price`.

SQL functions (service role only): `fn_apply_payment_capture`, `fn_apply_payment_failure`, `fn_apply_refund`, `fn_insert_deliveries`, `fn_delete_account`. Each runs in one transaction and takes row locks.

## Subscription lifecycle

```
pending_payment -> active <-> paused
        |            |  \
        |            |   -> past_due -> active
        +------------+------> cancelled   (terminal)
```

Transitions live in `packages/shared/src/state.ts` and are checked on every status change. Creation never activates a subscription: only a provider-confirmed capture does.

## Billing and deliveries

- A subscription is prepaid in 30-day blocks. The paid order records how many deliveries it covers, which becomes the subscription's `delivery_balance`.
- Deliveries are created only while the balance is positive; each one consumes a unit. Skipped, paused, failed and cancelled deliveries give the unit back, so the plan lasts longer and the customer pays only for what is delivered.
- Quantity and frequency changes re-create not-yet-prepared deliveries from the next changeable day. Prepaid deliveries keep their paid value, and new prices apply at renewal.
- Renewal is manual and allowed when 14 or fewer prepaid deliveries remain.
- Cancelling keeps deliveries that are already prepared, cancels the rest, and opens a refund-review ticket for unused balance.

## Cutoff, timezone and holidays

- All delivery dates are calendar dates in the zone's timezone (Asia/Kolkata by default), never UTC dates.
- A delivery can be changed until the zone's cutoff time (default 21:00) on the evening before. `earliestChangeableDate` returns tomorrow before the cutoff and the day after tomorrow once it passes.
- Holidays (global or per zone) are excluded from pricing and delivery creation.
- Past the cutoff the app shows "Being prepared". Admin statuses move a delivery on from there.

## Security summary

- Bearer token on every private route; ownership in every query; role from the database.
- Zod validation on all inputs, centralised error format, no stack traces to clients.
- Helmet, CORS allow-list, request ids, structured logs with secrets redacted, rate limits (global and tighter on payments).
- Payment checks: HMAC with constant-time comparison, provider confirmation of status and amount, raw-body webhook verification, idempotent processing, late failure events cannot undo a capture.
- Audit log for subscription, payment, refund and account actions.
- Account deletion anonymises personal data, cancels subscriptions, removes the auth user, and keeps payment records.
- The mobile app contains only the public anon key. Session tokens are stored in the OS keychain/keystore.

## Known limitations

- No recurring auto-debit. No GST tax invoices (receipts are payment confirmations).
- Email and SMS channels are placeholders reported as `not_configured`.
- Delivery generation happens when the app opens or a plan changes, not in the background.
- Receipts are HTML documents, not PDFs.
- The mobile app has not been run on a physical device or emulator in this environment; it was verified through unit/flow tests, type checks, production bundles for Android and iOS, and a web render against the API.
