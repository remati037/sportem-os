import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { OfferPeriod } from "@/lib/offers/period";

/*
 * Upiti modula Ponude. Čitaju kroz RLS klijent: Admin i Menadžer vide sve,
 * Logistika ništa (offer_* tabele nemaju politiku za nju — deny-by-default,
 * kao finansije i tiketi).
 *
 * Agregacije idu kroz SQL funkcije (`offer_rule_stats`, `offer_daily_stats`,
 * `offer_placement_stats`) — NIKAD kroz čitanje sirovih događaja: PostgREST u
 * ovom projektu tvrdo seče na 1000 redova, pa bi cifre tiho bile umanjene.
 * Funkcije su security invoker, tako da RLS i dalje važi.
 *
 * Otkazane i vraćene porudžbine su isključene iz „porudžbine" i „prihod" —
 * to radi sama SQL funkcija (spoj offer_events.order_id → orders.woo_order_id).
 */

/** PostgREST numeric ume da stigne kao string — cifra se uvek prisili na broj. */
function n(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type OfferRuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  placements: string[];
  offer_product: number | null;
  offer_sku: string | null;
  offer_name: string | null;
  price_rule: string | null;
  conditions: string | null;
  wp_updated_at: string | null;
  synced_at: string | null;
};

export type OfferStatsRow = {
  rule_id: string;
  impressions: number;
  adds: number;
  removes: number;
  orders: number;
  revenue: number;
  add_rate: number;
};

/** Pravilo + njegove cifre za izabrani period. */
export type OfferRuleStats = OfferStatsRow & {
  rule: OfferRuleRow | null;
  /** Naziv za prikaz: iz pravila, a kad je pravilo obrisano iz plugina — šifra. */
  name: string;
};

export type OfferTotals = {
  impressions: number;
  adds: number;
  removes: number;
  orders: number;
  revenue: number;
  addRate: number;
};

export type OfferDailyRow = { dan: string; adds: number; revenue: number };

export type OfferPlacementRow = {
  placement: string;
  impressions: number;
  adds: number;
  orders: number;
  revenue: number;
};

export type OfferSyncState = {
  last_event_id: number;
  last_synced_at: string | null;
  last_error: string | null;
};

/* ── osnovni upiti ────────────────────────────────────────────────────────── */

/** Sva pravila (ogledalo plugina), aktivna prvo pa po prioritetu. */
export async function listOfferRules(): Promise<OfferRuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offer_rules")
    .select(
      "id, name, active, priority, placements, offer_product, offer_sku, offer_name, price_rule, conditions, wp_updated_at, synced_at",
    )
    .order("active", { ascending: false })
    .order("priority", { ascending: false });

  if (error) throw new Error(`Pravila ponuda: ${error.message}`);
  return (data ?? []) as OfferRuleRow[];
}

export async function getOfferRule(id: string): Promise<OfferRuleRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offer_rules")
    .select(
      "id, name, active, priority, placements, offer_product, offer_sku, offer_name, price_rule, conditions, wp_updated_at, synced_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Pravilo ponude: ${error.message}`);
  return (data as OfferRuleRow | null) ?? null;
}

export async function getOfferSyncState(): Promise<OfferSyncState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offer_sync_state")
    .select("last_event_id, last_synced_at, last_error")
    .eq("key", "offers")
    .maybeSingle();

  if (error) throw new Error(`Stanje sinhronizacije: ${error.message}`);
  if (!data) return null;
  return {
    last_event_id: n(data.last_event_id),
    last_synced_at: data.last_synced_at,
    last_error: data.last_error,
  };
}

/** Ima li uopšte ijedan događaj (razlika „nema podataka" od „nema u periodu"). */
export async function hasOfferEvents(): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("offer_events")
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(`Broj događaja: ${error.message}`);
  return (count ?? 0) > 0;
}

/* ── agregacije (SQL funkcije) ────────────────────────────────────────────── */

export async function getOfferStats(period: OfferPeriod): Promise<OfferStatsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_rule_stats", {
    p_from: period.fromUtc,
    p_to: period.toUtc,
  });

  if (error) throw new Error(`Statistika ponuda: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    rule_id: String(r.rule_id ?? ""),
    impressions: n(r.impressions),
    adds: n(r.adds),
    removes: n(r.removes),
    orders: n(r.orders),
    revenue: n(r.revenue),
    add_rate: n(r.add_rate),
  }));
}

export async function getOfferDaily(
  period: OfferPeriod,
  ruleId?: string,
): Promise<OfferDailyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_daily_stats", {
    p_from: period.fromUtc,
    p_to: period.toUtc,
    p_rule_id: ruleId ?? null,
  });

  if (error) throw new Error(`Dnevna serija ponuda: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    dan: String(r.dan ?? ""),
    adds: n(r.adds),
    revenue: n(r.revenue),
  }));
}

export async function getOfferPlacements(
  period: OfferPeriod,
  ruleId?: string,
): Promise<OfferPlacementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_placement_stats", {
    p_from: period.fromUtc,
    p_to: period.toUtc,
    p_rule_id: ruleId ?? null,
  });

  if (error) throw new Error(`Podela po mestu prikaza: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    placement: String(r.placement ?? "—"),
    impressions: n(r.impressions),
    adds: n(r.adds),
    orders: n(r.orders),
    revenue: n(r.revenue),
  }));
}

/* ── sklopljeni pogledi za stranicu ───────────────────────────────────────── */

const EMPTY_STATS = {
  impressions: 0,
  adds: 0,
  removes: 0,
  orders: 0,
  revenue: 0,
  add_rate: 0,
} as const;

function totalsOf(rows: OfferStatsRow[]): OfferTotals {
  const t = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      adds: acc.adds + r.adds,
      removes: acc.removes + r.removes,
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
    }),
    { impressions: 0, adds: 0, removes: 0, orders: 0, revenue: 0 },
  );
  // Zbirna stopa se računa iz zbirova, ne kao prosek stopa po pravilu.
  return { ...t, addRate: t.impressions === 0 ? 0 : t.adds / t.impressions };
}

/**
 * Pregled za `/ponude`: sva pravila sa ciframa perioda + zbirovi + dnevna serija.
 *
 * Pravilo bez ijednog događaja u periodu se i dalje prikazuje (sa nulama) — da
 * se vidi da postoji; događaj čije je pravilo obrisano iz plugina se takođe
 * prikazuje (istorija se ne gubi), samo bez naziva.
 */
export async function getOffersOverview(period: OfferPeriod): Promise<{
  rules: OfferRuleStats[];
  totals: OfferTotals;
  daily: OfferDailyRow[];
}> {
  const [rules, stats, daily] = await Promise.all([
    listOfferRules(),
    getOfferStats(period),
    getOfferDaily(period),
  ]);

  const byRule = new Map(stats.map((s) => [s.rule_id, s]));

  const rows: OfferRuleStats[] = rules.map((rule) => {
    const s = byRule.get(rule.id) ?? { rule_id: rule.id, ...EMPTY_STATS };
    byRule.delete(rule.id);
    return { ...s, rule, name: rule.name };
  });

  // Ostatak: cifre za pravila kojih više nema u pluginu.
  for (const s of byRule.values()) {
    rows.push({ ...s, rule: null, name: s.rule_id || "Nepoznato pravilo" });
  }

  return { rules: rows, totals: totalsOf(stats), daily };
}

/** Detalj jednog pravila: cifre perioda, podela po mestu, dnevna serija. */
export async function getOfferRuleDetail(
  ruleId: string,
  period: OfferPeriod,
): Promise<{
  rule: OfferRuleRow | null;
  stats: OfferStatsRow;
  placements: OfferPlacementRow[];
  daily: OfferDailyRow[];
} | null> {
  const [rule, stats, placements, daily] = await Promise.all([
    getOfferRule(ruleId),
    getOfferStats(period),
    getOfferPlacements(period, ruleId),
    getOfferDaily(period, ruleId),
  ]);

  const mine = stats.find((s) => s.rule_id === ruleId);
  // Ni pravila ni ijednog događaja — pravilo ne postoji.
  if (!rule && !mine) return null;

  return {
    rule,
    stats: mine ?? { rule_id: ruleId, ...EMPTY_STATS },
    placements,
    daily,
  };
}
