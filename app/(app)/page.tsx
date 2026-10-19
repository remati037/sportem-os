import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";
import { getDashboardMetrics } from "@/db/dashboard";
import { computePeriodMetrics } from "@/db/metrics";
import { getDashboardCharts } from "@/db/dashboard-charts";
import { rsd, num } from "@/lib/format";
import { comparisonRange, resolvePeriod } from "@/lib/period";

import { DashboardCharts } from "./dashboard-charts";
import { MetricCard, marginDelta, pctDelta } from "./metric-card";
import { PeriodFilter } from "./period-filter";
import { OrdersRefresh } from "./porudzbine/orders-refresh";

export const dynamic = "force-dynamic";

/*
 * Dashboard — filter perioda, 4 kartice metrika i grafikoni. Kartice broje
 * porudžbine KREIRANE u periodu (sve statuse), a zarada/marža/neto samo
 * realizovane (bez otkazanih/vraćenih) — `computePeriodMetrics`, jedini izvor
 * istine. Ispod svake kartice je poređenje sa istim brojem dana prethodnog
 * perioda. Grafikoni (`getDashboardCharts`) prate isti period i ista pravila.
 * STAFF-only — Logistika se preusmerava na Katalog.
 */

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getProfile();
  if (!session) redirect("/prijava");
  // Logistika nema Dashboard — sleće na Katalog (izbegava redirect petlju kroz requireRole).
  if (session.profile.role === "logistics") redirect("/katalog");

  const period = resolvePeriod(await searchParams);
  const cmp = comparisonRange(period);

  const [metrics, charts, current, previous] = await Promise.all([
    getDashboardMetrics({ from: period.from, to: period.to }),
    getDashboardCharts({ from: period.from, to: period.to }),
    // Tekući period isečen na „danas" — računa se zasebno samo kad se seče.
    cmp && cmp.current.to !== period.to ? computePeriodMetrics(cmp.current) : null,
    cmp ? computePeriodMetrics(cmp.previous) : null,
  ]);

  const base = current ?? metrics;
  const marzaPct = Math.round(metrics.marza * 100);
  const vs = cmp?.label ?? "";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="eyebrow">Pregled</div>
          <h1 className="text-ink text-xl font-bold">Dashboard</h1>
        </div>
        <OrdersRefresh />
      </div>

      <PeriodFilter period={period} />

      {/* Metrike perioda */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Zarada"
          value={rsd(metrics.zarada)}
          hint={period.label}
          delta={previous ? pctDelta(base.zarada, previous.zarada, vs, rsd) : null}
        />
        <MetricCard
          label="Neto profit"
          value={rsd(metrics.neto)}
          hint={`Troškovi ${rsd(metrics.troskovi)}`}
          tone={metrics.neto >= 0 ? "ink" : "warning"}
          delta={previous ? pctDelta(base.neto, previous.neto, vs, rsd) : null}
        />
        <MetricCard
          label="Porudžbine"
          value={num(metrics.brojPorudzbina)}
          hint="Sve kreirane u periodu"
          delta={previous ? pctDelta(base.brojPorudzbina, previous.brojPorudzbina, vs) : null}
        />
        <MetricCard
          label="Prosečna marža"
          value={`${marzaPct}%`}
          hint="Zarada / promet"
          delta={previous ? marginDelta(base, previous, vs) : null}
        />
      </div>

      <DashboardCharts key={`${period.from}_${period.to}`} data={charts} />
    </main>
  );
}
