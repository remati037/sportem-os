import "server-only";

import * as Sentry from "@sentry/nextjs";

import {
  CART_STATS_MAX_DAYS,
  fetchCartStats,
  offersConfigured,
  type CartStatsApi,
} from "@/lib/offers/client";
import type { OfferPeriod } from "@/lib/offers/period";
import { createClient } from "@/lib/supabase/server";
import { isCancelStatusName } from "@/lib/woo";

/*
 * Napuštene korpe za stranicu `/ponude/korpe`, iz dva izvora:
 *
 *   1. Plugin „Sportem Korpa" (`/sportem-korpa/v1/stats`, uživo): uhvaćene
 *      korpe, poslati mejlovi, otvaranja, klikovi, odjave. To app nema.
 *   2. Supabase: porudžbine koje su stigle preko linka iz mejla — Woo ih
 *      obeleži sa `utm_medium=abandoned_cart` (`utm_campaign` = podsetnik_1|2).
 *      Ovo je izvor istine za broj i iznos: ima pravi status, pa se otkazane
 *      i vraćene vide i ne ulaze u zbir.
 *
 * Plugin čuva korpe 60 dana, pa za 90 dana deo iz plugina pokriva 60.
 */

export type CartRecoveredOrder = {
  id: string;
  wooOrderId: number | null;
  name: string | null;
  goodsTotal: number;
  orderedAt: string;
  /** „podsetnik_1" | „podsetnik_2" | null */
  campaign: string | null;
  statusName: string | null;
  statusColor: string | null;
  cancelled: boolean;
};

export type CartsOverview = {
  error: string | null;
  ordersError: string | null;
  /** Koliko dana pokriva statistika iz plugina (najviše 60). */
  pluginDays: number;
  stats: CartStatsApi | null;
  orders: CartRecoveredOrder[];
  /** Zbir porudžbina sa linka bez otkazanih/vraćenih. */
  ordersValid: number;
  revenueValid: number;
};

type OrderRow = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  goods_total: number | null;
  ordered_at: string;
  attr_utm_campaign: string | null;
  status: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
};

async function loadOrders(period: OfferPeriod): Promise<CartRecoveredOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, woo_order_id, ship_name, goods_total, ordered_at, attr_utm_campaign, status:order_statuses(name, color)",
    )
    .eq("attr_utm_medium", "abandoned_cart")
    .gte("ordered_at", period.fromUtc)
    .lt("ordered_at", period.toUtc)
    .order("ordered_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Porudžbine sa linka: ${error.message}`);

  return (data as OrderRow[]).map((o) => {
    const st = Array.isArray(o.status) ? o.status[0] : o.status;
    return {
      id: o.id,
      wooOrderId: o.woo_order_id,
      name: o.ship_name,
      goodsTotal: o.goods_total ?? 0,
      orderedAt: o.ordered_at,
      campaign: o.attr_utm_campaign,
      statusName: st?.name ?? null,
      statusColor: st?.color ?? null,
      cancelled: st ? isCancelStatusName(st.name) : false,
    };
  });
}

/** Nikad ne baca: greške idu u `error` / `ordersError` (i Sentry). */
export async function getCartsOverview(period: OfferPeriod): Promise<CartsOverview> {
  const out: CartsOverview = {
    error: null,
    ordersError: null,
    pluginDays: Math.min(period.days, CART_STATS_MAX_DAYS),
    stats: null,
    orders: [],
    ordersValid: 0,
    revenueValid: 0,
  };

  const [stats, orders] = await Promise.allSettled([
    offersConfigured()
      ? fetchCartStats(period.days)
      : Promise.reject(
          new Error("Plugin nije podešen — nedostaje SPORTEM_WP_URL ili SPORTEM_OFFERS_API_KEY."),
        ),
    loadOrders(period),
  ]);

  if (stats.status === "fulfilled") {
    out.stats = stats.value;
  } else {
    Sentry.captureException(stats.reason);
    out.error =
      stats.reason instanceof Error
        ? stats.reason.message
        : "Statistika se ne može učitati sa sajta.";
  }

  if (orders.status === "fulfilled") {
    out.orders = orders.value;
    for (const o of out.orders) {
      if (o.cancelled) continue;
      out.ordersValid += 1;
      out.revenueValid += o.goodsTotal;
    }
  } else {
    Sentry.captureException(orders.reason);
    out.ordersError =
      orders.reason instanceof Error ? orders.reason.message : "Porudžbine se ne mogu učitati.";
  }

  return out;
}
