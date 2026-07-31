-- ============================================================================
-- Sportem OS — popis zaliha („pogledao sam ovu varijantu")
--
-- Problem: `stock_quantity` je `not null default 0`, pa se stvarna nula
-- („prebrojao sam, nema ni jednog komada") NIJE mogla razlikovati od nikad
-- unete količine. Zbog toga je ceo neobrađen katalog padao u „nisko stanje"
-- i davio Dashboard listu i dnevni push.
--
-- Rešenje: `stock_counted_at` (kad je poslednji put popisano) + ko je popisao.
--   • popisano + količina 0  → NISKO STANJE (stvarna nula, treba poručiti)
--   • nepopisano             → NE ulazi u nisko stanje; izlazi kroz filter
--                              „Fali količina" u katalogu
--
-- Backfill: varijante sa `stock_quantity > 0` se smatraju popisanim (neko je
-- tu cifru već uneo — kroz formu ili CSV uvoz). Ostaju samo nule kao „fali
-- količina" — a to je tačno skup koji korisnik treba da obiđe.
--
-- Write ide kroz service-role server akciju (Admin + Logistika), pa RLS
-- politike na `product_variants` ostaju netaknute (Logistika i dalje NEMA
-- direktan write ni čitanje base tabele — vidi samo restriktovani view).
-- ============================================================================

alter table public.product_variants
  add column stock_counted_at timestamptz,
  add column stock_counted_by uuid references auth.users (id) on delete set null;

comment on column public.product_variants.stock_counted_at is
  'Kad je stanje poslednji put popisano (null = količina nikad uneta → ne broji se kao nisko stanje).';

-- Varijante sa unetom količinom > 0 → već popisane.
update public.product_variants
set stock_counted_at = updated_at
where stock_quantity > 0;

-- Nepopisane varijante se često filtriraju (katalog + Dashboard brojač).
create index product_variants_uncounted_idx
  on public.product_variants (id)
  where stock_counted_at is null and archived_at is null;

-- View za Logistiku: nova kolona na KRAJU (create or replace bez drop-a).
-- Popis NIJE finansijski podatak → Logistika ga vidi (ona i popisuje).
create or replace view public.product_variants_public
  with (security_invoker = false) as
  select id, product_id, sku, variant_name, stock_quantity,
         low_stock_threshold, supplier_sku, weight_grams, image, archived_at,
         attributes, stock_counted_at
  from public.product_variants;
