import "server-only";

import * as Sentry from "@sentry/nextjs";

import {
  fetchPackageStats,
  fetchPackages,
  offersConfigured,
  type PackageApi,
  type PackageStatsApi,
} from "@/lib/offers/client";

/*
 * Paketi (setovi) sa sajta — sklapanje sastava (`/packages`) i statistike
 * (`/packages/stats?days=N`) za stranicu `/ponude/paketi`.
 *
 * Čita se UŽIVO iz plugina (bez Supabase tabela): statistika je pluginova i
 * oslanja se na sesije, koje app nema. Zato ovde, za razliku od pravila ponuda,
 * otkazane porudžbine NISU isključene — cifre su onakve kakve plugin broji.
 *
 * Stope se računaju ovde, iz sesija (ne iz pluginovih `*_rate` polja), da bi
 * definicija bila jasna i ispisana u UI-ju:
 *   stopa dodavanja  = sesije sa dodavanjem / sesije sa pregledom
 *   stopa porudžbine = porudžbine / sesije sa pregledom
 *   prosečna porudžbina = ukupan iznos tih porudžbina / porudžbine
 */

export type PackageCounters = {
  archiveViews: number;
  cardClicks: number;
  views: number;
  viewSessions: number;
  addSessions: number;
  addAll: number;
  addAllBlocked: number;
  addItem: number;
  optionalAdd: number;
  unlockSessions: number;
  giftChoice: number;
  upsellViews: number;
  upsellAdds: number;
  upsellOrders: number;
  upsellRevenue: number;
  orders: number;
  times: number;
  revenue: number;
  orderTotal: number;
  partialOrders: number;
  partialRevenue: number;
  ebookSent: number;
  addRate: number;
  orderRate: number;
  aov: number;
};

export type PackageOverviewRow = PackageCounters & {
  id: number;
  title: string;
  /** Paket iz statistike koga više nema u `/packages` → null. */
  pkg: PackageApi | null;
};

export type PackagesOverview = {
  configured: boolean;
  error: string | null;
  days: number;
  archiveUrl: string | null;
  archiveViews: number;
  aov: { withOrders: number; withAov: number; withoutOrders: number; withoutAov: number } | null;
  rows: PackageOverviewRow[];
  totals: PackageCounters;
};

function n(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function countersOf(s: PackageStatsApi | undefined): PackageCounters {
  const c = {
    archiveViews: n(s?.archive_view),
    cardClicks: n(s?.card_click),
    views: n(s?.view),
    viewSessions: n(s?.view_sessions),
    addSessions: n(s?.add_sessions),
    addAll: n(s?.add_all),
    addAllBlocked: n(s?.add_all_blocked),
    addItem: n(s?.add_item),
    optionalAdd: n(s?.optional_add),
    unlockSessions: n(s?.unlock_sessions),
    giftChoice: n(s?.gift_choice),
    upsellViews: n(s?.upsell_view),
    upsellAdds: n(s?.upsell_add),
    upsellOrders: n(s?.upsell_orders),
    upsellRevenue: n(s?.upsell_revenue),
    orders: n(s?.orders),
    times: n(s?.times),
    revenue: n(s?.revenue),
    orderTotal: n(s?.order_total),
    partialOrders: n(s?.partial_orders),
    partialRevenue: n(s?.partial_revenue),
    ebookSent: n(s?.ebook_sent),
  };
  return withRates(c);
}

function withRates(c: Omit<PackageCounters, "addRate" | "orderRate" | "aov">): PackageCounters {
  return {
    ...c,
    addRate: ratio(c.addSessions, c.viewSessions),
    orderRate: ratio(c.orders, c.viewSessions),
    aov: ratio(c.orderTotal, c.orders),
  };
}

const SUM_KEYS = [
  "archiveViews",
  "cardClicks",
  "views",
  "viewSessions",
  "addSessions",
  "addAll",
  "addAllBlocked",
  "addItem",
  "optionalAdd",
  "unlockSessions",
  "giftChoice",
  "upsellViews",
  "upsellAdds",
  "upsellOrders",
  "upsellRevenue",
  "orders",
  "times",
  "revenue",
  "orderTotal",
  "partialOrders",
  "partialRevenue",
  "ebookSent",
] as const;

function totalsOf(rows: PackageCounters[]): PackageCounters {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<
    (typeof SUM_KEYS)[number],
    number
  >;
  for (const r of rows) for (const k of SUM_KEYS) t[k] += r[k];
  // Zbirne stope iz zbirova, ne prosek stopa po paketu.
  return withRates(t);
}

/** Objavljeni prvo, pa redosled sa sajta (`order`), pa naziv. */
function sortRows(rows: PackageOverviewRow[]): PackageOverviewRow[] {
  return rows.sort((a, b) => {
    const pa = a.pkg?.status === "publish" ? 0 : 1;
    const pb = b.pkg?.status === "publish" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const oa = a.pkg?.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.pkg?.order ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.title.localeCompare(b.title, "sr-RS");
  });
}

/**
 * Paketi + statistika za poslednjih `days` dana. Nikad ne baca: greška plugina
 * se vrati u `error` (i Sentry), da stranica prikaže poruku umesto da padne.
 */
export async function getPackagesOverview(days: number): Promise<PackagesOverview> {
  const empty: PackagesOverview = {
    configured: offersConfigured(),
    error: null,
    days,
    archiveUrl: null,
    archiveViews: 0,
    aov: null,
    rows: [],
    totals: totalsOf([]),
  };

  if (!empty.configured) {
    return {
      ...empty,
      error: "Plugin nije podešen — nedostaje SPORTEM_WP_URL ili SPORTEM_OFFERS_API_KEY.",
    };
  }

  try {
    const [catalog, stats] = await Promise.all([fetchPackages(), fetchPackageStats(days)]);

    const statsById = new Map(stats.packages.map((s) => [n(s.package_id), s]));

    const rows: PackageOverviewRow[] = catalog.packages.map((pkg) => {
      const s = statsById.get(pkg.id);
      statsById.delete(pkg.id);
      return { id: pkg.id, title: pkg.title, pkg, ...countersOf(s) };
    });

    // Statistika paketa kojih više nema na sajtu — istorija se ne krije.
    for (const s of statsById.values()) {
      rows.push({
        id: n(s.package_id),
        title: s.title || `Paket ${s.package_id}`,
        pkg: null,
        ...countersOf(s),
      });
    }

    const aov = stats.aov
      ? {
          withOrders: n(stats.aov.with_orders),
          withAov: n(stats.aov.with_aov),
          withoutOrders: n(stats.aov.without_orders),
          withoutAov: n(stats.aov.without_aov),
        }
      : null;

    return {
      ...empty,
      archiveUrl: catalog.archive ?? null,
      archiveViews: n(stats.archive?.views),
      aov,
      rows: sortRows(rows),
      totals: totalsOf(rows),
    };
  } catch (err) {
    Sentry.captureException(err);
    return {
      ...empty,
      error: err instanceof Error ? err.message : "Paketi se ne mogu učitati sa sajta.",
    };
  }
}
