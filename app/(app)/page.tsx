import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCheck,
  Info,
  PackageCheck,
  Truck,
  Wallet,
} from "lucide-react";

import { getProfile } from "@/lib/auth";
import { getDrugMiDuguje, getSaldoPostarine } from "@/db/finance";
import { getDashboardMetrics, getWaitingOrders } from "@/db/dashboard";
import { getLowStockVariants } from "@/db/catalog";
import { rsd, num } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { EmptyState } from "@/components/patterns/empty-state";

import { PeriodFilter } from "./period-filter";

export const dynamic = "force-dynamic";

/*
 * Dashboard (Korak 1.8) — sve ključne cifre na jednom ekranu. Metrike su po
 * izabranom periodu (dan/nedelja/mesec/prilagođeno) i realizovane (Isporučeno +
 * uplaćeno/keš, bez needs_vp); „drug mi duguje" i saldo poštarine su tekuće
 * stanje. STAFF-only — Logistika se preusmerava na Katalog.
 */

const LOW_STOCK_LIMIT = 8;

function signed(n: number) {
  return n === 0 ? "0" : `${n > 0 ? "+" : ""}${rsd(n)}`;
}

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

  const [metrics, drug, saldo, waiting, lowStock] = await Promise.all([
    getDashboardMetrics({ from: period.from, to: period.to }),
    getDrugMiDuguje(),
    getSaldoPostarine(),
    getWaitingOrders(),
    getLowStockVariants(),
  ]);

  const marzaPct = Math.round(metrics.marza * 100);
  const lowStockVisible = lowStock.slice(0, LOW_STOCK_LIMIT);
  const lowStockRest = lowStock.length - lowStockVisible.length;

  const readyHref = waiting.createdStatusId
    ? `/porudzbine?status=${waiting.createdStatusId}`
    : "/porudzbine";

  const waitingCards = [
    { label: "Čeka VP", count: waiting.needsVp, href: "/porudzbine?needs_vp=1", icon: AlertTriangle },
    { label: "Spremno za slanje", count: waiting.spremnoZaSlanje, href: readyHref, icon: Truck },
    {
      label: "Isporučeno, neuplaćeno",
      count: waiting.isporucenoNeuplaceno,
      href: "/finansije/uplate",
      icon: Wallet,
    },
    {
      label: "Za pregled",
      count: waiting.zaPregled,
      href: "/porudzbine?needs_review=1",
      icon: ClipboardCheck,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Pregled</div>
        <h1 className="text-ink text-xl font-bold">Dashboard</h1>
      </div>

      <PeriodFilter period={period} />

      {/* Metrike perioda */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Zarada" value={rsd(metrics.zarada)} hint={`${period.label}`} />
        <MetricCard
          label="Neto profit"
          value={rsd(metrics.neto)}
          hint={`Troškovi ${rsd(metrics.troskovi)}`}
          tone={metrics.neto >= 0 ? "ink" : "warning"}
        />
        <MetricCard label="Porudžbine" value={num(metrics.brojPorudzbina)} hint="Realizovano" />
        <MetricCard label="Prosečna marža" value={`${marzaPct}%`} hint="Zarada / promet" />
      </div>

      {/* Objašnjenje kad period nema realizovanih porudžbina (nule nisu kvar) */}
      {metrics.brojPorudzbina === 0 ? (
        <div className="border-border bg-surface text-ink-soft mb-8 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <Info className="text-ink-faint mt-0.5 size-4 shrink-0" />
          <div>
            Nema realizovanih porudžbina u ovom periodu ({period.label}). Metrike broje samo
            porudžbine koje su <span className="font-medium">isporučene i plaćene</span> — probaj
            drugi mesec.
            {waiting.isporucenoNeuplaceno > 0 ? (
              <>
                {" "}
                Imaš {num(waiting.isporucenoNeuplaceno)} isporučenih koje čekaju uplatu —{" "}
                <Link
                  href="/finansije/uplate"
                  className="text-green font-medium underline-offset-2 hover:underline"
                >
                  obeleži uplatu
                </Link>{" "}
                da uđu u zaradu.
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Tekuće stanje */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/finansije"
          className="border-green/30 bg-green-soft hover:bg-green/10 rounded-lg border px-4 py-4 transition-colors"
        >
          <div className="eyebrow text-green">Za fakturisanje</div>
          <div className="text-green num mt-1 text-2xl font-bold">{rsd(drug.total)}</div>
          <p className="text-ink-soft mt-1 text-xs">
            {num(drug.orderCount)} nefakturisanih porudžbina (uplaćeno, bez čekanja VP)
          </p>
        </Link>

        <Link
          href="/finansije/postarina"
          className="border-border bg-surface shadow-soft hover:bg-surface-2 rounded-lg border px-4 py-4 transition-colors"
        >
          <div className="eyebrow">Saldo poštarine</div>
          <div
            className={
              "num mt-1 text-2xl font-bold " +
              (saldo.balance === 0 ? "text-success" : "text-warning")
            }
          >
            {signed(saldo.balance)}
          </div>
          <p className="text-ink-soft mt-1 text-xs">Prolazna stavka — nije profit.</p>
        </Link>
      </div>

      {/* Porudžbine koje čekaju */}
      <section className="mb-8">
        <h2 className="text-ink mb-3 text-sm font-semibold">Porudžbine koje čekaju</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {waitingCards.map(({ label, count, href, icon: Icon }) => {
            const muted = count === 0;
            return (
              <Link
                key={label}
                href={href}
                className={
                  "flex flex-col gap-1 rounded-lg border px-4 py-4 transition-colors " +
                  (muted
                    ? "border-border bg-surface text-ink-faint hover:bg-surface-2"
                    : "border-warning/30 bg-warning/5 hover:bg-warning/10")
                }
              >
                <Icon className={"size-4 " + (muted ? "text-ink-faint" : "text-warning")} />
                <span className={"num text-2xl font-bold " + (muted ? "" : "text-ink")}>
                  {num(count)}
                </span>
                <span className="text-ink-soft text-xs">{label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Niska zaliha */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ink text-sm font-semibold">Niska zaliha</h2>
          {lowStock.length > 0 ? (
            <Link href="/katalog" className="text-green text-xs font-medium hover:underline">
              Vidi ceo katalog
            </Link>
          ) : null}
        </div>

        {lowStock.length === 0 ? (
          <EmptyState
            icon={<PackageCheck />}
            title="Sve zalihe iznad praga"
            description="Nijedna aktivna varijanta nije na niskom stanju."
          />
        ) : (
          <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
            {lowStockVisible.map((v) => (
              <Link
                key={v.variant_id}
                href={`/katalog/${v.product_id}`}
                className="hover:bg-surface-2 flex items-center justify-between gap-3 px-4 py-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-ink truncate text-sm font-medium">
                    {v.product_name}
                    {v.variant_name ? (
                      <span className="text-ink-soft font-normal"> · {v.variant_name}</span>
                    ) : null}
                  </div>
                  <div className="text-ink-faint truncate text-xs">{v.sku}</div>
                </div>
                <div className="num text-warning shrink-0 text-sm font-semibold">
                  {num(v.stock_quantity)} / {num(v.low_stock_threshold)}
                </div>
              </Link>
            ))}
            {lowStockRest > 0 ? (
              <div className="text-ink-soft px-4 py-2.5 text-xs">
                … još {num(lowStockRest)} varijanti na niskom stanju
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}

/* ── Lokalne komponente ──────────────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "warning";
}) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div
        className={"num mt-1 text-2xl font-bold " + (tone === "warning" ? "text-warning" : "text-ink")}
      >
        {value}
      </div>
      {hint ? <p className="text-ink-soft mt-1 truncate text-xs capitalize">{hint}</p> : null}
    </div>
  );
}
