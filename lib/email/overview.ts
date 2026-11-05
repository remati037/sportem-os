import "server-only";

import * as Sentry from "@sentry/nextjs";

import {
  brevoConfigured,
  fetchCampaign,
  fetchCampaigns,
  type BrevoCampaign,
} from "@/lib/email/brevo";
import type { OfferPeriod } from "@/lib/offers/period";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import { isCancelStatusName } from "@/lib/woo";

/*
 * Mejlovi kupcima za stranicu `/ponude/mejlovi`, iz dva izvora (obrazac Korpe):
 *
 *   1. Brevo (uživo): poslato, isporučeno, otvaranja, klikovi, odjave, spam,
 *      klikovi po linku. To app nema.
 *   2. Supabase: porudžbine sa linka iz mejla — Woo ih obeleži sa
 *      `utm_source=email` i `utm_medium=email` (`utm_campaign` = kampanja,
 *      `utm_content` = koje dugme). Ovo je izvor istine za broj, iznos i zaradu:
 *      ima pravi status, pa otkazane i vraćene ne ulaze u zbir.
 *
 * Veza kampanja ↔ porudžbine je `utm_campaign`, koji se čita iz linkova u mejlu.
 * Podsetnici za napuštene korpe imaju `utm_medium=abandoned_cart` i ovde ne ulaze.
 */

export type EmailOrder = {
  id: string;
  wooOrderId: number | null;
  name: string | null;
  goodsTotal: number;
  /** Zbir `profit_at_sale` stavki; stavke bez VP se preskaču. */
  profit: number;
  orderedAt: string;
  campaign: string | null;
  content: string | null;
  statusName: string | null;
  statusColor: string | null;
  cancelled: boolean;
};

export type CampaignRow = BrevoCampaign & {
  orders: number;
  revenue: number;
  profit: number;
};

type Totals = {
  sent: number;
  opened: number;
  clicked: number;
  unsub: number;
  complaints: number;
  orders: number;
  revenue: number;
  profit: number;
};

export type EmailOverview = {
  error: string | null;
  ordersError: string | null;
  campaigns: CampaignRow[];
  totals: Totals;
  orders: EmailOrder[];
};

type OrderRow = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  goods_total: number | null;
  ordered_at: string;
  attr_utm_campaign: string | null;
  attr_utm_content: string | null;
  status: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
  order_items: { profit_at_sale: number | null }[] | null;
};

async function loadOrders(
  fromUtc: string,
  toUtc: string,
  campaign?: string,
): Promise<EmailOrder[]> {
  const supabase = await createClient();
  const rows = await selectAll<OrderRow>("mejlovi: porudžbine", () => {
    let q = supabase
      .from("orders")
      .select(
        "id, woo_order_id, ship_name, goods_total, ordered_at, attr_utm_campaign, attr_utm_content, status:order_statuses(name, color), order_items(profit_at_sale)",
      )
      .eq("attr_utm_source", "email")
      .eq("attr_utm_medium", "email")
      .gte("ordered_at", fromUtc)
      .lt("ordered_at", toUtc);
    if (campaign) q = q.eq("attr_utm_campaign", campaign);
    return q.order("ordered_at", { ascending: false }).order("id", { ascending: true });
  });

  return rows.map((o) => {
    const st = Array.isArray(o.status) ? o.status[0] : o.status;
    return {
      id: o.id,
      wooOrderId: o.woo_order_id,
      name: o.ship_name,
      goodsTotal: o.goods_total ?? 0,
      profit: (o.order_items ?? []).reduce((s, i) => s + (i.profit_at_sale ?? 0), 0),
      orderedAt: o.ordered_at,
      campaign: o.attr_utm_campaign,
      content: o.attr_utm_content,
      statusName: st?.name ?? null,
      statusColor: st?.color ?? null,
      cancelled: st ? isCancelStatusName(st.name) : false,
    };
  });
}

function sumOrders(orders: EmailOrder[]) {
  const t = { orders: 0, revenue: 0, profit: 0 };
  for (const o of orders) {
    if (o.cancelled) continue;
    t.orders += 1;
    t.revenue += o.goodsTotal;
    t.profit += o.profit;
  }
  return t;
}

/** Kampanja ulazi u period ako je poslata u njemu ili je zakazana/šalje se. */
function inPeriod(c: BrevoCampaign, period: OfferPeriod): boolean {
  if (c.status === "queued" || c.status === "inProcess") return true;
  const at = c.sentDate ?? c.scheduledAt;
  return at !== null && at >= period.fromUtc && at < period.toUtc;
}

/** Nikad ne baca: greške idu u `error` / `ordersError` (i Sentry). */
export async function getEmailOverview(period: OfferPeriod): Promise<EmailOverview> {
  const out: EmailOverview = {
    error: null,
    ordersError: null,
    campaigns: [],
    totals: {
      sent: 0,
      opened: 0,
      clicked: 0,
      unsub: 0,
      complaints: 0,
      orders: 0,
      revenue: 0,
      profit: 0,
    },
    orders: [],
  };

  const [campaigns, orders] = await Promise.allSettled([
    brevoConfigured()
      ? fetchCampaigns()
      : Promise.reject(new Error("Brevo nije povezan — nedostaje BREVO_API_KEY.")),
    loadOrders(period.fromUtc, period.toUtc),
  ]);

  if (orders.status === "fulfilled") {
    out.orders = orders.value;
  } else {
    Sentry.captureException(orders.reason);
    out.ordersError =
      orders.reason instanceof Error ? orders.reason.message : "Porudžbine se ne mogu učitati.";
  }

  if (campaigns.status === "fulfilled") {
    out.campaigns = campaigns.value
      .filter((c) => inPeriod(c, period))
      .map((c) => ({
        ...c,
        ...sumOrders(out.orders.filter((o) => c.utmCampaign && o.campaign === c.utmCampaign)),
      }));
  } else {
    Sentry.captureException(campaigns.reason);
    out.error =
      campaigns.reason instanceof Error
        ? campaigns.reason.message
        : "Kampanje se ne mogu učitati iz Brevoa.";
  }

  for (const c of out.campaigns) {
    out.totals.sent += c.stats.sent;
    out.totals.opened += c.stats.uniqueViews;
    out.totals.clicked += c.stats.clickers;
    out.totals.unsub += c.stats.unsubscriptions;
    out.totals.complaints += c.stats.complaints;
  }
  Object.assign(out.totals, sumOrders(out.orders));
  return out;
}

export type LinkGroup = { key: string; clicks: number };
export type ContentGroup = { key: string; orders: number; revenue: number };

export type CampaignDetail = {
  error: string | null;
  ordersError: string | null;
  campaign: BrevoCampaign | null;
  /** Klikovi po dugmetu (`utm_content`), najviše prvi. */
  linkGroups: LinkGroup[];
  /** Klikovi po stranici (bez UTM-a), najviše prvih 15. */
  topLinks: LinkGroup[];
  orders: EmailOrder[];
  /** Porudžbine po dugmetu (`utm_content`), bez otkazanih. */
  contentGroups: ContentGroup[];
  totals: { orders: number; revenue: number; profit: number };
};

function linkKey(url: string): { content: string | null; page: string } {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    return { content: u.searchParams.get("utm_content"), page: `${u.hostname}${u.pathname}` };
  } catch {
    return { content: null, page: url };
  }
}

/** Nikad ne baca: greške idu u `error` / `ordersError`. */
export async function getCampaignDetail(id: number): Promise<CampaignDetail> {
  const out: CampaignDetail = {
    error: null,
    ordersError: null,
    campaign: null,
    linkGroups: [],
    topLinks: [],
    orders: [],
    contentGroups: [],
    totals: { orders: 0, revenue: 0, profit: 0 },
  };

  if (!brevoConfigured()) {
    out.error = "Brevo nije povezan — nedostaje BREVO_API_KEY.";
    return out;
  }
  try {
    out.campaign = await fetchCampaign(id);
  } catch (err) {
    Sentry.captureException(err);
    out.error = err instanceof Error ? err.message : "Kampanja se ne može učitati iz Brevoa.";
    return out;
  }

  const byContent = new Map<string, number>();
  const byPage = new Map<string, number>();
  for (const [url, clicks] of Object.entries(out.campaign.links ?? {})) {
    const k = linkKey(url);
    byContent.set(k.content ?? "ostalo", (byContent.get(k.content ?? "ostalo") ?? 0) + clicks);
    byPage.set(k.page, (byPage.get(k.page) ?? 0) + clicks);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].map(([key, clicks]) => ({ key, clicks })).sort((a, b) => b.clicks - a.clicks);
  out.linkGroups = sorted(byContent);
  out.topLinks = sorted(byPage).slice(0, 15);

  const utm = out.campaign.utmCampaign;
  const from = out.campaign.sentDate ?? out.campaign.scheduledAt;
  if (utm && from) {
    try {
      out.orders = await loadOrders(from, new Date(Date.now() + 86_400_000).toISOString(), utm);
    } catch (err) {
      Sentry.captureException(err);
      out.ordersError = err instanceof Error ? err.message : "Porudžbine se ne mogu učitati.";
    }
  }

  out.totals = sumOrders(out.orders);
  const groups = new Map<string, ContentGroup>();
  for (const o of out.orders) {
    if (o.cancelled) continue;
    const key = o.content ?? "ostalo";
    const g = groups.get(key) ?? { key, orders: 0, revenue: 0 };
    g.orders += 1;
    g.revenue += o.goodsTotal;
    groups.set(key, g);
  }
  out.contentGroups = [...groups.values()].sort((a, b) => b.revenue - a.revenue);
  return out;
}
