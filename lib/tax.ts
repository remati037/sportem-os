/*
 * Porez po mesecu (Dashboard „Posle poreza") — čista pravila, bez `server-only`
 * jer ih koriste i grafikoni na klijentu.
 *
 * Porez = zarada (MP − VP iz zamrznutih stavki) × stopa meseca u kom je
 * porudžbina KREIRANA. Keš porudžbine (`payment_status = 'kes'`) se ne
 * oporezuju. Stopa je u baznim poenima (2000 = 20 %), integer — bez float-a.
 *
 * Da se kartice i grafikon poklope do dinara, sabira se „brojilac"
 * (zarada × bp, integer) i deli/zaokružuje TEK na kraju (`taxFromNumer`).
 */

/** Keš porudžbina ulazi u zaradu pune vrednosti — bez poreza. */
export function isTaxExempt(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "kes";
}

/** „2026-11-18" → „2026-11". */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Brojilac poreza jedne porudžbine (zarada × bp). */
export function taxNumer(profit: number, rateBp: number): number {
  return rateBp > 0 ? profit * rateBp : 0;
}

/** Σ brojilaca → porez u RSD (zaokruženo, nikad negativan). */
export function taxFromNumer(numer: number): number {
  return numer > 0 ? Math.round(numer / 10000) : 0;
}

/** 2000 → „20 %", 1250 → „12,5 %". */
export function formatRateBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return `${whole} %`;
  return `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")} %`;
}

export type TaxRate = { month: string; rateBp: number }; // month = YYYY-MM
