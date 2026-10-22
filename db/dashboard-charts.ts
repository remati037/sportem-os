import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { mustRows } from "@/lib/supabase/paginate";
import { todayBelgrade } from "@/lib/date-belgrade";
import { loadSales, norm, sumItems } from "@/db/sales";

/*
 * Podaci za grafikone na Dashboardu. ISTA pravila kao kartice
 * (`computePeriodMetrics`): period po datumu KREIRANJA (`ordered_at`, celi
 * beogradski dani), Otkazano/Vraćeno po IMENU, promet/zarada ISKLJUČIVO iz
 * zamrznutih `order_items` (§4), artikli grupisani po `sku`. Učitavanje ide kroz
 * zajednički `loadSales` (isti koji koristi AI asistent — dokazano 0 RSD razlike
 * prema Dashboardu, `npm run ai:check`). Samo čita, RLS klijent.
 *
 * Na klijent idu samo zbirovi — nikad ime kupca, telefon ni adresa.
 */

export type ChartDay = {
  day: string; // YYYY-MM-DD (Belgrade)
  revenue: number; // promet realizovanih
  profit: number; // zarada realizovanih
  orders: number; // realizovane porudžbine
  cancelled: number; // otkazane + vraćene
};

export type ChartStatus = { name: string; color: string; count: number };

export type ChartItem = {
  sku: string;
  name: string;
  revenue: number;
  profit: number;
  quantity: number;
};

export type ChartCity = { city: string; orders: number; revenue: number };

export type ChartWeekday = { label: string; orders: number; revenue: number };

export type DashboardCharts = {
  days: ChartDay[]; // svaki dan perioda do danas (i dani bez porudžbina)
  statuses: ChartStatus[]; // svi statusi, po `sort_order`
  topItems: ChartItem[]; // unija top 10 po zaradi / prometu / komadima
  cities: ChartCity[]; // top 8 po broju porudžbina
  cityCount: number; // ukupno različitih gradova
  weekdays: ChartWeekday[]; // pon … ned
  needsVpOrders: number; // realizovane bez VP → zarada nepotpuna
};

const TOP_ITEMS = 10;
const TOP_CITIES = 8;
const WEEKDAYS = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"];

/** Svi kalendarski dani [from, to] (T12:00Z izbegava DST preskok). */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`).getTime();
  while (d.getTime() <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** „  novi   sad " → „Novi Sad" (za prikaz kad grad nema ujednačen zapis). */
function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sr-RS")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("sr-RS"));
}

/** `client` je za skripte/provere (service-role); strana koristi RLS klijent korisnika. */
export async function getDashboardCharts(
  range: { from: string; to: string },
  client?: SupabaseClient,
): Promise<DashboardCharts> {
  const supabase = client ?? (await createClient());
  const today = todayBelgrade();

  const [sales, statusRes] = await Promise.all([
    loadSales(supabase, range.from, range.to),
    supabase.from("order_statuses").select("name, color, sort_order").order("sort_order"),
  ]);
  const statusRows = mustRows<{ name: string; color: string | null; sort_order: number }>(
    statusRes,
    "dashboard: statusi",
  );

  const byDay = new Map<string, ChartDay>(
    // Dani posle „danas" se ne crtaju — inače kriva lažno pada na nulu.
    daysBetween(range.from, range.to < today ? range.to : today).map((day) => [
      day,
      { day, revenue: 0, profit: 0, orders: 0, cancelled: 0 },
    ]),
  );
  const statusCount = new Map<string, number>();
  const items = new Map<string, ChartItem>();
  const cities = new Map<string, ChartCity & { spellings: Map<string, number> }>();
  const weekdays: ChartWeekday[] = WEEKDAYS.map((label) => ({ label, orders: 0, revenue: 0 }));
  let needsVpOrders = 0;

  for (const o of sales.orders) {
    statusCount.set(o.status, (statusCount.get(o.status) ?? 0) + 1);
    const bucket = byDay.get(o.day);
    if (o.cancelled) {
      if (bucket) bucket.cancelled += 1;
      continue;
    }

    const { revenue, profit } = sumItems(o.items);
    if (o.needs_vp) needsVpOrders += 1;
    if (bucket) {
      bucket.revenue += revenue;
      bucket.profit += profit;
      bucket.orders += 1;
    }

    const wd = (new Date(`${o.day}T12:00:00Z`).getUTCDay() + 6) % 7; // pon=0
    weekdays[wd].orders += 1;
    weekdays[wd].revenue += revenue;

    for (const it of o.items) {
      const cur = items.get(it.sku) ?? {
        sku: it.sku,
        name: it.product_name,
        revenue: 0,
        profit: 0,
        quantity: 0,
      };
      cur.revenue += it.mp_at_sale * it.quantity;
      cur.profit += it.profit_at_sale ?? 0;
      cur.quantity += it.quantity;
      items.set(it.sku, cur);
    }

    // Beogradske opštine („Beograd-Zvezdara", „Beograd - Novi Beograd") idu pod
    // „Beograd" — inače se najveći grad rascepka na više manjih redova.
    let rawCity = o.ship_city?.trim();
    if (rawCity && /^beograd\s*[-–,(]/i.test(rawCity)) rawCity = "Beograd";
    if (rawCity) {
      const key = norm(rawCity).replace(/\s+/g, " ");
      const cur = cities.get(key) ?? { city: "", orders: 0, revenue: 0, spellings: new Map() };
      cur.orders += 1;
      cur.revenue += revenue;
      cur.spellings.set(rawCity, (cur.spellings.get(rawCity) ?? 0) + 1);
      cities.set(key, cur);
    }
  }

  // Unija top 10 po svakoj meri — klijent bira meru bez novog upita.
  const allItems = [...items.values()];
  const pick = new Set<string>();
  for (const key of ["profit", "revenue", "quantity"] as const) {
    [...allItems]
      .sort((a, b) => b[key] - a[key])
      .slice(0, TOP_ITEMS)
      .forEach((it) => pick.add(it.sku));
  }

  const cityList = [...cities.values()]
    .map(({ spellings, ...c }) => {
      // Najčešći zapis grada; ako je ceo u malim/velikim slovima — ulepšaj.
      const best = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const pretty = best === best.toLowerCase() || best === best.toUpperCase() ? titleCase(best) : best;
      return { ...c, city: pretty };
    })
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);

  return {
    days: [...byDay.values()],
    statuses: statusRows.map((s) => ({
      name: s.name,
      color: s.color ?? "#6B7280",
      count: statusCount.get(s.name) ?? 0,
    })),
    topItems: allItems.filter((it) => pick.has(it.sku)),
    cities: cityList.slice(0, TOP_CITIES),
    cityCount: cityList.length,
    weekdays,
    needsVpOrders,
  };
}
