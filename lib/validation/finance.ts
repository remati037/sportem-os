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
  // Naplaćena poštarina upisana u samom dijalogu (samo promenjene, samo izabrane).
  shipping: z
    .array(
      z.object({
        order_id: uuid("Neispravna porudžbina."),
        shipping_charged: z.coerce
          .number({ message: "Unesite poštarinu." })
          .int("Poštarina mora biti ceo broj (RSD).")
          .min(0, "Poštarina ne može biti negativna."),
      }),
    )
    .max(500, "Previše porudžbina.")
    .optional()
    .default([]),
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

/**
 * Stopa poreza kao procenat („10", „12,5", „12.5") → bazni poeni (1250). Prazno = 0.
 * String parsiranje — bez float aritmetike (§5).
 */
const taxPercentToBp = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const raw = String(v).trim().replace(",", ".");
    if (raw === "") return 0;
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Porez: unesite procenat (npr. 10 ili 12,5)." });
      return z.NEVER;
    }
    const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
    if (bp > 10000) {
      ctx.addIssue({ code: "custom", message: "Porez ne može biti veći od 100 %." });
      return z.NEVER;
    }
    return bp;
  });

export const setPayoutSettlementSchema = z.object({
  payout_id: uuid("Neispravna uplata."),
  settlement: z.enum(["faktura", "kes"], { message: "Izaberite način: faktura ili keš." }),
  tax_percent: taxPercentToBp,
});

export const setCashReceivedSchema = z.object({
  payout_id: uuid("Neispravna uplata."),
  received: z.boolean(),
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
