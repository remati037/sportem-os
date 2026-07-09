/**
 * Format brojeva i valute (docs/Sportem-Dizajn-Sistem.md, sekcija 7).
 *
 * Cene su uvek `integer` u RSD, bez decimala (12500 = 12.500 RSD) — vidi CLAUDE.md
 * sekcija 5. Prikaz iznosa i količina uvek kroz ove helpere, srpski locale.
 * U tabelama/statima koristiti `.num` klasu (tabularni brojevi) + desno poravnanje.
 */

/** Iznos u RSD → npr. rsd(12500) === "12.500 RSD" */
export const rsd = (n: number) =>
  new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency: "RSD",
    maximumFractionDigits: 0,
  }).format(n);

/** Običan broj/količina u srpskom formatu → npr. num(1500) === "1.500" */
export const num = (n: number) => new Intl.NumberFormat("sr-RS").format(n);

/* Datumi uvek u Europe/Belgrade (CLAUDE.md 5), bez obzira na server TZ. */

/** Datum → „9. 7. 2026." */
export const datum = (iso: string) =>
  new Intl.DateTimeFormat("sr-RS", { dateStyle: "short", timeZone: "Europe/Belgrade" }).format(
    new Date(iso),
  );

/** Datum i vreme → „9. 7. 2026. 14:30" */
export const datumVreme = (iso: string) =>
  new Intl.DateTimeFormat("sr-RS", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Belgrade",
  }).format(new Date(iso));
