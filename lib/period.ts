/**
 * Generički period model za Dashboard (Korak 1.8) — dan / nedelja / mesec /
 * prilagođeno. Sve nad KALENDARSKIM Belgrade datumima „YYYY-MM-DD" (Intl,
 * bez date-fns-tz — konzistentno sa lib/date-belgrade.ts i finansijama).
 *
 * URL: ?od=YYYY-MM-DD&do=YYYY-MM-DD (inkluzivno). Bez parametra → tekući mesec.
 */

import { todayBelgrade } from "@/lib/date-belgrade";

const TZ = "Europe/Belgrade";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PresetKey = "dan" | "nedelja" | "mesec";

export type Period = {
  from: string; // YYYY-MM-DD (inkluzivno)
  to: string; // YYYY-MM-DD (inkluzivno)
  preset: PresetKey | null; // null = prilagođeni raspon
  label: string;
};

/** Pomeri kalendarski „YYYY-MM-DD" za n dana (T12:00:00Z izbegava DST preskok). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dan u nedelji za kalendarski datum: 0=nedelja … 6=subota. */
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Granice preset-a za dati „danas" (Belgrade), sve inkluzivno. */
export function presetBounds(preset: PresetKey, today: string): { from: string; to: string } {
  if (preset === "dan") return { from: today, to: today };
  if (preset === "nedelja") {
    // Ponedeljak–nedelja koja sadrži „danas".
    const offsetToMonday = (weekdayOf(today) + 6) % 7; // pon=0 … ned=6
    const from = addDays(today, -offsetToMonday);
    return { from, to: addDays(from, 6) };
  }
  // mesec: prvi–poslednji kalendarski dan tekućeg meseca
  const [y, m] = today.split("-").map(Number);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${pad(lastDayNum)}` };
}

/**
 * Široki UTC pred-filter za raspon (Belgrade je UTC+1/+2 → Belgrade-dan može
 * pasti u prethodni UTC dan). Dan pre `from` do dva dana posle `to`; tačan
 * filter se radi u JS-u po belgradeDate() (isti obrazac kao monthBounds).
 */
export function rangeToUtcPrefilter(from: string, to: string): { gteUtc: string; ltUtc: string } {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return {
    gteUtc: new Date(fromMs - 86_400_000).toISOString(),
    ltUtc: new Date(toMs + 2 * 86_400_000).toISOString(),
  };
}

/** „d. M. yyyy." (Belgrade) za jedan kalendarski datum. */
function dayLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

/** „jul 2026" (Belgrade) za mesec kome pripada datum. */
function monthLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

function labelFor(preset: PresetKey | null, from: string, to: string): string {
  if (preset === "dan") return "Danas";
  if (preset === "nedelja") return "Ova nedelja";
  if (preset === "mesec") return monthLabel(from);
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** Detektuj da li raspon tačno odgovara nekom preset-u za „danas". */
function detectPreset(from: string, to: string, today: string): PresetKey | null {
  for (const key of ["dan", "nedelja", "mesec"] as PresetKey[]) {
    const b = presetBounds(key, today);
    if (b.from === from && b.to === to) return key;
  }
  return null;
}

/**
 * Pročitaj period iz searchParams. Validan ?od&do (od ≤ do) → prilagođeni raspon
 * (sa detekcijom da li se poklapa sa preset-om); u suprotnom → tekući mesec.
 */
export function resolvePeriod(sp: Record<string, string | string[] | undefined>): Period {
  const today = todayBelgrade();
  const od = typeof sp.od === "string" ? sp.od : "";
  const dor = typeof sp.do === "string" ? sp.do : "";

  if (DATE_RE.test(od) && DATE_RE.test(dor) && od <= dor) {
    const preset = detectPreset(od, dor, today);
    return { from: od, to: dor, preset, label: labelFor(preset, od, dor) };
  }

  const b = presetBounds("mesec", today);
  return { from: b.from, to: b.to, preset: "mesec", label: labelFor("mesec", b.from, b.to) };
}

/** URL za preset (?od&do), računat za „danas". */
export function presetHref(preset: PresetKey, today: string = todayBelgrade()): string {
  const b = presetBounds(preset, today);
  return `/?od=${b.from}&do=${b.to}`;
}

/**
 * Raspon za poređenje kartica sa prethodnim periodom — ISTI broj proteklih dana,
 * da tekući mesec od 19 dana ne bi bio poređen sa celim prošlim mesecom.
 * Tekući period se seče na „danas" (budući dani nemaju porudžbina). Za „mesec"
 * poredi sa istim delom prošlog kalendarskog meseca; inače sa istom dužinom
 * odmah pre `from`. Vraća i tekući isečeni raspon, da se obe strane računaju
 * nad istim brojem dana.
 */
export function comparisonRange(
  period: Period,
  today: string = todayBelgrade(),
): { current: { from: string; to: string }; previous: { from: string; to: string }; label: string } | null {
  const to = period.to < today ? period.to : today;
  if (to < period.from) return null; // ceo period je u budućnosti
  const len =
    Math.round(
      (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${period.from}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;

  if (period.preset === "mesec") {
    const [y, m] = period.from.split("-").map(Number);
    const prevStart = new Date(Date.UTC(y, m - 2, 1, 12)).toISOString().slice(0, 10);
    const prevLast = new Date(Date.UTC(y, m - 1, 0, 12)).toISOString().slice(0, 10);
    const prevTo = addDays(prevStart, len - 1);
    return {
      current: { from: period.from, to },
      previous: { from: prevStart, to: prevTo < prevLast ? prevTo : prevLast },
      label: "prošli mesec",
    };
  }

  // Ceo prethodni period iste dužine, pa iz njega isti broj proteklih dana
  // (nedelja od srede → prošli pon–sre, ne pet–ned).
  const fullLen =
    Math.round(
      (new Date(`${period.to}T12:00:00Z`).getTime() - new Date(`${period.from}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  const prevFrom = addDays(period.from, -fullLen);
  return {
    current: { from: period.from, to },
    previous: { from: prevFrom, to: addDays(prevFrom, len - 1) },
    label: period.preset === "dan" ? "juče" : period.preset === "nedelja" ? "prošla nedelja" : "prethodni period",
  };
}

/*
 * Preseti za stranice koje gledaju „klizni" period unazad (Računica, P1 —
 * docs/arhiva/2026-10-22-Plan-Racunica.md). Odvojeni od `PresetKey` da Dashboard filter i
 * njegovo poređenje ostanu netaknuti. Svi završavaju „danas" (osim „mesec",
 * koji je ceo kalendarski mesec kao na Dashboardu).
 */

export type RangePresetKey = "30d" | "90d" | "mesec" | "godina" | "sve";

/** Prvi dan podataka u app-u (backfill istorije, Korak 1.3). */
export const DATA_START = "2026-02-02";

export const RANGE_PRESETS: { key: RangePresetKey; label: string }[] = [
  { key: "30d", label: "30 dana" },
  { key: "90d", label: "90 dana" },
  { key: "mesec", label: "Ovaj mesec" },
  { key: "godina", label: "Ova godina" },
  { key: "sve", label: "Sve" },
];

export type RangePeriod = {
  from: string;
  to: string;
  preset: RangePresetKey | null;
  label: string;
};

export function rangePresetBounds(key: RangePresetKey, today: string): { from: string; to: string } {
  if (key === "30d") return { from: addDays(today, -29), to: today };
  if (key === "90d") return { from: addDays(today, -89), to: today };
  if (key === "mesec") return presetBounds("mesec", today);
  if (key === "godina") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: DATA_START, to: today };
}

function rangeLabel(preset: RangePresetKey | null, from: string, to: string): string {
  if (preset === "30d") return "Poslednjih 30 dana";
  if (preset === "90d") return "Poslednjih 90 dana";
  if (preset === "mesec") return monthLabel(from);
  if (preset === "godina") return `Godina ${from.slice(0, 4)}`;
  if (preset === "sve") return "Od početka";
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** Pročitaj ?od&do; bez validnog raspona → `fallback` preset (računat za „danas"). */
export function resolveRange(
  sp: Record<string, string | string[] | undefined>,
  fallback: RangePresetKey,
): RangePeriod {
  const today = todayBelgrade();
  const od = typeof sp.od === "string" ? sp.od : "";
  const dor = typeof sp.do === "string" ? sp.do : "";

  let from: string;
  let to: string;
  if (DATE_RE.test(od) && DATE_RE.test(dor) && od <= dor) {
    from = od;
    to = dor;
  } else {
    ({ from, to } = rangePresetBounds(fallback, today));
  }
  const preset =
    RANGE_PRESETS.map((p) => p.key).find((k) => {
      const b = rangePresetBounds(k, today);
      return b.from === from && b.to === to;
    }) ?? null;
  return { from, to, preset, label: rangeLabel(preset, from, to) };
}
