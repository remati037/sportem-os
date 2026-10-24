import "server-only";

import * as Sentry from "@sentry/nextjs";

import { todayBelgrade } from "@/lib/date-belgrade";
import { syncMetaExpenses } from "@/lib/meta/expenses";
import { decimalToMinor, getRates, minorToRsd } from "@/lib/meta/fx";
import {
  fetchCampaignInsights,
  fetchCampaigns,
  metaAccountId,
  metaConfigured,
  type MetaActionApi,
  type MetaInsightApi,
} from "@/lib/meta/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/paginate";

/*
 * Sinhronizacija Meta Ads → Supabase (plan Reklame, M1).
 *
 * Tok: kampanje → upsert · Insights po kampanji i danu, mesec po mesec, od
 * početka (prvi put: META_SYNC_START) ili od poslednjeg dana − 7 (Meta koriguje
 * cifre unazad) do DANAS (današnji dan je delimičan i sutra se prepiše) →
 * kurs NBS po danu → upsert `ad_insights_daily` → automatski mesečni trošak.
 *
 * Piše kroz service role (ad_* nemaju write politiku). Nikad ne baca — greška se
 * vrati u rezultatu i upiše u `ad_sync_state.last_error` (obrazac lib/offers/sync).
 */

/** Ceo februar — app ima podatke od 02.02.2026, a mesečni trošak mora biti pun mesec. */
export const META_SYNC_START = "2026-02-01";
const RESYNC_DAYS = 7;
const UPSERT_CHUNK = 500;
const SYNC_KEY = "meta";

export type MetaSyncResult = {
  ok: boolean;
  from?: string;
  to?: string;
  campaigns: number;
  days: number;
  months: number;
  error?: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** [since, until] isečen na kalendarske mesece (Meta ne voli ogromne opsege). */
function monthWindows(since: string, until: string): [string, string][] {
  const out: [string, string][] = [];
  let start = since;
  while (start <= until) {
    const [y, m] = start.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const end = monthEnd < until ? monthEnd : until;
    out.push([start, end]);
    start = addDays(end, 1);
  }
  return out;
}

function intOf(v: string | undefined): number {
  const n = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

/** „Kupovine" po Meta pikselu — jedan tip, da se isti događaj ne broji više puta. */
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function purchaseOf(list: MetaActionApi[] | undefined): string | undefined {
  for (const t of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return hit.value;
  }
  return undefined;
}

async function writeState(
  supabase: AdminClient,
  patch: { last_synced_at?: string; last_error: string | null },
) {
  const { error } = await supabase
    .from("ad_sync_state")
    .upsert({ key: SYNC_KEY, ...patch }, { onConflict: "key" });
  if (error) Sentry.captureException(new Error(`Upis stanja Meta sync-a: ${error.message}`));
}

async function upsertChunked(
  supabase: AdminClient,
  table: "ad_campaigns" | "ad_insights_daily",
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`Upis u ${table}: ${error.message}`);
  }
}

/** Odakle kreće ovaj sync: poslednji sinhronizovan dan − 7, ili početak istorije. */
async function syncFrom(supabase: AdminClient): Promise<string> {
  const { data, error } = await supabase
    .from("ad_insights_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Čitanje poslednjeg dana: ${error.message}`);
  const last = (data as { date: string } | null)?.date;
  if (!last) return META_SYNC_START;
  const from = addDays(last, -RESYNC_DAYS);
  return from < META_SYNC_START ? META_SYNC_START : from;
}

/** Dani u prozoru koji još nemaju RSD (kurs nije stigao ranije) — pokušava se ponovo. */
async function daysMissingRsd(supabase: AdminClient, before: string): Promise<string[]> {
  const rows = await selectAll<{ date: string }>("dani bez kursa", () =>
    supabase
      .from("ad_insights_daily")
      .select("date")
      .is("spend_rsd", null)
      .lt("date", before)
      .order("date", { ascending: true })
      .order("campaign_id", { ascending: true }),
  );
  return [...new Set(rows.map((r) => r.date))];
}

export async function syncMeta(): Promise<MetaSyncResult> {
  const supabase = createAdminClient();

  if (!metaConfigured()) {
    const error = "Meta nije podešena — nedostaje META_ACCESS_TOKEN ili META_AD_ACCOUNT_ID.";
    await writeState(supabase, { last_error: error });
    return { ok: false, campaigns: 0, days: 0, months: 0, error };
  }

  const today = todayBelgrade();
  let from: string | undefined;
  let campaignsCount = 0;
  let rowsCount = 0;

  try {
    const accountId = metaAccountId();
    from = await syncFrom(supabase);

    // ── 1. kampanje ──────────────────────────────────────────────────────────
    const campaigns = await fetchCampaigns();
    const campaignRows = new Map<string, Record<string, unknown>>(
      campaigns.map((c) => [
        c.id,
        {
          id: c.id,
          account_id: accountId,
          name: c.name ?? "",
          status: c.effective_status ?? null,
          objective: c.objective ?? null,
          synced_at: new Date().toISOString(),
        },
      ]),
    );

    // ── 2. insights, mesec po mesec ─────────────────────────────────────────
    const insights: MetaInsightApi[] = [];
    for (const [since, until] of monthWindows(from, today)) {
      insights.push(...(await fetchCampaignInsights(since, until)));
    }

    // Kampanja iz Insights-a koje nema na spisku (npr. obrisana) — da FK prođe.
    for (const r of insights) {
      if (!campaignRows.has(r.campaign_id)) {
        campaignRows.set(r.campaign_id, {
          id: r.campaign_id,
          account_id: accountId,
          name: r.campaign_name ?? "",
          status: null,
          objective: null,
          synced_at: new Date().toISOString(),
        });
      }
    }
    await upsertChunked(supabase, "ad_campaigns", [...campaignRows.values()], "id");
    campaignsCount = campaignRows.size;

    // ── 3. kurs NBS: dani iz ovog prozora + raniji dani koji su ostali bez kursa ─
    const currency = (insights[0]?.account_currency ?? "USD").toUpperCase();
    const retryDays = await daysMissingRsd(supabase, from);
    const { rates, failed } = await getRates(
      supabase,
      currency,
      [...insights.map((r) => r.date_start), ...retryDays],
      today,
    );

    const rows = insights.map((r) => {
      const spendMinor = decimalToMinor(r.spend, 2);
      const rate = rates.get(r.date_start);
      return {
        campaign_id: r.campaign_id,
        date: r.date_start,
        currency: (r.account_currency ?? currency).toUpperCase(),
        spend_minor: spendMinor,
        fx_rate_micro: rate?.middleMicro ?? null,
        fx_list_date: rate?.listDate ?? null,
        spend_rsd: rate ? minorToRsd(spendMinor, rate.middleMicro) : null,
        impressions: intOf(r.impressions),
        clicks: intOf(r.clicks),
        link_clicks: intOf(r.inline_link_clicks),
        meta_purchases: intOf(purchaseOf(r.actions)),
        meta_purchase_value_minor: decimalToMinor(purchaseOf(r.action_values), 2),
        synced_at: new Date().toISOString(),
      };
    });
    await upsertChunked(supabase, "ad_insights_daily", rows, "campaign_id,date");
    rowsCount = rows.length;

    // Raniji dani bez kursa: dopuni RSD gde je kurs sad stigao.
    for (const day of retryDays) {
      const rate = rates.get(day);
      if (!rate) continue;
      await fillRsdForDay(supabase, day, rate.middleMicro, rate.listDate);
    }

    // ── 4. automatski mesečni trošak ────────────────────────────────────────
    const expenses = await syncMetaExpenses(supabase);

    const problems = [
      failed.length > 0
        ? `Kurs NBS nije stigao za ${failed.length} ${failed.length === 1 ? "dan" : "dana"} (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}) — pokušaće se ponovo.`
        : null,
      expenses.skipped.length > 0
        ? `Trošak nije ažuriran za: ${expenses.skipped.join(", ")} (fali kurs za neki dan).`
        : null,
    ].filter(Boolean);

    await writeState(supabase, {
      last_synced_at: new Date().toISOString(),
      last_error: problems.length > 0 ? problems.join(" ") : null,
    });

    return {
      ok: true,
      from,
      to: today,
      campaigns: campaignsCount,
      days: rowsCount,
      months: expenses.upserted,
      error: problems.length > 0 ? problems.join(" ") : undefined,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Nepoznata greška pri Meta sinhronizaciji.";
    Sentry.captureException(err);
    await writeState(supabase, { last_error: message });
    return {
      ok: false,
      from,
      to: today,
      campaigns: campaignsCount,
      days: rowsCount,
      months: 0,
      error: message,
    };
  }
}

/** Dan koji je ranije ostao bez kursa: izračunaj RSD za sve njegove kampanje. */
async function fillRsdForDay(
  supabase: AdminClient,
  day: string,
  middleMicro: number,
  listDate: string,
) {
  const rows = await selectAll<{ campaign_id: string; spend_minor: number }>("dan bez kursa", () =>
    supabase
      .from("ad_insights_daily")
      .select("campaign_id, spend_minor")
      .eq("date", day)
      .is("spend_rsd", null)
      .order("campaign_id", { ascending: true }),
  );
  for (const r of rows) {
    const { error } = await supabase
      .from("ad_insights_daily")
      .update({
        fx_rate_micro: middleMicro,
        fx_list_date: listDate,
        spend_rsd: minorToRsd(Number(r.spend_minor), middleMicro),
      })
      .eq("campaign_id", r.campaign_id)
      .eq("date", day);
    if (error) throw new Error(`Dopuna kursa za ${day}: ${error.message}`);
  }
}
