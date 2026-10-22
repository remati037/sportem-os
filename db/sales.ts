import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { chunked, mustRows, selectAll, selectAllByIdShards } from "@/lib/supabase/paginate";
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

type OrderRow = {
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
};

const ORDER_COLS =
  "id, woo_order_id, ordered_at, status_id, delivery_method, payment_status, customer_id, ship_name, ship_city, needs_vp, goods_total";
const ITEM_COLS = "order_id, sku, product_name, quantity, mp_at_sale, profit_at_sale";

async function statusNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const rows = mustRows<{ id: string; name: string }>(
    await supabase.from("order_statuses").select("id, name"),
    "AI: statusi",
  );
  return new Map(rows.map((s) => [s.id, s.name]));
}

/** Zajednička pravila: celi beogradski dani + Otkazano/Vraćeno po IMENU. */
function toOrders(rows: OrderRow[], statusName: Map<string, string>, from: string, to: string) {
  const orders: SaleOrder[] = [];
  for (const r of rows) {
    const day = belgradeDate(r.ordered_at);
    if (day < from || day > to) continue;
    const status = statusName.get(r.status_id) ?? "Nepoznat";
    orders.push({ ...r, day, status, cancelled: isCancelStatusName(status), items: [] });
  }
  return orders;
}

export async function loadSales(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<Sales> {
  const statusName = await statusNames(supabase);

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);
  const rows = await selectAll<OrderRow>("AI: porudžbine", () =>
    supabase
      .from("orders")
      .select(ORDER_COLS)
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  const orders = toOrders(rows, statusName, from, to);
  const byId = new Map(orders.map((o) => [o.id, o]));
  // Parčad se čitaju PARALELNO (Računica P6). Svako parče je svoj skup
  // porudžbina, pa redosled stavki unutar porudžbine (po `id`) ostaje isti.
  const parts = await Promise.all(
    chunked(orders.map((o) => o.id)).map((chunk) =>
      selectAll<SaleItem & { order_id: string }>("AI: stavke", () =>
        supabase
          .from("order_items")
          .select(ITEM_COLS)
          .in("order_id", chunk)
          .order("id", { ascending: true }),
      ),
    ),
  );
  for (const items of parts) {
    for (const { order_id, ...it } of items) byId.get(order_id)?.items.push(it);
  }

  return { from, to, orders };
}

/**
 * Isto što i `loadSales`, ali za ŠIROK raspon (cela istorija — Računica):
 * statusi, porudžbine i stavke se čitaju ISTOVREMENO, porudžbine i stavke
 * cele tabele kroz 4 UUID opsega (`selectAllByIdShards`, obrazac `/kupci`),
 * umesto „porudžbine pa stavke po 200". Za uzak period (AI alat za jedan
 * mesec) `loadSales` je jeftiniji jer ne čita stavke koje mu ne trebaju.
 * Rezultat je isti kao `loadSales(from, to)`: isti filteri, porudžbine po
 * `ordered_at` pa `id`, stavke unutar porudžbine po `id`.
 */
export async function loadSalesWide(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<Sales> {
  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);
  const [statusName, rows, items] = await Promise.all([
    statusNames(supabase),
    selectAllByIdShards<OrderRow>("AI: porudžbine (široko)", (lo, hi) => {
      const q = supabase
        .from("orders")
        .select(ORDER_COLS)
        .not("ordered_at", "is", null)
        .gte("ordered_at", gteUtc)
        .lt("ordered_at", ltUtc)
        .gte("id", lo);
      return (hi ? q.lt("id", hi) : q).order("id", { ascending: true });
    }),
    selectAllByIdShards<SaleItem & { id: string; order_id: string }>(
      "AI: stavke (široko)",
      (lo, hi) => {
        const q = supabase.from("order_items").select(`id, ${ITEM_COLS}`).gte("id", lo);
        return (hi ? q.lt("id", hi) : q).order("id", { ascending: true });
      },
    ),
  ]);

  rows.sort((a, b) =>
    a.ordered_at === b.ordered_at ? (a.id < b.id ? -1 : 1) : a.ordered_at < b.ordered_at ? -1 : 1,
  );
  const orders = toOrders(rows, statusName, from, to);
  const byId = new Map(orders.map((o) => [o.id, o]));
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const it of items) {
    byId.get(it.order_id)?.items.push({
      sku: it.sku,
      product_name: it.product_name,
      quantity: it.quantity,
      mp_at_sale: it.mp_at_sale,
      profit_at_sale: it.profit_at_sale,
    });
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
