-- Local development seed data. Prices are in paise. image_url is NULL until real photos are
-- uploaded to the `product-images` Supabase Storage bucket (see docs/SETUP.md).
insert into public.delivery_zones (name, postal_codes, window_start, window_end, cutoff_time) values
  ('Bengaluru Central', array['560001','560002','560008','560025','560034','560038','560066','560095'], '06:00', '08:00', '21:00'),
  ('Mumbai Suburbs',    array['400001','400050','400053','400058'], '05:30', '07:30', '21:00')
on conflict do nothing;

insert into public.subscription_plans (code, name, description, frequency, discount_bps) values
  ('daily',     'Every day',       'Fresh delivery every morning', 'daily', 300),
  ('alternate', 'Alternate days',  'Every other day, starting on your start date', 'alternate_days', 0),
  ('weekdays',  'Pick your days',  'Choose the weekdays that suit you', 'weekdays', 0)
on conflict (code) do nothing;

insert into public.products (slug, name, description, category, is_featured, sort_order) values
  ('farm-fresh-cow-milk', 'Farm Fresh Cow Milk', 'Pasteurised full-cream cow milk from local farms, chilled and delivered before sunrise.', 'milk', true, 1),
  ('a2-desi-cow-milk', 'A2 Desi Cow Milk', 'Rich, naturally A2 milk from indigenous cows. No additives.', 'milk', true, 2),
  ('toned-milk', 'Toned Milk', 'Light everyday milk with 3% fat. Great for tea and coffee.', 'milk', false, 3),
  ('buffalo-milk', 'Buffalo Milk', 'Thick and creamy buffalo milk with high fat, ideal for sweets and ghee.', 'milk', false, 4),
  ('set-curd', 'Classic Set Curd', 'Thick, mildly tangy curd set fresh each day in earthen-style cups.', 'curd', true, 5),
  ('greek-curd', 'High-Protein Greek Curd', 'Strained, extra thick curd. Twice the protein, no added sugar.', 'curd', false, 6),
  ('probiotic-curd', 'Probiotic Curd', 'Live cultures for gut health, creamy and smooth.', 'curd', false, 7)
on conflict (slug) do nothing;

insert into public.product_variants (product_id, sku, name, size_label, price_minor, mrp_minor, sort_order)
select p.id, v.sku, v.name, v.size, v.price, v.mrp, v.ord
from public.products p
join (values
  ('farm-fresh-cow-milk','CM-500','500 ml pouch','500 ml',3000,3200,1),
  ('farm-fresh-cow-milk','CM-1000','1 L pouch','1 L',5800,6200,2),
  ('a2-desi-cow-milk','A2-500','500 ml glass bottle','500 ml',4500,4800,1),
  ('a2-desi-cow-milk','A2-1000','1 L glass bottle','1 L',8500,9000,2),
  ('toned-milk','TM-500','500 ml pouch','500 ml',2600,2700,1),
  ('toned-milk','TM-1000','1 L pouch','1 L',5000,5200,2),
  ('buffalo-milk','BM-500','500 ml pouch','500 ml',3600,3800,1),
  ('buffalo-milk','BM-1000','1 L pouch','1 L',7000,7400,2),
  ('set-curd','SC-200','200 g cup','200 g',2200,2400,1),
  ('set-curd','SC-400','400 g cup','400 g',4000,4300,2),
  ('set-curd','SC-1000','1 kg tub','1 kg',9000,9600,3),
  ('greek-curd','GC-200','200 g cup','200 g',4500,4800,1),
  ('probiotic-curd','PC-400','400 g cup','400 g',5200,5500,1)
) as v(slug, sku, name, size, price, mrp, ord) on v.slug = p.slug
on conflict (sku) do nothing;

insert into public.coupons (code, description, discount_type, value, max_discount_minor, min_order_minor, per_user_limit, valid_to) values
  ('WELCOME10', '10% off your first subscription (up to Rs 150)', 'percent', 1000, 15000, 50000, 1, null),
  ('FRESH50',   'Flat Rs 50 off on orders above Rs 500', 'flat', 5000, null, 50000, 3, null)
on conflict (code) do nothing;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true) on conflict (id) do nothing;
  end if;
end $$;
