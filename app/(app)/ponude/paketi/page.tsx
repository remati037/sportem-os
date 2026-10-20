import { AlertTriangle, Package } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { num, rsd } from "@/lib/format";
import { rate } from "@/lib/offers/labels";
import { getPackagesOverview } from "@/lib/offers/packages";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { EmptyState } from "@/components/patterns/empty-state";

import { OffersTabs } from "../offers-tabs";
import { PeriodTabs } from "../period-tabs";
import { PackagesTable, type PackageRow } from "./packages-table";

export const dynamic = "force-dynamic";

/*
 * Ponude → Paketi: statistika setova sa sajta (plugin „Sportem Offers",
 * `/packages` + `/packages/stats`). Čita se uživo iz plugina — nema tabela
 * u Supabase-u, pa ni dugmeta za sinhronizaciju.
 *
 * Pristup: Admin i Menadžer (prihod). Ključ plugina ostaje na serveru.
 */

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-xl font-bold break-words">{value}</div>
      {hint ? <div className="text-ink-faint mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

export default async function PaketiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const period = resolveOfferPeriod(await searchParams);
  const overview = await getPackagesOverview(period.days);
  const { totals, aov } = overview;

  const rows: PackageRow[] = overview.rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.pkg?.status ?? null,
    fromPrice: r.pkg?.from_price ?? null,
    views: r.viewSessions,
    addRate: r.addRate,
    orders: r.orders,
    orderRate: r.orderRate,
    revenue: r.revenue,
    aov: r.aov,
  }));

  const published = overview.rows.filter((r) => r.pkg?.status === "publish").length;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Prodaja</div>
          <h1 className="text-ink text-xl font-bold">Ponude</h1>
        </div>
        <PeriodTabs active={period.days} basePath="/ponude/paketi" />
      </div>

      <OffersTabs days={period.days} />

      {overview.error ? (
        <div className="border-danger bg-danger-soft text-danger mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Paketi se ne mogu učitati sa sajta</p>
            <p className="mt-0.5 break-words">{overview.error}</p>
          </div>
        </div>
      ) : overview.rows.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Na sajtu još nema paketa."
          description="Kad napraviš paket u pluginu, ovde se pojavljuje sam — bez sinhronizacije."
        />
      ) : (
        <>
          <p className="text-ink-faint mb-4 text-xs">
            {num(overview.rows.length)} paketa, od toga {num(published)} objavljeno · podaci uživo
            sa sajta, poslednjih {period.days} dana
          </p>

          {/* KPI red */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Pregledi paketa"
              value={num(totals.viewSessions)}
              hint={`posete stranice „Paketi“: ${num(overview.archiveViews)}`}
            />
            <Kpi
              label="Dodaje u korpu"
              value={rate(totals.addRate)}
              hint="od onih koji pogledaju"
            />
            <Kpi
              label="Porudžbine"
              value={num(totals.orders)}
              hint={`${rate(totals.orderRate)} od pregleda`}
            />
            <Kpi label="Prihod od paketa" value={rsd(Math.round(totals.revenue))} />
            <Kpi
              label="Delimične porudžbine"
              value={num(totals.partialOrders)}
              hint="kupljen samo deo paketa"
            />
          </div>

          {/* Prosečna porudžbina sa/bez paketa */}
          {aov ? (
            <div className="border-border bg-surface shadow-soft mb-6 grid gap-3 rounded-lg border px-4 py-3 sm:grid-cols-2">
              <div>
                <div className="eyebrow">Prosečna porudžbina sa paketom</div>
                <div className="num text-ink mt-1 text-lg font-bold">
                  {aov.withOrders === 0 ? "—" : rsd(Math.round(aov.withAov))}
                </div>
                <div className="text-ink-faint text-xs">{num(aov.withOrders)} porudžbina</div>
              </div>
              <div>
                <div className="eyebrow">Prosečna porudžbina bez paketa</div>
                <div className="num text-ink mt-1 text-lg font-bold">
                  {aov.withoutOrders === 0 ? "—" : rsd(Math.round(aov.withoutAov))}
                </div>
                <div className="text-ink-faint text-xs">{num(aov.withoutOrders)} porudžbina</div>
              </div>
            </div>
          ) : null}

          <PackagesTable rows={rows} days={period.days} />

          <p className="text-ink-faint mt-4 text-xs">
            „Pregledi“ i stope se broje po posetiocu (sesiji), ne po učitavanju stranice. Cifre su
            onakve kakve ih broji plugin — otkazane porudžbine NISU isključene (za razliku od
            pravila ponuda).
          </p>
        </>
      )}
    </main>
  );
}
