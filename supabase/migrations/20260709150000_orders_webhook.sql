-- ============================================================================
-- Korak 1.2 — kolone za WooCommerce webhook sinhronizaciju
-- ============================================================================

alter table public.orders
  add column woo_status    text,
  add column needs_review  boolean not null default false,
  add column review_reason text;

comment on column public.orders.woo_status is
  'Poslednji sirovi WooCommerce status (dijagnostika); app status vodi status_id.';
comment on column public.orders.needs_review is
  'Woo otkazivanje/refund stiglo posle fakturisanja/uplate — traži ručnu odluku admina.';
comment on column public.orders.review_reason is
  'Razlog zašto porudžbina čeka ručnu proveru (needs_review).';
