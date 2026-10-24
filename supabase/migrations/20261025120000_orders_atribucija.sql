-- Atribucija porudžbine (plan Reklame, M3) — odakle je kupac došao.
--
-- WooCommerce (Order Attribution, ≥ 8.5) beleži izvor posete u order meta
-- `_wc_order_attribution_*`. Webhook ih snima pri PRVOM prijemu porudžbine
-- (snapshot, kao adresa i pokloni); `order.updated` ih samo DOPUNJUJE kad su
-- prazni. Skripta `woo-attribution-backfill.mjs` popunjava starije porudžbine.
--
-- `attr_utm_campaign` nosi Meta ID kampanje (`utm_campaign={{campaign.id}}` u
-- oglasima od 24.10.2026) → spaja se sa `ad_campaigns.id` (rezerva: naziv).
--
-- NIJE novac: ne dira `order_items`, zamrznute cene ni finansije. RLS na
-- `orders` važi na nivou tabele (Logistika i dalje nema nijednu `select`).

alter table public.orders
  add column attr_source_type  text,   -- utm | organic | referral | typein | admin | …
  add column attr_utm_source   text,
  add column attr_utm_medium   text,
  add column attr_utm_campaign text,
  add column attr_utm_content  text,
  add column attr_referrer     text;

create index orders_attr_utm_campaign_idx on public.orders (attr_utm_campaign)
  where attr_utm_campaign is not null;

comment on column public.orders.attr_source_type is
  'Woo Order Attribution: tip izvora (utm/organic/referral/typein/admin…). Snapshot sa prvog webhooka.';
comment on column public.orders.attr_utm_campaign is
  'utm_campaign iz Woo Order Attribution — za Meta oglase ID kampanje ({{campaign.id}}).';

-- UNDO:
-- drop index public.orders_attr_utm_campaign_idx;
-- alter table public.orders drop column attr_source_type, drop column attr_utm_source,
--   drop column attr_utm_medium, drop column attr_utm_campaign, drop column attr_utm_content,
--   drop column attr_referrer;
