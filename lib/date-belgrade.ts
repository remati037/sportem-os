/**
 * Belgrade (Europe/Belgrade) datum helperi za finansije (Korak 1.6).
 *
 * Konzistentno sa lib/format.ts — sve kroz `Intl` + `timeZone: "Europe/Belgrade"`,
 * bez `date-fns-tz` (v. plan). Radimo nad KALENDARSKIM datumima (YYYY-MM-DD):
 * uplata (T+1) i predlog porudžbina se vezuju za dan isporuke, ne za tačan trenutak.
 */

const TZ = "Europe/Belgrade";

/** ISO timestamp → Belgrade kalendarski datum „YYYY-MM-DD" (DST-korektno preko Intl). */
export function belgradeDate(iso: string): string {
  // en-CA daje baš „YYYY-MM-DD".
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Danas u Beogradu kao „YYYY-MM-DD" (default za payout_date). */
export function todayBelgrade(): string {
  return belgradeDate(new Date().toISOString());
}

/**
 * Prethodni radni dan (pon–pet) pre `dateStr` — T−1 logika uplate
 * (uplata ponedeljak → isporučeno petak; utorak → ponedeljak; …).
 * Čista kalendarska matematika nad „YYYY-MM-DD"; računa se na T12:00:00Z da
 * pomeranje sata (DST) nikad ne prebaci na susedni dan.
 */
export function previousWorkingDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); // 0 = nedelja, 6 = subota
  return d.toISOString().slice(0, 10);
}
