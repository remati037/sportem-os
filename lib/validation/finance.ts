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
