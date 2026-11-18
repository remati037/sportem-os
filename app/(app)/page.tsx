import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";
import { getDashboardMetrics } from "@/db/dashboard";
import { computePeriodMetrics } from "@/db/metrics";
import { getDashboardCharts } from "@/db/dashboard-charts";
import { getPdvTurnover } from "@/db/pdv";
import { rsd, num } from "@/lib/format";
import { comparisonRange, resolvePeriod } from "@/lib/period";
import { formatRateBp } from "@/lib/tax";

import { DashboardCharts } from "./dashboard-charts";
import { MetricCard, marginDelta, pctDelta } from "./metric-card";
import { PdvCard } from "./pdv-card";
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

  const sp = await searchParams;
  const period = resolvePeriod(sp);
  // Prekidač „Posle poreza" (?porez=1) — podrazumevano pre poreza.
  const afterTax = sp.porez === "1";
  const cmp = comparisonRange(period);

  const [metrics, charts, current, previous, pdv] = await Promise.all([
    getDashboardMetrics({ from: period.from, to: period.to }),
    getDashboardCharts({ from: period.from, to: period.to }),
    // Tekući period isečen na „danas" — računa se zasebno samo kad se seče.
    cmp && cmp.current.to !== period.to ? computePeriodMetrics(cmp.current) : null,
    cmp ? computePeriodMetrics(cmp.previous) : null,
    // PDV prag — klizno 12 meseci, nezavisno od filtera perioda.
    getPdvTurnover(),
  ]);

  const base = current ?? metrics;
  const vs = cmp?.label ?? "";

  // Izbor cifara po prekidaču; poređenje sa prethodnim periodom prati isti izbor.
  const zaradaOf = (m: typeof metrics) => (afterTax ? m.zaradaPosle : m.zarada);
  const netoOf = (m: typeof metrics) => (afterTax ? m.netoPosle : m.neto);
  const marzaOf = (m: typeof metrics) => ({ ...m, marza: afterTax ? m.marzaPosle : m.marza });
  const marzaPct = Math.round(marzaOf(metrics).marza * 100);

  const monthShort = new Intl.DateTimeFormat("sr-Latn-RS", { month: "short", timeZone: "UTC" });
  const stope = metrics.porezStope
    .map((s) => `${formatRateBp(s.rateBp)} ${monthShort.format(new Date(`${s.month}-01T12:00:00Z`)).replace(".", "")}`)
    .join(", ");
  const porezHint = !metrics.porezOk
    ? "Stope poreza nisu dostupne"
    : stope
      ? stope + (metrics.kesBezPoreza > 0 ? ` · ${num(metrics.kesBezPoreza)} keš bez poreza` : "")
      : "Nema upisan porez za period";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="eyebrow">Pregled</div>
          <h1 className="text-ink text-xl font-bold">Dashboard</h1>
        </div>
        <OrdersRefresh />
      </div>

      <PeriodFilter period={period} afterTax={afterTax} />

      {/* Metrike perioda */}
      <div
        className={
          "mb-6 grid grid-cols-2 gap-4 " + (afterTax ? "md:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-4")
        }
      >
        <MetricCard
          label={afterTax ? "Zarada posle poreza" : "Zarada"}
          value={rsd(zaradaOf(metrics))}
          hint={afterTax ? `Pre poreza ${rsd(metrics.zarada)}` : period.label}
          delta={previous ? pctDelta(zaradaOf(base), zaradaOf(previous), vs, rsd) : null}
        />
        <MetricCard
          label={afterTax ? "Neto posle poreza" : "Neto profit"}
          value={rsd(netoOf(metrics))}
          hint={`Troškovi ${rsd(metrics.troskovi)}`}
          tone={netoOf(metrics) >= 0 ? "ink" : "warning"}
          delta={previous ? pctDelta(netoOf(base), netoOf(previous), vs, rsd) : null}
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
          hint={afterTax ? "Posle poreza / promet" : "Zarada / promet"}
          delta={previous ? marginDelta(marzaOf(base), marzaOf(previous), vs) : null}
        />
        {afterTax ? (
          <MetricCard
            label="Porez"
            value={rsd(metrics.porez)}
            hint={porezHint}
          />
        ) : null}
      </div>

      <PdvCard data={pdv} />

      <DashboardCharts key={`${period.from}_${period.to}`} data={charts} afterTax={afterTax} />
    </main>
  );
}
