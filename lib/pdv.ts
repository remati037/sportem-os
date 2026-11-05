/*
 * PDV prag (Zakon o PDV-u): obveznik postaje onaj čiji promet u PRETHODNIH 12
 * MESECI (klizno, ne kalendarska godina) pređe 8.000.000 RSD. Kartica na
 * Dashboardu prati koliko je Sportem blizu praga — za odluku o sopstvenoj
 * firmi (knjigaš van PDV-a). Iznosi su integer RSD (§5).
 *
 * Bez `server-only` — konstante koristi i prikaz.
 */

/** Zakonski prag prometa za obavezan ulazak u PDV (RSD, 12 meseci klizno). */
export const PDV_THRESHOLD_RSD = 8_000_000;

/** Interni prag upozorenja — vreme za smanjenje reklama / preusmeravanje porudžbina. */
export const PDV_WARN_RSD = 7_500_000;

/** Dužina kliznog prozora u danima (12 meseci). */
export const PDV_WINDOW_DAYS = 365;

export type PdvLevel = "ok" | "warn" | "over";

/** Nivo za prikaz: ispod upozorenja / između upozorenja i praga / preko praga. */
export function pdvLevel(amount: number): PdvLevel {
  if (amount >= PDV_THRESHOLD_RSD) return "over";
  if (amount >= PDV_WARN_RSD) return "warn";
  return "ok";
}

/** Datum `YYYY-MM-DD` pomeren za `days` kalendarskih dana (bez vremenskih zona — čist kalendar). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Broj kalendarskih dana od `from` do `to`, uključujući oba. */
export function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}
