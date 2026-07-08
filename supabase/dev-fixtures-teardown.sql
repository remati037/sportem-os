-- ============================================================================
-- Sportem OS — TEARDOWN dev fixtures (Korak 0.4)
-- Briše SAMO lažne test podatke iz dev-fixtures.sql, po fiksnim UUID-jevima.
-- Pravi podaci (import 1.1, backfill/webhook 1.2/1.3) imaju nasumične
-- UUID-jeve pa ih ovo NE dira. Statuse i kategorije troškova (seed.sql) NE dira.
--
-- POKRENUTI pre backfill-a (1.3) i uključivanja webhooka (1.2):
--   psql "<connection-string>" -f supabase/dev-fixtures-teardown.sql
-- ============================================================================

begin;

-- porudžbine (order_items se brišu kaskadno kroz ON DELETE CASCADE)
delete from public.orders where id in (
  '00000000-0000-0000-0000-000000000f01'::uuid,
  '00000000-0000-0000-0000-000000000f02'::uuid,
  '00000000-0000-0000-0000-000000000f03'::uuid
);

-- varijante pre proizvoda (FK product_id je ON DELETE RESTRICT)
delete from public.product_variants where id in (
  '00000000-0000-0000-0000-000000000d01'::uuid,
  '00000000-0000-0000-0000-000000000d02'::uuid,
  '00000000-0000-0000-0000-000000000d03'::uuid,
  '00000000-0000-0000-0000-000000000d04'::uuid
);

delete from public.products where id in (
  '00000000-0000-0000-0000-000000000c01'::uuid,
  '00000000-0000-0000-0000-000000000c02'::uuid,
  '00000000-0000-0000-0000-000000000c03'::uuid
);

delete from public.categories where id in (
  '00000000-0000-0000-0000-000000000b01'::uuid,
  '00000000-0000-0000-0000-000000000b02'::uuid,
  '00000000-0000-0000-0000-000000000b03'::uuid
);

delete from public.customers where id in (
  '00000000-0000-0000-0000-000000000e01'::uuid,
  '00000000-0000-0000-0000-000000000e02'::uuid
);

commit;
