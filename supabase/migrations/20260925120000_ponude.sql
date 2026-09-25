-- ============================================================================
-- Ponude — sinhronizacija WooCommerce plugina „Sportem Offers"
--
-- Na sajtu (sportem.rs) radi custom plugin koji prikazuje upsell ponude u side
-- cartu i korpi, i order bump na checkoutu. Plugin beleži događaje (prikaz,
-- dodavanje, uklanjanje, porudžbina) i izlaže ih kroz REST API. App ih povlači
-- u Supabase (cron + ručno dugme) i prikazuje statistiku po pravilu (/ponude).
--
-- Tri tabele:
--   1. offer_rules      — pravila iz plugina (ogledalo, prepisuje se pri sync-u)
--   2. offer_events     — događaji (id je WordPress id → idempotentan upsert)
--   3. offer_sync_state — dokle se stiglo + poslednja greška
--
-- Pristup: Admin + Menadžer (stranica pokazuje PRIHOD, a po zaključanoj odluci
-- Logistika ne vidi nijednu finansijsku cifru). Nijedna write politika →
-- upisuje isključivo service role (cron ruta i server akcija), kao kod
-- notification_log. Sve agregacije idu kroz SQL funkcije na dnu ovog fajla,
-- jer PostgREST u ovom projektu tvrdo seče na 1000 redova (docs/backlog.md #0)
-- pa bi čitanje sirovih događaja u JS tiho gubilo rep.
--
-- Ne dira: zamrznute cene (order_items), finansije, RLS postojećih tabela.
-- ============================================================================

-- ── 1. offer_rules ──────────────────────────────────────────────────────────
-- Ogledalo pravila iz plugina. `id` je id pravila u WordPress-u (text, jer ga
-- plugin tako izlaže). Naziv/uslovi se pri svakom sync-u prepisuju — izvor
-- istine je plugin, app ovde ništa ne uređuje.
create table public.offer_rules (
  id             text primary key,
  name           text not null,
  active         boolean not null default false,
  priority       int not null default 0,
  placements     text[] not null default '{}',   -- sidecart | cart | checkout
  offer_product  bigint,                         -- Woo product id ponuđenog artikla
  offer_sku      text,
  offer_name     text,
  price_rule     text,                           -- opis pravila cene (slobodan tekst iz plugina)
  conditions     text,                           -- uslovi prikaza (slobodan tekst iz plugina)
  wp_updated_at  timestamptz,                    -- „updated" iz plugina (Europe/Belgrade → UTC)
  synced_at      timestamptz not null default now()
);

comment on table public.offer_rules is
  'Pravila upsell ponuda iz WooCommerce plugina „Sportem Offers". Ogledalo — prepisuje se pri sinhronizaciji.';
comment on column public.offer_rules.wp_updated_at is
  'Vreme izmene pravila u pluginu. Plugin šalje lokalno vreme sajta (Europe/Belgrade); app konvertuje u UTC.';

-- ── 2. offer_events ─────────────────────────────────────────────────────────
-- `id` je id događaja iz WordPress-a (NE generiše se novi) — time je upsert
-- idempotentan i ponovljena sinhronizacija ne pravi duplikate.
-- `rule_id` NEMA FK na offer_rules: događaj sme da preživi obrisano pravilo
-- (istorija se ne gubi), a redosled upisa pri sync-u ne sme da obara batch.
create table public.offer_events (
  id         bigint primary key,
  created_at timestamptz not null,
  event      text not null check (event in ('impression', 'add', 'remove', 'order')),
  rule_id    text,
  placement  text,                               -- sidecart | cart | checkout
  product_id bigint,
  order_id   bigint,                             -- 0 osim kod event = 'order'
  value      numeric(12, 2) not null default 0
);

create index offer_events_rule_created_idx  on public.offer_events (rule_id, created_at);
create index offer_events_event_created_idx on public.offer_events (event, created_at);

comment on table public.offer_events is
  'Događaji ponuda iz plugina (prikaz/dodavanje/uklanjanje/porudžbina). id = id iz WordPress-a → idempotentan upsert.';
comment on column public.offer_events.value is
  'Kod „add" cena ponuđenog proizvoda, kod „order" iznos stavke u porudžbini (RSD). Inače 0.';
comment on column public.offer_events.order_id is
  'Woo broj porudžbine (spaja se na orders.woo_order_id). 0 kad događaj nije „order".';

-- ── 3. offer_sync_state ─────────────────────────────────────────────────────
-- Jedan red po izvoru (ključ „offers"). `last_event_id` se pomera SAMO kad
-- batch prođe; greška se upisuje u `last_error` i vidi se na stranici.
create table public.offer_sync_state (
  key            text primary key,
  last_event_id  bigint not null default 0,
  last_synced_at timestamptz,
  last_error     text
);

comment on table public.offer_sync_state is
  'Stanje sinhronizacije ponuda: dokle je stigao after_id, kad je poslednji put uspelo i poslednja greška.';

insert into public.offer_sync_state (key, last_event_id) values ('offers', 0)
  on conflict (key) do nothing;

-- ── RLS (obrazac iz postage_settlements / xexpress_invoices) ────────────────
-- select: Admin + Menadžer. Logistika NEMA nijednu politiku → deny-by-default,
-- kao kod finansija i tiketa. Write politike ne postoje: upis ide isključivo
-- kroz service role (cron ruta + server akcija „Sinhronizuj sada").
alter table public.offer_rules      enable row level security;
alter table public.offer_events     enable row level security;
alter table public.offer_sync_state enable row level security;

create policy "offer_rules_select" on public.offer_rules
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

create policy "offer_events_select" on public.offer_events
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

create policy "offer_sync_state_select" on public.offer_sync_state
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

-- ============================================================================
-- AGREGACIJE
--
-- Funkcije su SECURITY INVOKER (podrazumevano) → RLS pozivaoca ostaje na snazi:
-- Logistika nema select ni na offer_events ni na orders, pa ne dobija ništa.
--
-- Otkazane i vraćene porudžbine se isključuju iz `orders` i `revenue`:
-- offer_events.order_id je Woo broj → spoj na orders.woo_order_id. Porudžbina
-- se izbacuje ako ima cancelled_at ILI status „Otkazano"/„Vraćeno" (po IMENU,
-- nikad po hardkodovanom UUID-u — obrazac APP_STATUS).
--
-- VAŽNO: događaj čija porudžbina UOPŠTE ne postoji u `orders` (starija od
-- uključenja Woo webhook-a) se BROJI — status joj nije poznat, a tiho
-- izbacivanje bi umanjilo prihod. Stranica /ponude to piše kao napomenu.
-- ============================================================================

-- Spoj događaja i porudžbine: `offer_events.order_id` je Woo broj, pa ide na
-- `orders.woo_order_id` (unique → spoj ne množi redove). Događaj se BROJI kad
-- porudžbine nema (o.id is null) ili kad nije otkazana/vraćena.
--
-- Jedan LEFT JOIN umesto provere po redu — brže i lakše za čitanje.

-- ── statistika po pravilu ───────────────────────────────────────────────────
create or replace function public.offer_rule_stats(p_from timestamptz, p_to timestamptz)
returns table (
  rule_id     text,
  impressions bigint,
  adds        bigint,
  removes     bigint,
  orders      bigint,
  revenue     numeric,
  add_rate    numeric
)
language sql
stable
as $$
  with e as (
    select ev.rule_id,
           ev.event,
           ev.order_id,
           ev.value,
           (o.id is null or (o.cancelled_at is null
                             and s.name not in ('Otkazano', 'Vraćeno'))) as counts
    from public.offer_events ev
    left join public.orders o
      on ev.event = 'order' and o.woo_order_id = ev.order_id
    left join public.order_statuses s on s.id = o.status_id
    where ev.created_at >= p_from and ev.created_at < p_to
  )
  select
    e.rule_id,
    count(*) filter (where e.event = 'impression')                       as impressions,
    count(*) filter (where e.event = 'add')                              as adds,
    count(*) filter (where e.event = 'remove')                           as removes,
    count(distinct e.order_id) filter (where e.event = 'order' and e.counts) as orders,
    coalesce(sum(e.value) filter (where e.event = 'order' and e.counts), 0) as revenue,
    case
      when count(*) filter (where e.event = 'impression') = 0 then 0
      else round(count(*) filter (where e.event = 'add')::numeric
                 / count(*) filter (where e.event = 'impression'), 4)
    end                                                                  as add_rate
  from e
  group by e.rule_id;
$$;

comment on function public.offer_rule_stats(timestamptz, timestamptz) is
  'Statistika ponuda po pravilu za period [p_from, p_to). Otkazane/vraćene porudžbine isključene iz orders i revenue.';

-- ── dnevna serija (dan u Europe/Belgrade) ───────────────────────────────────
-- p_rule_id = null → sva pravila zbirno.
create or replace function public.offer_daily_stats(
  p_from    timestamptz,
  p_to      timestamptz,
  p_rule_id text default null
)
returns table (
  dan     date,
  adds    bigint,
  revenue numeric
)
language sql
stable
as $$
  with e as (
    select (ev.created_at at time zone 'Europe/Belgrade')::date as dan,
           ev.event,
           ev.value,
           (o.id is null or (o.cancelled_at is null
                             and s.name not in ('Otkazano', 'Vraćeno'))) as counts
    from public.offer_events ev
    left join public.orders o
      on ev.event = 'order' and o.woo_order_id = ev.order_id
    left join public.order_statuses s on s.id = o.status_id
    where ev.created_at >= p_from and ev.created_at < p_to
      and (p_rule_id is null or ev.rule_id = p_rule_id)
  )
  select e.dan,
         count(*) filter (where e.event = 'add')                            as adds,
         coalesce(sum(e.value) filter (where e.event = 'order' and e.counts), 0) as revenue
  from e
  group by e.dan
  order by e.dan;
$$;

comment on function public.offer_daily_stats(timestamptz, timestamptz, text) is
  'Dnevna serija (dan u Europe/Belgrade): dodavanja i prihod. p_rule_id = null → sva pravila zbirno.';

-- ── podela po mestu prikaza (detalj pravila) ────────────────────────────────
create or replace function public.offer_placement_stats(
  p_from    timestamptz,
  p_to      timestamptz,
  p_rule_id text default null
)
returns table (
  placement   text,
  impressions bigint,
  adds        bigint,
  orders      bigint,
  revenue     numeric
)
language sql
stable
as $$
  with e as (
    select coalesce(ev.placement, '—') as placement,
           ev.event,
           ev.order_id,
           ev.value,
           (o.id is null or (o.cancelled_at is null
                             and s.name not in ('Otkazano', 'Vraćeno'))) as counts
    from public.offer_events ev
    left join public.orders o
      on ev.event = 'order' and o.woo_order_id = ev.order_id
    left join public.order_statuses s on s.id = o.status_id
    where ev.created_at >= p_from and ev.created_at < p_to
      and (p_rule_id is null or ev.rule_id = p_rule_id)
  )
  select e.placement,
         count(*) filter (where e.event = 'impression')                      as impressions,
         count(*) filter (where e.event = 'add')                             as adds,
         count(distinct e.order_id) filter (where e.event = 'order' and e.counts) as orders,
         coalesce(sum(e.value) filter (where e.event = 'order' and e.counts), 0) as revenue
  from e
  group by e.placement
  order by e.placement;
$$;

comment on function public.offer_placement_stats(timestamptz, timestamptz, text) is
  'Statistika po mestu prikaza (sidecart / cart / checkout) za jedno pravilo ili sva.';

revoke all on function public.offer_rule_stats(timestamptz, timestamptz) from public, anon;
revoke all on function public.offer_daily_stats(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.offer_placement_stats(timestamptz, timestamptz, text) from public, anon;

grant execute on function public.offer_rule_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.offer_daily_stats(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.offer_placement_stats(timestamptz, timestamptz, text) to authenticated;
