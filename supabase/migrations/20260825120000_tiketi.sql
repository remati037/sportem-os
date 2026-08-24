-- ============================================================================
-- Tiketi (kanban za tim) — Korak T1: cela šema modula u JEDNOJ migraciji
-- (docs/Sportem-Plan-Tiketi.md, sekcija 1). Jedan `supabase db push` = ceo modul.
--
-- Pristup: SAMO Admin i Menadžer. Logistika nema nijednu politiku ni na jednoj
-- ticket tabeli → deny-by-default, ne vidi ništa (kao finansije).
-- Podešavanja (kolone / prioriteti / tagovi) piše SAMO Admin.
--
-- Podrazumevane kolone/prioriteti/tagovi se upisuju OVDE (fiksni UUID +
-- `on conflict do nothing`), a ne u seed.sql — seed se ne primenjuje na
-- postojeću produkcionu bazu.
--
-- NE dira: order_items (zamrznute cene), finansije, RLS politike postojećih
-- tabela, webhook tok porudžbina, restriktovani view za Logistiku.
-- ============================================================================

-- ── Brojač šifre tiketa: prikaz „SPT-{code}" (lib/tickets.ts) ───────────────
create sequence public.ticket_code_seq as integer start with 1;

-- ============================================================================
-- 1. ticket_columns — kolone kanban board-a (podesivo u Podešavanjima)
-- ============================================================================
create table public.ticket_columns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,                                  -- heks (#RRGGBB)
  sort_order int  not null default 0,
  is_done    boolean not null default false,        -- „završna kolona" (postavlja completed_at)
  wip_limit  int,                                   -- soft limit (kolona pocrveni, ali pušta)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_columns_sort_order_idx on public.ticket_columns (sort_order);
create trigger ticket_columns_set_updated_at
  before update on public.ticket_columns
  for each row execute function public.set_updated_at();

comment on table public.ticket_columns is
  'Kolone kanban board-a (podesivo). is_done se čita po zastavici, nikad po hardkodovanom UUID-u.';
comment on column public.ticket_columns.wip_limit is
  'Soft WIP limit — UI broji „4/3" i pocrveni, ali pomeranje NIJE blokirano.';

-- ============================================================================
-- 2. ticket_priorities — prioriteti (podesivo)
-- ============================================================================
create table public.ticket_priorities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  level      int  not null default 1,               -- 1 = najniži; sortiranje/isticanje
  is_default boolean not null default false,        -- prioritet novog tiketa
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_priorities_sort_order_idx on public.ticket_priorities (sort_order);
-- Najviše jedan podrazumevani prioritet (akcija prvo skine stari, pa postavi novi).
create unique index ticket_priorities_single_default
  on public.ticket_priorities (is_default) where is_default;
create trigger ticket_priorities_set_updated_at
  before update on public.ticket_priorities
  for each row execute function public.set_updated_at();

comment on table public.ticket_priorities is
  'Prioriteti tiketa (podesivo). Podrazumevani se čita po is_default, nikad po UUID-u.';

-- ============================================================================
-- 3. ticket_tags — tagovi (podesivo, sa arhiviranjem)
-- ============================================================================
create table public.ticket_tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  sort_order  int  not null default 0,
  archived_at timestamptz,                          -- skloni iz izbora, ostaje na starim tiketima
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Jedinstveno ime među AKTIVNIM tagovima (arhivirani smeju da se ponove).
create unique index ticket_tags_name_uniq
  on public.ticket_tags (lower(name)) where archived_at is null;
create index ticket_tags_sort_order_idx on public.ticket_tags (sort_order);
create trigger ticket_tags_set_updated_at
  before update on public.ticket_tags
  for each row execute function public.set_updated_at();

comment on column public.ticket_tags.archived_at is
  'Arhiviran tag ne izlazi u izboru, ali ostaje na starim tiketima (istorija netaknuta).';

-- ============================================================================
-- 4. tickets — sam tiket
-- ============================================================================
create table public.tickets (
  id                   uuid primary key default gen_random_uuid(),
  code                 int  not null unique default nextval('public.ticket_code_seq'),
  title                text not null,
  description          text,                        -- običan tekst (auto-linkovi u UI), bez markdown-a
  column_id            uuid not null references public.ticket_columns (id)    on delete restrict,
  priority_id          uuid references public.ticket_priorities (id)          on delete set null,
  position             numeric not null,            -- ručni redosled u koloni (fractional indexing)
  due_date             date,                        -- jedan rok, samo datum
  estimate_minutes     int,
  blocked_by_ticket_id uuid references public.tickets (id)                    on delete set null,
  order_id             uuid references public.orders (id)                     on delete set null,
  variant_id           uuid references public.product_variants (id)           on delete set null,
  customer_id          uuid references public.customers (id)                  on delete set null,
  created_by           uuid references public.profiles (id)                   on delete set null,
  completed_at         timestamptz,                 -- postavlja trigger (ulazak u is_done kolonu)
  source               text not null default 'manual'
                       check (source in ('manual', 'auto_risky_customer')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter sequence public.ticket_code_seq owned by public.tickets.code;

create index tickets_column_position_idx on public.tickets (column_id, position);
create index tickets_due_date_idx        on public.tickets (due_date);
create index tickets_completed_at_idx    on public.tickets (completed_at);
create index tickets_order_id_idx        on public.tickets (order_id);
create index tickets_blocked_by_idx      on public.tickets (blocked_by_ticket_id);
-- Anti-duplikat: najviše jedan automatski tiket („rizičan kupac") po porudžbini.
create unique index tickets_auto_order_uniq
  on public.tickets (order_id) where source = 'auto_risky_customer';

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

comment on table public.tickets is
  'Interni tiketi (kanban). Šifra se prikazuje kao „SPT-{code}". Ne dira porudžbine ni snapshot cene.';
comment on column public.tickets.position is
  'Ručni redosled u koloni; numeric (fractional indexing), nikad float — pravilo iz CLAUDE.md §5.';
comment on column public.tickets.completed_at is
  'Postavlja/briše ISKLJUČIVO trigger tickets_sync_completed_at (ulazak/izlazak iz is_done kolone).';

-- ── completed_at prati is_done kolonu (izvor istine u bazi, ne u app-u) ─────
create or replace function public.tickets_sync_completed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  done boolean;
begin
  select c.is_done into done from public.ticket_columns c where c.id = new.column_id;

  if coalesce(done, false) then
    if new.completed_at is null then new.completed_at = now(); end if;
  else
    new.completed_at = null;
  end if;

  return new;
end;
$$;

create trigger tickets_sync_completed_at
  before insert or update of column_id on public.tickets
  for each row execute function public.tickets_sync_completed_at();

-- ============================================================================
-- 5. ticket_assignees — više izvršilaca po tiketu (M:N); tiket sme biti nedodeljen
-- ============================================================================
create table public.ticket_assignees (
  ticket_id  uuid not null references public.tickets (id)  on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
create index ticket_assignees_user_id_idx on public.ticket_assignees (user_id);

-- ============================================================================
-- 6. ticket_tag_links — više tagova po tiketu (M:N)
-- ============================================================================
create table public.ticket_tag_links (
  ticket_id uuid not null references public.tickets (id)     on delete cascade,
  tag_id    uuid not null references public.ticket_tags (id) on delete cascade,
  primary key (ticket_id, tag_id)
);
create index ticket_tag_links_tag_id_idx on public.ticket_tag_links (tag_id);

comment on table public.ticket_tag_links is
  'Brisanje taga ga samo skida sa tiketa (cascade) — preporučeno je arhiviranje.';

-- ============================================================================
-- 7. ticket_checklist_items — checklist unutar tiketa
-- ============================================================================
create table public.ticket_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  label      text not null,
  done       boolean not null default false,
  sort_order int  not null default 0,
  done_at    timestamptz,
  done_by    uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_checklist_items_ticket_idx
  on public.ticket_checklist_items (ticket_id, sort_order);
create trigger ticket_checklist_items_set_updated_at
  before update on public.ticket_checklist_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 8. ticket_comments — komentari
-- ============================================================================
create table public.ticket_comments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id)  on delete cascade,
  author_id  uuid references public.profiles (id)          on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);
create trigger ticket_comments_set_updated_at
  before update on public.ticket_comments
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 9. ticket_events — audit (ko je šta promenio)
-- ============================================================================
create table public.ticket_events (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  actor_id   uuid references public.profiles (id)         on delete set null,
  kind       text not null,
  from_text  text,
  to_text    text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

comment on column public.ticket_events.kind is
  'created | column | priority | assignee | due | tag | blocked | checklist | comment_deleted (bez CHECK-a — lista raste kroz faze).';
comment on table public.ticket_events is
  'Append-only istorija promena tiketa. Piše i server (service-role) kod automatike.';

-- ============================================================================
-- RLS — obrazac iz postage_settlements (20260710120000_finansije.sql)
--
--   tickets, ticket_assignees, ticket_tag_links, ticket_checklist_items,
--   ticket_comments, ticket_events        → select+write: admin, manager
--   ticket_columns, ticket_priorities, ticket_tags
--                                         → select: admin, manager · write: admin
--
-- Logistika nema nijednu politiku → ne vidi i ne piše ništa.
-- ============================================================================
alter table public.ticket_columns         enable row level security;
alter table public.ticket_priorities      enable row level security;
alter table public.ticket_tags            enable row level security;
alter table public.tickets                enable row level security;
alter table public.ticket_assignees       enable row level security;
alter table public.ticket_tag_links       enable row level security;
alter table public.ticket_checklist_items enable row level security;
alter table public.ticket_comments        enable row level security;
alter table public.ticket_events          enable row level security;

-- ── Config tabele: čitaju Admin + Menadžer, menja SAMO Admin ────────────────
create policy "ticket_columns_select" on public.ticket_columns
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "ticket_columns_admin_write" on public.ticket_columns
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "ticket_priorities_select" on public.ticket_priorities
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "ticket_priorities_admin_write" on public.ticket_priorities
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "ticket_tags_select" on public.ticket_tags
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));
create policy "ticket_tags_admin_write" on public.ticket_tags
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ── Tiketi i sadržaj: Menadžer je ravnopravan Adminu ────────────────────────
create policy "tickets_staff_all" on public.tickets
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

create policy "ticket_assignees_staff_all" on public.ticket_assignees
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

create policy "ticket_tag_links_staff_all" on public.ticket_tag_links
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

create policy "ticket_checklist_items_staff_all" on public.ticket_checklist_items
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

create policy "ticket_comments_staff_all" on public.ticket_comments
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

create policy "ticket_events_staff_all" on public.ticket_events
  for all to authenticated
  using (public.current_app_role() in ('admin', 'manager'))
  with check (public.current_app_role() in ('admin', 'manager'));

-- Brojač šifre koristi se kroz `nextval` default-om pri insertu tiketa.
revoke all on sequence public.ticket_code_seq from anon;
grant usage, select on sequence public.ticket_code_seq to authenticated, service_role;

-- ============================================================================
-- Podrazumevani config (fiksni UUID-jevi + on conflict do nothing).
-- Idempotentno: ponovni push ne duplira, a ručne izmene korisnika ostaju.
-- ============================================================================
insert into public.ticket_columns (id, name, color, sort_order, is_done, wip_limit) values
  ('00000000-0000-0000-0000-00000000c001'::uuid, 'Za rad',   '#6B7280', 1, false, null),
  ('00000000-0000-0000-0000-00000000c002'::uuid, 'U toku',   '#2563EB', 2, false, null),
  ('00000000-0000-0000-0000-00000000c003'::uuid, 'Čeka',     '#D97706', 3, false, null),
  ('00000000-0000-0000-0000-00000000c004'::uuid, 'Završeno', '#1B7A45', 4, true,  null)
on conflict (id) do nothing;

insert into public.ticket_priorities (id, name, color, level, is_default, sort_order) values
  ('00000000-0000-0000-0000-00000000d001'::uuid, 'Nizak',   '#6B7280', 1, false, 1),
  ('00000000-0000-0000-0000-00000000d002'::uuid, 'Srednji', '#2563EB', 2, true,  2),
  ('00000000-0000-0000-0000-00000000d003'::uuid, 'Visok',   '#D97706', 3, false, 3),
  ('00000000-0000-0000-0000-00000000d004'::uuid, 'Hitno',   '#DC2626', 4, false, 4)
on conflict (id) do nothing;

insert into public.ticket_tags (id, name, color, sort_order) values
  ('00000000-0000-0000-0000-00000000e001'::uuid, 'Poziv',       '#2563EB', 1),
  ('00000000-0000-0000-0000-00000000e002'::uuid, 'XExpress',    '#6B7280', 2),
  ('00000000-0000-0000-0000-00000000e003'::uuid, 'Reklamacija', '#DC2626', 3),
  ('00000000-0000-0000-0000-00000000e004'::uuid, 'Nabavka',     '#1B7A45', 4)
on conflict (id) do nothing;
