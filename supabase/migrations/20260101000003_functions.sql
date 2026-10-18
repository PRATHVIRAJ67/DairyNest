-- Atomic, idempotent business operations. Executed by the API with the service role only.

-- Insert deliveries for explicit dates. Safe to call repeatedly (unique(subscription_id, delivery_date)).
-- Dates are computed by the API (timezone-aware); the DB re-checks every invariant that protects money.
create or replace function public.fn_insert_deliveries(p_subscription_id uuid, p_dates date[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  sub public.subscriptions%rowtype;
  zone public.delivery_zones%rowtype;
  addr public.addresses%rowtype;
  d date;
  new_id uuid;
  inserted integer := 0;
  total integer;
  bal integer;
  sorted date[];
begin
  select * into sub from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if sub.status <> 'active' then raise exception 'subscription_not_active'; end if;
  select * into addr from public.addresses where id = sub.address_id;
  select * into zone from public.delivery_zones where id = addr.zone_id;

  select coalesce(sum(quantity * unit_price_minor), 0) into total from public.subscription_items where subscription_id = sub.id;
  select coalesce(array_agg(x order by x), '{}') into sorted from (select distinct unnest(p_dates) x) u;
  bal := sub.delivery_balance;

  foreach d in array sorted loop
    exit when bal <= 0;                      -- only prepaid deliveries are ever scheduled
    continue when d < sub.start_date;
    continue when exists (select 1 from public.subscription_skipped_dates where subscription_id = sub.id and skip_date = d);
    continue when exists (select 1 from public.subscription_pauses p where p.subscription_id = sub.id and p.ended_early_at is null
      and d >= p.starts_on and (p.ends_on is null or d <= p.ends_on));
    continue when exists (select 1 from public.holidays h where h.holiday_date = d and (h.zone_id is null or h.zone_id = addr.zone_id));

    insert into public.deliveries (subscription_id, user_id, address_id, delivery_date, window_start, window_end, instructions, total_minor)
    values (sub.id, sub.user_id, sub.address_id, d, coalesce(zone.window_start, '06:00'), coalesce(zone.window_end, '08:00'),
            addr.delivery_instructions, total)
    on conflict (subscription_id, delivery_date) do nothing
    returning id into new_id;

    if new_id is not null then
      insert into public.delivery_items (delivery_id, variant_id, name, quantity, unit_price_minor)
      select new_id, si.variant_id, p.name || ' - ' || v.name, si.quantity, si.unit_price_minor
      from public.subscription_items si
      join public.product_variants v on v.id = si.variant_id
      join public.products p on p.id = v.product_id
      where si.subscription_id = sub.id;
      inserted := inserted + 1;
      bal := bal - 1;
      new_id := null;
    end if;
  end loop;
  update public.subscriptions set delivery_balance = bal,
    paid_through = (select max(delivery_date) from public.deliveries where subscription_id = sub.id and status <> 'skipped')
    where id = sub.id;
  return inserted;
end $$;

-- Apply a verified captured payment. Idempotent: replays return already_processed = true.
create or replace function public.fn_apply_payment_capture(
  p_provider_order_id text, p_provider_payment_id text, p_amount_minor integer, p_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ord public.payment_orders%rowtype;
  pay public.payments%rowtype;
  sub public.subscriptions%rowtype;
  inv_id uuid;
begin
  select * into ord from public.payment_orders where provider_order_id = p_provider_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if ord.amount_minor <> p_amount_minor then raise exception 'amount_mismatch'; end if;

  select * into pay from public.payments where provider_payment_id = p_provider_payment_id;
  if found and pay.status = 'captured' and ord.status = 'paid' then
    return jsonb_build_object('already_processed', true, 'payment_id', pay.id, 'payment_order_id', ord.id);
  end if;

  insert into public.payments (payment_order_id, user_id, provider_payment_id, amount_minor, status, method)
  values (ord.id, ord.user_id, p_provider_payment_id, p_amount_minor, 'captured', p_method)
  on conflict (provider_payment_id) do update set status = 'captured', method = coalesce(excluded.method, public.payments.method), failure_reason = null
  returning * into pay;

  update public.payment_orders set status = 'paid' where id = ord.id;

  if ord.subscription_id is not null then
    select * into sub from public.subscriptions where id = ord.subscription_id for update;
    if sub.status in ('pending_payment','past_due') then
      update public.subscriptions set status = 'active',
        current_period_start = ord.period_start, current_period_end = ord.period_end,
        delivery_balance = delivery_balance + ord.deliveries_count
      where id = sub.id;
    elsif sub.status in ('active','paused') then
      update public.subscriptions set current_period_start = ord.period_start, current_period_end = ord.period_end,
        delivery_balance = delivery_balance + ord.deliveries_count where id = sub.id;
    end if;  -- cancelled: payment is recorded; refund is handled out of band
  end if;

  if ord.coupon_id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, payment_order_id, discount_minor)
    values (ord.coupon_id, ord.user_id, ord.id, ord.discount_minor) on conflict (payment_order_id) do nothing;
  end if;

  insert into public.invoices (user_id, payment_id, subscription_id, invoice_number, amount_minor, lines)
  values (ord.user_id, pay.id, ord.subscription_id, 'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_seq'),
    p_amount_minor,
    jsonb_build_object('subtotalMinor', ord.subtotal_minor, 'discountMinor', ord.discount_minor,
      'periodStart', ord.period_start, 'periodEnd', ord.period_end,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', p.name || ' - ' || v.name, 'quantity', si.quantity, 'unitPriceMinor', si.unit_price_minor))
        from public.subscription_items si join public.product_variants v on v.id = si.variant_id
        join public.products p on p.id = v.product_id where si.subscription_id = ord.subscription_id), '[]'::jsonb)))
  on conflict (payment_id) do nothing returning id into inv_id;

  return jsonb_build_object('already_processed', false, 'payment_id', pay.id, 'payment_order_id', ord.id,
    'subscription_id', ord.subscription_id, 'user_id', ord.user_id, 'invoice_id', inv_id);
end $$;

-- Record a failed payment attempt. Never downgrades an already-captured payment.
create or replace function public.fn_apply_payment_failure(
  p_provider_order_id text, p_provider_payment_id text, p_amount_minor integer, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ord public.payment_orders%rowtype; pay public.payments%rowtype;
begin
  select * into ord from public.payment_orders where provider_order_id = p_provider_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select * into pay from public.payments where provider_payment_id = p_provider_payment_id;
  if found and pay.status in ('captured','refunded','partially_refunded') then
    return jsonb_build_object('ignored', true);
  end if;
  insert into public.payments (payment_order_id, user_id, provider_payment_id, amount_minor, status, failure_reason)
  values (ord.id, ord.user_id, p_provider_payment_id, p_amount_minor, 'failed', p_reason)
  on conflict (provider_payment_id) do update set status = 'failed', failure_reason = excluded.failure_reason;
  -- the provider order stays open for retries; the failed attempt is kept in payments for history
  return jsonb_build_object('ignored', false, 'user_id', ord.user_id, 'subscription_id', ord.subscription_id);
end $$;

create or replace function public.fn_apply_refund(p_provider_payment_id text, p_refunded_total_minor integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype;
begin
  select * into pay from public.payments where provider_payment_id = p_provider_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p_refunded_total_minor > pay.amount_minor then raise exception 'refund_exceeds_payment'; end if;
  update public.payments set refunded_minor = greatest(refunded_minor, p_refunded_total_minor),
    status = case when greatest(refunded_minor, p_refunded_total_minor) >= amount_minor then 'refunded' else 'partially_refunded' end
  where id = pay.id;
  return jsonb_build_object('user_id', pay.user_id, 'payment_id', pay.id);
end $$;

-- Account deletion: anonymise PII, cancel subscriptions, keep financial records for compliance.
create or replace function public.fn_delete_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.subscriptions set status = 'cancelled', cancelled_at = now(), cancel_reason = 'account_deleted'
    where user_id = p_user_id and status <> 'cancelled';
  update public.deliveries set status = 'cancelled' where user_id = p_user_id and status in ('scheduled','pending') and delivery_date >= current_date;
  update public.addresses set deleted_at = now(), recipient_name = 'Deleted', phone = '+916000000000'::text, line1 = 'Deleted', line2 = '',
    landmark = '', delivery_instructions = '', is_default = false where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.support_tickets where user_id = p_user_id;
  update public.profiles set full_name = '', phone = null, email = null, push_token = null, deleted_at = now() where id = p_user_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id) values (p_user_id, 'account.deleted', 'profile', p_user_id::text);
end $$;

revoke all on function public.fn_insert_deliveries(uuid, date[]), public.fn_apply_payment_capture(text,text,integer,text),
  public.fn_apply_payment_failure(text,text,integer,text), public.fn_apply_refund(text,integer), public.fn_delete_account(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_insert_deliveries(uuid, date[]), public.fn_apply_payment_capture(text,text,integer,text),
  public.fn_apply_payment_failure(text,text,integer,text), public.fn_apply_refund(text,integer), public.fn_delete_account(uuid)
  to service_role;
