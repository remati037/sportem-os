-- ============================================================================
-- Korak 1.9 (dopuna) — notification_preferences
-- Po korisniku: master prekidač (enabled) + izbor kanala po tipu obaveštenja
-- (push / email / oba / isključeno) u `prefs` jsonb-u. Nedostajući tip → default
-- (push uključen, email isključen) — v. lib/notifications.ts.
-- ============================================================================
create table public.notification_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  enabled    boolean not null default true,
  -- { "<type>": { "push": bool, "email": bool }, ... }
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

-- Svaki korisnik čita/piše samo svoj red. Service-role (fan-out) zaobilazi RLS.
create policy "notification_preferences_own" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
