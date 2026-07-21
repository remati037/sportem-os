-- ============================================================================
-- XExpress fakture poštarine — rekonsilijacija (zarada/gubitak na poštarini)
--
-- XExpress šalje fakturu ~svakih 10 dana: zbir STVARNIH poštarina po pošiljci
-- (specifikacija) + 20% PDV, i to Sportem plaća. Kupcima se naplaćuje sam
-- određena poštarina (orders.shipping_charged). Ova tabela grupiše porudžbine
-- pod jednu XExpress fakturu; stvarna poštarina (osnovica, bez PDV-a) se upisuje
-- u postojeći orders.shipping_actual, a faktura ih vezuje kroz FK.
--
-- Poštarina ostaje PROLAZNA stavka (NIJE profit) — ne dira order_items, snapshot
-- cene ni neto profit. RLS obrazac iz postage_settlements (20260710120000).
-- ============================================================================

create table public.xexpress_invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text,                              -- broj XExpress fakture (opciono)
  invoice_date   date not null default current_date,
  period_from    date,                              -- period specifikacije (od)
  period_to      date,                              -- period specifikacije (do)
  vat_rate       int  not null default 20,          -- PDV %, snapshot (za buduće izmene stope)
  notes          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Jedinstven broj fakture kad je unet (dozvoli više NULL — broj je opcion).
create unique index xexpress_invoices_number_uniq
  on public.xexpress_invoices (invoice_number)
  where invoice_number is not null;

create trigger xexpress_invoices_set_updated_at
  before update on public.xexpress_invoices
  for each row execute function public.set_updated_at();

comment on table public.xexpress_invoices is
  'XExpress fakture poštarine (grupa porudžbina po specifikaciji). Prolazna stavka, van profita.';
comment on column public.xexpress_invoices.vat_rate is
  'PDV % (default 20) — snapshot za slučaj izmene stope.';

-- Veza porudžbine → XExpress faktura. SET NULL: brisanje fakture ne briše
-- porudžbine (akcija dodatno čisti shipping_actual eksplicitno).
alter table public.orders
  add column xexpress_invoice_id uuid
  references public.xexpress_invoices (id) on delete set null;
create index orders_xexpress_invoice_id_idx on public.orders (xexpress_invoice_id);

comment on column public.orders.xexpress_invoice_id is
  'XExpress faktura poštarine kojoj porudžbina pripada (shipping_actual = osnovica te fakture).';

-- ── RLS (obrazac iz postage_settlements) ────────────────────────────────────
alter table public.xexpress_invoices enable row level security;

-- select: Admin + Menadžer (finansije); Logistika ❌
create policy "xexpress_invoices_select" on public.xexpress_invoices
  for select to authenticated
  using (public.current_app_role() in ('admin', 'manager'));

-- write: samo Admin (dira novac)
create policy "xexpress_invoices_admin_write" on public.xexpress_invoices
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
