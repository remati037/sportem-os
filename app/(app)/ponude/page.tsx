import { AlertTriangle, Megaphone } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { datumVreme, num, rsd } from "@/lib/format";
import { rate } from "@/lib/offers/labels";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { getOffersOverview, getOfferSyncState, hasOfferEvents } from "@/db/offers";
import { EmptyState } from "@/components/patterns/empty-state";

import { OffersChart } from "./offers-chart";
import { PeriodTabs } from "./period-tabs";
import { RulesTable, type RuleRow } from "./rules-table";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

/*
 * Ponude — statistika upsell ponuda sa sajta (plugin „Sportem Offers").
 *
 * Pristup: Admin i Menadžer (stranica pokazuje prihod; Logistika nema ni RLS
 * politiku na offer_* tabelama). Sve cifre dolaze iz SQL agregacija, pa se ne
 * gube na PostgREST limitu od 1000 redova.
 *
 * Otkazane i vraćene porudžbine su isključene iz „Porudžbine" i „Prihod".
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

export default async function PonudePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const sp = await searchParams;
  const period = resolveOfferPeriod(sp);

  const [{ rules, totals, daily }, syncState, anyEvents] = await Promise.all([
    getOffersOverview(period),
    getOfferSyncState(),
    hasOfferEvents(),
  ]);

  const rows: RuleRow[] = rules.map((r) => ({
    id: r.rule_id,
    name: r.name,
    active: r.rule?.active ?? false,
    priority: r.rule?.priority ?? 0,
    placements: r.rule?.placements ?? [],
    offerName: r.rule?.offer_name ?? null,
    offerSku: r.rule?.offer_sku ?? null,
    impressions: r.impressions,
    adds: r.adds,
    addRate: r.add_rate,
    orders: r.orders,
    revenue: r.revenue,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Prodaja</div>
          <h1 className="text-ink text-xl font-bold">Ponude</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodTabs active={period.days} basePath="/ponude" />
          <SyncButton />
        </div>
      </div>

      <p className="text-ink-faint mb-4 text-xs">
        {syncState?.last_synced_at
          ? `Poslednja sinhronizacija: ${datumVreme(syncState.last_synced_at)}`
          : "Još nije bilo uspešne sinhronizacije."}
      </p>

      {syncState?.last_error ? (
        <div className="border-danger bg-danger-soft text-danger mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Poslednja sinhronizacija nije uspela</p>
            <p className="mt-0.5 break-words">{syncState.last_error}</p>
          </div>
        </div>
      ) : null}

      {!anyEvents ? (
        <EmptyState
          icon={<Megaphone />}
          title="Još nema podataka."
          description="Pokreni sinhronizaciju ili sačekaj prve prikaze na sajtu."
        />
      ) : (
        <>
          {/* KPI red */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Prikazi" value={num(totals.impressions)} />
            <Kpi label="Dodato" value={num(totals.adds)} />
            <Kpi label="Stopa dodavanja" value={rate(totals.addRate)} hint="dodato / prikazi" />
            <Kpi label="Porudžbine" value={num(totals.orders)} hint="bez otkazanih" />
            <Kpi label="Prihod od ponuda" value={rsd(Math.round(totals.revenue))} />
          </div>

          {/* Grafikon */}
          <div className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
            <OffersChart daily={daily} period={period} />
          </div>

          {/* Tabela po pravilu */}
          {rows.length === 0 ? (
            <EmptyState
              icon={<Megaphone />}
              title="Nema ponuda za ovaj period."
              description="Promeni period ili proveri da li su pravila aktivna na sajtu."
            />
          ) : (
            <RulesTable rows={rows} />
          )}

          <p className="text-ink-faint mt-4 text-xs">
            Otkazane i vraćene porudžbine ne ulaze u „Porudžbine“ i „Prihod“. Porudžbina koja ne
            postoji u aplikaciji (starija od uključenja WooCommerce webhook-a) se broji, jer joj
            status nije poznat.
          </p>
        </>
      )}
    </main>
  );
}
