-- ============================================================================
-- Uplate: način naplate zarade (faktura / keš) + porez (17.11.2026)
--
-- Za svaku NEfakturisanu uplatu Admin bira:
--   * settlement  — 'faktura' (podrazumevano; ide na fakturu drugu) ili 'kes'
--                   (drug zaradu iz te uplate daje u kešu → uplata IZLAZI iz
--                   „Za fakturisanje" i ne može na fakturu).
--   * tax_rate_bp — stopa poreza koji se ODUZIMA od zarade, u baznim poenima
--                   (1000 = 10 %, 1250 = 12,5 %). Integer — bez float-a (§5).
--   * cash_received_at — kad je keš stvarno primljen (NULL = još se duguje).
--
-- Porez = round(zarada × tax_rate_bp / 10000), neto = zarada − porez. Računa
-- se u app-u (db/finance.ts → taxOf). Zarada je i dalje isključivo iz zamrznutih
-- order_items (order_profit view) — ova migracija ne dira snapshot, order_items,
-- invoices.total_amount ni RLS (postojeće payouts politike pokrivaju nove kolone:
-- Admin piše, Admin+Menadžer čitaju, Logistika ništa).
-- ============================================================================

alter table public.payouts
  add column settlement text not null default 'faktura'
    check (settlement in ('faktura', 'kes')),
  add column tax_rate_bp int not null default 0
    check (tax_rate_bp between 0 and 10000),
  add column cash_received_at timestamptz;

comment on column public.payouts.settlement is
  'Način naplate zarade iz uplate: faktura (ide na fakturu drugu) ili kes (van fakture).';
comment on column public.payouts.tax_rate_bp is
  'Stopa poreza koji se oduzima od zarade, u baznim poenima (1000 = 10 %).';
comment on column public.payouts.cash_received_at is
  'Kad je keš za uplatu sa settlement=kes primljen (NULL = još se duguje).';

-- UNDO:
-- alter table public.payouts
--   drop column cash_received_at,
--   drop column tax_rate_bp,
--   drop column settlement;
