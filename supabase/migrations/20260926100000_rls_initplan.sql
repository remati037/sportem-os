-- ============================================================================
-- Sportem OS — Korak K3: RLS `initplan` (migracija #1, NULA promene ponašanja)
--
-- ŠTA: svih 75 poziva public.current_app_role() u RLS politikama se zaomotava u
-- skalarni podupit `(select public.current_app_role())`.
--
-- ZAŠTO: bez omotača Postgres izvršava funkciju PO REDU (1.324× po skeniranju
-- `orders`). Sa omotačem planer je promoviše u `InitPlan` — izračuna se JEDNOM
-- po upitu. Ovo je čisto ubrzanje: predikat pušta i zabranjuje tačno iste
-- redove kao pre.
--
-- KAKO (tvrdi zahtevi iz plana, odluka O5):
--   • `alter policy`, NIKAD drop+create — tabela ni u jednom trenutku ne stoji
--     bez politike, a imena politika ostaju identična (`rls-test.mjs` ih
--     proverava po imenu).
--   • Logika predikata se NE MENJA — menja se samo omotač.
--   • Migracija je SAMO-PROVERAVAJUĆA: snimi `pg_policies` PRE alterā, pa na
--     kraju uporedi predikate POSLE skidanja omotača. Svaka razlika →
--     `raise exception` → cela migracija se vraća unazad (dokazano probnom
--     migracijom 20260926090000_tx_probe.sql) i baza ostaje netaknuta.
--
-- OBIM: 51 politika (49 sa `current_app_role()` + `push_subscriptions_own` i
-- `notification_preferences_own`, koje nose samo `auth.uid()` i već su omotane
-- — ovde se potvrđuju, ne menjaju). Politike bez ijednog poziva
-- (`categories_select`, `products_select`, `order_statuses_select`,
-- `product_images_read`) se ne diraju.
--
-- NE DIRA: nijednu tabelu, kolonu, view, funkciju, trigger ni podatak.
-- Zamrznute cene (`order_items`), finansije i tok statusa su netaknuti.
--
-- UNDO: na dnu fajla, zakomentarisan blok „UNDO".
-- ============================================================================

-- ── 1) SNAPSHOT PRE ─────────────────────────────────────────────────────────
-- `on commit drop` → tabela nestaje sa commit-om; pri rollback-u nestaje svakako.
create temp table __rls_pre on commit drop as
select schemaname,
       tablename,
       policyname,
       cmd,
       permissive,
       roles::text as roles,
       qual,
       with_check
from pg_policies
where schemaname in ('public', 'storage');

-- ── 2) ALTER POLICY × 51 ────────────────────────────────────────────────────

-- ── Korak 0.5 — osnovne politike (20260708172800_rls_policies.sql) ─────────
alter policy "profiles_select" on public.profiles
  using (id = (select auth.uid()) or (select public.current_app_role()) = 'admin');
alter policy "profiles_admin_write" on public.profiles
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "categories_admin_write" on public.categories
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "products_admin_write" on public.products
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "product_variants_select" on public.product_variants
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "product_variants_admin_write" on public.product_variants
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "order_statuses_admin_write" on public.order_statuses
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "customers_select" on public.customers
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "customers_admin_write" on public.customers
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "orders_select" on public.orders
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "orders_admin_write" on public.orders
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "order_items_select" on public.order_items
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "order_items_admin_write" on public.order_items
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "invoices_select" on public.invoices
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "invoices_admin_write" on public.invoices
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "payouts_select" on public.payouts
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "payouts_admin_write" on public.payouts
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "expense_categories_select" on public.expense_categories
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "expense_categories_admin_write" on public.expense_categories
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "expenses_select" on public.expenses
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "expenses_admin_write" on public.expenses
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "push_subscriptions_own" on public.push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Storage: slike proizvoda (20260709100000) ─────────────────────────────
alter policy "product_images_admin_insert" on storage.objects
  with check (bucket_id = 'product-images' and (select public.current_app_role()) = 'admin');
alter policy "product_images_admin_update" on storage.objects
  using (bucket_id = 'product-images' and (select public.current_app_role()) = 'admin')
  with check (bucket_id = 'product-images' and (select public.current_app_role()) = 'admin');
alter policy "product_images_admin_delete" on storage.objects
  using (bucket_id = 'product-images' and (select public.current_app_role()) = 'admin');

-- ── Istorija statusa porudžbine (20260709160000) ──────────────────────────
alter policy "osh_select" on public.order_status_history
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "osh_admin_write" on public.order_status_history
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- ── Finansije: poravnanja poštarine (20260710120000) ──────────────────────
alter policy "postage_settlements_select" on public.postage_settlements
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "postage_settlements_admin_write" on public.postage_settlements
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- ── Storage: prilozi troškova (20260710140000) ────────────────────────────
alter policy "expense_attachments_read" on storage.objects
  using (bucket_id = 'expense-attachments' and (select public.current_app_role()) in ('admin', 'manager'));
alter policy "expense_attachments_admin_insert" on storage.objects
  with check (bucket_id = 'expense-attachments' and (select public.current_app_role()) = 'admin');
alter policy "expense_attachments_admin_update" on storage.objects
  using (bucket_id = 'expense-attachments' and (select public.current_app_role()) = 'admin')
  with check (bucket_id = 'expense-attachments' and (select public.current_app_role()) = 'admin');
alter policy "expense_attachments_admin_delete" on storage.objects
  using (bucket_id = 'expense-attachments' and (select public.current_app_role()) = 'admin');

-- ── Preference obaveštenja (20260711120000) ───────────────────────────────
alter policy "notification_preferences_own" on public.notification_preferences
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── XExpress fakture poštarine (20260721120000) ───────────────────────────
alter policy "xexpress_invoices_select" on public.xexpress_invoices
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "xexpress_invoices_admin_write" on public.xexpress_invoices
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- ── Tiketi (20260825120000) ───────────────────────────────────────────────
alter policy "ticket_columns_select" on public.ticket_columns
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_columns_admin_write" on public.ticket_columns
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "ticket_priorities_select" on public.ticket_priorities
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_priorities_admin_write" on public.ticket_priorities
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "ticket_tags_select" on public.ticket_tags
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_tags_admin_write" on public.ticket_tags
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "tickets_staff_all" on public.tickets
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_assignees_staff_all" on public.ticket_assignees
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_tag_links_staff_all" on public.ticket_tag_links
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_checklist_items_staff_all" on public.ticket_checklist_items
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_comments_staff_all" on public.ticket_comments
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "ticket_events_staff_all" on public.ticket_events
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));

-- ── Ponude (20260925120000) ───────────────────────────────────────────────
alter policy "offer_rules_select" on public.offer_rules
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "offer_events_select" on public.offer_events
  using ((select public.current_app_role()) in ('admin', 'manager'));
alter policy "offer_sync_state_select" on public.offer_sync_state
  using ((select public.current_app_role()) in ('admin', 'manager'));

-- ── 3) SAMO-PROVERA ─────────────────────────────────────────────────────────
-- Normalizacija: skida `( SELECT x.current_app_role() AS current_app_role)` na
-- `x.current_app_role()` i `( SELECT auth.uid() AS uid)` na `auth.uid()`. Kako
-- se primenjuje i na STARI i na NOVI predikat, poređenje je slepo za omotač i
-- gleda ISKLJUČIVO logiku. Šema u regexu je opciona jer `pg_get_expr` kvalifikuje
-- ime u zavisnosti od `search_path`.
create function pg_temp.__k3_norm(p text) returns text
language sql immutable as $fn$
  select regexp_replace(
           regexp_replace(
             coalesce($1, ''),
             '\(\s*SELECT\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?current_app_role\(\))\s+AS\s+current_app_role\s*\)',
             '\1', 'gi'),
           '\(\s*SELECT\s+(auth\.uid\(\))\s+AS\s+uid\s*\)',
           '\1', 'gi')
$fn$;

-- Ima li u predikatu poziva koji NIJE u omotaču? (omotane pojave se prvo
-- zamene sentinelom, pa se traži šta je ostalo)
create function pg_temp.__k3_unwrapped(p text) returns boolean
language sql immutable as $fn$
  select regexp_replace(
           regexp_replace(
             coalesce($1, ''),
             '\(\s*SELECT\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?current_app_role\(\)\s+AS\s+current_app_role\s*\)',
             '<<OMOTANO>>', 'gi'),
           '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)',
           '<<OMOTANO>>', 'gi')
         ~* '(current_app_role\s*\(|auth\.uid\s*\()'
$fn$;

do $k3$
declare
  r            record;
  v_pre        int;
  v_post       int;
  v_wrapped    int;
  v_problemi   text[] := '{}';
  c_ocekivano  constant int := 51;   -- politika koje POSLE ovoga moraju biti omotane
begin
  -- (a) isti broj politika pre i posle
  select count(*) into v_pre from __rls_pre;
  select count(*) into v_post
    from pg_policies where schemaname in ('public', 'storage');

  if v_pre <> v_post then
    raise exception
      'K3 RLS initplan: broj politika se promenio (pre = %, posle = %). Migracija vraćena unazad.',
      v_pre, v_post;
  end if;

  if v_pre = 0 then
    raise exception
      'K3 RLS initplan: snapshot `pg_policies` je prazan — provera bi bila lažno zelena. Migracija vraćena unazad.';
  end if;

  -- (b) predikat po predikat: identičan posle skidanja omotača + ništa nezaomotano
  for r in
    select coalesce(pre.schemaname, post.schemaname) as schemaname,
           coalesce(pre.tablename,  post.tablename)  as tablename,
           coalesce(pre.policyname, post.policyname) as policyname,
           pre.policyname is null as samo_posle,
           post.policyname is null as samo_pre,
           pre.cmd        as old_cmd,        post.cmd        as new_cmd,
           pre.permissive as old_permissive, post.permissive as new_permissive,
           pre.roles      as old_roles,      post.roles      as new_roles,
           pre.qual       as old_qual,       post.qual       as new_qual,
           pre.with_check as old_check,      post.with_check as new_check
    from __rls_pre pre
    full outer join (
      select schemaname, tablename, policyname, cmd, permissive,
             roles::text as roles, qual, with_check
      from pg_policies
      where schemaname in ('public', 'storage')
    ) post
      on  post.schemaname = pre.schemaname
      and post.tablename  = pre.tablename
      and post.policyname = pre.policyname
    order by 1, 2, 3
  loop
    if r.samo_pre then
      v_problemi := v_problemi || format('%s.%s / "%s": politika je NESTALA.',
        r.schemaname, r.tablename, r.policyname);
      continue;
    end if;
    if r.samo_posle then
      v_problemi := v_problemi || format('%s.%s / "%s": politika je NOVA (nije postojala pre).',
        r.schemaname, r.tablename, r.policyname);
      continue;
    end if;

    -- komanda / permisivnost / role se ne smeju pomeriti
    if r.old_cmd is distinct from r.new_cmd
       or r.old_permissive is distinct from r.new_permissive
       or r.old_roles is distinct from r.new_roles then
      v_problemi := v_problemi || format(
        '%s.%s / "%s": promenjen okvir politike — cmd %s→%s, permissive %s→%s, roles %s→%s.',
        r.schemaname, r.tablename, r.policyname,
        r.old_cmd, r.new_cmd, r.old_permissive, r.new_permissive, r.old_roles, r.new_roles);
    end if;

    -- USING
    if pg_temp.__k3_norm(r.old_qual) is distinct from pg_temp.__k3_norm(r.new_qual) then
      v_problemi := v_problemi || format(
        '%s.%s / "%s": USING se PROMENIO.%s  STARO: %s%s  NOVO:  %s',
        r.schemaname, r.tablename, r.policyname,
        chr(10), coalesce(r.old_qual, '<null>'), chr(10), coalesce(r.new_qual, '<null>'));
    end if;

    -- WITH CHECK
    if pg_temp.__k3_norm(r.old_check) is distinct from pg_temp.__k3_norm(r.new_check) then
      v_problemi := v_problemi || format(
        '%s.%s / "%s": WITH CHECK se PROMENIO.%s  STARO: %s%s  NOVO:  %s',
        r.schemaname, r.tablename, r.policyname,
        chr(10), coalesce(r.old_check, '<null>'), chr(10), coalesce(r.new_check, '<null>'));
    end if;

    -- nijedan poziv ne sme ostati bez omotača
    if pg_temp.__k3_unwrapped(r.new_qual) or pg_temp.__k3_unwrapped(r.new_check) then
      v_problemi := v_problemi || format(
        '%s.%s / "%s": OSTAO NEZAOMOTAN poziv.%s  USING: %s%s  WITH CHECK: %s',
        r.schemaname, r.tablename, r.policyname,
        chr(10), coalesce(r.new_qual, '<null>'), chr(10), coalesce(r.new_check, '<null>'));
    end if;
  end loop;

  -- (c) omotač je stvarno primenjen na očekivan broj politika (kapija protiv
  --     regexa koji ništa ne pogađa → lažno zelena provera pod (b))
  select count(*) into v_wrapped
    from pg_policies
   where schemaname in ('public', 'storage')
     and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         ~* '\(\s*SELECT\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?(current_app_role|uid)\s*\(\)';

  if v_wrapped <> c_ocekivano then
    v_problemi := v_problemi || format(
      'Omotanih politika ima %s, a očekivano je %s. Neka politika nije alterovana ili je dodata van ove migracije.',
      v_wrapped, c_ocekivano);
  end if;

  if array_length(v_problemi, 1) is not null then
    raise exception
      E'K3 RLS initplan: % problem(a) — migracija vraćena unazad, baza je NETAKNUTA.\n\n%',
      array_length(v_problemi, 1),
      array_to_string(v_problemi, E'\n\n');
  end if;

  raise notice
    'K3 RLS initplan ✅ — % politika provereno, % omotano, svi predikati logički identični.',
    v_post, v_wrapped;
end
$k3$;

drop function pg_temp.__k3_norm(text);
drop function pg_temp.__k3_unwrapped(text);

-- ============================================================================
-- UNDO — vraća predikate u stanje pre K3 (skida omotač oko current_app_role();
-- `(select auth.uid())` je bio omotan i PRE ovog koraka, pa tu nema promene).
-- Ponašanje je identično u oba smera — vraćanje menja samo brzinu.
-- Pokrenuti kao jedan blok (ceo blok odkomentarisati) u SQL editoru ili kao
-- novu migraciju.
-- ============================================================================
-- -- ── Korak 0.5 — osnovne politike (20260708172800_rls_policies.sql) ─────────
-- alter policy "profiles_select" on public.profiles
--   using (id = (select auth.uid()) or public.current_app_role() = 'admin');
-- alter policy "profiles_admin_write" on public.profiles
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "categories_admin_write" on public.categories
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "products_admin_write" on public.products
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "product_variants_select" on public.product_variants
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "product_variants_admin_write" on public.product_variants
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "order_statuses_admin_write" on public.order_statuses
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "customers_select" on public.customers
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "customers_admin_write" on public.customers
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "orders_select" on public.orders
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "orders_admin_write" on public.orders
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "order_items_select" on public.order_items
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "order_items_admin_write" on public.order_items
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "invoices_select" on public.invoices
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "invoices_admin_write" on public.invoices
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "payouts_select" on public.payouts
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "payouts_admin_write" on public.payouts
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "expense_categories_select" on public.expense_categories
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "expense_categories_admin_write" on public.expense_categories
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "expenses_select" on public.expenses
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "expenses_admin_write" on public.expenses
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "push_subscriptions_own" on public.push_subscriptions
--   using (user_id = (select auth.uid()))
--   with check (user_id = (select auth.uid()));
--
-- -- ── Storage: slike proizvoda (20260709100000) ─────────────────────────────
-- alter policy "product_images_admin_insert" on storage.objects
--   with check (bucket_id = 'product-images' and public.current_app_role() = 'admin');
-- alter policy "product_images_admin_update" on storage.objects
--   using (bucket_id = 'product-images' and public.current_app_role() = 'admin')
--   with check (bucket_id = 'product-images' and public.current_app_role() = 'admin');
-- alter policy "product_images_admin_delete" on storage.objects
--   using (bucket_id = 'product-images' and public.current_app_role() = 'admin');
--
-- -- ── Istorija statusa porudžbine (20260709160000) ──────────────────────────
-- alter policy "osh_select" on public.order_status_history
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "osh_admin_write" on public.order_status_history
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
--
-- -- ── Finansije: poravnanja poštarine (20260710120000) ──────────────────────
-- alter policy "postage_settlements_select" on public.postage_settlements
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "postage_settlements_admin_write" on public.postage_settlements
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
--
-- -- ── Storage: prilozi troškova (20260710140000) ────────────────────────────
-- alter policy "expense_attachments_read" on storage.objects
--   using (bucket_id = 'expense-attachments' and public.current_app_role() in ('admin', 'manager'));
-- alter policy "expense_attachments_admin_insert" on storage.objects
--   with check (bucket_id = 'expense-attachments' and public.current_app_role() = 'admin');
-- alter policy "expense_attachments_admin_update" on storage.objects
--   using (bucket_id = 'expense-attachments' and public.current_app_role() = 'admin')
--   with check (bucket_id = 'expense-attachments' and public.current_app_role() = 'admin');
-- alter policy "expense_attachments_admin_delete" on storage.objects
--   using (bucket_id = 'expense-attachments' and public.current_app_role() = 'admin');
--
-- -- ── Preference obaveštenja (20260711120000) ───────────────────────────────
-- alter policy "notification_preferences_own" on public.notification_preferences
--   using (user_id = (select auth.uid()))
--   with check (user_id = (select auth.uid()));
--
-- -- ── XExpress fakture poštarine (20260721120000) ───────────────────────────
-- alter policy "xexpress_invoices_select" on public.xexpress_invoices
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "xexpress_invoices_admin_write" on public.xexpress_invoices
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
--
-- -- ── Tiketi (20260825120000) ───────────────────────────────────────────────
-- alter policy "ticket_columns_select" on public.ticket_columns
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_columns_admin_write" on public.ticket_columns
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "ticket_priorities_select" on public.ticket_priorities
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_priorities_admin_write" on public.ticket_priorities
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "ticket_tags_select" on public.ticket_tags
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_tags_admin_write" on public.ticket_tags
--   using (public.current_app_role() = 'admin')
--   with check (public.current_app_role() = 'admin');
-- alter policy "tickets_staff_all" on public.tickets
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_assignees_staff_all" on public.ticket_assignees
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_tag_links_staff_all" on public.ticket_tag_links
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_checklist_items_staff_all" on public.ticket_checklist_items
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_comments_staff_all" on public.ticket_comments
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
-- alter policy "ticket_events_staff_all" on public.ticket_events
--   using (public.current_app_role() in ('admin', 'manager'))
--   with check (public.current_app_role() in ('admin', 'manager'));
--
-- -- ── Ponude (20260925120000) ───────────────────────────────────────────────
-- alter policy "offer_rules_select" on public.offer_rules
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "offer_events_select" on public.offer_events
--   using (public.current_app_role() in ('admin', 'manager'));
-- alter policy "offer_sync_state_select" on public.offer_sync_state
--   using (public.current_app_role() in ('admin', 'manager'));
