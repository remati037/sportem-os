-- ============================================================================
-- Sportem OS — RLS politike po roli (Korak 0.5)
--
-- Korak 0.4 je uključio RLS deny-by-default bez politika. Ovde se dodaju:
--   • helper current_app_role() — čita rolu iz profiles (SECURITY DEFINER)
--   • restriktovani view product_variants_public — Logistika bez MP/VP/profit
--   • politike po tabeli: Admin sve; Menadžer read-only (Sportem podaci);
--     Logistika samo katalog (bez finansija)
--
-- Model: Supabase koristi jednu Postgres rolu `authenticated` za sve ulogovane
-- korisnike; razlika po roli se pravi kroz current_app_role(). Service role
-- (webhook, cron, seed, invite) ZAOBILAZI RLS — zato write-politike pokrivaju
-- samo Admina; ostali upisi idu preko servera sa service role ključem.
-- ============================================================================

-- ── helper: rola trenutnog korisnika ────────────────────────────────────────
-- SECURITY DEFINER + prazan search_path → zaobilazi RLS na profiles (bez
-- rekurzije) i imun na search_path napade. Schema-kvalifikovane reference.
create or replace function public.current_app_role()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

-- ── restriktovani view za Logistiku (bez mp_price/vp_price/profit) ───────────
-- security_invoker = false → izvršava se kao vlasnik (zaobilazi RLS base
-- tabele), pa Logistika može da čita bezbedne kolone iako nema pristup bazi.
create view public.product_variants_public
  with (security_invoker = false) as
  select id, product_id, sku, variant_name, stock_quantity,
         low_stock_threshold, supplier_sku, weight_grams, image, archived_at
  from public.product_variants;

revoke all on public.product_variants_public from anon;
grant select on public.product_variants_public to authenticated;

-- ============================================================================
-- POLITIKE
-- Obrazac: SELECT politika definiše ko čita; "<t>_admin_write" (for all) daje
-- Adminu pun pristup (uklj. čitanje kroz USING). Sve politike su za rolu
-- `authenticated`; anon nema nijednu → potpun deny.
-- ============================================================================

-- profiles — svako vidi svoj red; Admin sve
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.current_app_role() = 'admin');
create policy "profiles_admin_write" on public.profiles
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- categories — katalog: čitaju svi (uklj. Logistiku); piše Admin
create policy "categories_select" on public.categories
  for select to authenticated using (true);
create policy "categories_admin_write" on public.categories
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- products — bez finansijskih kolona: čitaju svi; piše Admin
create policy "products_select" on public.products
  for select to authenticated using (true);
create policy "products_admin_write" on public.products
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- product_variants — ima MP/VP/profit: čitaju samo Admin/Menadžer.
-- Logistika NEMA pristup bazi → čita product_variants_public view.
create policy "product_variants_select" on public.product_variants
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "product_variants_admin_write" on public.product_variants
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- order_statuses — labele: čitaju svi; piše Admin
create policy "order_statuses_select" on public.order_statuses
  for select to authenticated using (true);
create policy "order_statuses_admin_write" on public.order_statuses
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- customers — Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "customers_select" on public.customers
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "customers_admin_write" on public.customers
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- orders — Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "orders_select" on public.orders
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "orders_admin_write" on public.orders
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- order_items — zamrznute cene: Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "order_items_select" on public.order_items
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "order_items_admin_write" on public.order_items
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- invoices — finansije: Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "invoices_select" on public.invoices
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "invoices_admin_write" on public.invoices
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- payouts — finansije: Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "payouts_select" on public.payouts
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "payouts_admin_write" on public.payouts
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- expense_categories — finansije: Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "expense_categories_select" on public.expense_categories
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "expense_categories_admin_write" on public.expense_categories
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- expenses — finansije: Admin/Menadžer čitaju; Admin piše; Logistika ❌
create policy "expenses_select" on public.expenses
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "expenses_admin_write" on public.expenses
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- push_subscriptions — svaki korisnik upravlja samo svojim uređajima
create policy "push_subscriptions_own" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- notification_log — bez politika za authenticated (samo service role/cron).
-- RLS ostaje uključen → potpun deny svim ulogovanim korisnicima.
