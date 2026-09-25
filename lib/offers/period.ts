/**
 * Period za stranicu Ponude: poslednjih 7 / 30 / 90 dana (`?dana=`).
 *
 * Granice su CELI kalendarski dani u Europe/Belgrade (od 00:00 prvog dana do
 * 00:00 dana posle danas), pa se KPI cifre i dnevni grafikon uvek poklapaju.
 * Konverzija u UTC ide kroz `belgradeLocalToUtc` — isti obrazac kao finansije
 * (Intl, bez `date-fns-tz`).
 */

import { belgradeLocalToUtc, todayBelgrade } from "@/lib/date-belgrade";

export const OFFER_PERIODS = [7, 30, 90] as const;
export type OfferPeriodDays = (typeof OFFER_PERIODS)[number];

export const DEFAULT_OFFER_PERIOD: OfferPeriodDays = 30;

export type OfferPeriod = {
  days: OfferPeriodDays;
  /** Prvi dan perioda, „YYYY-MM-DD" (Belgrade). */
  fromDate: string;
  /** Poslednji dan perioda = danas, „YYYY-MM-DD" (Belgrade). */
  toDate: string;
  /** ISO UTC granice: [fromUtc, toUtc) — `toUtc` je 00:00 sutra. */
  fromUtc: string;
  toUtc: string;
};

/** Pomeri kalendarski „YYYY-MM-DD" za n dana (T12:00:00Z izbegava DST preskok). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Početak beogradskog dana kao ISO UTC. */
function startOfDayUtc(dateStr: string): string {
  return belgradeLocalToUtc(`${dateStr} 00:00:00`) ?? `${dateStr}T00:00:00.000Z`;
}

/** Broj dana iz URL-a (7/30/90); sve ostalo → podrazumevanih 30. */
export function resolveOfferPeriod(
  sp: Record<string, string | string[] | undefined>,
  today: string = todayBelgrade(),
): OfferPeriod {
  const raw = typeof sp.dana === "string" ? Number(sp.dana) : NaN;
  const days = (OFFER_PERIODS as readonly number[]).includes(raw)
    ? (raw as OfferPeriodDays)
    : DEFAULT_OFFER_PERIOD;

  const fromDate = addDays(today, -(days - 1));

  return {
    days,
    fromDate,
    toDate: today,
    fromUtc: startOfDayUtc(fromDate),
    toUtc: startOfDayUtc(addDays(today, 1)),
  };
}

/** Svi kalendarski dani perioda — da grafikon ima i dane bez ijednog događaja. */
export function periodDays(period: OfferPeriod): string[] {
  const out: string[] = [];
  for (let d = period.fromDate; d <= period.toDate; d = addDays(d, 1)) out.push(d);
  return out;
}
