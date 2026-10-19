-- Suppliers: a supplier serves one or more delivery zones (areas such as Jayanagar); a zone can have several suppliers.
-- Suppliers only ever see data for their own zones. All access goes through the API's ownership checks;
-- RLS below is defence in depth.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer', 'supplier', 'admin'));

create table public.supplier_zones (
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  zone_id uuid not null references public.delivery_zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (supplier_id, zone_id)
);
create index idx_supplier_zones_zone on public.supplier_zones(zone_id);

-- Supplier screens filter deliveries by date and by the address's zone.
create index if not exists idx_deliveries_delivery_date on public.deliveries(delivery_date);
create index if not exists idx_addresses_zone on public.addresses(zone_id);

alter table public.supplier_zones enable row level security;
create policy "supplier zones select own" on public.supplier_zones for select using (supplier_id = auth.uid());
revoke insert, update, delete on public.supplier_zones from anon, authenticated;
revoke all on public.supplier_zones from anon;

-- Categories are owner-defined (e.g. milk, curd, ghee, paneer): any short lowercase slug.
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category ~ '^[a-z][a-z0-9-]{1,29}$');
