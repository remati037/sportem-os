/*
 * Oznake kupca (Korak C3) — FIKSNA lista (odluka korisnika 18.10.2026).
 * Ista lista stoji u CHECK-u migracije `20261019120000_kupci_beleske.sql`;
 * nova oznaka = migracija + stavka ovde. Bez `server-only` — koristi i klijent.
 */

export const CUSTOMER_FLAGS = [
  { value: "stalni", label: "Stalni kupac", variant: "success" },
  { value: "veleprodaja", label: "Veleprodaja", variant: "info" },
  { value: "zvati", label: "Pazi — zvati pre slanja", variant: "warning" },
] as const;

export type CustomerFlag = (typeof CUSTOMER_FLAGS)[number]["value"];

export const CUSTOMER_FLAG_VALUES = CUSTOMER_FLAGS.map((f) => f.value) as [
  CustomerFlag,
  ...CustomerFlag[],
];

/** Oznaka koja se vidi i na listi porudžbina (tamo se biraju porudžbine za slanje). */
export const CALL_FIRST_FLAG: CustomerFlag = "zvati";

export function customerFlagMeta(flag: CustomerFlag) {
  return CUSTOMER_FLAGS.find((f) => f.value === flag)!;
}

/** Najduža beleška (isti limit kao CHECK u migraciji). */
export const CUSTOMER_NOTE_MAX = 2000;
