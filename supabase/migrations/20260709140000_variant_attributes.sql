-- ============================================================================
-- Sportem OS — atributi varijanti (Korak 1.1c)
--
-- Proizvod definiše KOJE atribute njegove varijante imaju (npr. Vinil bučice →
-- „Težina"; vijača → „Boja" + „Dužina"), a svaka varijanta nosi vrednost po
-- atributu. SKU sufiks je samo redni broj varijante — atributi nose značenje.
--
-- JSONB pristup (bez novih tabela): atributi su čisto opisni, interni katalog;
-- Woo webhook gađa samo SKU. `variant_name` ostaje kao sastavljeni prikaz.
-- Atributi NISU finansijski podatak → ulaze i u restriktovani view za Logistiku
-- (magacinu i trebaju: boja/kilaža identifikuju robu).
-- ============================================================================

alter table public.products
  add column attribute_names text[] not null default '{}';

alter table public.product_variants
  add column attributes jsonb not null default '{}'::jsonb;

-- View: nova kolona na KRAJU (create or replace to dozvoljava bez drop-a);
-- security_invoker = false se ponavlja eksplicitno. Grants ostaju netaknuti.
create or replace view public.product_variants_public
  with (security_invoker = false) as
  select id, product_id, sku, variant_name, stock_quantity,
         low_stock_threshold, supplier_sku, weight_grams, image, archived_at,
         attributes
  from public.product_variants;
