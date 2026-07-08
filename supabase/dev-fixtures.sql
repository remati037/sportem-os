-- ============================================================================
-- Sportem OS — DEV FIXTURES (Korak 0.4)
-- Lažni test podaci za razvoj ekrana bez produkcionih podataka.
-- ⚠️  OBRISATI pre backfill-a (1.3) i uključivanja webhooka (1.2):
--       psql "<connection-string>" -f supabase/dev-fixtures-teardown.sql
--
-- Svi UUID-jevi su fiksni i validno heksadecimalni da bi porudžbine mogle da
-- referenciraju svoje stavke i da bi teardown mogao ciljano da ih obriše:
--   bX=kategorija, cX=proizvod, dX=varijanta, eX=kupac, fX=porudžbina.
-- Pravi podaci (import 1.1, backfill/webhook 1.2/1.3) dobijaju nasumične
-- UUID-jeve, pa ih teardown NE može dodirnuti.
-- ============================================================================

-- ── Kategorije proizvoda (test — pravi katalog dolazi importom u 1.1) ────────
insert into public.categories (id, name, sort_order) values
  ('00000000-0000-0000-0000-000000000b01'::uuid, 'Patike',  1),
  ('00000000-0000-0000-0000-000000000b02'::uuid, 'Dresovi', 2),
  ('00000000-0000-0000-0000-000000000b03'::uuid, 'Oprema',  3)
on conflict (id) do nothing;

-- ── Proizvodi ───────────────────────────────────────────────────────────────
insert into public.products (id, name, description, brand, category_id) values
  ('00000000-0000-0000-0000-000000000c01'::uuid, 'Nike Revolution 6', 'Patike za trčanje',   'Nike',   '00000000-0000-0000-0000-000000000b01'::uuid),
  ('00000000-0000-0000-0000-000000000c02'::uuid, 'Dres FC Barcelona', 'Zvanični dres 24/25', 'Nike',   '00000000-0000-0000-0000-000000000b02'::uuid),
  ('00000000-0000-0000-0000-000000000c03'::uuid, 'Lopta Molten V5M',  'Odbojkaška lopta',    'Molten', '00000000-0000-0000-0000-000000000b03'::uuid)
on conflict (id) do nothing;

-- ── Varijante (SKU grupe; cene integer RSD → profit generisan) ───────────────
insert into public.product_variants
  (id, product_id, sku, variant_name, mp_price, vp_price, stock_quantity, low_stock_threshold, weight_grams) values
  ('00000000-0000-0000-0000-000000000d01'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 'SM021-42', 'Broj 42', 9990, 6500, 12, 5, 800),
  ('00000000-0000-0000-0000-000000000d02'::uuid, '00000000-0000-0000-0000-000000000c01'::uuid, 'SM021-43', 'Broj 43', 9990, 6500, 3,  5, 820),
  ('00000000-0000-0000-0000-000000000d03'::uuid, '00000000-0000-0000-0000-000000000c02'::uuid, 'DR100',    'Default', 7490, 4800, 20, 5, 250),
  ('00000000-0000-0000-0000-000000000d04'::uuid, '00000000-0000-0000-0000-000000000c03'::uuid, 'LP050',    'Default', 4500, 2900, 8,  5, 300)
on conflict (id) do nothing;

-- ── Kupci (dedup po telefonu) ───────────────────────────────────────────────
insert into public.customers (id, name, phone, email, address, city, postal_code) values
  ('00000000-0000-0000-0000-000000000e01'::uuid, 'Marko Petrović', '+381641234567', 'marko@example.com', 'Bulevar oslobođenja 12', 'Novi Sad', '21000'),
  ('00000000-0000-0000-0000-000000000e02'::uuid, 'Ana Jovanović',  '+381621112223', 'ana@example.com',   'Knez Mihailova 5',       'Beograd',  '11000')
on conflict (id) do nothing;

-- ============================================================================
-- Test porudžbine
-- ============================================================================

-- Porudžbina 1 — XExpress, isporučeno + uplaćeno (kandidat za fakturu)
insert into public.orders
  (id, woo_order_id, customer_id, status_id, delivery_method, payment_status,
   ship_name, ship_phone, ship_address, ship_city, ship_postal_code,
   goods_total, shipping_charged, shipping_actual, cod_amount, package_count, weight_grams,
   ordered_at, shipped_at, delivered_at, paid_at) values
  ('00000000-0000-0000-0000-000000000f01'::uuid, 1001,
   '00000000-0000-0000-0000-000000000e01'::uuid,
   '00000000-0000-0000-0000-000000000a03'::uuid, 'xexpress', 'uplaceno',
   'Marko Petrović', '+381641234567', 'Bulevar oslobođenja 12', 'Novi Sad', '21000',
   9990, 400, 350, 10390, 1, 800,
   now() - interval '10 days', now() - interval '9 days', now() - interval '7 days', now() - interval '5 days')
on conflict (id) do nothing;

insert into public.order_items (order_id, variant_id, sku, product_name, quantity, mp_at_sale, vp_at_sale) values
  ('00000000-0000-0000-0000-000000000f01'::uuid, '00000000-0000-0000-0000-000000000d01'::uuid, 'SM021-42', 'Nike Revolution 6 — Broj 42', 1, 9990, 6500)
on conflict do nothing;

-- Porudžbina 2 — lična prodaja + keš
insert into public.orders
  (id, customer_id, status_id, delivery_method, payment_status,
   ship_name, ship_phone, goods_total, package_count, weight_grams,
   ordered_at, delivered_at, paid_at) values
  ('00000000-0000-0000-0000-000000000f02'::uuid,
   '00000000-0000-0000-0000-000000000e02'::uuid,
   '00000000-0000-0000-0000-000000000a03'::uuid, 'licno', 'kes',
   'Ana Jovanović', '+381621112223', 7490, 1, 250,
   now() - interval '3 days', now() - interval '3 days', now() - interval '3 days')
on conflict (id) do nothing;

insert into public.order_items (order_id, variant_id, sku, product_name, quantity, mp_at_sale, vp_at_sale) values
  ('00000000-0000-0000-0000-000000000f02'::uuid, '00000000-0000-0000-0000-000000000d03'::uuid, 'DR100', 'Dres FC Barcelona — Default', 1, 7490, 4800)
on conflict do nothing;

-- Porudžbina 3 — XExpress, kreirano, NEPOZNAT SKU (needs_vp = true, vp_at_sale null)
insert into public.orders
  (id, woo_order_id, customer_id, status_id, delivery_method, payment_status,
   ship_name, ship_phone, ship_address, ship_city, ship_postal_code,
   goods_total, shipping_charged, cod_amount, needs_vp, ordered_at) values
  ('00000000-0000-0000-0000-000000000f03'::uuid, 1002,
   '00000000-0000-0000-0000-000000000e01'::uuid,
   '00000000-0000-0000-0000-000000000a01'::uuid, 'xexpress', 'neuplaceno',
   'Marko Petrović', '+381641234567', 'Bulevar oslobođenja 12', 'Novi Sad', '21000',
   3200, 400, 3600, true, now() - interval '1 day')
on conflict (id) do nothing;

-- stavka bez varijante (nepoznat SKU): vp_at_sale null → profit_at_sale null
insert into public.order_items (order_id, variant_id, sku, product_name, quantity, mp_at_sale, vp_at_sale) values
  ('00000000-0000-0000-0000-000000000f03'::uuid, null, 'NEPOZNAT-01', 'Nepoznati artikal iz Woo-a', 1, 3200, null)
on conflict do nothing;
