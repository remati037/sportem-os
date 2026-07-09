-- ============================================================================
-- Korak 1.6 — Finansije: ledger poravnanja poštarine + view zarade po porudžbini
--
-- Sve ostale finance tabele (invoices, payouts, expenses) i finance kolone na
-- orders postoje od 0.4. Ovde se dodaje SAMO ono što nedostaje:
--   1. postage_settlements — append-only ledger „poravnato keš" (saldo poštarine)
--   2. order_profit — view Σ profit_at_sale po porudžbini (faktura / drug duguje / neto)
--
-- Snapshot cene se NE diraju; view samo čita zamrznute order_items.
-- ============================================================================

-- ── 1. postage_settlements ──────────────────────────────────────────────────
-- Saldo poštarine (naplaćeno − stvarno) je PROLAZNA stavka, van fakture. Kad se
-- poravna keš, upisuje se red sa iznosom poravnanja (predznak +/−) i snapshotom
-- salda u tom trenutku. Append-only (nema updated_at) — mirror order_status_history.
create table public.postage_settlements (
  id             uuid primary key default gen_random_uuid(),
  amount         int  not null,                 -- iznos poravnanja u RSD (predznak +/−)
  settled_at     date not null default current_date,
  balance_before int,                           -- saldo u trenutku poravnanja (istorija)
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index postage_settlements_settled_at_idx on public.postage_settlements (settled_at);

comment on table public.postage_settlements is
  'Poravnanja salda poštarine (keš predat/primljen, VAN fakture). Append-only ledger.';
comment on column public.postage_settlements.amount is
  'Iznos poravnanja RSD, predznak: + = drug doneo keš Sportemu, − = Sportem dodao drugu.';
comment on column public.postage_settlements.balance_before is
  'Snapshot salda poštarine u trenutku poravnanja (za istoriju, bez rekompjutovanja).';

-- ── 2. view order_profit ────────────────────────────────────────────────────
-- Σ zamrznute zarade po porudžbini. security_invoker = true → poštuje RLS
-- pozivaoca (Logistika i dalje ne vidi ništa jer nema SELECT na order_items).
-- profit je null za porudžbinu sa bar jednom needs_vp stavkom (null u sumi).
create view public.order_profit
  with (security_invoker = true) as
  select order_id, sum(profit_at_sale) as profit
  from public.order_items
  group by order_id;

comment on view public.order_profit is
  'Σ profit_at_sale po porudžbini (zamrznuta zarada). Null ako neka stavka nema VP.';

revoke all on public.order_profit from anon;
grant select on public.order_profit to authenticated;

-- ── RLS na postage_settlements (obrazac iz 20260708172800_rls_policies.sql) ──
alter table public.postage_settlements enable row level security;

-- select: Admin + Menadžer (finansije); Logistika ❌
create policy "postage_settlements_select" on public.postage_settlements
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

-- write: samo Admin (dira novac)
create policy "postage_settlements_admin_write" on public.postage_settlements
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
