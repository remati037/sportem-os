-- ============================================================================
-- Sportem OS — automatsko skidanje robe sa stanja po porudžbini
--
-- Do sada se `product_variants.stock_quantity` menjao ISKLJUČIVO ručno (forma,
-- CSV uvoz, popis) — nova porudžbina nije skidala robu sa stanja, pa je stanje
-- odmah bilo netačno.
--
-- Model:
--   • nova porudžbina (webhook)      → stanje  −količina, `stock_applied = true`
--   • Otkazano / Vraćeno             → stanje  +količina, `stock_applied = false`
--   • povratak iz Otkazano/Vraćeno   → stanje  −količina, `stock_applied = true`
--   • izmena stavki dok je rezervisano → razlika se odmah primeni
--
-- `stock_applied` je idempotentni prekidač: dva webhook prijema (Woo retry) ili
-- dvostruko otkazivanje ne mogu duplo da skinu/vrate robu. Za SVE postojeće
-- porudžbine je `false` (istorijski se ništa nije skidalo), pa otkazivanje
-- stare porudžbine NEĆE naduvati stanje.
--
-- Stanje SME da ode u minus: nepopisana varijanta je 0 („količina nije uneta"),
-- pa minus pošteno znači „prodato više nego što je evidentirano". Popis kasnije
-- upiše tačnu cifru. Zato NEMA clamp-a na nulu — inače bi vraćanje otkazane
-- porudžbine izmišljalo robu koja nikad nije skinuta.
--
-- Popis (`stock_counted_at`) se NE dira — automatska promena nije „pogledao sam".
-- Zamrznute cene (`order_items`) se ne diraju.
-- ============================================================================

alter table public.orders
  add column stock_applied boolean not null default false;

comment on column public.orders.stock_applied is
  'Da li je roba ove porudžbine trenutno skinuta sa stanja (idempotentni prekidač: rezervisano ↔ vraćeno).';

-- ── atomična primena razlika ────────────────────────────────────────────────
-- supabase-js ne ume `stock_quantity = stock_quantity - n` (read-modify-write
-- bi gubio konkurentne izmene), pa promena ide kroz jedan SQL statement.
-- Ulaz: jsonb niz `[{"variant_id": "...", "delta": -2}, ...]` (delta sa
-- predznakom, više redova za istu varijantu se sabira).
create or replace function public.apply_stock_delta(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_variants v
  set stock_quantity = v.stock_quantity + d.delta
  from (
    select (x->>'variant_id')::uuid as variant_id,
           sum((x->>'delta')::int)  as delta
    from jsonb_array_elements(p_items) as x
    group by 1
  ) d
  where v.id = d.variant_id
    and d.delta <> 0;
end;
$$;

-- Zove se ISKLJUČIVO sa servera (service role) — Logistika/Menadžer nemaju
-- write na katalog, a Admin menja stanje kroz katalog akcije, ne kroz ovu rutu.
revoke all on function public.apply_stock_delta(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stock_delta(jsonb) to service_role;
