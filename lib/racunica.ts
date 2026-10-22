/*
 * Računica — isplativost artikala (P1, docs/Sportem-Plan-Racunica.md §1).
 * Tipovi + čiste funkcije, BEZ `server-only`: UI ih koristi za kolone, sortiranje,
 * filtere i CSV; server (db/racunica.ts) puni redove.
 *
 * Dve osnove marže, jedna pored druge:
 *   - „Katalog" = TRENUTNA `mp_price − vp_price` (nikad ne ulazi u zbir zarade);
 *   - „Stvarno" = zamrznuti `order_items` u periodu (CLAUDE.md §4).
 * Marža % je uvek OD MP: (MP − VP) / MP — ista formula kao Dashboard.
 * Stvarna marža % broji SAMO stavke sa poznatim VP (stavka bez VP bi je lažno
 * spustila); zarada u RSD broji `profit ?? 0`, kao Dashboard (0 RSD razlike).
 */

/** Zbir prodaje za varijantu ili proizvod (samo realizovane, osim `cancelledQty`). */
export type SalesStats = {
  qty: number; // komadi, bez Otkazano/Vraćeno
  revenue: number; // Σ mp_at_sale × kol
  profit: number; // Σ profit_at_sale (null → 0)
  knownQty: number; // komadi sa poznatim VP
  knownRevenue: number; // promet stavki sa poznatim VP
  knownProfit: number;
  cancelledQty: number; // komadi u otkazanim/vraćenim porudžbinama
  catalogRevenue: number; // Σ kol × TRENUTNA MP (samo varijante iz kataloga) — za popust
  pricedRevenue: number; // promet tih istih stavki
};

export const emptyStats = (): SalesStats => ({
  qty: 0,
  revenue: 0,
  profit: 0,
  knownQty: 0,
  knownRevenue: 0,
  knownProfit: 0,
  cancelledQty: 0,
  catalogRevenue: 0,
  pricedRevenue: 0,
});

export function addStats(into: SalesStats, s: SalesStats): void {
  into.qty += s.qty;
  into.revenue += s.revenue;
  into.profit += s.profit;
  into.knownQty += s.knownQty;
  into.knownRevenue += s.knownRevenue;
  into.knownProfit += s.knownProfit;
  into.cancelledQty += s.cancelledQty;
  into.catalogRevenue += s.catalogRevenue;
  into.pricedRevenue += s.pricedRevenue;
}

export type RacunicaVariant = {
  sku: string;
  variantId: string | null; // null = SKU van kataloga
  label: string; // naziv varijante (ili snapshot naziv za van kataloga)
  mp: number | null;
  vp: number | null;
  stock: number | null;
  counted: boolean; // stanje popisano (stock_counted_at)
  archived: boolean;
  stats: SalesStats;
};

export type RacunicaRow = {
  key: string; // productId ili OUT_OF_CATALOG_KEY
  productId: string | null;
  name: string;
  brand: string | null;
  categoryId: string | null;
  categoryName: string | null;
  archived: boolean;
  outOfCatalog: boolean;
  variants: RacunicaVariant[];
  stats: SalesStats;
  /** Raspon trenutnih cena aktivnih varijanti (sve, ako nijedna nije aktivna). */
  mpMin: number | null;
  mpMax: number | null;
  vpMin: number | null;
  vpMax: number | null;
  catalogProfitMin: number | null;
  catalogProfitMax: number | null;
  /** Σ(MP − VP) / ΣMP tih varijanti, u procentima. */
  catalogMarginPct: number | null;
  stock: number; // Σ stanja aktivnih varijanti
  uncounted: number; // aktivne varijante bez popisa
  stockValueVp: number; // Σ popisano stanje > 0 × VP
};

export type RacunicaTotals = {
  qty: number;
  revenue: number;
  profit: number;
  knownRevenue: number;
  knownProfit: number;
  unknownQty: number;
  cancelledQty: number;
  stockValueVp: number;
};

export type RacunicaData = {
  from: string;
  to: string;
  rows: RacunicaRow[];
  totals: RacunicaTotals;
  categories: { id: string; name: string }[];
  brands: string[];
};

export const OUT_OF_CATALOG_KEY = "van-kataloga";
export const DEFAULT_TARGET_PCT = 30;

/* ---------- izvedene vrednosti (procenti su u procentima, npr. 32.5) ---------- */

export function marginPct(profit: number, revenue: number): number | null {
  return revenue > 0 ? (profit / revenue) * 100 : null;
}

export function catalogMarginOf(mp: number | null, vp: number | null): number | null {
  return mp != null && vp != null ? marginPct(mp - vp, mp) : null;
}

/** Stvarna marža % — samo stavke sa poznatim VP. */
export const realMarginPct = (s: SalesStats) => marginPct(s.knownProfit, s.knownRevenue);

export const avgPrice = (s: SalesStats) => (s.qty > 0 ? s.revenue / s.qty : null);

export const profitPerUnit = (s: SalesStats) => (s.knownQty > 0 ? s.knownProfit / s.knownQty : null);

/** Koliko se prosečno prodaje ispod TRENUTNE kataloške MP (negativno = iznad). */
export const discountPct = (s: SalesStats) =>
  s.catalogRevenue > 0 ? (1 - s.pricedRevenue / s.catalogRevenue) * 100 : null;

/** Udeo otkazanih/vraćenih komada u svim naručenim. */
export const cancelRatePct = (s: SalesStats) =>
  s.qty + s.cancelledQty > 0 ? (s.cancelledQty / (s.qty + s.cancelledQty)) * 100 : null;

/** Marža za proveru cilja: stvarna kad ima prodaje sa VP, inače kataloška. */
export function effectiveMarginPct(row: RacunicaRow): number | null {
  return realMarginPct(row.stats) ?? row.catalogMarginPct;
}

export const hasActivity = (s: SalesStats) => s.qty > 0 || s.cancelledQty > 0;

/* ---------- sortiranje ---------- */

export const RACUNICA_SORTS = [
  { key: "zarada", label: "Stvarna zarada" },
  { key: "marza", label: "Stvarna marža %" },
  { key: "katalog", label: "Katalog marža %" },
  { key: "promet", label: "Promet" },
  { key: "prodato", label: "Prodato (kom)" },
  { key: "po_komadu", label: "Zarada po komadu" },
  { key: "popust", label: "Popust vs katalog" },
  { key: "otkazano", label: "Otkazano %" },
  { key: "stanje", label: "Stanje" },
  { key: "vezano", label: "Stanje po VP" },
  { key: "naziv", label: "Naziv" },
] as const;

export type RacunicaSort = (typeof RACUNICA_SORTS)[number]["key"];

export const DEFAULT_SORT: RacunicaSort = "zarada";

export function isRacunicaSort(v: string | null | undefined): v is RacunicaSort {
  return RACUNICA_SORTS.some((s) => s.key === v);
}

/** Vrednost reda za sortiranje; `null` (nema podatka) uvek ide na kraj. */
export function sortValue(row: RacunicaRow, key: RacunicaSort): number | string | null {
  switch (key) {
    case "zarada":
      return hasActivity(row.stats) ? row.stats.profit : null;
    case "marza":
      return realMarginPct(row.stats);
    case "katalog":
      return row.catalogMarginPct;
    case "promet":
      return hasActivity(row.stats) ? row.stats.revenue : null;
    case "prodato":
      return row.stats.qty;
    case "po_komadu":
      return profitPerUnit(row.stats);
    case "popust":
      return discountPct(row.stats);
    case "otkazano":
      return cancelRatePct(row.stats);
    case "stanje":
      return row.outOfCatalog ? null : row.stock;
    case "vezano":
      return row.outOfCatalog ? null : row.stockValueVp;
    case "naziv":
      return row.name;
  }
}

export function compareRows(
  a: RacunicaRow,
  b: RacunicaRow,
  key: RacunicaSort,
  dir: "asc" | "desc",
): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va == null && vb == null) return a.name.localeCompare(b.name, "sr");
  if (va == null) return 1;
  if (vb == null) return -1;
  const cmp =
    typeof va === "string" || typeof vb === "string"
      ? String(va).localeCompare(String(vb), "sr")
      : va - vb;
  if (cmp === 0) return a.name.localeCompare(b.name, "sr");
  return dir === "asc" ? cmp : -cmp;
}

/** Procenat za prikaz: „32,5 %". */
export function pct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)} %`;
}

/** Pretraga bez obzira na velika slova i dijakritike („đ" = „dj"). */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
