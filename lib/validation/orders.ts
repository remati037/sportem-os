import { z } from "zod";

/*
 * Zod šeme za edit stavki porudžbine (Korak 1.2). Sve izmene diraju SAMO
 * zamrznute vrednosti konkretne stavke — katalog se nikad ne menja odavde.
 */

const uuid = (msg: string) => z.string().uuid(msg);

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
