-- Row Level Security. The Express API uses the service role (bypasses RLS) and performs its own
-- ownership checks; these policies are the second line of defence for any direct client access.
do $$
declare t text;
begin
  foreach t in array array['profiles','delivery_zones','holidays','addresses','products','product_variants',
    'subscription_plans','coupons','subscriptions','subscription_items','subscription_pauses',
    'subscription_skipped_dates','deliveries','delivery_items','payment_orders','payments',
    'payment_webhook_events','invoices','coupon_redemptions','notifications','support_tickets','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public catalog (read-only)
create policy "catalog read products" on public.products for select using (is_active);
create policy "catalog read variants" on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_id and p.is_active));
create policy "catalog read plans" on public.subscription_plans for select using (is_active);
create policy "catalog read zones" on public.delivery_zones for select using (is_active);
create policy "catalog read holidays" on public.holidays for select using (true);

-- profiles: read own, update own (role / deleted_at cannot be changed by the user)
create policy "profiles select own" on public.profiles for select using (id = auth.uid());
create policy "profiles update own" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = 'customer');

-- addresses: full CRUD on own rows
create policy "addresses select own" on public.addresses for select using (user_id = auth.uid());
create policy "addresses insert own" on public.addresses for insert with check (user_id = auth.uid());
create policy "addresses update own" on public.addresses for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "addresses delete own" on public.addresses for delete using (user_id = auth.uid());

-- subscription data: read-only for the owner; every write goes through the API (state machine + pricing)
create policy "subs select own" on public.subscriptions for select using (user_id = auth.uid());
create policy "sub_items select own" on public.subscription_items for select
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = auth.uid()));
create policy "pauses select own" on public.subscription_pauses for select
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = auth.uid()));
create policy "skips select own" on public.subscription_skipped_dates for select
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and s.user_id = auth.uid()));
create policy "deliveries select own" on public.deliveries for select using (user_id = auth.uid());
create policy "delivery_items select own" on public.delivery_items for select
  using (exists (select 1 from public.deliveries d where d.id = delivery_id and d.user_id = auth.uid()));

-- payments: read-only for owner
create policy "porders select own" on public.payment_orders for select using (user_id = auth.uid());
create policy "payments select own" on public.payments for select using (user_id = auth.uid());
create policy "invoices select own" on public.invoices for select using (user_id = auth.uid());
create policy "redemptions select own" on public.coupon_redemptions for select using (user_id = auth.uid());
-- payment_webhook_events, coupons, audit_logs: no client policies => service role only

-- notifications: read + mark-read own
create policy "notif select own" on public.notifications for select using (user_id = auth.uid());
create policy "notif update own" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- support tickets: create + read own
create policy "tickets select own" on public.support_tickets for select using (user_id = auth.uid());
create policy "tickets insert own" on public.support_tickets for insert with check (user_id = auth.uid() and status = 'open');

-- Defence in depth: clients get no write grants on sensitive tables even if a policy is added later.
revoke insert, update, delete on public.subscriptions, public.subscription_items, public.subscription_pauses,
  public.subscription_skipped_dates, public.deliveries, public.delivery_items, public.payment_orders,
  public.payments, public.invoices, public.coupon_redemptions, public.coupons, public.payment_webhook_events,
  public.audit_logs, public.products, public.product_variants, public.subscription_plans,
  public.delivery_zones, public.holidays from anon, authenticated;
revoke all on public.payment_webhook_events, public.audit_logs, public.coupons from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, email, notification_prefs, push_token, profile_completed) on public.profiles to authenticated;
revoke insert, update, delete on public.notifications from anon;
revoke all on all tables in schema public from anon;
grant select on public.products, public.product_variants, public.subscription_plans,
  public.delivery_zones, public.holidays to anon;
