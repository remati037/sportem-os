-- ============================================================================
-- Sportem OS — bootstrap prvog Admina (Korak 0.5)
--
-- Chicken-and-egg: treba postojeći Admin da bi kroz app-ekran „Korisnici"
-- slao invite-e ostalima. Zato se PRVI Admin kreira RUČNO u Supabase Auth
-- dashboardu (Authentication → Add user), a onda se ovim SQL-om poveže sa
-- `profiles` redom i dobije rolu 'admin'.
--
-- Menadžera i Logistiku posle toga dodaje Admin IZ APLIKACIJE (ekran
-- „Korisnici" → „Pozovi korisnika") — za njih NIJE potreban ovaj SQL.
--
-- Primena (jednokratno): Supabase SQL editor ili
--   psql "<connection-string-iz-dashboarda>" -f supabase/profiles.sql
-- ============================================================================

-- 1) Zameni e-mail i ime pravim vrednostima Admin naloga kreiranog u dashboardu.
insert into public.profiles (id, full_name, role)
select id, 'Marko (Admin)', 'admin'
from auth.users
where email = 'mmarkom2000@gmail.com'          -- ← ZAMENI pravim e-mailom
on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name;

-- 2) Provera (opciono): treba da vrati jedan red sa role = 'admin'.
-- select p.role, p.full_name, u.email
--   from public.profiles p join auth.users u on u.id = p.id;
