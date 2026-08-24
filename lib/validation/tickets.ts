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

/* ── Tiketi (Korak T2) ──────────────────────────────────────────────────── */

/**
 * Opciona veza iz FormData: prazno / „none" → `null`, inače UUID.
 * (Select komponenta ne sme da ima prazan `value`, pa se „ništa" šalje kao „none".)
 */
const optionalLink = (msg: string) =>
  z
    .union([z.literal(""), z.literal("none"), uuid(msg)])
    .optional()
    .transform((v) => (v === "" || v === "none" || v === undefined ? null : v));

/** Opciono tekstualno polje: prazno → `null`. */
const optionalText = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .optional()
    .transform((v) => (v ? v : null));

/** Rok — samo datum („YYYY-MM-DD"), prazno → bez roka. */
const optionalDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Rok mora biti datum.")])
  .optional()
  .transform((v) => (v ? v : null));

/** Procena vremena u minutima — prazno → bez procene. */
const optionalMinutes = z
  .union([
    z.literal(""),
    z.coerce
      .number({ message: "Procena mora biti broj minuta." })
      .int("Procena mora biti ceo broj minuta.")
      .min(1, "Procena mora biti najmanje 1 minut.")
      .max(100000, "Procena je prevelika."),
  ])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** Lista id-jeva iz `formData.getAll(...)` — duplikati se sklanjaju. */
const idList = (msg: string) =>
  z
    .array(uuid(msg))
    .optional()
    .transform((v) => [...new Set(v ?? [])]);

export const ticketSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Unesite naslov tiketa.")
    .max(160, "Naslov je predugačak (max 160 znakova)."),
  description: optionalText(4000, "Opis je predugačak (max 4000 znakova)."),
  column_id: uuid("Izaberite kolonu."),
  priority_id: optionalLink("Neispravan prioritet."),
  due_date: optionalDate,
  estimate_minutes: optionalMinutes,
  blocked_by_ticket_id: optionalLink("Neispravan tiket."),
  order_id: optionalLink("Neispravna porudžbina."),
  variant_id: optionalLink("Neispravan artikal."),
  customer_id: optionalLink("Neispravan kupac."),
  assignee_ids: idList("Neispravan izvršilac."),
  tag_ids: idList("Neispravan tag."),
});

export type TicketInput = z.infer<typeof ticketSchema>;

export const updateTicketSchema = ticketSchema.extend({
  id: uuid("Neispravan tiket."),
});

/**
 * Sused pri premeštanju (Korak T3): `null` / prazno = nema ga (vrh ili dno
 * kolone). Server iz suseda sam računa `position` — klijentskoj poziciji se
 * ne veruje.
 */
const neighborId = z
  .union([z.literal(""), z.null(), uuid("Neispravan sused.")])
  .optional()
  .transform((v) => (v ? v : null));

/**
 * Premeštanje tiketa: ciljna kolona + susedi na mestu ispuštanja.
 * Bez suseda (meni „⋮" ili prazna kolona) tiket ide na dno kolone.
 */
export const moveTicketSchema = z.object({
  id: uuid("Neispravan tiket."),
  column_id: uuid("Izaberite kolonu."),
  before_id: neighborId,
  after_id: neighborId,
});

/** Dodela izvršilaca (zamena kompletne liste). */
export const setAssigneesSchema = z.object({
  id: uuid("Neispravan tiket."),
  assignee_ids: idList("Neispravan izvršilac."),
});

/** Tagovi tiketa (zamena kompletne liste). */
export const setTagsSchema = z.object({
  id: uuid("Neispravan tiket."),
  tag_ids: idList("Neispravan tag."),
});

/** Brisanje tiketa. */
export const ticketIdSchema = z.object({
  id: uuid("Neispravan tiket."),
});
