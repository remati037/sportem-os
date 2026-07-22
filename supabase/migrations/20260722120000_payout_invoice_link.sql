-- ============================================================================
-- Fakturisanje po uplatama — veza uplata → faktura
--
-- Fakturisanje drugu se pojednostavljuje: umesto biranja pojedinačnih porudžbina,
-- faktura se sklapa od UPLATA (payouts). „Za fakturisanje" = Σ zarade uplata koje
-- još nisu ni na jednoj fakturi.
--
-- Model: jedna faktura sadrži više uplata (payouts.invoice_id); svaka uplata
-- sadrži porudžbine (orders.payout_id). Pri izdavanju fakture akcija dodatno
-- kaskadno postavlja orders.invoice_id (za sve porudžbine tih uplata) — čime
-- ostaje netaknuta postojeća mašinerija (getInvoiceDetail, zaključavanje stavki,
-- ISTORIJA-BACKFILL isključenje). Ne dira snapshot cene ni order_items.
--
-- SET NULL: brisanje fakture ne briše uplatu (akcija dodatno nulira invoice_id
-- i na uplatama i na porudžbinama, vraćajući ih u kandidate).
-- ============================================================================

alter table public.payouts
  add column invoice_id uuid
  references public.invoices (id) on delete set null;

create index payouts_invoice_id_idx on public.payouts (invoice_id);

comment on column public.payouts.invoice_id is
  'Faktura drugu na kojoj se ova uplata nalazi (NULL = nefakturisana, kandidat za fakturu).';
