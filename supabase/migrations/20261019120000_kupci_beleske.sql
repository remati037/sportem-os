-- ============================================================================
-- Kupci (Korak C3) — beleške i oznake kupca
--
-- Plan: docs/Sportem-Plan-Kupci.md. Jedina migracija modula Kupci.
--
-- Kupac NIJE `customers` red nego GRUPA porudžbina spojenih po telefonu, pa po
-- e-mailu (db/customers.ts, C1) — grupa se proteže preko više `customers`
-- redova. Zato je ključ `customer_key` tekst, ne FK:
--   p:<normalizovan telefon> · e:<e-mail> · c:<customers.id>
-- Kad nova porudžbina spoji dve grupe, aplikacija čita beleške SVIH ključeva
-- grupe (svaki telefon, e-mail i customers.id je kandidat), pa se ništa ne
-- gubi i ne treba migracija podataka.
--
-- Oznake su FIKSNA lista (odluka korisnika 18.10.2026); menja se migracijom.
-- Oznaka se upisuje pod SVIM ključevima grupe, da bi se lista porudžbina
-- poklopila direktno po ključevima same porudžbine (bez spajanja grupa).
--
-- Pristup: SAMO Admin i Menadžer (oboje pišu — odluka korisnika). Logistika
-- nema nijednu politiku (deny-by-default, kao finansije/tiketi). Belešku menja
-- i briše SAMO autor — i u RLS-u, ne samo u akciji.
--
-- Svaki poziv je omotan u (select …) — K3 pravilo (initplan), inače
-- `npm run rls:static` pada.
--
-- Ne dira: customers šemu, zamrznute cene (order_items), finansije, RLS
-- postojećih tabela, webhook.
-- ============================================================================

-- ── 1. customer_notes ───────────────────────────────────────────────────────
create table public.customer_notes (
  id           uuid primary key default gen_random_uuid(),
  customer_key text not null check (customer_key ~ '^[pec]:.+'),
  body         text not null check (length(btrim(body)) between 1 and 2000),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index customer_notes_key_idx on public.customer_notes (customer_key, created_at desc);

create trigger customer_notes_set_updated_at
  before update on public.customer_notes
  for each row execute function public.set_updated_at();

comment on table public.customer_notes is
  'Beleške o kupcu (C3). customer_key = p:telefon | e:e-mail | c:customers.id — ključ grupe iz db/customers.ts.';

-- ── 2. customer_flags ───────────────────────────────────────────────────────
create table public.customer_flags (
  customer_key text not null check (customer_key ~ '^[pec]:.+'),
  flag         text not null check (flag in ('stalni', 'veleprodaja', 'zvati')),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (customer_key, flag)
);

-- Lista porudžbina traži samo „zvati pre slanja".
create index customer_flags_flag_idx on public.customer_flags (flag, customer_key);

comment on table public.customer_flags is
  'Oznake kupca (C3, fiksna lista: stalni | veleprodaja | zvati). Upisuju se pod svim ključevima grupe.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.customer_notes enable row level security;
alter table public.customer_flags enable row level security;

create policy "customer_notes_staff_select" on public.customer_notes
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

create policy "customer_notes_staff_insert" on public.customer_notes
  for insert to authenticated
  with check (
    (select public.current_app_role()) in ('admin', 'manager')
    and created_by = (select auth.uid())
  );

-- Menja i briše samo autor.
create policy "customer_notes_author_update" on public.customer_notes
  for update to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'manager')
    and created_by = (select auth.uid())
  )
  with check (
    (select public.current_app_role()) in ('admin', 'manager')
    and created_by = (select auth.uid())
  );

create policy "customer_notes_author_delete" on public.customer_notes
  for delete to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'manager')
    and created_by = (select auth.uid())
  );

create policy "customer_flags_staff_all" on public.customer_flags
  for all to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'))
  with check ((select public.current_app_role()) in ('admin', 'manager'));

-- UNDO (ručno, ako zatreba):
-- drop table public.customer_flags;
-- drop table public.customer_notes;
