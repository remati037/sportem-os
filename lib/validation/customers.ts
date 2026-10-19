import { z } from "zod";

import { CUSTOMER_FLAG_VALUES, CUSTOMER_NOTE_MAX } from "@/lib/customers";

import { uuid } from "./uuid";

/*
 * Zod šeme za beleške i oznake kupca (Korak C3). Kupac se identifikuje
 * `customers.id`-jem (repId sa profila) — server sam razrešava grupu i ključ,
 * klijent ga nikad ne šalje.
 */

const noteBody = z
  .string()
  .trim()
  .min(1, "Upiši belešku.")
  .max(CUSTOMER_NOTE_MAX, `Beleška je predugačka (max ${CUSTOMER_NOTE_MAX} znakova).`);

export const addCustomerNoteSchema = z.object({
  customer_id: uuid("Nepoznat kupac."),
  body: noteBody,
});

export const editCustomerNoteSchema = z.object({
  id: uuid("Nepoznata beleška."),
  body: noteBody,
});

export const customerNoteIdSchema = z.object({
  id: uuid("Nepoznata beleška."),
});

export const setCustomerFlagsSchema = z.object({
  customer_id: uuid("Nepoznat kupac."),
  flags: z.array(z.enum(CUSTOMER_FLAG_VALUES, { message: "Nepoznata oznaka." })).max(10),
});
