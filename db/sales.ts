import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { chunked, mustRows, selectAll } from "@/lib/supabase/paginate";
import { isCancelStatusName } from "@/lib/woo";

/*
 * Zajednički učitavač prodaje (Korak A3; premešten iz lib/ai/tools/ u P1 Računice
 * jer ga koriste i AI alati, i Dashboard grafikoni, i /racunica). ISTA pravila kao
 * `computePeriodMetrics` (db/metrics.ts), da se cifre poklapaju sa Dashboardom:
 *   - period po datumu KREIRANJA (`ordered_at`), celi beogradski dani;
 *   - Otkazano/Vraćeno se prepoznaju po IMENU (`isCancelStatusName`);
 *   - promet/zarada ISKLJUČIVO iz zamrznutih `order_items` (mp_at_sale,
 *     profit_at_sale) — nikad iz kataloga (CLAUDE.md §4);
 *   - paginacija i `.in()` parčad kroz `lib/supabase/paginate`.
 * Čita RLS klijentom korisnika (Admin/Menadžer vide prodaju; Logistika ništa).
 */

export type SaleItem = {
  sku: string;
  product_name: string;
  quantity: number;
  mp_at_sale: number;
  profit_at_sale: number | null;
};

export type SaleOrder = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string;
  day: string; // YYYY-MM-DD (Belgrade)
  status: string;
  cancelled: boolean; // Otkazano ili Vraćeno
  delivery_method: string;
  payment_status: string;
  customer_id: string | null;
  ship_name: string | null;
  ship_city: string | null;
  needs_vp: boolean;
  goods_total: number | null;
  items: SaleItem[];
};

export type Sales = { from: string; to: string; orders: SaleOrder[] };

/** Promet (Σ mp×kol) i zarada (Σ profit) za listu stavki. */
export function sumItems(items: SaleItem[]) {
  let revenue = 0;
  let profit = 0;
  let quantity = 0;
  for (const it of items) {
    revenue += it.mp_at_sale * it.quantity;
    profit += it.profit_at_sale ?? 0;
    quantity += it.quantity;
  }
  return { revenue, profit, quantity };
}

export async function loadSales(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<Sales> {
  const statusRows = mustRows<{ id: string; name: string }>(
    await supabase.from("order_statuses").select("id, name"),
    "AI: statusi",
  );
  const statusName = new Map(statusRows.map((s) => [s.id, s.name]));

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);
  const rows = await selectAll<{
    id: string;
    woo_order_id: number | null;
    ordered_at: string;
    status_id: string;
    delivery_method: string;
    payment_status: string;
    customer_id: string | null;
    ship_name: string | null;
    ship_city: string | null;
    needs_vp: boolean;
    goods_total: number | null;
  }>("AI: porudžbine", () =>
    supabase
      .from("orders")
      .select(
        "id, woo_order_id, ordered_at, status_id, delivery_method, payment_status, customer_id, ship_name, ship_city, needs_vp, goods_total",
      )
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  const orders: SaleOrder[] = [];
  for (const r of rows) {
    const day = belgradeDate(r.ordered_at);
    if (day < from || day > to) continue;
    const status = statusName.get(r.status_id) ?? "Nepoznat";
    orders.push({ ...r, day, status, cancelled: isCancelStatusName(status), items: [] });
  }

  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const chunk of chunked(orders.map((o) => o.id))) {
    const items = await selectAll<SaleItem & { order_id: string }>("AI: stavke", () =>
      supabase
        .from("order_items")
        .select("order_id, sku, product_name, quantity, mp_at_sale, profit_at_sale")
        .in("order_id", chunk)
        .order("id", { ascending: true }),
    );
    for (const { order_id, ...it } of items) byId.get(order_id)?.items.push(it);
  }

  return { from, to, orders };
}

/** Ključ grupisanja po vremenu: dan / nedelja (ponedeljak) / mesec. */
export function bucketOf(day: string, grain: "dan" | "nedelja" | "mesec"): string {
  if (grain === "dan") return day;
  if (grain === "mesec") return day.slice(0, 7);
  const d = new Date(`${day}T12:00:00Z`);
  const offsetToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offsetToMonday);
  return d.toISOString().slice(0, 10);
}

/** Normalizacija za pretragu po nazivu/SKU (mala slova, bez dijakritika). */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
}
