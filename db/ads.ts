import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSales, sumItems } from "@/db/sales";
import { rangeToUtcPrefilter } from "@/lib/period";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";

/*
 * Upiti modula Reklame (Meta Ads). Čitaju kroz RLS klijent: Admin i Menadžer
 * vide, Logistika nema nijednu politiku na ad_* tabelama.
 *
 * Zbirovi se rade u JS-u preko `selectAll` (paginacija, bez tihog reza na 1000):
 * po kampanji i danu je ~50 redova mesečno, pa SQL agregacija iz plana (M2) nije
 * potrebna — i nema migracije.
 *
 * Novac: RSD iz `spend_rsd` (snapshot kursa NBS po danu), a ROAS u valuti naloga
 * (vrednost kupovina i potrošnja su obe u USD centima — bez kursa u odnosu).
 * Sve „kupovine" i ROAS su PO META-I (piksel, njen model pripisivanja).
 *
 * Opcioni `client` (obrazac db/customers.ts): bez njega RLS klijent iz kolačića;
 * skripte i budući AI alat (M4) prosleđuju svoj.
 */

type Client = SupabaseClient;
const clientOr = async (client?: Client): Promise<Client> => client ?? (await createClient());

export type MetaSyncState = {
  lastSyncedAt: string | null;
  lastError: string | null;
};

/** Stanje poslednje Meta sinhronizacije (null kad tabela još ne postoji / nema reda). */
export async function getMetaSyncState(client?: Client): Promise<MetaSyncState | null> {
  const supabase = await clientOr(client);
  const { data, error } = await supabase
    .from("ad_sync_state")
    .select("last_synced_at, last_error")
    .eq("key", "meta")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { last_synced_at: string | null; last_error: string | null };
  return { lastSyncedAt: row.last_synced_at, lastError: row.last_error };
}

/* ── zbirovi ─────────────────────────────────────────────────────────────── */

export type AdMetrics = {
  spendRsd: number;
  spendMinor: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  metaPurchases: number;
  metaPurchaseValueMinor: number;
  /** Redova sa potrošnjom bez kursa (RSD nepotpun dok sledeći sync ne dopuni). */
  missingRsd: number;
};

export type AdCampaignStat = AdMetrics & {
  id: string;
  name: string;
  status: string | null;
  objective: string | null;
  firstDay: string | null;
  lastDay: string | null;
};

export type AdDailyStat = { date: string; spendRsd: number; metaPurchases: number };

type InsightRow = {
  campaign_id: string;
  date: string;
  spend_minor: number;
  spend_rsd: number | null;
  impressions: number;
  clicks: number;
  link_clicks: number;
  meta_purchases: number;
  meta_purchase_value_minor: number;
};

const INSIGHT_COLUMNS =
  "campaign_id, date, spend_minor, spend_rsd, impressions, clicks, link_clicks, meta_purchases, meta_purchase_value_minor";

function emptyMetrics(): AdMetrics {
  return {
    spendRsd: 0,
    spendMinor: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    metaPurchases: 0,
    metaPurchaseValueMinor: 0,
    missingRsd: 0,
  };
}

function addRow(m: AdMetrics, r: InsightRow) {
  m.spendMinor += Number(r.spend_minor);
  if (r.spend_rsd == null) {
    if (Number(r.spend_minor) > 0) m.missingRsd++;
  } else {
    m.spendRsd += r.spend_rsd;
  }
  m.impressions += r.impressions;
  m.clicks += r.clicks;
  m.linkClicks += r.link_clicks;
  m.metaPurchases += r.meta_purchases;
  m.metaPurchaseValueMinor += Number(r.meta_purchase_value_minor);
}

/** CTR (link klikovi / prikazi) u %, null bez prikaza. */
export function ctrPct(m: AdMetrics): number | null {
  return m.impressions > 0 ? (m.linkClicks / m.impressions) * 100 : null;
}

/** Cena po link kliku u RSD (zaokruženo), null bez klikova. */
export function cpcRsd(m: AdMetrics): number | null {
  return m.linkClicks > 0 ? Math.round(m.spendRsd / m.linkClicks) : null;
}

/** Cena po Meta kupovini u RSD, null bez kupovina. */
export function costPerPurchaseRsd(m: AdMetrics): number | null {
  return m.metaPurchases > 0 ? Math.round(m.spendRsd / m.metaPurchases) : null;
}

/** ROAS po Meta-i (vrednost kupovina / potrošnja, ista valuta), null bez potrošnje. */
export function metaRoas(m: AdMetrics): number | null {
  return m.spendMinor > 0 ? m.metaPurchaseValueMinor / m.spendMinor : null;
}

async function loadInsights(
  supabase: Client,
  from: string,
  to: string,
  campaignId?: string,
): Promise<InsightRow[]> {
  return selectAll<InsightRow>("Meta potrošnja", () => {
    let q = supabase
      .from("ad_insights_daily")
      .select(INSIGHT_COLUMNS)
      .gte("date", from)
      .lte("date", to);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    return q.order("date", { ascending: true }).order("campaign_id", { ascending: true });
  });
}

type CampaignRow = { id: string; name: string; status: string | null; objective: string | null };

async function loadCampaigns(supabase: Client): Promise<CampaignRow[]> {
  return selectAll<CampaignRow>("Meta kampanje", () =>
    supabase
      .from("ad_campaigns")
      .select("id, name, status, objective")
      .order("id", { ascending: true }),
  );
}

export type AdsOverview = {
  totals: AdMetrics;
  campaigns: AdCampaignStat[];
  daily: AdDailyStat[];
  /** Da li u bazi uopšte ima ijednog dana (za prazno stanje „nije sinhronizovano"). */
  hasAnyData: boolean;
};

/** Zbir perioda + po kampanji (samo kampanje sa aktivnošću) + po danu. */
export async function getAdsOverview(
  from: string,
  to: string,
  client?: Client,
): Promise<AdsOverview> {
  const supabase = await clientOr(client);
  const [rows, campaigns, firstRow] = await Promise.all([
    loadInsights(supabase, from, to),
    loadCampaigns(supabase),
    supabase.from("ad_insights_daily").select("date").limit(1),
  ]);

  if (firstRow.error) throw new Error(`Meta potrošnja: ${firstRow.error.message}`);

  const totals = emptyMetrics();
  const byCampaign = new Map<string, AdCampaignStat>();
  const byDay = new Map<string, AdDailyStat>();
  const meta = new Map(campaigns.map((c) => [c.id, c]));

  for (const r of rows) {
    addRow(totals, r);

    let c = byCampaign.get(r.campaign_id);
    if (!c) {
      const info = meta.get(r.campaign_id);
      c = {
        ...emptyMetrics(),
        id: r.campaign_id,
        name: info?.name ?? r.campaign_id,
        status: info?.status ?? null,
        objective: info?.objective ?? null,
        firstDay: null,
        lastDay: null,
      };
      byCampaign.set(r.campaign_id, c);
    }
    addRow(c, r);
    if (!c.firstDay || r.date < c.firstDay) c.firstDay = r.date;
    if (!c.lastDay || r.date > c.lastDay) c.lastDay = r.date;

    const d = byDay.get(r.date) ?? { date: r.date, spendRsd: 0, metaPurchases: 0 };
    d.spendRsd += r.spend_rsd ?? 0;
    d.metaPurchases += r.meta_purchases;
    byDay.set(r.date, d);
  }

  return {
    totals,
    campaigns: [...byCampaign.values()].sort((a, b) => b.spendRsd - a.spendRsd),
    daily: [...byDay.values()],
    hasAnyData: (firstRow.data?.length ?? 0) > 0,
  };
}

export type AdCampaignDetail = {
  campaign: CampaignRow;
  totals: AdMetrics;
  days: (AdMetrics & { date: string })[];
};

/** Jedna kampanja po danima u periodu; null kad kampanja ne postoji. */
export async function getAdCampaignDetail(
  id: string,
  from: string,
  to: string,
  client?: Client,
): Promise<AdCampaignDetail | null> {
  const supabase = await clientOr(client);
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("id, name, status, objective")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Meta kampanja: ${error.message}`);
  if (!data) return null;

  const rows = await loadInsights(supabase, from, to, id);
  const totals = emptyMetrics();
  const days = rows.map((r) => {
    addRow(totals, r);
    const m = emptyMetrics();
    addRow(m, r);
    return { ...m, date: r.date };
  });

  return { campaign: data as CampaignRow, totals, days: days.reverse() };
}

/* ── poređenje ručno vs automatski (odluka D11) ─────────────────────────── */

/** Ručno unet red koji po opisu liči na Meta naplatu — kandidat za dupli trošak. */
const META_LIKE = /\b(meta|facebook|fb|instagram)\b/i;

export type ManualAdExpense = { date: string; amount: number; description: string | null };

export type AdExpenseMonth = {
  month: string; // YYYY-MM
  /** Automatski red „meta:YYYY-MM" (null dok ga nema). */
  autoRsd: number | null;
  /** Ručni redovi kategorije „Reklame" koji po opisu liče na Meta. */
  manualMeta: ManualAdExpense[];
  /** Ostali ručni redovi kategorije „Reklame" (druge reklame — nisu dupli). */
  manualOther: ManualAdExpense[];
};

/**
 * Po mesecu: automatski Meta trošak naspram ručnih redova kategorije „Reklame".
 * Mesec u kome postoje i automatski red i ručni „Meta …" red je verovatno dupli
 * trošak — korisnik briše ručni posle provere.
 */
export async function getAdExpenseComparison(client?: Client): Promise<AdExpenseMonth[]> {
  const supabase = await clientOr(client);

  type Raw = {
    date: string;
    amount: number;
    description: string | null;
    source: string | null;
    source_key: string | null;
    expense_categories: { name: string } | { name: string }[] | null;
  };

  const rows = await selectAll<Raw>("troškovi reklama", () =>
    supabase
      .from("expenses")
      .select("date, amount, description, source, source_key, expense_categories(name)")
      .order("date", { ascending: true })
      .order("id", { ascending: true }),
  );

  const months = new Map<string, AdExpenseMonth>();
  const get = (month: string) => {
    let m = months.get(month);
    if (!m) {
      m = { month, autoRsd: null, manualMeta: [], manualOther: [] };
      months.set(month, m);
    }
    return m;
  };

  for (const r of rows) {
    if (r.source === "meta" && r.source_key) {
      get(r.source_key.slice("meta:".length)).autoRsd = r.amount;
      continue;
    }
    if (r.source) continue;
    const cat = Array.isArray(r.expense_categories)
      ? r.expense_categories[0]
      : r.expense_categories;
    if (cat?.name?.toLowerCase() !== "reklame") continue;
    const item = { date: r.date, amount: r.amount, description: r.description };
    const m = get(r.date.slice(0, 7));
    if (META_LIKE.test(r.description ?? "")) m.manualMeta.push(item);
    else m.manualOther.push(item);
  }

  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/* ── atribucija: šta kaže sajt (plan Reklame, M3) ───────────────────────── */

/**
 * utm_source koji znači plaćeni Meta oglas. Meta sama dodaje `fb`/`ig`/`th`
 * (Threads)/`an` (Audience Network)/`msg` (Messenger) uz utm_medium=paid.
 */
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "th", "threads", "meta", "an", "msg"]);

export type SiteStats = {
  /** Sve porudžbine (i otkazane/vraćene) — isto kao kartica „Porudžbine" na Dashboardu. */
  orders: number;
  /** Bez Otkazano/Vraćeno. */
  realized: number;
  cancelled: number;
  /** Promet i zarada samo realizovanih, iz ZAMRZNUTIH order_items (§4). */
  revenue: number;
  profit: number;
  /** Realizovane bez VP — zarada im je nepotpuna. */
  needsVp: number;
};

export type AdAttribution = {
  /** Po Meta ID kampanje (poklapanje utm_campaign ↔ ad_campaigns.id, rezerva naziv). */
  byCampaign: Map<string, SiteStats>;
  /** Naziv i status svake kampanje naloga (i one bez potrošnje u periodu). */
  campaignInfo: Map<string, CampaignRow>;
  /** Meta oglas (utm_source facebook/instagram…) bez prepoznate kampanje. */
  metaUnknown: SiteStats;
  /** Drugi izvori: organski, direktno, preporuka, drugi UTM. */
  other: SiteStats;
  /** Porudžbine bez ikakve atribucije (starije od Order Attribution ili ručne). */
  none: SiteStats;
  total: SiteStats;
};

function emptySite(): SiteStats {
  return { orders: 0, realized: 0, cancelled: 0, revenue: 0, profit: 0, needsVp: 0 };
}

type AttrRow = {
  id: string;
  attr_source_type: string | null;
  attr_utm_source: string | null;
  attr_utm_campaign: string | null;
};

/**
 * Porudžbine perioda raspoređene po izvoru. Isti učitavač i pravila kao
 * Dashboard (`loadSales`: `ordered_at` u beogradskim danima, Otkazano/Vraćeno po
 * IMENU, novac iz zamrznutih stavki) → Σ zarade svih korpi = zarada Dashboarda.
 * Kampanja se prepoznaje po ID-u (utm_campaign={{campaign.id}}), rezerva naziv.
 */
export async function getAdAttribution(
  from: string,
  to: string,
  client?: Client,
): Promise<AdAttribution> {
  const supabase = await clientOr(client);
  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);

  const [campaigns, sales, attrRows] = await Promise.all([
    loadCampaigns(supabase),
    loadSales(supabase, from, to),
    selectAll<AttrRow>("atribucija porudžbina", () =>
      supabase
        .from("orders")
        .select("id, attr_source_type, attr_utm_source, attr_utm_campaign")
        .not("ordered_at", "is", null)
        .gte("ordered_at", gteUtc)
        .lt("ordered_at", ltUtc)
        .order("id", { ascending: true }),
    ),
  ]);

  const attrById = new Map(attrRows.map((r) => [r.id, r]));
  const ids = new Set(campaigns.map((c) => c.id));
  const byName = new Map(campaigns.map((c) => [c.name.trim().toLowerCase(), c.id]));

  const out: AdAttribution = {
    byCampaign: new Map(),
    campaignInfo: new Map(campaigns.map((c) => [c.id, c])),
    metaUnknown: emptySite(),
    other: emptySite(),
    none: emptySite(),
    total: emptySite(),
  };

  for (const o of sales.orders) {
    const a = attrById.get(o.id);
    const campaign = a?.attr_utm_campaign?.trim() ?? "";
    const campaignId = ids.has(campaign) ? campaign : byName.get(campaign.toLowerCase());

    let bucket: SiteStats;
    if (campaignId) {
      bucket = out.byCampaign.get(campaignId) ?? emptySite();
      out.byCampaign.set(campaignId, bucket);
    } else if (META_SOURCES.has((a?.attr_utm_source ?? "").trim().toLowerCase())) {
      bucket = out.metaUnknown;
    } else if (a?.attr_source_type || a?.attr_utm_source) {
      bucket = out.other;
    } else {
      bucket = out.none;
    }

    for (const b of [bucket, out.total]) {
      b.orders++;
      if (o.cancelled) {
        b.cancelled++;
        continue;
      }
      const { revenue, profit } = sumItems(o.items);
      b.realized++;
      b.revenue += revenue;
      b.profit += profit;
      if (o.needs_vp) b.needsVp++;
    }
  }

  return out;
}
