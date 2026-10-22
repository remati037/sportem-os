/*
 * Brzina prodaje i prognoze (Računica P3, docs/Sportem-Plan-Racunica.md).
 * Čiste funkcije, bez `server-only` — deli ih Računica, a Nabavka N1 treba da
 * ih koristi umesto svoje formule (da dva ekrana nikad ne daju različit tempo).
 *
 * Sve gleda unazad OD DANAS, nezavisno od perioda izabranog na strani:
 * prognoza je vezana za sutra, ne za izabrani mesec. Istorija počinje
 * 02.02.2026 — sezona NIJE uračunata (premalo podataka; v. plan §P3).
 */

/** Komadi iz realizovanih porudžbina (bez Otkazano/Vraćeno) u prozorima od danas. */
export type Velocity = {
  q30: number; // poslednjih 30 dana (danas i 29 pre)
  qPrev30: number; // 30 dana pre toga (za trend)
  q31to90: number; // dani 31–90 unazad (za tempo)
};

export const emptyVelocity = (): Velocity => ({ q30: 0, qPrev30: 0, q31to90: 0 });

export function addVelocity(into: Velocity, v: Velocity): void {
  into.q30 += v.q30;
  into.qPrev30 += v.qPrev30;
  into.q31to90 += v.q31to90;
}

/** Ispod ovoliko komada u OBA prozora trend se ne prikazuje („malo podataka"). */
export const TREND_MIN_QTY = 5;
/** Promena manja od ovoga (u %) je „bez promene". */
export const TREND_FLAT_PCT = 10;
export const FORECAST_DAYS = 30;

/**
 * Dnevni tempo: ponderisani prosek — poslednjih 30 dana vredi DVOSTRUKO od
 * prethodnih 60 (nedavna prodaja više govori o sutra): (2·q30 + q31–90) / 120.
 */
export function dailyRate(v: Velocity): number {
  return (2 * v.q30 + v.q31to90) / (2 * 30 + 60);
}

/** Očekivani komadi u narednih `days` dana. */
export function forecastQty(v: Velocity, days = FORECAST_DAYS): number {
  return dailyRate(v) * days;
}

/**
 * Za koliko dana stanje pada na nulu po trenutnom tempu. null = ne zna se
 * (stanje nije popisano, ILI artikal nije prodavan 90 dana — nula na stanju
 * bez potražnje nije „nestaje"); 0 = već nema na stanju, a traži se.
 */
export function daysToZero(stock: number | null, counted: boolean, v: Velocity): number | null {
  if (!counted || stock == null) return null;
  const rate = dailyRate(v);
  if (rate <= 0) return null;
  return stock <= 0 ? 0 : stock / rate;
}

export type Trend =
  | { dir: "few" }
  | { dir: "new" }
  | { dir: "up" | "down" | "flat"; pct: number };

/** Poslednjih 30 dana prema prethodnih 30 (komadi). */
export function trendOf(v: Velocity): Trend {
  if (v.q30 < TREND_MIN_QTY && v.qPrev30 < TREND_MIN_QTY) return { dir: "few" };
  if (v.qPrev30 === 0) return { dir: "new" };
  const pct = ((v.q30 - v.qPrev30) / v.qPrev30) * 100;
  return { dir: pct >= TREND_FLAT_PCT ? "up" : pct <= -TREND_FLAT_PCT ? "down" : "flat", pct };
}

/** Vrednost trenda za sortiranje (few na kraj, novo kao +∞). */
export function trendSortValue(t: Trend): number | null {
  if (t.dir === "few") return null;
  if (t.dir === "new") return Number.POSITIVE_INFINITY;
  return t.pct;
}

/* ---------- zarada do kraja meseca ---------- */

export type MonthInput = {
  monthFrom: string; // prvi dan tekućeg meseca
  monthTo: string; // poslednji dan
  today: string;
  mtdProfit: number; // ostvareno od 1. do danas (uklj. danas), kao Dashboard
  mtdRevenue: number;
  /** Zarada po danu za 28 PUNIH dana pre danas (najstariji prvi). */
  last28Profit: number[];
};

export type MonthProjection = {
  mtdProfit: number;
  mtdRevenue: number;
  remainingDays: number; // dani posle danas do kraja meseca
  dailyAvg: number; // prosek 28 dana
  projected: number; // ostvareno + prosek × preostali dani
  low: number; // najslabija od 4 nedelje, preračunata na preostale dane
  high: number; // najjača od 4 nedelje
};

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / dayMs);

/**
 * Procena zarade do kraja meseca po trenutnom tempu. Raspon = najslabija i
 * najjača od poslednje 4 nedelje (prosek po danu te nedelje × preostali dani),
 * da cifra ne izgleda sigurnije nego što jeste. Sve u celim RSD.
 */
export function projectMonth(m: MonthInput): MonthProjection {
  const remainingDays = Math.max(daysBetween(m.today, m.monthTo), 0);
  const days = m.last28Profit.length || 1;
  const dailyAvg = m.last28Profit.reduce((s, x) => s + x, 0) / days;
  const weeks: number[] = [];
  for (let i = 0; i + 7 <= m.last28Profit.length; i += 7) {
    weeks.push(m.last28Profit.slice(i, i + 7).reduce((s, x) => s + x, 0) / 7);
  }
  const lowDaily = weeks.length ? Math.min(...weeks) : dailyAvg;
  const highDaily = weeks.length ? Math.max(...weeks) : dailyAvg;
  return {
    mtdProfit: m.mtdProfit,
    mtdRevenue: m.mtdRevenue,
    remainingDays,
    dailyAvg: Math.round(dailyAvg),
    projected: Math.round(m.mtdProfit + dailyAvg * remainingDays),
    low: Math.round(m.mtdProfit + lowDaily * remainingDays),
    high: Math.round(m.mtdProfit + highDaily * remainingDays),
  };
}
