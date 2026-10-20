-- Pokloni iz paketa (plugin „Sportem Offers") na porudžbini.
--
-- Plugin upisuje u Woo order meta:
--   sportem_pokloni_tekst      — čitljiv tekst poklona koje treba spakovati
--   sportem_besplatna_dostava  — paket je doneo besplatnu dostavu
-- Webhook ih snima pri PRVOM prijemu porudžbine (snapshot, kao adresa i stavke).
-- `order.updated` ih nikad ne prepisuje — samo dopuni ako su još prazni (meta
-- ponekad stigne tek posle prvog webhooka).
--
-- Operativni podatak za pakovanje (PDF lista za slanje, detalj porudžbine) —
-- NIJE novac: ne dira `order_items`, zamrznute cene ni finansije. RLS politike
-- na `orders` važe na nivou tabele (Logistika i dalje nema nijednu `select`).

alter table public.orders
  add column gift_text text,
  add column free_shipping boolean not null default false;

comment on column public.orders.gift_text is
  'Pokloni iz paketa (Woo meta sportem_pokloni_tekst) — snapshot sa prvog webhooka.';
comment on column public.orders.free_shipping is
  'Paket doneo besplatnu dostavu (Woo meta sportem_besplatna_dostava).';

-- UNDO:
-- alter table public.orders drop column gift_text, drop column free_shipping;
