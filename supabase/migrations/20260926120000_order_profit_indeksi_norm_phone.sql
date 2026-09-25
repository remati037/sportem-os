-- ============================================================================
-- Sportem OS — Korak K4: zaštita fakture + indeksi koji fale + norm_phone
-- (docs/Sportem-Plan-Optimizacija.md, migracija #2)
--
-- Četiri stvari, sve merene kao „0 pogođenih redova danas" — ovo je zaštita od
-- budućeg i brži upiti, ne ispravka postojećih cifara:
--
--   1) `order_profit` više NE sumira preko NULL-ova (docs/backlog.md #5).
--      Porudžbina sa stavkama [8000, NULL] je davala 8000 i tiho ulazila u
--      fakturu UMANJENA — isti tip buga koji je u Sheetsu retroaktivno menjao
--      zaradu. Sada takva porudžbina vraća NULL = „zarada nije poznata".
--      `security_invoker = true` OSTAJE (Logistika i dalje ne vidi ništa).
--
--   2) Osam indeksa za filtere koji danas sekvencijalno skeniraju `orders`
--      i `customers` (uključujući `ilike` pretragu po imenu → pg_trgm + GIN).
--
--   3) `public.norm_phone(text)` IMMUTABLE — SQL kopija `normalizePhone` iz
--      `lib/woo.ts`, BIT PO BIT ista logika (v. tabelu ispod), plus generisane
--      kolone `orders.ship_phone_norm` i `customers.phone_norm` + indeksi.
--      **Ništa je još ne koristi** — priprema za K6 (`order_risk_counts`), gde
--      poklapanje „rizičnog kupca" prelazi sa JS indeksa na indeks u bazi.
--
-- ŠTA SE NE DIRA: zamrznute cene (`order_items` se ne piše ni ne menja), RLS
-- politike (nove kolone pokrivaju postojeće politike na nivou tabele — Logistika
-- na `orders`/`customers` i dalje nema nijednu `select` politiku), tok statusa
-- porudžbina, webhook, `syncOrderStock`, obaveštenja.
--
-- APP STRANA (isti commit): `issueInvoice` u `app/(app)/finansije/actions.ts`
-- tvrdo odbija fakturu ako bilo koja porudžbina ima `profit IS NULL` (do sada
-- `?? 0` — to je bio bug: faktura bi se izdala umanjena i zaključala stavke).
--
-- UNDO: na dnu fajla, zakomentarisan blok „UNDO".
-- ============================================================================

-- ── 1) public.norm_phone(text) ──────────────────────────────────────────────
-- Doslovna SQL kopija `normalizePhone` iz `lib/woo.ts`:
--
--   if (!raw) return null;                                → STRICT + '' → null
--   let digits = raw.replace(/\D/g, "");                  → regexp_replace [^0-9]
--   if      (digits.startsWith("00381")) digits = "0" + digits.slice(5);
--   else if (digits.startsWith("381"))   digits = "0" + digits.slice(3);
--   if (digits.length < 6) return null;
--   return digits;
--
-- JS `slice(5)` → `substr(…, 6)`, `slice(3)` → `substr(…, 4)` (1-based).
-- JS `\D` je tačno `[^0-9]` (bez `u` zastavice, samo ASCII cifre) — isto ponašanje
-- i na arapsko-indijskim / punoširinskim ciframa: obe strane ih SKIDAJU.
-- `else if` je u SQL-u `case … when … when …` (druga grana se ne proverava kad
-- prva pogodi) — isti redosled, ista granica.
--
-- IMMUTABLE je uslov za generisanu kolonu; funkcija je stvarno immutable (čista
-- transformacija stringa). `search_path = ''` je konvencija projekta (0.5); svi
-- korišćeni pozivi su iz `pg_catalog`, koji je uvek implicitno u putu.
create or replace function public.norm_phone(p_raw text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = ''
as $$
  select case when length(d) < 6 then null else d end
  from (
    select case
             when left(dig, 5) = '00381' then '0' || substr(dig, 6)
             when left(dig, 3) = '381'   then '0' || substr(dig, 4)
             else dig
           end as d
    from (select regexp_replace(p_raw, '[^0-9]', '', 'g') as dig) s
  ) t;
$$;

comment on function public.norm_phone(text) is
  'Normalizacija telefona (SQL kopija normalizePhone iz lib/woo.ts): skini sve '
  'sem cifara, 00381/381 → 0, kraće od 6 cifara → null. IMMUTABLE (generisane kolone).';

revoke all on function public.norm_phone(text) from public;
grant execute on function public.norm_phone(text) to authenticated, service_role;

-- ── 2) Samo-provera funkcije ────────────────────────────────────────────────
-- Granični slučajevi prepisani iz `normalizePhone`. Ako se ijedan ne poklopi,
-- CELA migracija se vraća unazad (`supabase db push` je obmotava u transakciju —
-- dokazano probnom migracijom u K3) i baza ostaje netaknuta.
do $$
declare
  -- [ulaz, očekivano]. NULL ulaz se ne može zapisati u text[][] → zaseban test ispod.
  v_cases text[][] := array[
    array['0601234567',       '0601234567'],   -- već normalizovan
    array['+381601234567',    '0601234567'],   -- +381 → 0
    array['00381601234567',   '0601234567'],   -- 00381 → 0
    array['381601234567',     '0601234567'],   -- 381 → 0
    array['+381 60 123-4567', '0601234567'],   -- razmaci i crtice se skidaju
    array['(060) 123 4567',   '0601234567'],   -- zagrade
    array['060/123-4567',     '0601234567'],   -- kosa crta
    array['tel: 060 1234567', '0601234567'],   -- slova se skidaju
    array['3811234567',       '01234567'],     -- 381 → 0, 8 cifara
    array['0038112345',       '012345'],       -- 00381 → 0, tačno 6 cifara
    array['',                 null],           -- prazan string → null (JS: !raw)
    array['   ',              null],           -- samo razmaci → 0 cifara → null
    array['abc',              null],           -- bez cifara → null
    array['12345',            null],           -- 5 cifara < 6 → null
    array['123456',           '123456'],       -- tačno 6 → prolazi
    array['381123',           null],           -- 6 cifara, ali POSLE skidanja 381 ostaje '0123' (4) → null
    array['0038160',          null],           -- POSLE skidanja 00381 ostaje '060' (3) → null
    array['00381',            null],           -- ostaje '0' → null
    array['١٢٣٤٥٦٧٨٩٠',        null],           -- arapsko-indijske cifre: i JS \D i [^0-9] ih SKIDAJU
    array['０６０１２３４５６７',  null]            -- punoširinske cifre: isto, skidaju se
  ];
  v_in  text;
  v_exp text;
  v_got text;
  v_bad text[] := '{}';
begin
  for i in 1 .. array_length(v_cases, 1) loop
    v_in  := v_cases[i][1];
    v_exp := v_cases[i][2];
    v_got := public.norm_phone(v_in);
    if v_got is distinct from v_exp then
      v_bad := v_bad || format('norm_phone(%L) = %L, očekivano %L', v_in, v_got, v_exp);
    end if;
  end loop;

  if public.norm_phone(null) is not null then
    v_bad := v_bad || 'norm_phone(NULL) nije NULL (funkcija nije STRICT)';
  end if;

  if array_length(v_bad, 1) is not null then
    raise exception E'norm_phone ne prati normalizePhone iz lib/woo.ts:\n  %',
      array_to_string(v_bad, E'\n  ');
  end if;

  raise notice 'norm_phone: % graničnih slučajeva provereno ✓', array_length(v_cases, 1) + 1;
end $$;

-- NAPOMENA o granici dužine ('381123' → null, '0038160' → null): u JS-u se
-- prefiks skida PRE provere `length < 6`, pa se broj koji je IMAO 6 cifara posle
-- skidanja 381 skraćuje na 4 i ispada kao null. To nije lepo, ali je postojeće
-- ponašanje i kopira se DOSLOVNO — `norm_phone` i `normalizePhone` moraju da daju
-- isti rezultat i na besmislenom ulazu, inače K6 poklapanje „rizičnog kupca" ne
-- bi bilo identično. Menjanje samog pravila je odvojena odluka, van K4.

-- ── 3) Generisane kolone (priprema za K6 — ništa ih još ne čita) ────────────
-- `stored`, ne `virtual`: samo stored generisana kolona može da se indeksira.
-- Dodavanje kolone prepisuje tabelu — 1.324 + 1.220 redova, trenutno.
alter table public.orders
  add column ship_phone_norm text generated always as (public.norm_phone(ship_phone)) stored;

alter table public.customers
  add column phone_norm text generated always as (public.norm_phone(phone)) stored;

comment on column public.orders.ship_phone_norm is
  'Normalizovan ship_phone (public.norm_phone). Priprema za K6 order_risk_counts. '
  'Generisana — nikad se ne piše iz app-a.';
comment on column public.customers.phone_norm is
  'Normalizovan phone (public.norm_phone). Priprema za K6 order_risk_counts. '
  'Generisana — nikad se ne piše iz app-a.';

create index orders_ship_phone_norm_idx on public.orders (ship_phone_norm);
create index customers_phone_norm_idx   on public.customers (phone_norm);

-- ── 4) order_profit — NULL kad IJEDNA stavka nema zamrznut profit ───────────
-- `sum()` u Postgresu PRESKAČE NULL-ove, pa je [8000, NULL] davalo 8000. Sada:
-- ako postoji bar jedna stavka bez `profit_at_sale` (nepoznat SKU → needs_vp),
-- cela porudžbina vraća NULL = „zarada nije poznata".
--
-- Ime i tip kolona su nepromenjeni (order_id uuid, profit bigint), pa
-- `create or replace view` prolazi bez `drop` (ništa ne zavisi od view-a u bazi).
-- `security_invoker = true` se navodi EKSPLICITNO — bez toga bi view pao na
-- vlasnika i Logistika bi kroz njega videla zaradu.
create or replace view public.order_profit
  with (security_invoker = true) as
  select order_id,
         case
           when count(*) filter (where profit_at_sale is null) > 0 then null
           else sum(profit_at_sale)
         end as profit
  from public.order_items
  group by order_id;

comment on view public.order_profit is
  'Σ profit_at_sale po porudžbini (zamrznuta zarada). NULL ako IJEDNA stavka '
  'nema VP — zarada nije poznata, ne sme se sumirati u fakturu (K4, backlog #5).';

-- `create or replace view` ne resetuje privilegije, ali se navode za sveže baze.
revoke all on public.order_profit from anon;
grant select on public.order_profit to authenticated;

-- Koliko porudžbina je PROMENILO cifru ovom izmenom (mera, ne kapija):
-- plan je izmerio 0. Ako ispiše > 0, `scripts/provera-k4.mjs` ih imenuje.
do $$
declare v_changed int;
begin
  select count(*) into v_changed
  from (
    select order_id
    from public.order_items
    group by order_id
    having count(*) filter (where profit_at_sale is null) > 0
       and sum(profit_at_sale) is not null
  ) t;
  raise notice 'order_profit: % porudžbina menja cifru (staro Σ ≠ novo NULL). Očekivano: 0.', v_changed;
end $$;

-- ── 5) Indeksi koji fale ────────────────────────────────────────────────────
-- Svi filteri ispod danas sekvencijalno skeniraju tabelu. Indeks NIKAD ne menja
-- rezultat upita — samo put do njega.

-- „rizičan kupac" (db/customer-risk.ts): `.not("cancelled_at","is",null)`.
-- Parcijalni — 141 od 1.324 redova je otkazano/vraćeno.
create index orders_cancelled_at_idx on public.orders (cancelled_at)
  where cancelled_at is not null;

-- `.eq("needs_vp", true)` (Dashboard, /finansije upozorenje, lista porudžbina).
-- Parcijalni `where needs_vp`: kolona je `not null default false`, a svi upiti
-- gledaju SAMO `= true` → indeks je sitan i pokriva sve pozivaoce.
create index orders_needs_vp_idx on public.orders (needs_vp)
  where needs_vp;

-- `.eq("needs_review", true)` (Dashboard „za proveru", lista porudžbina).
create index orders_needs_review_idx on public.orders (needs_review)
  where needs_review;

-- Kandidati za uplatu (db/finance.ts, assertLinkable): xexpress + Isporučeno +
-- neuplaceno + payout_id null. Parcijalni po `payout_id is null` — nevezanih je
-- manjina, a to je jedini uslov koji je konstantan u svim pozivima.
create index orders_payout_candidates_idx
  on public.orders (status_id, delivery_method, payment_status)
  where payout_id is null;

-- pg_trgm za `ilike '%term%'` pretragu po imenu (db/orders.ts, db/tickets.ts).
-- Bez trgm indeksa `ilike` sa vodećim `%` ne može da iskoristi btree — uvek
-- sekvencijalno skeniranje.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Operatorska klasa se traži u katalogu, ne pretpostavlja se šema: ako je
-- pg_trgm na ovoj bazi već bio instaliran u `public` (ili bilo gde), `with
-- schema extensions` iznad je no-op i `extensions.gin_trgm_ops` ne bi postojao.
do $$
declare v_schema text;
begin
  select n.nspname into v_schema
  from pg_opclass oc
  join pg_namespace n on n.oid = oc.opcnamespace
  where oc.opcname = 'gin_trgm_ops'
  limit 1;

  if v_schema is null then
    raise exception 'pg_trgm nije dostupan (gin_trgm_ops nije u katalogu) — GIN indeksi pretrage se ne mogu napraviti.';
  end if;

  execute format(
    'create index orders_ship_name_trgm_idx on public.orders using gin (ship_name %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index customers_name_trgm_idx on public.customers using gin (name %I.gin_trgm_ops)',
    v_schema);

  raise notice 'pg_trgm: GIN indeksi napravljeni (gin_trgm_ops u šemi %)', v_schema;
end $$;

-- Ukupno 8 indeksa: 2 na generisanim kolonama (sekcija 3) + 4 filterska + 2 GIN trgm.
analyze public.orders;
analyze public.customers;

-- ============================================================================
-- UNDO — vraća bazu u stanje pre K4. Ponašanje je posle UNDO-a identično onome
-- pre migracije (uključujući bug #5); menja se samo brzina.
--
-- KAKO: iskopiraj blok ispod u SQL editor i skini prefiks `-- ` sa svake linije
-- (svaka linija ima tačno taj prefiks — nema izuzetaka).
--
-- VAŽNO: `issueInvoice` iz istog commita tvrdo odbija `profit IS NULL`. Posle
-- UNDO-a stari view nikad ne vraća NULL (sumira preko NULL-ova), pa provera
-- postaje mrtvo slovo — ne pada, samo ne štiti. Ako se vraća unazad, vrati i kod
-- (`git revert`).
--
-- -- 1) stari view (vraća bug #5: sumira preko NULL-ova)
-- create or replace view public.order_profit
--   with (security_invoker = true) as
--   select order_id, sum(profit_at_sale) as profit
--   from public.order_items
--   group by order_id;
--
-- comment on view public.order_profit is
--   'Σ profit_at_sale po porudžbini (zamrznuta zarada). Null ako neka stavka nema VP.';
--
-- -- 2) indeksi (nijedan se ne čita iz koda — brišu se bez posledica)
-- drop index if exists public.orders_ship_name_trgm_idx;
-- drop index if exists public.customers_name_trgm_idx;
-- drop index if exists public.orders_payout_candidates_idx;
-- drop index if exists public.orders_needs_review_idx;
-- drop index if exists public.orders_needs_vp_idx;
-- drop index if exists public.orders_cancelled_at_idx;
-- drop index if exists public.orders_ship_phone_norm_idx;
-- drop index if exists public.customers_phone_norm_idx;
--
-- -- pg_trgm se NE briše (druga stvar na bazi ga može koristiti):
-- -- drop extension if exists pg_trgm;
--
-- -- 3) generisane kolone (do K6 ih ništa ne čita) i funkcija
-- alter table public.orders    drop column if exists ship_phone_norm;
-- alter table public.customers drop column if exists phone_norm;
-- drop function if exists public.norm_phone(text);
-- ============================================================================
