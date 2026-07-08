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
