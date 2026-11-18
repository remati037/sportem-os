-- ============================================================================
-- Porez po mesecu (18.11.2026, na zahtev korisnika)
--
-- Admin upisuje stopu poreza za kalendarski mesec (npr. novembar 2026 → 20 %).
-- Dashboard prekidačem „Posle poreza" oduzima porez od zarade porudžbina
-- KREIRANIH u tom mesecu (`ordered_at`, Beograd):
--   porez = zarada (MP − VP iz zamrznutih order_items) × stopa,
-- OSIM porudžbina označenih kao keš (`payment_status = 'kes'`) — one ulaze u
-- zaradu pune vrednosti. Računa se u app-u pri svakom prikazu (lib/tax.ts), pa
-- prebacivanje porudžbine u keš odmah skida porez sa nje. Ništa se ne upisuje
-- na porudžbinu.
--
-- Nezavisno od `payouts.tax_rate_bp` (stopa na uplati vodi fakturu i
-- „Drug mi duguje"). Ne dira snapshot, order_items, finansije ni postojeći RLS.
--
-- Stopa u BAZNIM POENIMA (2000 = 20 %), integer — bez float-a (§5).
-- Mesec bez reda = 0 %.
-- ============================================================================

create table public.tax_months (
  month date primary key
    check (extract(day from month) = 1),
  rate_bp int not null
    check (rate_bp between 0 and 10000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tax_months is
  'Stopa poreza na zaradu po kalendarskom mesecu (Dashboard „Posle poreza"). Keš porudžbine se ne oporezuju.';
comment on column public.tax_months.month is 'Prvi dan meseca (YYYY-MM-01).';
comment on column public.tax_months.rate_bp is 'Stopa u baznim poenima (2000 = 20 %).';

create trigger tax_months_set_updated_at
  before update on public.tax_months
  for each row execute function public.set_updated_at();

-- ── RLS: čitaju Admin + Menadžer, piše samo Admin; Logistika ništa ─────────
alter table public.tax_months enable row level security;

create policy "tax_months_staff_select" on public.tax_months
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

create policy "tax_months_admin_write" on public.tax_months
  for all to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- UNDO:
-- drop table public.tax_months;
