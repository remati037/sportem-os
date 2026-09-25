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

/**
 * Pomeraj Europe/Belgrade u odnosu na UTC (ms) u datom trenutku (CET +1h / CEST +2h).
 * Računa se tako što se isti trenutak formatira u beogradskoj zoni i pročita
 * kao da je UTC — razlika je pomeraj (DST-korektno, bez tabele prelaza).
 */
function belgradeOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // „24" umesto „00" kod ponoći u nekim runtime-ovima
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * Lokalno beogradsko vreme „YYYY-MM-DD HH:MM:SS" (format koji šalje WordPress
 * plugin) → ISO UTC. Nevalidan ulaz → null.
 *
 * Pomeraj se prvo proceni nad naivnim trenutkom, pa proveri nad izračunatim —
 * drugi prolaz hvata satove oko prelaska na letnje/zimsko računanje.
 */
export function belgradeLocalToUtc(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;

  const [, y, mo, d, hh, mi, ss] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +hh, +mi, ss ? +ss : 0);
  if (Number.isNaN(naive)) return null;

  let ts = naive - belgradeOffsetMs(new Date(naive));
  const refined = naive - belgradeOffsetMs(new Date(ts));
  if (refined !== ts) ts = refined;

  return new Date(ts).toISOString();
}
