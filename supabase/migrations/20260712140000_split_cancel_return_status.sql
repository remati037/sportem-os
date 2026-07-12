-- ============================================================================
-- Razdvajanje statusa „Otkazano/Vraćeno" na dva zasebna statusa.
--
-- Interno se otkazivanje i vraćanje razlikuju (mnogo znači operativno), ali oba
-- se i dalje mapiraju na WooCommerce `cancelled` (Woo ne razlikuje).
--
-- Odluka korisnika: postojeći red (…0a04) se PREIMENUJE u „Otkazano" i dodaje se
-- novi „Vraćeno" (…0a05). Stare porudžbine i dalje gađaju …0a04 (sada „Otkazano")
-- — razlika ranije nije praćena, pa nema migracije podataka.
-- ============================================================================

-- Preimenuj postojeći otkazni status (boja ostaje crvena #DC2626).
update public.order_statuses
   set name = 'Otkazano'
 where id = '00000000-0000-0000-0000-000000000a04'::uuid;

-- Dodaj novi status „Vraćeno" (amber — vizuelno različit u listi/pill-u).
insert into public.order_statuses (id, name, sort_order, color) values
  ('00000000-0000-0000-0000-000000000a05'::uuid, 'Vraćeno', 5, '#D97706')
on conflict (id) do nothing;
