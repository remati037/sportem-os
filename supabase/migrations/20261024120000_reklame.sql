-- ============================================================================
-- Reklame (Meta Ads) — M1: sinhronizacija potrošnje + automatski trošak
-- (plan docs/Sportem-Plan-Reklame.md, odluke D1–D11 potvrđene 24.10.2026)
--
-- App SAMO ČITA Meta Marketing API (Insights) i čuva potrošnju po kampanji i
-- danu. Ad nalog je u USD → potrošnja se čuva u CENTIMA (integer) i preračunava
-- u RSD po srednjem kursu NBS na dan potrošnje; kurs se pamti uz red (snapshot —
-- stari dani se nikad ne preračunavaju).
--
-- Četiri tabele:
--   1. ad_campaigns      — ogledalo kampanja (id = Meta ID)
--   2. ad_insights_daily — potrošnja po kampanji i danu (upsert, ponovo se
--                          povlači poslednjih 7 dana jer Meta koriguje unazad)
--   3. ad_sync_state     — kad je poslednji put uspelo + poslednja greška
--   4. fx_rates          — keš srednjeg kursa NBS po danu (da se ne traži ponovo)
-- + expenses.source / expenses.source_key — automatski mesečni trošak „Meta —
--   {mesec}" (jedan red po mesecu; ručne redove app nikad ne dira).
--
-- Pristup: Admin + Menadžer čitaju (potrošnja je finansija). Logistika NEMA
-- nijednu politiku. Nijedna write politika → upisuje isključivo service role
-- (cron + „Sinhronizuj sada"), obrazac modula Ponude. Svaki poziv u (select …) (K3).
--
-- Ne dira: zamrznute cene (order_items), fakture/uplate/poštarinu, RLS
-- postojećih tabela, computePeriodMetrics (troškovi ulaze u neto kroz expenses).
-- ============================================================================

-- ── 1. ad_campaigns ─────────────────────────────────────────────────────────
create table public.ad_campaigns (
  id          text primary key,                 -- Meta campaign id
  account_id  text not null,                    -- act_…
  name        text not null,
  status      text,                             -- effective_status sa Meta-e
  objective   text,
  synced_at   timestamptz not null default now()
);

comment on table public.ad_campaigns is
  'Kampanje sa Meta ad naloga (ogledalo — prepisuje se pri sinhronizaciji).';

-- ── 2. ad_insights_daily ────────────────────────────────────────────────────
-- Novac: spend_minor = najmanja jedinica valute naloga (USD centi), bez float-a.
-- fx_rate_micro = RSD za 1 jedinicu valute × 10⁶ (srednji kurs NBS), null dok
-- kurs nije poznat; spend_rsd = zaokružen RSD iznos (snapshot).
create table public.ad_insights_daily (
  campaign_id               text not null references public.ad_campaigns (id) on delete cascade,
  date                      date not null,     -- dan po vremenskoj zoni naloga (Europe/Belgrade)
  currency                  text not null,
  spend_minor               bigint not null default 0,
  fx_rate_micro             bigint,
  fx_list_date              date,              -- dan NBS liste (vikend → poslednja objavljena)
  spend_rsd                 int,
  impressions               int not null default 0,
  clicks                    int not null default 0,
  link_clicks               int not null default 0,
  meta_purchases            int not null default 0,
  meta_purchase_value_minor bigint not null default 0,
  synced_at                 timestamptz not null default now(),
  primary key (campaign_id, date)
);

create index ad_insights_daily_date_idx on public.ad_insights_daily (date);

comment on table public.ad_insights_daily is
  'Meta Insights po kampanji i danu. Ogledalo, ne ledger — Meta koriguje unazad, pa se poslednjih 7 dana uvek ponovo povlači.';
comment on column public.ad_insights_daily.spend_minor is
  'Potrošnja u najmanjoj jedinici valute naloga (USD centi). Bez PDV-a (Sportem nije u sistemu PDV-a).';
comment on column public.ad_insights_daily.fx_rate_micro is
  'Srednji kurs NBS (RSD po jedinici valute) × 1.000.000 na dan potrošnje. Snapshot.';

-- ── 3. ad_sync_state ────────────────────────────────────────────────────────
create table public.ad_sync_state (
  key            text primary key,
  last_synced_at timestamptz,
  last_error     text
);

insert into public.ad_sync_state (key) values ('meta')
  on conflict (key) do nothing;

-- ── 4. fx_rates ─────────────────────────────────────────────────────────────
-- Keš srednjeg kursa NBS. Ključ je TRAŽENI dan; list_date je dan liste koja važi
-- (subota/nedelja/praznik → poslednja objavljena lista).
create table public.fx_rates (
  currency     text not null,
  date         date not null,
  list_date    date not null,
  middle_micro bigint not null check (middle_micro > 0),
  fetched_at   timestamptz not null default now(),
  primary key (currency, date)
);

comment on table public.fx_rates is
  'Srednji kurs NBS po danu (RSD za 1 jedinicu × 10⁶). Izvor: kurs.resenje.org (preslikava NBS listu).';

-- ── 5. expenses: oznaka automatskog troška ──────────────────────────────────
-- source null = ručno uneto (app ga nikad ne dira). source 'meta' = mesečni red
-- koji pravi sinhronizacija; source_key 'meta:YYYY-MM' je jedinstven, pa ponovni
-- sync menja isti red. UNIQUE bez predikata: NULL-ovi se u Postgres-u ne sudaraju
-- (ručni redovi), a PostgREST `on_conflict` traži pravi unique (ne parcijalni).
alter table public.expenses
  add column source     text,
  add column source_key text unique;

alter table public.expenses
  add constraint expenses_source_check
  check ((source is null and source_key is null) or (source is not null and source_key is not null));

comment on column public.expenses.source is
  'null = ručno; ''meta'' = automatski mesečni trošak reklama (menja ga samo sinhronizacija).';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.ad_campaigns      enable row level security;
alter table public.ad_insights_daily enable row level security;
alter table public.ad_sync_state     enable row level security;
alter table public.fx_rates          enable row level security;

create policy "ad_campaigns_select" on public.ad_campaigns
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

create policy "ad_insights_daily_select" on public.ad_insights_daily
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

create policy "ad_sync_state_select" on public.ad_sync_state
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

create policy "fx_rates_select" on public.fx_rates
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

-- UNDO:
-- drop table public.ad_insights_daily, public.ad_campaigns, public.ad_sync_state, public.fx_rates;
-- delete from public.expenses where source is not null;
-- alter table public.expenses drop constraint expenses_source_check,
--   drop column source_key, drop column source;
