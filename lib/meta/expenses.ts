import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "@/lib/supabase/paginate";

/*
 * Automatski mesečni trošak reklama (plan Reklame, odluka D5).
 *
 * Posle svake sinhronizacije: za svaki mesec sa Meta potrošnjom tačno JEDAN red
 * u `expenses` — kategorija „Reklame" (po IMENU), opis „Meta — oktobar 2026",
 * datum = 1. u mesecu, iznos = Σ `spend_rsd` (svaki dan po svom kursu NBS).
 * Ključ `source_key = 'meta:YYYY-MM'` je UNIQUE, pa ponovni sync menja isti red.
 *
 * Ručne redove (`source` null) ovaj kod nikad ne čita ni ne menja. Mesec u kome
 * neki dan sa potrošnjom još nema kurs se PRESKAČE (ostaje prethodna cifra) —
 * bolje zastareo zbir nego tiho umanjen.
 */

export const META_EXPENSE_SOURCE = "meta";
const ADS_CATEGORY_NAME = "Reklame";

const MONTH_LABEL = new Intl.DateTimeFormat("sr-Latn-RS", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** „2026-10" → „Meta — oktobar 2026". */
export function metaExpenseDescription(month: string): string {
  const label = MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`)).replace(/\.$/, "");
  return `Meta — ${label}`;
}

export async function syncMetaExpenses(
  supabase: SupabaseClient,
): Promise<{ upserted: number; skipped: string[] }> {
  const rows = await selectAll<{ date: string; spend_minor: number; spend_rsd: number | null }>(
    "Meta potrošnja po danu",
    () =>
      supabase
        .from("ad_insights_daily")
        .select("date, spend_minor, spend_rsd")
        .order("date", { ascending: true })
        .order("campaign_id", { ascending: true }),
  );

  const months = new Map<string, { rsd: number; incomplete: boolean }>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const m = months.get(month) ?? { rsd: 0, incomplete: false };
    if (r.spend_rsd == null) {
      if (Number(r.spend_minor) > 0) m.incomplete = true;
    } else {
      m.rsd += r.spend_rsd;
    }
    months.set(month, m);
  }

  const { data: cat, error: catErr } = await supabase
    .from("expense_categories")
    .select("id")
    .ilike("name", ADS_CATEGORY_NAME)
    .limit(1)
    .maybeSingle();
  if (catErr) throw new Error(`Kategorija „${ADS_CATEGORY_NAME}": ${catErr.message}`);
  const categoryId = (cat as { id: string } | null)?.id ?? null;

  const skipped: string[] = [];
  const upserts: Record<string, unknown>[] = [];
  for (const [month, m] of months) {
    if (m.incomplete) {
      skipped.push(month);
      continue;
    }
    if (m.rsd <= 0) continue;
    upserts.push({
      source: META_EXPENSE_SOURCE,
      source_key: `${META_EXPENSE_SOURCE}:${month}`,
      amount: m.rsd,
      date: `${month}-01`,
      category_id: categoryId,
      description: metaExpenseDescription(month),
    });
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("expenses")
      .upsert(upserts, { onConflict: "source_key" });
    if (error) throw new Error(`Upis automatskog troška: ${error.message}`);
  }

  return { upserted: upserts.length, skipped };
}
