import {
  daysToZero,
  forecastQty,
  trendOf,
  trendSortValue,
  type MonthInput,
  type Velocity,
} from "@/lib/sales-velocity";

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
  /** Poslednja realizovana prodaja (Beograd dan) iz CELE istorije; null = nikad. */
  lastSoldDay: string | null;
  /** Komadi po prozorima unazad od danas (P3) — ne zavisi od perioda. */
  vel: Velocity;
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
  vel: Velocity; // zbir varijanti
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
  today: string;
  /** Sirovi podaci za „zarada do kraja meseca" (projectMonth u lib/sales-velocity). */
  month: MonthInput;
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

/**
 * Za koliko dana nestaje PRVA aktivna varijanta proizvoda (za veličine/težine
 * zbirno stanje laže — 10 kg može da nestane dok 2 kg ima na bacanje).
 */
export function rowDaysToZero(row: RacunicaRow): number | null {
  let min: number | null = null;
  for (const v of row.variants) {
    if (v.archived) continue;
    const d = daysToZero(v.stock, v.counted, v.vel);
    if (d != null && (min == null || d < min)) min = d;
  }
  return min;
}

/** Granica za „nestaje uskoro" (filter trenda). */
export const SOON_DAYS = 30;

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
  { key: "trend", label: "Trend (30 vs 30 dana)" },
  { key: "prognoza", label: "Prognoza 30 dana" },
  { key: "do_nule", label: "Dana do nule" },
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
    case "trend":
      return trendSortValue(trendOf(row.vel));
    case "prognoza":
      return forecastQty(row.vel);
    case "do_nule":
      return rowDaysToZero(row);
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

/* ---------- razvrstavanje (P2) ---------- */

export type ViewKey = "abc" | "matrica" | "mrtva";
export const VIEW_KEYS: ViewKey[] = ["abc", "matrica", "mrtva"];
export const VIEW_LABELS: Record<ViewKey, string> = {
  abc: "ABC",
  matrica: "Matrica",
  mrtva: "Mrtva roba",
};

export type AbcClass = "A" | "B" | "C";
export const ABC_A_PCT = 80;
export const ABC_B_PCT = 95;

/**
 * ABC (Pareto) po stvarnoj zaradi u periodu. Redovi sa zaradom > 0 idu ↓; red je
 * A dok je kumulativ PRE njega < 80 %, B dok je < 95 %, ostalo C. Tako je red
 * koji prelazi granicu još u višoj klasi (najveći artikal je uvek A).
 * Bez prodaje ili sa zaradom ≤ 0 → C. Računa se nad SVIM redovima perioda, ne
 * nad filtriranim — klasa se ne menja kad se suzi pretraga.
 */
export function classifyAbc(rows: RacunicaRow[]): Map<string, AbcClass> {
  const out = new Map<string, AbcClass>();
  const positive = rows.filter((r) => r.stats.profit > 0).sort((a, b) => b.stats.profit - a.stats.profit);
  const total = positive.reduce((s, r) => s + r.stats.profit, 0);
  let cum = 0;
  for (const r of positive) {
    const before = total > 0 ? (cum / total) * 100 : 100;
    out.set(r.key, before < ABC_A_PCT ? "A" : before < ABC_B_PCT ? "B" : "C");
    cum += r.stats.profit;
  }
  for (const r of rows) if (!out.has(r.key)) out.set(r.key, "C");
  return out;
}

export type Quadrant = "zvezde" | "obim" | "nisa" | "kandidati";
export const QUADRANTS: { key: Quadrant; label: string; hint: string }[] = [
  { key: "zvezde", label: "Zvezde", hint: "mnogo komada, marža iznad cilja" },
  { key: "obim", label: "Obim", hint: "mnogo komada, marža ispod cilja" },
  { key: "nisa", label: "Niša", hint: "malo komada, marža iznad cilja" },
  { key: "kandidati", label: "Kandidati za izbacivanje", hint: "malo komada, marža ispod cilja" },
];

export function isQuadrant(v: string | null | undefined): v is Quadrant {
  return QUADRANTS.some((q) => q.key === v);
}

/** Medijana prodatih komada među redovima koji su prodavani (granica „mnogo"). */
export function medianQty(rows: RacunicaRow[]): number {
  const q = rows
    .filter((r) => r.stats.qty > 0)
    .map((r) => r.stats.qty)
    .sort((a, b) => a - b);
  if (q.length === 0) return 0;
  const mid = Math.floor(q.length / 2);
  return q.length % 2 ? q[mid] : (q[mid - 1] + q[mid]) / 2;
}

/**
 * Kvadrant matrice obim × marža: „mnogo" = više od medijane komada, „visoka" =
 * stvarna marža ≥ cilj. Bez prodaje ili bez poznate marže → null (van grafikona).
 */
export function quadrantOf(row: RacunicaRow, median: number, target: number): Quadrant | null {
  const m = realMarginPct(row.stats);
  if (row.stats.qty === 0 || m == null) return null;
  const many = row.stats.qty > median;
  const high = m >= target;
  return many ? (high ? "zvezde" : "obim") : high ? "nisa" : "kandidati";
}

export const DEAD_DAYS_OPTIONS = [60, 90] as const;
export const DEFAULT_DEAD_DAYS = 90;

export type DeadStockItem = {
  rowKey: string;
  productId: string;
  productName: string;
  variant: RacunicaVariant;
  value: number; // stanje × VP
};

/** Kalendarski dan „YYYY-MM-DD" pomeren za n dana. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Mrtva roba: aktivna, POPISANA varijanta sa stanjem > 0 bez realizovane prodaje
 * u poslednjih `days` dana (ili nikad od početka podataka). Ne zavisi od
 * izabranog perioda — gleda unazad od danas. Najveća vrednost po VP prva.
 */
export function deadStock(rows: RacunicaRow[], today: string, days: number): DeadStockItem[] {
  const cutoff = shiftDay(today, -days);
  const out: DeadStockItem[] = [];
  for (const r of rows) {
    if (!r.productId) continue;
    for (const v of r.variants) {
      if (v.archived || !v.counted || (v.stock ?? 0) <= 0) continue;
      if (v.lastSoldDay && v.lastSoldDay > cutoff) continue;
      out.push({
        rowKey: r.key,
        productId: r.productId,
        productName: r.name,
        variant: v,
        value: (v.stock ?? 0) * (v.vp ?? 0),
      });
    }
  }
  return out.sort((a, b) => b.value - a.value || a.productName.localeCompare(b.productName, "sr"));
}
