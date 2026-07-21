import { z } from "zod";

import { uuid } from "./uuid";

/*
 * Zod šeme za edit stavki porudžbine (Korak 1.2). Sve izmene diraju SAMO
 * zamrznute vrednosti konkretne stavke — katalog se nikad ne menja odavde.
 */

/** Zamrznuta cena stavke: ceo broj RSD ≥ 0 (0 = poklon/gratis). */
const frozenPrice = (label: string) =>
  z.coerce
    .number({ message: `Unesite ${label}.` })
    .int(`${label} mora biti ceo broj (RSD).`)
    .min(0, `${label} ne može biti negativna.`);

export const updateItemPriceSchema = z.object({
  item_id: uuid("Neispravna stavka."),
  mp_at_sale: frozenPrice("MP cenu"),
});

export const updateItemQuantitySchema = z.object({
  item_id: uuid("Neispravna stavka."),
  quantity: z.coerce
    .number({ message: "Unesite količinu." })
    .int("Količina mora biti ceo broj.")
    .min(1, "Količina mora biti najmanje 1."),
});

export const setItemVpSchema = z.object({
  item_id: uuid("Neispravna stavka."),
  vp_at_sale: frozenPrice("VP cenu"),
});

export const addItemSchema = z.object({
  order_id: uuid("Neispravna porudžbina."),
  variant_id: uuid("Izaberite artikal iz kataloga."),
  quantity: z.coerce
    .number({ message: "Unesite količinu." })
    .int("Količina mora biti ceo broj.")
    .min(1, "Količina mora biti najmanje 1.")
    .default(1),
});

/* ── Promena statusa porudžbine (Korak 1.4) ─────────────────────────────── */

/** Opciona napomena uz promenu statusa — prazan string → null. */
const optionalNote = z
  .string()
  .trim()
  .max(500, "Napomena je predugačka.")
  .optional()
  .transform((v) => (v ? v : null));

export const changeOrderStatusSchema = z.object({
  order_id: uuid("Neispravna porudžbina."),
  status_id: uuid("Izaberite status."),
  note: optionalNote,
  // Admin „ipak vrati/otkaži" preko zaštite za plaćenu/fakturisanu porudžbinu.
  force: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export const markCashSaleSchema = z.object({
  order_id: uuid("Neispravna porudžbina."),
});

/* ── Logistika i slanje (Korak 1.5) ─────────────────────────────────────── */

/** Bulk „Označi poslato" — lista porudžbina za jedan potez slanja. */
export const markOrdersShippedSchema = z.object({
  order_ids: z
    .array(uuid("Neispravna porudžbina."))
    .min(1, "Izaberite bar jednu porudžbinu.")
    .max(200, "Najviše 200 porudžbina po potezu."),
});

/** Bulk promena statusa — lista porudžbina + ciljni status + opciona napomena. */
export const changeOrdersStatusSchema = z.object({
  order_ids: z
    .array(uuid("Neispravna porudžbina."))
    .min(1, "Izaberite bar jednu porudžbinu.")
    .max(200, "Najviše 200 porudžbina po potezu."),
  status_id: uuid("Izaberite status."),
  note: optionalNote,
});

/** Opcioni ceo broj ≥ 0 (RSD/grami/komadi); prazno → null. */
const optionalNonNegInt = (label: string) =>
  z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int(`${label} mora biti ceo broj.`)
        .min(0, `${label} ne može biti negativna.`),
    ])
    .transform((v) => (v === "" ? null : v));

/** Paket i poštarina (Korak 1.5) — prolazne stavke, ne diraju snapshot cene. */
export const updateShippingSchema = z.object({
  order_id: uuid("Neispravna porudžbina."),
  shipping_charged: optionalNonNegInt("Naplaćena poštarina"),
  shipping_actual: optionalNonNegInt("Stvarna poštarina"),
  weight_grams: optionalNonNegInt("Težina"),
  package_count: optionalNonNegInt("Broj paketa"),
});

/* ── Podešavanje statusa porudžbine (Korak 1.4, Admin) ──────────────────── */

export const orderStatusSchema = z.object({
  name: z.string().trim().min(1, "Unesite naziv statusa.").max(60, "Naziv je predugačak."),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Boja mora biti heks (npr. #1B7A45)."),
  sort_order: z.coerce
    .number({ message: "Unesite redosled." })
    .int("Redosled mora biti ceo broj.")
    .min(0, "Redosled ne može biti negativan."),
});

export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
