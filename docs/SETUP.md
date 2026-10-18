# Setup guide

Everything here needs your own accounts. Nothing is pre-configured and no credentials are committed.

## 1. Supabase

1. Create a project at supabase.com (pick a region near your customers, for example Mumbai).
2. Copy these into `.env` (see `.env.example`):
   - Project URL and the publishable (anon) key from Project Settings > API.
   - The database connection string from Project Settings > Database. The transaction pooler string is a good default.
   - Optional: the service-role key. It is only used to delete the auth user on account deletion. Keep it server side.
3. Apply the schema. Either option works; do not mix them on one database.
   - Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
   - Without the CLI: `npm run db:migrate -w @milk/api`.
4. Load development data (zones, plans, products, coupons) with `npm run db:seed -w @milk/api`. Skip this in production and enter your real catalogue instead.
5. Optional: `supabase/seed.sql` also creates a public `product-images` storage bucket when run on Supabase.

The migrations create 22 tables with constraints, indexes and Row Level Security, plus atomic functions for payment capture, delivery creation, refunds and account deletion. Customers have read access to their own rows, and writes go through the API.

### Phone sign-in (OTP)

The app uses Supabase Auth phone OTP. Supabase does not send SMS by itself.

1. Authentication > Providers > Phone: enable it and connect an SMS provider (Twilio, MessageBird, Vonage or TextLocal). For India, check DLT registration requirements with your provider.
2. For development without sending SMS, Supabase lets you list test phone numbers with fixed OTPs in the same settings page.
3. Until a provider is configured, the app shows: "SMS sending is not set up for this project yet." It never fakes verification.

Account recovery is the same flow: signing in again with the same number returns the same account. For a lost number, customers use the "Contact support" link on the sign-in screen.

### Making an admin

There is no admin UI. Operations endpoints (`/admin/...`) require `profiles.role = 'admin'`. After the person signs in once:

```sql
update public.profiles set role = 'admin' where phone = '+91XXXXXXXXXX';
```

## 2. Razorpay (test mode)

Subject to Razorpay account approval for your business.

1. Dashboard > Account & Settings > API keys: generate **test** keys. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Dashboard > Webhooks: add `https://YOUR-API-HOST/api/v1/webhooks/razorpay` with a secret of your choice (set the same value in `RAZORPAY_WEBHOOK_SECRET`). Enable `payment.captured`, `payment.failed`, `order.paid` and `refund.processed`. Use a tunnel such as ngrok for local testing.
3. Restart the API. `GET /api/v1/health` now reports `paymentsConfigured: true`.
4. Pay with Razorpay's documented test cards or test UPI IDs.

How payments are protected:

- The API creates the order and calculates the amount. The app never sends prices.
- After checkout the app sends the signature. The API verifies it, then fetches the payment from Razorpay and checks it is captured for the exact order amount before activating anything.
- Webhook signatures are verified over the raw request bytes. Events are stored once (unique event id) and processing is idempotent, so retries and duplicates are safe.
- Card numbers and UPI PINs never reach this system.

Checkout runs Razorpay Standard Checkout inside a WebView, so it works in Expo Go and dev builds without a native module. You can swap in `react-native-razorpay` with a dev build later if you prefer the native SDK.

**Recurring billing is not implemented.** Subscriptions are prepaid for 30 days and renewed from the app. Auto-debit needs Razorpay Subscriptions or UPI AutoPay (e-mandate) approval and testing, which has not been done.

### Refunds

Admins call `POST /api/v1/admin/payments/:id/refund`. When a customer cancels with unused prepaid deliveries, the API opens a support ticket for refund review.

## 3. Running locally

```bash
npm install
npm run dev -w @milk/api        # http://localhost:4000/api/v1/docs
npm start -w @milk/mobile       # then press a (Android), i (iOS) or scan the QR with a dev build
```

On a physical phone set `EXPO_PUBLIC_API_URL` to your computer's LAN address, and make sure your firewall allows port 4000.

## 4. Push notifications

In-app notification history always works. Remote push needs all of:

- a physical device, notification permission, and a development or production build (Expo Go does not support remote push);
- `eas init`, then `EXPO_PUBLIC_EAS_PROJECT_ID` in `apps/mobile/.env`.

Email and SMS notifications have no provider yet. The API records them as `not_configured`, never as sent.

## 5. Product photos

The catalogue stores `image_url`. Upload photos to the `product-images` bucket (or any public URL) and set the column:

```sql
update public.products set image_url = 'https://YOUR-REF.supabase.co/storage/v1/object/public/product-images/set-curd.jpg' where slug = 'set-curd';
```

Until then the app draws vector illustrations. Use photos you own or have licensed.

## 6. Delivery operations without a scheduler

- Deliveries are created by an idempotent API call: `POST /subscriptions/:id/deliveries/generate`. The app calls it when the customer opens Home, and it runs when payment succeeds or a plan changes. Only prepaid deliveries are ever created.
- Delivery statuses after "scheduled" (preparing, out for delivery, delivered, failed) are set through `PATCH /admin/deliveries/:id/status`. Without that call a past delivery stays "scheduled" in the database. The app shows a derived "Being prepared" state once the cutoff has passed.
- Subscription states such as "paused until a date ending" and "past due" are reconciled lazily whenever the subscription is read.

## 7. Release checklist

- [ ] Replace the template Terms and Privacy text in `app/legal/[doc].tsx` after legal review.
- [ ] Set `CORS_ORIGINS`, use production Supabase and Razorpay **live** keys, and review RLS in the dashboard.
- [ ] Rotate any key that was ever pasted into chat, email or a ticket.
- [ ] Configure an SMS provider and complete DLT registration if sending in India.
- [ ] Build with EAS (`eas build`). `npm run build:android` and `build:ios` in `apps/mobile` produce JS bundles and are used here as a smoke test.
- [ ] Add monitoring and log shipping for the API (pino JSON logs are on stdout), and run it behind HTTPS.
- [ ] Add real app store assets. The included icons are simple placeholders.

## Versions

| Package | Version | Why |
| --- | --- | --- |
| Expo SDK | 57 (React Native 0.86, React 19.2.3) | Current at build time. `npx expo install` resolved every Expo module to matching versions. |
| React | pinned to 19.2.3 with an npm override | Two React copies break hooks; the override keeps one. |
| Express | 4.x | Mature and well supported. Express 5 is fine to adopt later. |
| Zod | 3.x | Shared by API and app, pinned to one major. |
| PGlite | 0.2.x | In-process Postgres used only by tests and the demo launcher. |
