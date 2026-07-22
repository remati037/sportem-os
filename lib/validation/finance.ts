import { z } from "zod";

import { uuid } from "./uuid";

/*
 * Zod šeme za finansije (Korak 1.6). Iznosi su ceo broj RSD (bez decimala,
 * bez float-a). Id polja idu kroz labavi `uuid()` (v. uuid.ts).
 */

/** „YYYY-MM-DD" datum. */
const isoDate = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Neispravan ${label}.`);

/** Opciona napomena — prazan string → null. */
const optionalNote = z
  .string()
  .trim()
  .max(500, "Napomena je predugačka.")
  .optional()
  .transform((v) => (v ? v : null));

/* ── Uplate (payouts) — 1.6a ─────────────────────────────────────────────── */

export const createPayoutSchema = z.object({
  amount: z.coerce
    .number({ message: "Unesite iznos." })
    .int("Iznos mora biti ceo broj (RSD).")
    .min(0, "Iznos ne može biti negativan."),
  payout_date: isoDate("datum uplate"),
  // Ako se izostavi, server izvede T−1 radni dan iz payout_date.
  delivery_date: z
    .union([z.literal(""), isoDate("datum isporuke")])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optionalNote,
  // Sme prazno (uplata bez vezanih porudžbina — samo evidencija iznosa).
  order_ids: z.array(uuid("Neispravna porudžbina.")).max(500, "Previše porudžbina."),
});

export const updatePayoutSchema = createPayoutSchema.extend({
  id: uuid("Neispravna uplata."),
});

/* ── Fakture (invoices) — 1.6b ───────────────────────────────────────────── */

export const issueInvoiceSchema = z.object({
  // Ručni unos broja (jedinstvenost čuva invoice_number UNIQUE u bazi).
  invoice_number: z
    .string()
    .trim()
    .min(1, "Unesite broj fakture.")
    .max(100, "Broj fakture je predugačak."),
  // Jedan datum fakture (default danas); puni obe period kolone u bazi.
  invoice_date: isoDate("datum fakture"),
  // Bar jedna uplata — faktura se sklapa od uplata (ne pojedinačnih porudžbina).
  payout_ids: z
    .array(uuid("Neispravna uplata."))
    .min(1, "Izaberite bar jednu uplatu.")
    .max(1000, "Previše uplata."),
});

export const markInvoicePaidSchema = z.object({
  id: uuid("Neispravna faktura."),
});

/* ── Poštarina (settlements) — 1.6c ──────────────────────────────────────── */

export const settlePostageSchema = z.object({
  // Saldo poštarine može biti negativan (Sportem naplatio manje nego što košta) —
  // zato BEZ .min(0); poravnanje ide sa predznakom.
  amount: z.coerce
    .number({ message: "Unesite iznos." })
    .int("Iznos mora biti ceo broj (RSD)."),
  notes: optionalNote,
});

/* ── XExpress fakture poštarine ──────────────────────────────────────────── */

/** Opcion datum „YYYY-MM-DD" — prazan string → null. */
const optionalIsoDate = (label: string) =>
  z
    .union([z.literal(""), isoDate(label)])
    .optional()
    .transform((v) => (v ? v : null));

/** Osnovica poštarine (bez PDV-a) po porudžbini — ceo broj RSD, ≥ 0. */
const nonNegInt = z.coerce
  .number({ message: "Unesite iznos." })
  .int("Iznos mora biti ceo broj (RSD).")
  .min(0, "Iznos ne može biti negativan.");

export const xexpressInvoiceSchema = z.object({
  // Broj XExpress fakture je opcion (jedinstvenost čuva parcijalni UNIQUE indeks).
  invoice_number: z
    .string()
    .trim()
    .max(100, "Broj fakture je predugačak.")
    .optional()
    .transform((v) => (v ? v : null)),
  invoice_date: isoDate("datum fakture"),
  period_from: optionalIsoDate("period od"),
  period_to: optionalIsoDate("period do"),
  notes: optionalNote,
  // Bar jedna porudžbina sa unetom naplaćenom + osnovicom stvarne poštarine.
  orders: z
    .array(
      z.object({
        order_id: uuid("Neispravna porudžbina."),
        shipping_charged: nonNegInt,
        shipping_actual: nonNegInt,
      }),
    )
    .min(1, "Izaberite bar jednu porudžbinu.")
    .max(1000, "Previše porudžbina."),
});

export const updateXexpressInvoiceSchema = xexpressInvoiceSchema.extend({
  id: uuid("Neispravna faktura."),
});
