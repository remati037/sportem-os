-- ============================================================================
-- Sportem OS — seed: TRAJNI bootstrap config (Korak 0.4)
-- Ovo produkcija stvarno treba i OSTAJE i kad krene prava roba.
-- NE sadrži test/lažne podatke — oni su u dev-fixtures.sql.
-- NE puni profiles — auth korisnici se kreiraju u Koraku 0.5.
--
-- Primena na cloud (jednokratno):
--   psql "<connection-string-iz-dashboarda>" -f supabase/seed.sql
-- ============================================================================

-- ── Statusi porudžbine (podesivo) ───────────────────────────────────────────
insert into public.order_statuses (id, name, sort_order, color) values
  ('00000000-0000-0000-0000-000000000a01'::uuid, 'Kreirano',          1, '#6B7280'),
  ('00000000-0000-0000-0000-000000000a02'::uuid, 'Poslato',           2, '#2563EB'),
  ('00000000-0000-0000-0000-000000000a03'::uuid, 'Isporučeno',        3, '#1B7A45'),
  ('00000000-0000-0000-0000-000000000a04'::uuid, 'Otkazano',          4, '#DC2626'),
  ('00000000-0000-0000-0000-000000000a05'::uuid, 'Vraćeno',           5, '#D97706')
on conflict (id) do nothing;

-- ── Kategorije troškova ─────────────────────────────────────────────────────
insert into public.expense_categories (name, sort_order) values
  ('Reklame', 1), ('Pakovanje', 2), ('Ostalo', 3)
on conflict do nothing;
