import { z } from "zod";

import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./catalog";
import { isUuid, uuid } from "./uuid";

/*
 * Zod šeme za troškove (Korak 1.7). Iznos je ceo broj RSD (bez decimala, bez
 * float-a). Troškovi ulaze u neto profit, nikad u fakturu. Prilog (račun/PDF)
 * se validira zasebno u server akciji (v. ACCEPTED_ATTACHMENT_TYPES).
 */

/** „YYYY-MM-DD" datum. */
const isoDate = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Neispravan ${label}.`);

/** Opcioni opis — prazan string → null. */
const optionalDescription = z
  .string()
  .trim()
  .max(500, "Opis je predugačak.")
  .optional()
  .transform((v) => (v ? v : null));

/** Sentinel „bez kategorije" → null; inače validan uuid. */
const optionalCategoryId = z
  .string()
  .transform((v) => (v === "" || v === "none" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || isUuid(v), { message: "Neispravna kategorija." });

/* ── Trošak ──────────────────────────────────────────────────────────────── */

export const expenseSchema = z.object({
  amount: z.coerce
    .number({ message: "Unesite iznos." })
    .int("Iznos mora biti ceo broj (RSD).")
    .min(0, "Iznos ne može biti negativan."),
  date: isoDate("datum"),
  category_id: optionalCategoryId,
  description: optionalDescription,
});

export const updateExpenseSchema = expenseSchema.extend({
  id: uuid("Neispravan trošak."),
});

/* ── Prilog (validira se u server akciji) ────────────────────────────────── */

export const ACCEPTED_ATTACHMENT_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"];
export const MAX_ATTACHMENT_BYTES = MAX_IMAGE_BYTES; // 5 MiB

/* ── Kategorije troškova ─────────────────────────────────────────────────── */

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1, "Unesite naziv kategorije.").max(80, "Naziv je predugačak."),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const updateExpenseCategorySchema = expenseCategorySchema.extend({
  id: uuid("Neispravna kategorija."),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
