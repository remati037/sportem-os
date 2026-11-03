import "server-only";

import { loadSales, sumItems, type SaleOrder } from "@/db/sales";
import { todayBelgrade } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/paginate";
import { tgEscape } from "@/lib/telegram";

/*
 * Jutarnji izveštaj o prodaji za Telegram (cron `/api/cron/prodaja-report`).
 *
 * Ista pravila kao Dashboard (`computePeriodMetrics`) kroz `loadSales`:
 * porudžbine po `ordered_at` u beogradskim danima, broj = SVI statusi, promet i
 * zarada samo realizovane (bez Otkazano/Vraćeno po imenu) iz ZAMRZNUTIH stavki,
 * neto = zarada − troškovi. Troškovi = ručni `expenses` po datumu + Meta potrošnja po
 * DANIMA iz `ad_insights_daily` (automatski red „Meta — mesec" nosi ceo mesec na
 * 1. u mesecu, pa bi poređenje sa delom prošlog meseca bilo iskrivljeno). Izveštaj je za JUČE
 * (današnji dan je delimičan) + mesec do juče, uz poređenje. Samo čita.
 */

type Day = {
  orders: number; // svi statusi
  realized: number;
  cancelled: number;
  revenue: number;
  profit: number;
  needsVp: number;
  meta: number; // realizovane sa Meta oglasa (utm_content = Meta ad ID)
  licno: number;
};

const emptyDay = (): Day => ({
  orders: 0,
  realized: 0,
  cancelled: 0,
  revenue: 0,
  profit: 0,
  needsVp: 0,
  meta: 0,
  licno: 0,
});

export type SalesReport = {
  day: string;
  yesterday: Day;
  weekAgo: Day; // isti dan prošle nedelje
  avg7: Day; // prosek 7 dana pre juče
  adSpendYesterday: number;
  month: Day & { from: string; expenses: number };
  prevMonth: Day & { from: string; to: string; expenses: number };
  topItems: { name: string; quantity: number; profit: number }[];
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Isti dan u prethodnom mesecu (31.3. → 28/29.2.). */
function sameDayPrevMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function addOrder(into: Day, o: SaleOrder, metaAd: boolean) {
  into.orders++;
  if (o.cancelled) {
    into.cancelled++;
    return;
  }
  const { revenue, profit } = sumItems(o.items);
  into.realized++;
  into.revenue += revenue;
  into.profit += profit;
  if (o.needs_vp) into.needsVp++;
  if (metaAd) into.meta++;
  if (o.delivery_method === "licno") into.licno++;
}

export async function buildSalesReport(today = todayBelgrade()): Promise<SalesReport> {
  const supabase = createAdminClient();
  const day = addDays(today, -1);
  const monthFrom = `${day.slice(0, 8)}01`;
  const prevTo = sameDayPrevMonth(day);
  const prevFrom = `${prevTo.slice(0, 8)}01`;
  const weekFrom = addDays(day, -7);
  const from = prevFrom < weekFrom ? prevFrom : weekFrom;

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, day);
  const [sales, attr, expenses, ads] = await Promise.all([
    loadSales(supabase, from, day),
    selectAll<{ id: string; attr_utm_content: string | null }>("prodaja: atribucija", () =>
      supabase
        .from("orders")
        .select("id, attr_utm_content")
        .not("ordered_at", "is", null)
        .gte("ordered_at", gteUtc)
        .lt("ordered_at", ltUtc)
        .order("id", { ascending: true }),
    ),
    selectAll<{ date: string; amount: number }>("prodaja: troškovi", () =>
      supabase
        .from("expenses")
        .select("date, amount")
        .is("source", null)
        .gte("date", prevFrom)
        .lte("date", day)
        .order("id", { ascending: true }),
    ),
    selectAll<{ date: string; spend_rsd: number | null }>("prodaja: reklame", () =>
      supabase
        .from("ad_insights_daily")
        .select("date, spend_rsd")
        .gte("date", prevFrom)
        .lte("date", day)
        .order("date", { ascending: true }),
    ),
  ]);

  const metaAd = new Set(attr.filter((a) => /^\d{6,}$/.test(a.attr_utm_content?.trim() ?? "")).map((a) => a.id));
  const yesterday = emptyDay();
  const weekAgo = emptyDay();
  const sum7 = emptyDay();
  const month = { ...emptyDay(), from: monthFrom, expenses: 0 };
  const prevMonth = { ...emptyDay(), from: prevFrom, to: prevTo, expenses: 0 };
  const items = new Map<string, { name: string; quantity: number; profit: number }>();

  for (const o of sales.orders) {
    const m = metaAd.has(o.id);
    if (o.day === day) {
      addOrder(yesterday, o, m);
      if (!o.cancelled) {
        for (const it of o.items) {
          const row = items.get(it.sku) ?? { name: it.product_name, quantity: 0, profit: 0 };
          row.quantity += it.quantity;
          row.profit += it.profit_at_sale ?? 0;
          items.set(it.sku, row);
        }
      }
    }
    if (o.day === addDays(day, -7)) addOrder(weekAgo, o, m);
    if (o.day >= weekFrom && o.day < day) addOrder(sum7, o, m);
    if (o.day >= monthFrom) addOrder(month, o, m);
    if (o.day >= prevFrom && o.day <= prevTo) addOrder(prevMonth, o, m);
  }
  let adSpendYesterday = 0;
  for (const e of [...expenses, ...ads.map((a) => ({ date: a.date, amount: a.spend_rsd ?? 0 }))]) {
    if (e.date >= monthFrom) month.expenses += e.amount;
    if (e.date >= prevFrom && e.date <= prevTo) prevMonth.expenses += e.amount;
  }
  for (const a of ads) if (a.date === day) adSpendYesterday += a.spend_rsd ?? 0;

  const avg7 = emptyDay();
  for (const k of Object.keys(avg7) as (keyof Day)[]) avg7[k] = Math.round(sum7[k] / 7);

  return {
    day,
    yesterday,
    weekAgo,
    avg7,
    adSpendYesterday,
    month,
    prevMonth,
    topItems: [...items.values()].sort((a, b) => b.profit - a.profit || b.quantity - a.quantity).slice(0, 5),
  };
}

/* ── formatiranje ── */

const n0 = (n: number) => new Intl.NumberFormat("sr-RS").format(Math.round(n));
const rsd = (n: number) => `${n0(n)} RSD`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const WEEKDAYS = ["nedelja", "ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota"];

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** „▲ 12%" / „▼ 8%" naspram poređenja; prazno kad nema osnove. */
function diff(cur: number, base: number): string {
  if (base <= 0) return "";
  const p = Math.round(((cur - base) / base) * 100);
  return p === 0 ? " (=)" : ` (${p > 0 ? "▲" : "▼"} ${Math.abs(p)}%)`;
}

export function formatSalesReport(r: SalesReport): string {
  const y = r.yesterday;
  const m = r.month;
  const pm = r.prevMonth;
  const avgBasket = y.realized > 0 ? y.revenue / y.realized : 0;
  const lines: string[] = [];

  lines.push(`💰 <b>Prodaja — ${dayLabel(r.day)}</b>`);
  lines.push("");
  lines.push(`Porudžbine <b>${y.orders}</b>${y.cancelled ? ` (realizovano ${y.realized}, otkazano ${y.cancelled})` : ""}`);
  lines.push(`Promet <b>${rsd(y.revenue)}</b> · prosečna korpa ${rsd(avgBasket)}`);
  lines.push(`Zarada <b>${rsd(y.profit)}</b> · marža ${pct(y.profit, y.revenue)}`);
  lines.push(`Meta reklame ${rsd(r.adSpendYesterday)} → zarada posle reklama <b>${rsd(y.profit - r.adSpendYesterday)}</b>`);
  lines.push(`Sa Meta oglasa ${y.meta} · lično/keš ${y.licno} · ostalo ${y.realized - y.meta - y.licno}`);
  lines.push("");
  lines.push(`<b>Poređenje</b>`);
  lines.push(
    `Isti dan prošle nedelje: ${r.weekAgo.orders} por., zarada ${rsd(r.weekAgo.profit)}${diff(y.profit, r.weekAgo.profit)}`,
  );
  lines.push(`Prosek prethodnih 7 dana: ${r.avg7.orders} por., zarada ${rsd(r.avg7.profit)}${diff(y.profit, r.avg7.profit)}`);
  if (r.topItems.length) {
    lines.push("");
    lines.push(`<b>Najprodavanije juče</b>`);
    for (const it of r.topItems) lines.push(`• ${tgEscape(it.name)} ×${it.quantity} · zarada ${n0(it.profit)}`);
  }
  lines.push("");
  lines.push(`<b>Mesec do juče</b> (1.–${Number(r.day.slice(8))}.)`);
  lines.push(`Porudžbine <b>${m.orders}</b>${diff(m.orders, pm.orders)} · realizovano ${m.realized} · otkazano ${m.cancelled}`);
  lines.push(`Promet <b>${rsd(m.revenue)}</b>${diff(m.revenue, pm.revenue)}`);
  lines.push(`Zarada <b>${rsd(m.profit)}</b>${diff(m.profit, pm.profit)} · marža ${pct(m.profit, m.revenue)}`);
  lines.push(`Troškovi ${rsd(m.expenses)} (Meta + ostalo) → neto profit <b>${rsd(m.profit - m.expenses)}</b>`);
  lines.push(
    `<i>Prošli mesec isti period: ${pm.orders} por., zarada ${rsd(pm.profit)}, neto ${rsd(pm.profit - pm.expenses)}</i>`,
  );
  if (y.needsVp || m.needsVp) {
    lines.push("");
    lines.push(`⚠️ Bez VP cene: ${m.needsVp} porudžbina ovog meseca${y.needsVp ? ` (${y.needsVp} juče)` : ""} — zarada je nepotpuna.`);
  }
  return lines.join("\n");
}
