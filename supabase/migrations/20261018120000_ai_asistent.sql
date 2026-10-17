-- ============================================================================
-- AI Asistent (Korak A1) — razgovori i poruke
--
-- Plan: docs/Sportem-Plan-AI-Asistent.md. Chat sa Claude-om nad Sportem
-- podacima (samo čitanje). Ova migracija pravi SAMO istoriju razgovora;
-- alati u kasnijim fazama čitaju postojeće tabele kroz RLS korisnika.
--
-- Dve tabele:
--   1. ai_conversations — razgovor (vlasnik, naslov, poslednji model)
--   2. ai_messages      — poruke; `content` je CEO niz content blokova iz
--                         Anthropic API-ja (tekst, tool_use, tool_result,
--                         thinking), ne samo tekst — razgovor se nastavlja
--                         append-only, bez prepravljanja ranijih poruka.
--
-- Pristup: istorija je LIČNA (svako vidi samo svoje razgovore) i samo za
-- Admina i Menadžera — asistent vidi zaradu, pa po zaključanoj odluci
-- Logistika ne sme. Logistika nema nijednu politiku (deny-by-default).
--
-- Poruke se ne menjaju posle upisa (nema update politike); brišu se samo
-- kaskadno sa razgovorom (FK cascade ne proverava RLS).
--
-- Novac: `cost_micro_usd` je bigint (milioniti deo dolara) — bez float tipova
-- u finansijama (CLAUDE.md §5).
--
-- Ne dira: zamrznute cene (order_items), finansije, RLS postojećih tabela.
-- ============================================================================

-- ── 1. ai_conversations ─────────────────────────────────────────────────────
create table public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Nov razgovor',
  model       text not null,                  -- poslednji izabran model (prikaz)
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc);

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

comment on table public.ai_conversations is
  'Razgovori sa AI asistentom. Lični — RLS pušta samo vlasnika (Admin/Menadžer).';

-- ── 2. ai_messages ──────────────────────────────────────────────────────────
create table public.ai_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.ai_conversations (id) on delete cascade,
  role              text not null check (role in ('user', 'assistant')),
  content           jsonb not null,           -- niz Anthropic content blokova
  model             text,                     -- model koji je odgovorio (null za user)
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_micro_usd    bigint not null default 0,
  created_at        timestamptz not null default now()
);

create index ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);

-- Mesečna potrošnja (A5) gleda poruke po vremenu.
create index ai_messages_created_idx on public.ai_messages (created_at);

comment on column public.ai_messages.content is
  'Ceo niz content blokova (Anthropic API) — tekst, tool_use, tool_result, thinking. Ne menja se posle upisa.';
comment on column public.ai_messages.cost_micro_usd is
  'Cena poruke u milionitim delovima USD (integer, bez float-a).';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Svaki poziv je omotan u (select …) — K3 pravilo (initplan), inače
-- `npm run rls:static` pada.
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;

create policy "ai_conversations_own" on public.ai_conversations
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.current_app_role()) in ('admin', 'manager')
  )
  with check (
    user_id = (select auth.uid())
    and (select public.current_app_role()) in ('admin', 'manager')
  );

create policy "ai_messages_select_own" on public.ai_messages
  for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'manager')
    and exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

create policy "ai_messages_insert_own" on public.ai_messages
  for insert to authenticated
  with check (
    (select public.current_app_role()) in ('admin', 'manager')
    and exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

-- UNDO (ručno, ako zatreba):
-- drop table public.ai_messages;
-- drop table public.ai_conversations;
