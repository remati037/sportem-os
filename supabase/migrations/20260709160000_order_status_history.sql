-- ============================================================================
-- Korak 1.4 — istorija promena statusa porudžbine („ko i kada")
-- ============================================================================
-- Svaka ručna promena statusa (kroz app) upisuje red sa korisnikom koji je
-- promenio. Webhook/backfill promene → changed_by null (sistem). Postojeće
-- porudžbine nemaju istoriju — puni se od sada.

create table public.order_status_history (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  from_status_id uuid references public.order_statuses(id) on delete set null,
  to_status_id   uuid not null references public.order_statuses(id) on delete restrict,
  changed_by     uuid references public.profiles(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);

create index on public.order_status_history(order_id);

comment on column public.order_status_history.changed_by is
  'Korisnik koji je promenio status; null = sistem (webhook/backfill).';

-- RLS: čitaju Admin + Menadžer (kao orders). Piše Admin kroz RLS; Menadžer
-- piše kroz service-role server akciju koja zaobilazi RLS (CLAUDE.md 0.5).
alter table public.order_status_history enable row level security;

create policy "osh_select" on public.order_status_history
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

create policy "osh_admin_write" on public.order_status_history
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
