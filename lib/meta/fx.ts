import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "@/lib/supabase/paginate";

/*
 * Novac i kurs za Meta potrošnju — BEZ float-a (§5).
 *
 * Meta vraća iznose kao decimalni string („12.34"), pa se parsiraju kao string u
 * najmanju jedinicu (cente). Kurs je srednji kurs NBS na dan potrošnje, čuva se
 * kao RSD × 10⁶ (`middle_micro`), a preračun ide u BigInt aritmetici.
 *
 * Izvor kursa: kurs.resenje.org (besplatan JSON, preslikava NBS kursnu listu).
 * Za subotu/nedelju/praznik vraća poslednju objavljenu listu (`date_from`), kao
 * što i NBS lista važi do sledeće. Kurs se kešira u `fx_rates` — svaki dan se
 * traži samo jednom.
 */

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;

export type FxRate = { date: string; listDate: string; middleMicro: number };

/** 10^n kao BigInt (tsconfig target ne dozvoljava `10n` literale). */
function pow10(n: number): bigint {
  return BigInt(`1${"0".repeat(n)}`);
}

/**
 * Decimalni string → ceo broj u jedinici 10^-scale („12.34", 2 → 1234).
 * Višak decimala se zaokružuje na pola naviše. Neispravan unos → 0.
 */
export function decimalToMinor(value: string | number | null | undefined, scale: number): number {
  if (value == null) return 0;
  const s = String(value).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) return 0;
  const [, sign, int, frac = ""] = m;
  const padded = (frac + "0".repeat(scale + 1)).slice(0, scale + 1);
  let minor = BigInt(int || "0") * pow10(scale) + BigInt(padded.slice(0, scale) || "0");
  if (Number(padded[scale]) >= 5) minor += BigInt(1);
  return Number(sign ? -minor : minor);
}

/** Centi × kurs(×10⁶) → zaokružen RSD (pola naviše). */
export function minorToRsd(minor: number, middleMicro: number, scale = 2): number {
  const denom = pow10(scale + 6);
  const num = BigInt(minor) * BigInt(middleMicro);
  const half = denom / BigInt(2);
  return Number(num >= BigInt(0) ? (num + half) / denom : -((-num + half) / denom));
}

async function fetchRemoteRate(currency: string, date: string): Promise<FxRate> {
  const url = `https://kurs.resenje.org/api/v1/currencies/${currency.toLowerCase()}/rates/${date}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Kurs ${currency} za ${date}: odgovor ${res.status}.`);
    const body = (await res.json()) as {
      date_from?: string;
      exchange_middle?: number;
      parity?: number;
    };
    const parity = body.parity && body.parity > 0 ? body.parity : 1;
    // exchange_middle stiže kao JSON broj sa 4 decimale → kroz string, ne množenjem
    const middleMicro = Math.round(decimalToMinor(body.exchange_middle ?? null, 6) / parity);
    if (!body.date_from || middleMicro <= 0) {
      throw new Error(`Kurs ${currency} za ${date}: neispravan odgovor.`);
    }
    return { date, listDate: body.date_from, middleMicro };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Kursna lista nije odgovorila za ${date}.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Kurs za svaki traženi dan: prvo iz keša (`fx_rates`), ostatak sa izvora
 * (paralelno, po CONCURRENCY) pa u keš. Dan za koji izvor ne odgovori izostaje
 * iz mape — pozivalac ostavlja `spend_rsd` prazan i sledeći sync pokušava opet.
 * Kurs za DANAS se ne kešira (lista za sutra može izaći istog dana posle 8h —
 * pa bi „danas" mogao da dobije zastarelu vikend listu); traži se svaki put.
 */
export async function getRates(
  supabase: SupabaseClient,
  currency: string,
  dates: string[],
  today: string,
): Promise<{ rates: Map<string, FxRate>; failed: string[] }> {
  const rates = new Map<string, FxRate>();
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return { rates, failed: [] };

  const cached = await selectAll<{ date: string; list_date: string; middle_micro: number }>(
    "keš kursa",
    () =>
      supabase
        .from("fx_rates")
        .select("date, list_date, middle_micro")
        .eq("currency", currency)
        .gte("date", unique[0])
        .lte("date", unique[unique.length - 1])
        .order("date", { ascending: true }),
  );
  for (const r of cached) {
    if (r.date !== today) {
      rates.set(r.date, {
        date: r.date,
        listDate: r.list_date,
        middleMicro: Number(r.middle_micro),
      });
    }
  }

  const missing = unique.filter((d) => !rates.has(d));
  const failed: string[] = [];
  const fresh: FxRate[] = [];

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((d) => fetchRemoteRate(currency, d)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        rates.set(r.value.date, r.value);
        fresh.push(r.value);
      } else {
        failed.push(batch[j]);
      }
    });
  }

  const toCache = fresh.filter((r) => r.date !== today);
  if (toCache.length > 0) {
    const { error: upErr } = await supabase.from("fx_rates").upsert(
      toCache.map((r) => ({
        currency,
        date: r.date,
        list_date: r.listDate,
        middle_micro: r.middleMicro,
      })),
      { onConflict: "currency,date" },
    );
    // keš je ušteda, ne istina — neuspeh upisa ne obara sync
    if (upErr) Sentry.captureException(new Error(`Upis keša kursa: ${upErr.message}`));
  }

  return { rates, failed };
}
