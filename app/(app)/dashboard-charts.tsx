"use client";

import { useMemo, useState } from "react";

import { num, rsd } from "@/lib/format";
import { BarList } from "@/components/charts/bar-list";
import { ColumnChart, type Column } from "@/components/charts/column-chart";
import { ChartCard, ChartEmpty, Legend, Segmented } from "@/components/charts/core";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import type { ChartDay, DashboardCharts as ChartsData } from "@/db/dashboard-charts";

/*
 * Grafikoni Dashboarda. Svi prate isti period kao kartice iznad (filter perioda
 * je jedan, na vrhu strane); unutar kartice su samo lokalni izbori prikaza
 * (granulacija, mera). Podaci stižu kao zbirovi po danu — grupisanje po
 * nedelji/mesecu je ovde, bez novog upita.
 *
 * Boje: promet = plava, zarada = brend zelena (validirano za daltonizam);
 * otkazane = neutralna siva (prigušeno, nije „serija"); statusi nose SVOJU boju
 * iz podešavanja (ista kao bedž statusa u celoj aplikaciji).
 */

type Grain = "dan" | "nedelja" | "mesec";

const WEEKDAY_FULL: Record<string, string> = {
  Pon: "Ponedeljak",
  Uto: "Utorak",
  Sre: "Sreda",
  Čet: "Četvrtak",
  Pet: "Petak",
  Sub: "Subota",
  Ned: "Nedelja",
};

const C_REVENUE = "#2a78d6";
const C_PROFIT = "var(--green)";
const C_CANCELLED = "#c5ccc8";

const GRAINS: { key: Grain; label: string }[] = [
  { key: "dan", label: "Dan" },
  { key: "nedelja", label: "Nedelja" },
  { key: "mesec", label: "Mesec" },
];

const monthShort = new Intl.DateTimeFormat("sr-Latn-RS", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("sr-Latn-RS", { month: "long", year: "numeric", timeZone: "UTC" });

function dm(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
function dmy(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}.`;
}
function weekdayName(day: string): string {
  return ["nedelja", "ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota"][
    new Date(`${day}T12:00:00Z`).getUTCDay()
  ];
}
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

type Bucket = ChartDay & { key: string; axisLabel: string; title: string };

/** Zbir po danu → zbir po izabranoj granulaciji (prvi/poslednji dan se seku na period). */
function bucketize(days: ChartDay[], grain: Grain): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const d of days) {
    const key = grain === "dan" ? d.day : grain === "mesec" ? d.day.slice(0, 7) : mondayOf(d.day);
    let b = out.get(key);
    if (!b) {
      const first = new Date(`${(grain === "mesec" ? key + "-01" : key)}T12:00:00Z`);
      b = {
        key,
        day: d.day,
        revenue: 0,
        profit: 0,
        orders: 0,
        cancelled: 0,
        axisLabel: grain === "mesec" ? monthShort.format(first).replace(".", "") : dm(d.day),
        title:
          grain === "dan"
            ? `${weekdayName(d.day)}, ${dmy(d.day)}`
            : grain === "mesec"
              ? monthLong.format(first)
              : "",
      };
      out.set(key, b);
    }
    b.revenue += d.revenue;
    b.profit += d.profit;
    b.orders += d.orders;
    b.cancelled += d.cancelled;
    if (grain === "nedelja") b.title = `${dm(b.day)} – ${dm(d.day)}${d.day.slice(0, 4)}.`;
  }
  return [...out.values()];
}

function defaultGrain(dayCount: number): Grain {
  if (dayCount <= 31) return "dan";
  if (dayCount <= 120) return "nedelja";
  return "mesec";
}

export function DashboardCharts({ data }: { data: ChartsData }) {
  const dayCount = data.days.length;
  const [grain, setGrain] = useState<Grain>(() => defaultGrain(dayCount));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [itemMetric, setItemMetric] = useState<"profit" | "revenue" | "quantity">("profit");
  const [cityMetric, setCityMetric] = useState<"orders" | "revenue">("orders");
  const [weekMetric, setWeekMetric] = useState<"orders" | "revenue">("orders");

  const buckets = useMemo(() => bucketize(data.days, grain), [data.days, grain]);

  const totals = useMemo(
    () =>
      data.days.reduce(
        (s, d) => ({
          revenue: s.revenue + d.revenue,
          profit: s.profit + d.profit,
          orders: s.orders + d.orders,
          cancelled: s.cancelled + d.cancelled,
        }),
        { revenue: 0, profit: 0, orders: 0, cancelled: 0 },
      ),
    [data.days],
  );

  const grainOptions = GRAINS.map((g) => ({
    ...g,
    // Granulacija koja daje jednu jedinu tačku nema šta da pokaže.
    disabled:
      (g.key === "nedelja" && dayCount <= 7) || (g.key === "mesec" && new Set(data.days.map((d) => d.day.slice(0, 7))).size < 2),
  }));
  const grainControl = (
    <Segmented label="Granulacija" value={grain} options={grainOptions} onChange={setGrain} />
  );

  const trendSeries = [
    { key: "revenue", label: "Promet", color: C_REVENUE },
    { key: "profit", label: "Zarada", color: C_PROFIT },
  ];
  const trendPoints: TrendPoint[] = buckets.map((b) => ({
    key: b.key,
    axisLabel: b.axisLabel,
    title: b.title,
    values: { revenue: b.revenue, profit: b.profit },
  }));

  const orderColumns: Column[] = buckets.map((b) => ({
    key: b.key,
    axisLabel: b.axisLabel,
    title: b.title,
    values: { orders: b.orders, cancelled: b.cancelled },
  }));

  const avgPoints: TrendPoint[] = buckets.map((b) => ({
    key: b.key,
    axisLabel: b.axisLabel,
    title: b.title,
    values: { avg: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0 },
  }));
  const avgTotal = totals.orders > 0 ? Math.round(totals.revenue / totals.orders) : 0;

  const items = [...data.topItems].sort((a, b) => b[itemMetric] - a[itemMetric]).slice(0, 10);
  const itemFmt = itemMetric === "quantity" ? (v: number) => `${num(v)} kom` : rsd;

  const cities = [...data.cities].sort((a, b) => b[cityMetric] - a[cityMetric]);
  const statusTotal = data.statuses.reduce((s, x) => s + x.count, 0);
  const singleDay = dayCount === 1;

  return (
    <div className="space-y-4">
      {/* 1. Promet i zarada kroz vreme */}
      <ChartCard
        title="Promet i zarada"
        subtitle={
          <>
            Bez otkazanih i vraćenih porudžbina
            {data.needsVpOrders > 0 ? (
              <span className="text-warning"> · {num(data.needsVpOrders)} bez VP (zarada nepotpuna)</span>
            ) : null}
          </>
        }
        actions={singleDay ? null : grainControl}
      >
        <div className="mb-3">
          <Legend
            items={trendSeries.map((s) => ({
              ...s,
              shape: "line" as const,
              value: rsd(s.key === "revenue" ? totals.revenue : totals.profit),
            }))}
            hidden={hidden}
            onToggle={(key) =>
              setHidden((cur) => {
                const next = new Set(cur);
                if (next.has(key)) next.delete(key);
                else if (next.size < trendSeries.length - 1) next.add(key); // bar jedna ostaje
                return next;
              })
            }
          />
        </div>
        {singleDay ? (
          <ChartEmpty height={180}>Za jedan dan nema krive kroz vreme — izaberi nedelju ili mesec.</ChartEmpty>
        ) : totals.orders === 0 ? (
          <ChartEmpty height={240}>Nema realizovanih porudžbina u ovom periodu.</ChartEmpty>
        ) : (
          <TrendChart
            points={trendPoints}
            series={trendSeries.filter((s) => !hidden.has(s.key))}
            format={rsd}
            height={260}
          />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 2. Broj porudžbina */}
        <ChartCard
          className="lg:col-span-3"
          title="Porudžbine"
          subtitle="Sve kreirane u periodu"
          actions={singleDay ? null : grainControl}
        >
          <div className="mb-3">
            <Legend
              items={[
                { key: "orders", label: "Realizovane", color: C_PROFIT, value: num(totals.orders) },
                { key: "cancelled", label: "Otkazane i vraćene", color: C_CANCELLED, value: num(totals.cancelled) },
              ]}
            />
          </div>
          {totals.orders + totals.cancelled === 0 ? (
            <ChartEmpty>Nema porudžbina u ovom periodu.</ChartEmpty>
          ) : (
            <ColumnChart
              columns={orderColumns}
              series={[
                { key: "orders", label: "Realizovane", color: C_PROFIT },
                { key: "cancelled", label: "Otkazane i vraćene", color: C_CANCELLED },
              ]}
              format={num}
              showTotal
            />
          )}
        </ChartCard>

        {/* 3. Statusi */}
        <ChartCard className="lg:col-span-2" title="Statusi" subtitle="Gde su sada porudžbine iz perioda">
          {statusTotal === 0 ? (
            <ChartEmpty>Nema porudžbina u ovom periodu.</ChartEmpty>
          ) : (
            <DonutChart
              centerLabel="porudžbina"
              slices={data.statuses.map((s) => ({ key: s.name, label: s.name, value: s.count, color: s.color }))}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 4. Top artikli */}
        <ChartCard
          title="Najprodavaniji artikli"
          subtitle="Top 10 po SKU"
          actions={
            <Segmented
              label="Mera"
              value={itemMetric}
              onChange={setItemMetric}
              options={[
                { key: "profit", label: "Zarada" },
                { key: "revenue", label: "Promet" },
                { key: "quantity", label: "Komadi" },
              ]}
            />
          }
        >
          {items.length === 0 ? (
            <ChartEmpty>Nema prodatih artikala u ovom periodu.</ChartEmpty>
          ) : (
            <BarList
              color={itemMetric === "revenue" ? C_REVENUE : C_PROFIT}
              rows={items.map((it) => ({
                key: it.sku,
                label: it.name,
                sublabel: it.sku,
                value: it[itemMetric],
                display: itemFmt(it[itemMetric]),
              }))}
            />
          )}
        </ChartCard>

        {/* 5. Gradovi */}
        <ChartCard
          title="Gradovi"
          subtitle={
            data.cityCount > data.cities.length
              ? `Top ${data.cities.length} od ${num(data.cityCount)} gradova`
              : "Realizovane porudžbine po gradu dostave"
          }
          actions={
            <Segmented
              label="Mera"
              value={cityMetric}
              onChange={setCityMetric}
              options={[
                { key: "orders", label: "Porudžbine" },
                { key: "revenue", label: "Promet" },
              ]}
            />
          }
        >
          {cities.length === 0 ? (
            <ChartEmpty>Nema porudžbina sa upisanim gradom.</ChartEmpty>
          ) : (
            <BarList
              color={cityMetric === "revenue" ? C_REVENUE : C_PROFIT}
              rows={cities.map((c) => ({
                key: c.city,
                label: c.city,
                value: c[cityMetric],
                display: cityMetric === "orders" ? num(c.orders) : rsd(c.revenue),
              }))}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 6. Prosečna korpa */}
        <ChartCard
          title="Prosečna vrednost porudžbine"
          subtitle={`Promet / realizovane porudžbine · ceo period ${rsd(avgTotal)}`}
          actions={singleDay ? null : grainControl}
        >
          {singleDay ? (
            <ChartEmpty>Za jedan dan nema krive kroz vreme.</ChartEmpty>
          ) : totals.orders === 0 ? (
            <ChartEmpty>Nema realizovanih porudžbina u ovom periodu.</ChartEmpty>
          ) : (
            <TrendChart
              points={avgPoints}
              series={[{ key: "avg", label: "Prosečna korpa", color: C_REVENUE }]}
              format={rsd}
              height={220}
            />
          )}
        </ChartCard>

        {/* 7. Dan u nedelji */}
        <ChartCard
          title="Dan u nedelji"
          subtitle="Kada kupci najviše poručuju"
          actions={
            <Segmented
              label="Mera"
              value={weekMetric}
              onChange={setWeekMetric}
              options={[
                { key: "orders", label: "Porudžbine" },
                { key: "revenue", label: "Promet" },
              ]}
            />
          }
        >
          {totals.orders === 0 ? (
            <ChartEmpty>Nema realizovanih porudžbina u ovom periodu.</ChartEmpty>
          ) : (
            <ColumnChart
              columns={data.weekdays.map((w) => ({
                key: w.label,
                axisLabel: w.label,
                title: WEEKDAY_FULL[w.label] ?? w.label,
                values: { v: w[weekMetric] },
              }))}
              series={[
                {
                  key: "v",
                  label: weekMetric === "orders" ? "Porudžbine" : "Promet",
                  color: weekMetric === "orders" ? C_PROFIT : C_REVENUE,
                },
              ]}
              format={weekMetric === "orders" ? num : rsd}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
