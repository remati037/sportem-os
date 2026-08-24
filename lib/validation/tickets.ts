import { z } from "zod";

import { uuid } from "./uuid";

/*
 * Zod šeme za podešavanja modula Tiketi (Korak T1): kolone, prioriteti, tagovi.
 * Šeme za same tikete dolaze u T2. Sve poruke su na srpskom (jedinstven
 * error/toast obrazac, `firstZodError`).
 */

/** Heks boja (#RRGGBB) — isti oblik kao kod statusa porudžbine. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Boja mora biti heks (npr. #1B7A45).");

const sortOrder = z.coerce
  .number({ message: "Unesite redosled." })
  .int("Redosled mora biti ceo broj.")
  .min(0, "Redosled ne može biti negativan.");

/** Checkbox iz FormData: „on"/„true" → true; nedostaje → false. */
const checkbox = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const name = (label: string) =>
  z.string().trim().min(1, `Unesite ${label}.`).max(60, "Naziv je predugačak (max 60 znakova).");

/* ── Kolone board-a ─────────────────────────────────────────────────────── */

export const ticketColumnSchema = z.object({
  name: name("naziv kolone"),
  color: hexColor,
  sort_order: sortOrder,
  is_done: checkbox,
  // Prazno = bez limita. Soft limit: UI upozorava, ali ne blokira pomeranje.
  wip_limit: z
    .union([
      z.literal(""),
      z.coerce
        .number({ message: "WIP limit mora biti broj." })
        .int("WIP limit mora biti ceo broj.")
        .min(1, "WIP limit mora biti najmanje 1."),
    ])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export type TicketColumnInput = z.infer<typeof ticketColumnSchema>;

/* ── Prioriteti ─────────────────────────────────────────────────────────── */

export const ticketPrioritySchema = z.object({
  name: name("naziv prioriteta"),
  color: hexColor,
  level: z.coerce
    .number({ message: "Unesite nivo." })
    .int("Nivo mora biti ceo broj.")
    .min(1, "Nivo mora biti najmanje 1.")
    .max(99, "Nivo je prevelik."),
  is_default: checkbox,
  sort_order: sortOrder,
});

export type TicketPriorityInput = z.infer<typeof ticketPrioritySchema>;

/* ── Tagovi ─────────────────────────────────────────────────────────────── */

export const ticketTagSchema = z.object({
  name: name("naziv taga"),
  color: hexColor,
  sort_order: sortOrder,
});

export type TicketTagInput = z.infer<typeof ticketTagSchema>;

/** Arhiviranje/vraćanje taga — skloni iz izbora, ostaje na starim tiketima. */
export const archiveTicketTagSchema = z.object({
  id: uuid("Neispravan tag."),
  archived: checkbox,
});

/** Zajednička šema za brisanje config reda. */
export const ticketConfigIdSchema = z.object({
  id: uuid("Neispravan unos."),
});
