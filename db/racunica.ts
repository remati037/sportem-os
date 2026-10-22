import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { todayBelgrade } from "@/lib/date-belgrade";
import { DATA_START, presetBounds } from "@/lib/period";
import { addVelocity, emptyVelocity, type Velocity } from "@/lib/sales-velocity";
import { selectAll } from "@/lib/supabase/paginate";
import { loadSales } from "@/db/sales";
import {
  OUT_OF_CATALOG_KEY,
  addStats,
  emptyStats,
  shiftDay,
  marginPct,
  type RacunicaData,
  type RacunicaRow,
  type RacunicaVariant,
  type SalesStats,
} from "@/lib/racunica";

/*
 * Računica (P1, docs/Sportem-Plan-Racunica.md). Katalog (trenutne cene i stanje)
 * + prodaja u periodu iz `loadSales` (ista pravila kao Dashboard), spojeni po
 * `sku` — `order_items.variant_id` je null na ~93 % istorije. SKU koga nema u
 * katalogu ide u red „Van kataloga" (naziv iz `product_name` snapshot-a), pa
 * Σ zarade svih redova = Dashboard „Zarada" za isti period.
 *
 * Prodaja se čita JEDNOM za celu istoriju (od `DATA_START`) i u memoriji se
 * deli na period i na „poslednju prodaju po SKU" (P2, mrtva roba) — istorija je
 * mala (~1.500 porudžbina), a drugi upit bi čitao iste redove.
 *
 * Čita RLS klijentom (Admin/Menadžer čitaju base `product_variants` sa cenama);
 * opcioni `client` je za AI alat i skripte (obrazac iz db/customers.ts).
 */

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category_id: string | null;
  archived_at: string | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  variant_name: string | null;
  mp_price: number;
  vp_price: number;
  stock_quantity: number;
  stock_counted_at: string | null;
  archived_at: string | null;
};

const skuKey = (sku: string) => sku.trim();

export async function getRacunica(
  { from, to }: { from: string; to: string },
  client?: SupabaseClient,
): Promise<RacunicaData> {
  const supabase = client ?? (await createClient());
  const today = todayBelgrade();

  const [products, variants, categories, sales] = await Promise.all([
    selectAll<ProductRow>("računica: proizvodi", () =>
      supabase
        .from("products")
        .select("id, name, brand, category_id, archived_at")
        .order("id", { ascending: true }),
    ),
    selectAll<VariantRow>("računica: varijante", () =>
      supabase
        .from("product_variants")
        .select(
          "id, product_id, sku, variant_name, mp_price, vp_price, stock_quantity, stock_counted_at, archived_at",
        )
        .order("id", { ascending: true }),
    ),
    selectAll<{ id: string; name: string; sort_order: number }>("računica: kategorije", () =>
      supabase
        .from("categories")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true }),
    ),
    loadSales(supabase, from < DATA_START ? from : DATA_START, to > today ? to : today),
  ]);

  // Iz cele istorije, nezavisno od perioda (gleda unazad od danas):
  //  - poslednja REALIZOVANA prodaja po SKU (P2, mrtva roba);
  //  - komadi po prozorima 30 / 31–60 / 31–90 dana (P3, tempo i trend);
  //  - zarada tekućeg meseca i po danu za 28 punih dana pre danas (P3).
  const d30 = shiftDay(today, -29);
  const d60 = shiftDay(today, -59);
  const d90 = shiftDay(today, -89);
  const d28 = shiftDay(today, -28);
  const month = presetBounds("mesec", today);
  const lastSold = new Map<string, string>();
  const velBySku = new Map<string, Velocity>();
  const dailyProfit = new Map<string, number>();
  let mtdProfit = 0;
  let mtdRevenue = 0;
  for (const order of sales.orders) {
    if (order.cancelled) continue;
    for (const it of order.items) {
      const key = skuKey(it.sku);
      const prev = lastSold.get(key);
      if (!prev || order.day > prev) lastSold.set(key, order.day);

      if (order.day >= d90 && order.day <= today) {
        let v = velBySku.get(key);
        if (!v) velBySku.set(key, (v = emptyVelocity()));
        if (order.day >= d30) v.q30 += it.quantity;
        else {
          v.q31to90 += it.quantity;
          if (order.day >= d60) v.qPrev30 += it.quantity;
        }
      }
      const profit = it.profit_at_sale ?? 0;
      if (order.day >= month.from && order.day <= today) {
        mtdProfit += profit;
        mtdRevenue += it.mp_at_sale * it.quantity;
      }
      if (order.day >= d28 && order.day < today) {
        dailyProfit.set(order.day, (dailyProfit.get(order.day) ?? 0) + profit);
      }
    }
  }
  const last28Profit = Array.from({ length: 28 }, (_, i) => dailyProfit.get(shiftDay(d28, i)) ?? 0);

  // Prodaja po SKU (stavke su hronološki — poslednji snapshot naziv je najnoviji).
  const bySku = new Map<string, { stats: SalesStats; name: string }>();
  for (const order of sales.orders) {
    if (order.day < from || order.day > to) continue;
    for (const it of order.items) {
      const key = skuKey(it.sku);
      let entry = bySku.get(key);
      if (!entry) {
        entry = { stats: emptyStats(), name: it.product_name };
        bySku.set(key, entry);
      }
      entry.name = it.product_name;
      const s = entry.stats;
      if (order.cancelled) {
        s.cancelledQty += it.quantity;
        continue;
      }
      const revenue = it.mp_at_sale * it.quantity;
      s.qty += it.quantity;
      s.revenue += revenue;
      s.profit += it.profit_at_sale ?? 0;
      if (it.profit_at_sale != null) {
        s.knownQty += it.quantity;
        s.knownRevenue += revenue;
        s.knownProfit += it.profit_at_sale;
      }
    }
  }

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const variantsByProduct = new Map<string, VariantRow[]>();
  const catalogSkus = new Set<string>();
  for (const v of variants) {
    catalogSkus.add(skuKey(v.sku));
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const rows: RacunicaRow[] = [];
  for (const p of products) {
    const list = variantsByProduct.get(p.id) ?? [];
    if (list.length === 0) continue; // proizvod bez varijanti nema šta da se računa
    const productArchived = p.archived_at != null;

    const vRows: RacunicaVariant[] = list.map((v) => {
      const sold = bySku.get(skuKey(v.sku));
      const stats = sold ? { ...sold.stats } : emptyStats();
      stats.catalogRevenue = stats.qty * v.mp_price;
      stats.pricedRevenue = stats.revenue;
      return {
        sku: v.sku,
        variantId: v.id,
        label: v.variant_name && v.variant_name !== "Default" ? v.variant_name : "—",
        mp: v.mp_price,
        vp: v.vp_price,
        stock: v.stock_quantity,
        counted: v.stock_counted_at != null,
        archived: productArchived || v.archived_at != null,
        lastSoldDay: lastSold.get(skuKey(v.sku)) ?? null,
        vel: { ...(velBySku.get(skuKey(v.sku)) ?? emptyVelocity()) },
        stats,
      };
    });
    vRows.sort((a, b) => a.label.localeCompare(b.label, "sr", { numeric: true }));

    const active = vRows.filter((v) => !v.archived);
    const priced = active.length > 0 ? active : vRows;
    const stats = emptyStats();
    const vel = emptyVelocity();
    for (const v of vRows) {
      addStats(stats, v.stats);
      addVelocity(vel, v.vel);
    }

    const mps = priced.map((v) => v.mp ?? 0);
    const vps = priced.map((v) => v.vp ?? 0);
    const profits = priced.map((v) => (v.mp ?? 0) - (v.vp ?? 0));
    const sumMp = mps.reduce((a, b) => a + b, 0);
    const sumProfit = profits.reduce((a, b) => a + b, 0);

    let stock = 0;
    let uncounted = 0;
    let stockValueVp = 0;
    for (const v of active) {
      stock += v.stock ?? 0;
      if (!v.counted) uncounted += 1;
      else if ((v.stock ?? 0) > 0) stockValueVp += (v.stock ?? 0) * (v.vp ?? 0);
    }

    rows.push({
      key: p.id,
      productId: p.id,
      name: p.name,
      brand: p.brand?.trim() || null,
      categoryId: p.category_id,
      categoryName: p.category_id ? (catName.get(p.category_id) ?? null) : null,
      archived: productArchived || active.length === 0,
      outOfCatalog: false,
      variants: vRows,
      stats,
      vel,
      mpMin: Math.min(...mps),
      mpMax: Math.max(...mps),
      vpMin: Math.min(...vps),
      vpMax: Math.max(...vps),
      catalogProfitMin: Math.min(...profits),
      catalogProfitMax: Math.max(...profits),
      catalogMarginPct: marginPct(sumProfit, sumMp),
      stock,
      uncounted,
      stockValueVp,
    });
  }

  // SKU-ovi prodati u periodu kojih nema u katalogu.
  const outVariants: RacunicaVariant[] = [];
  for (const [sku, { stats, name }] of bySku) {
    if (catalogSkus.has(sku)) continue;
    outVariants.push({
      sku,
      variantId: null,
      label: name,
      mp: null,
      vp: null,
      stock: null,
      counted: false,
      archived: false,
      lastSoldDay: lastSold.get(sku) ?? null,
      vel: { ...(velBySku.get(sku) ?? emptyVelocity()) },
      stats,
    });
  }
  if (outVariants.length > 0) {
    outVariants.sort((a, b) => b.stats.profit - a.stats.profit);
    const stats = emptyStats();
    const vel = emptyVelocity();
    for (const v of outVariants) {
      addStats(stats, v.stats);
      addVelocity(vel, v.vel);
    }
    rows.push({
      key: OUT_OF_CATALOG_KEY,
      productId: null,
      name: "Van kataloga",
      brand: null,
      categoryId: null,
      categoryName: null,
      archived: false,
      outOfCatalog: true,
      variants: outVariants,
      stats,
      vel,
      mpMin: null,
      mpMax: null,
      vpMin: null,
      vpMax: null,
      catalogProfitMin: null,
      catalogProfitMax: null,
      catalogMarginPct: null,
      stock: 0,
      uncounted: 0,
      stockValueVp: 0,
    });
  }

  const totals = {
    qty: 0,
    revenue: 0,
    profit: 0,
    knownRevenue: 0,
    knownProfit: 0,
    unknownQty: 0,
    cancelledQty: 0,
    stockValueVp: 0,
  };
  for (const r of rows) {
    totals.qty += r.stats.qty;
    totals.revenue += r.stats.revenue;
    totals.profit += r.stats.profit;
    totals.knownRevenue += r.stats.knownRevenue;
    totals.knownProfit += r.stats.knownProfit;
    totals.unknownQty += r.stats.qty - r.stats.knownQty;
    totals.cancelledQty += r.stats.cancelledQty;
    totals.stockValueVp += r.stockValueVp;
  }

  const brands = [...new Set(rows.map((r) => r.brand).filter((b): b is string => !!b))].sort(
    (a, b) => a.localeCompare(b, "sr"),
  );

  return {
    from,
    to,
    today,
    month: {
      monthFrom: month.from,
      monthTo: month.to,
      today,
      mtdProfit,
      mtdRevenue,
      last28Profit,
    },
    rows,
    totals,
    categories: categories.map(({ id, name }) => ({ id, name })),
    brands,
  };
}
