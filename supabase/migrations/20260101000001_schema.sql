-- Milk & curd subscription schema. Money is stored as integer minor units (paise).

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text,
  email text,
  role text not null default 'customer' check (role in ('customer','admin')),
  notification_prefs jsonb not null default
    '{"push":true,"email":false,"sms":false,"deliveryUpdates":true,"paymentUpdates":true,"promotions":false}',
  push_token text,
  profile_completed boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Create a profile row whenever an auth user is created.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, email) values (new.id, new.phone, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- delivery zones ----------
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  postal_codes text[] not null default '{}',
  window_start time not null default '06:00',
  window_end time not null default '08:00',
  cutoff_time time not null default '21:00',   -- cutoff is on the day BEFORE delivery
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start)
);
create index idx_zones_postal on public.delivery_zones using gin (postal_codes);
create trigger trg_zones_updated before update on public.delivery_zones for each row execute function public.set_updated_at();

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.delivery_zones(id) on delete cascade, -- null = all zones
  holiday_date date not null,
  reason text not null default '',
  unique nulls not distinct (zone_id, holiday_date)
);

-- ---------- addresses ----------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  recipient_name text not null,
  phone text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  line1 text not null,
  line2 text not null default '',
  landmark text not null default '',
  city text not null,
  postal_code text not null check (postal_code ~ '^[1-9][0-9]{5}$'),
  delivery_instructions text not null default '' check (char_length(delivery_instructions) <= 250),
  is_default boolean not null default false,
  zone_id uuid references public.delivery_zones(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_addresses_user on public.addresses(user_id) where deleted_at is null;
create unique index uq_addresses_one_default on public.addresses(user_id) where is_default and deleted_at is null;
create trigger trg_addresses_updated before update on public.addresses for each row execute function public.set_updated_at();

-- ---------- catalog ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  category text not null check (category in ('milk','curd','other')),
  image_url text,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_products_cat on public.products(category) where is_active;
create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  name text not null,            -- e.g. "500 ml pouch"
  size_label text not null,
  price_minor integer not null check (price_minor >= 0),
  mrp_minor integer not null check (mrp_minor >= 0),
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mrp_minor >= price_minor)
);
create index idx_variants_product on public.product_variants(product_id);
create trigger trg_variants_updated before update on public.product_variants for each row execute function public.set_updated_at();

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  frequency text not null check (frequency in ('daily','alternate_days','weekdays')),
  discount_bps integer not null default 0 check (discount_bps between 0 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- coupons ----------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  description text not null default '',
  discount_type text not null check (discount_type in ('percent','flat')),
  value integer not null check (value > 0),         -- percent => bps; flat => paise
  max_discount_minor integer check (max_discount_minor >= 0),
  min_order_minor integer not null default 0 check (min_order_minor >= 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  usage_limit integer check (usage_limit > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or value <= 10000)
);

-- ---------- subscriptions ----------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id),
  address_id uuid not null references public.addresses(id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment','active','paused','past_due','cancelled')),
  frequency text not null check (frequency in ('daily','alternate_days','weekdays')),
  weekdays smallint[] check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_date date not null,
  current_period_start date,
  current_period_end date,
  paid_through date,
  delivery_balance integer not null default 0 check (delivery_balance >= 0),  -- prepaid deliveries not yet scheduled
  schedule_anchor date not null,
  idempotency_key text not null,
  coupon_id uuid references public.coupons(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (frequency <> 'weekdays' or (weekdays is not null and cardinality(weekdays) > 0))
);
create index idx_subs_user on public.subscriptions(user_id, status);
create trigger trg_subs_updated before update on public.subscriptions for each row execute function public.set_updated_at();

create table public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity between 1 and 20),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  unique (subscription_id, variant_id)
);
create index idx_sub_items_sub on public.subscription_items(subscription_id);

create table public.subscription_pauses (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  starts_on date not null,
  ends_on date,                       -- null = indefinite
  ended_early_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index idx_pauses_sub on public.subscription_pauses(subscription_id);
-- only one open pause (not ended) per subscription
create unique index uq_pause_one_open on public.subscription_pauses(subscription_id) where ended_early_at is null and ends_on is null;

create table public.subscription_skipped_dates (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  skip_date date not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, skip_date)
);

-- ---------- deliveries ----------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  address_id uuid not null references public.addresses(id),
  delivery_date date not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','pending','out_for_delivery','delivered','skipped','failed','cancelled')),
  window_start time not null default '06:00',
  window_end time not null default '08:00',
  instructions text not null default '',
  total_minor integer not null default 0 check (total_minor >= 0),
  delivered_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, delivery_date)        -- duplicate delivery prevention
);
create index idx_deliveries_user_date on public.deliveries(user_id, delivery_date);
create trigger trg_deliveries_updated before update on public.deliveries for each row execute function public.set_updated_at();

create table public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  unique (delivery_id, variant_id)
);

-- ---------- payments ----------
create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'razorpay',
  provider_order_id text unique,
  amount_minor integer not null check (amount_minor >= 0),
  subtotal_minor integer not null default 0 check (subtotal_minor >= 0),
  discount_minor integer not null default 0 check (discount_minor >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created' check (status in ('created','paid','failed','expired')),
  coupon_id uuid references public.coupons(id),
  period_start date,
  period_end date,
  deliveries_count integer not null default 0 check (deliveries_count >= 0),
  receipt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_porders_user on public.payment_orders(user_id, created_at desc);
create index idx_porders_sub on public.payment_orders(subscription_id);
create trigger trg_porders_updated before update on public.payment_orders for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_payment_id text not null unique,
  amount_minor integer not null check (amount_minor >= 0),
  status text not null default 'pending' check (status in ('pending','captured','failed','refunded','partially_refunded')),
  method text,
  failure_reason text,
  refunded_minor integer not null default 0 check (refunded_minor >= 0 and refunded_minor <= amount_minor),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_user on public.payments(user_id, created_at desc);
create trigger trg_payments_updated before update on public.payments for each row execute function public.set_updated_at();

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)                    -- duplicate webhook prevention
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  invoice_number text not null unique,
  amount_minor integer not null check (amount_minor >= 0),
  lines jsonb not null default '[]',
  issued_at timestamptz not null default now()
);
create index idx_invoices_user on public.invoices(user_id, issued_at desc);
create sequence public.invoice_seq start 1000;

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_order_id uuid not null unique references public.payment_orders(id) on delete cascade,
  discount_minor integer not null check (discount_minor >= 0),
  created_at timestamptz not null default now()
);
create index idx_redemptions_coupon_user on public.coupon_redemptions(coupon_id, user_id);

-- ---------- notifications / support / audit ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  channel text not null default 'in_app' check (channel in ('in_app','push','email','sms')),
  provider_status text not null default 'recorded' check (provider_status in ('recorded','sent','not_configured','failed')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notif_user on public.notifications(user_id, created_at desc);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('delivery','payment','product','account','other')),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tickets_user on public.support_tickets(user_id, created_at desc);
create trigger trg_tickets_updated before update on public.support_tickets for each row execute function public.set_updated_at();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,                                  -- intentionally no FK: survives account deletion
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_audit_entity on public.audit_logs(entity, entity_id);
