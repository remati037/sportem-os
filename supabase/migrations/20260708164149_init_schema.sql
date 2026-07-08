-- ============================================================================
-- Sportem OS — prva migracija (Korak 0.4)
-- Kompletna šema: katalog, kupci, porudžbine (zamrznute cene), finansije,
-- troškovi, push. Sve cene su integer u RSD (bez decimala, bez float-a).
--
-- Konvencije:
--   • id uuid pk default gen_random_uuid()
--   • created_at/updated_at timestamptz; updated_at kroz trigger set_updated_at()
--   • generisane kolone za profit (STORED)
--   • soft delete kroz archived_at (products/product_variants)
--   • RLS uključen deny-by-default; politike dolaze u Koraku 0.5
-- ============================================================================

create extension if not exists pgcrypto;

-- ── zajednički trigger za updated_at ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. profiles — interni korisnici + role (redovi se pune u Koraku 0.5)
-- ============================================================================
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       text not null check (role in ('admin', 'manager', 'logistics')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. categories — kategorije proizvoda
-- ============================================================================
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 3. products — proizvod (roditelj)
-- ============================================================================
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  brand       text,
  image       text,                                  -- Supabase Storage path
  category_id uuid references public.categories (id) on delete set null,
  archived_at timestamptz,                           -- soft delete
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_category_id_idx on public.products (category_id);
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. product_variants — SKU, cene, stanje. profit = mp - vp (GENERATED)
-- ============================================================================
create table public.product_variants (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products (id) on delete restrict,
  sku                 text not null unique,
  variant_name        text,
  mp_price            int  not null,                 -- maloprodajna (RSD)
  vp_price            int  not null,                 -- veleprodajna (RSD)
  profit              int  generated always as (mp_price - vp_price) stored,
  stock_quantity      int  not null default 0,
  low_stock_threshold int  not null default 5,
  supplier_sku        text,
  weight_grams        int,
  image               text,
  archived_at         timestamptz,                   -- soft delete
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index product_variants_product_id_idx  on public.product_variants (product_id);
create index product_variants_supplier_sku_idx on public.product_variants (supplier_sku);
create index product_variants_active_idx       on public.product_variants (id) where archived_at is null;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 5. customers — kupci (dedup po telefonu)
-- ============================================================================
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  phone       text unique,                           -- dedup po telefonu
  email       text,
  address     text,                                  -- poslednja poznata adresa
  city        text,
  postal_code text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 6. order_statuses — podesiva lista statusa
-- ============================================================================
create table public.order_statuses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0,
  color      text,                                   -- hex boja (podesivo)
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. invoices — fakture drugu (nastaju tek kad se izdaju)
-- ============================================================================
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  period_from    date,
  period_to      date,
  total_amount   int,                                -- Σ profit_at_sale u trenutku izdavanja
  status         text not null default 'izdato' check (status in ('izdato', 'placeno')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 8. payouts — uplate druga (T+1 logika: delivery_date izvedeno u app-u)
-- ============================================================================
create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  amount        int  not null,
  payout_date   date not null,
  delivery_date date,                                -- T+1 izvedeno, čuva se
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 9. orders — porudžbine. Ulaze kroz WooCommerce webhook (upsert po woo_order_id)
-- ============================================================================
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  woo_order_id    bigint unique,                     -- idempotentnost webhooka
  customer_id     uuid references public.customers (id)      on delete set null,
  status_id       uuid not null references public.order_statuses (id) on delete restrict,
  invoice_id      uuid references public.invoices (id)       on delete set null,
  payout_id       uuid references public.payouts (id)        on delete set null,
  delivery_method text not null check (delivery_method in ('xexpress', 'licno')),
  payment_status  text not null default 'neuplaceno'
                    check (payment_status in ('neuplaceno', 'uplaceno', 'kes')),
  -- adresa snapshot (eksplicitne kolone — čitljivo za PDF listu za slanje)
  ship_name        text,
  ship_phone       text,
  ship_address     text,
  ship_city        text,
  ship_postal_code text,
  ship_note        text,
  -- iznosi (RSD)
  goods_total      int,
  shipping_charged int,
  shipping_actual  int,
  cod_amount       int,
  package_count    int,
  weight_grams     int,
  needs_vp         boolean not null default false,   -- flag: nepoznat SKU bez VP
  -- datumi životnog ciklusa
  ordered_at   timestamptz,
  shipped_at   timestamptz,
  delivered_at timestamptz,
  paid_at      timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index orders_customer_id_idx on public.orders (customer_id);
create index orders_status_id_idx   on public.orders (status_id);
create index orders_invoice_id_idx  on public.orders (invoice_id);
create index orders_payout_id_idx   on public.orders (payout_id);
create index orders_ordered_at_idx  on public.orders (ordered_at);
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 10. order_items — ZAMRZNUTE CENE (snapshot). Nikad ne čitaju iz kataloga.
--     profit_at_sale = (mp_at_sale - vp_at_sale) * quantity (GENERATED)
--     null dok nema vp_at_sale (nepoznat SKU) — aritmetika s null daje null.
-- ============================================================================
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  variant_id    uuid references public.product_variants (id) on delete set null,  -- nullable: nepoznat SKU
  sku           text not null,                       -- snapshot
  product_name  text not null,                       -- snapshot
  quantity      int  not null default 1,
  mp_at_sale    int  not null,                       -- zamrznuta MP (editabilno = popust)
  vp_at_sale    int,                                 -- zamrznuta VP (null dok nepoznat SKU)
  profit_at_sale int generated always as ((mp_at_sale - vp_at_sale) * quantity) stored,
  created_at    timestamptz not null default now()
);
create index order_items_order_id_idx   on public.order_items (order_id);
create index order_items_variant_id_idx on public.order_items (variant_id);
create index order_items_sku_idx        on public.order_items (sku);

-- ============================================================================
-- 11. expense_categories — kategorije troškova
-- ============================================================================
create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 12. expenses — troškovi (ne diraju fakturu)
-- ============================================================================
create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  amount          int  not null,
  date            date not null,
  category_id     uuid references public.expense_categories (id) on delete set null,
  description     text,
  attachment_path text,                              -- Supabase Storage path
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index expenses_date_idx        on public.expenses (date);
create index expenses_category_id_idx on public.expenses (category_id);
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 13. push_subscriptions — Web Push pretplate po uređaju
-- ============================================================================
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);
create unique index push_subscriptions_user_endpoint_idx
  on public.push_subscriptions (user_id, (subscription ->> 'endpoint'));

-- ============================================================================
-- 14. notification_log — sprečava duplirane notifikacije
-- ============================================================================
create table public.notification_log (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  reference_id text,
  sent_at      timestamptz not null default now()
);
create unique index notification_log_type_reference_idx
  on public.notification_log (type, reference_id);

-- ============================================================================
-- RLS — uključeno deny-by-default na svim tabelama.
-- Politike po roli + restriktovani view za logistiku dolaze u Koraku 0.5.
-- Service role (seed, webhook, cron) zaobilazi RLS.
-- ============================================================================
alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.product_variants   enable row level security;
alter table public.customers          enable row level security;
alter table public.order_statuses     enable row level security;
alter table public.invoices           enable row level security;
alter table public.payouts            enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security;
