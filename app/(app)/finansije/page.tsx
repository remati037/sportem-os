import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getDrugMiDuguje, getSaldoPostarine, getNetoProfit } from "@/db/finance";
import { rsd, num } from "@/lib/format";
import { todayBelgrade } from "@/lib/date-belgrade";

import { FinanceTabs } from "./finance-tabs";

export const dynamic = "force-dynamic";

/*
 * Finansije — overview (Korak 1.6c). Tri kartice: „Drug mi duguje", saldo
 * poštarine i neto profit izabranog meseca (uplaćeno + keš zarada − troškovi).
 * Cifre su iz zamrznutih stavki (order_profit view). Tabovi vode na pod-rute.
 */

/** „YYYY-MM" → naredni/prethodni mesec (kalendarska matematika). */
function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** „YYYY-MM" → „jul 2026" (Europe/Belgrade lokalizacija). */
function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Intl.DateTimeFormat("sr-RS", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function signed(n: number) {
  return n === 0 ? "0" : `${n > 0 ? "+" : ""}${rsd(n)}`;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export default async function FinansijePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const sp = await searchParams;
  const rawMonth = typeof sp.mesec === "string" ? sp.mesec : "";
  const mesec = MONTH_RE.test(rawMonth) ? rawMonth : todayBelgrade().slice(0, 7);

  const [drug, saldo, neto] = await Promise.all([
    getDrugMiDuguje(),
    getSaldoPostarine(),
    getNetoProfit(mesec),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>

      <FinanceTabs />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Drug mi duguje */}
        <div className="border-green/30 bg-green-soft rounded-lg border px-4 py-4">
          <div className="eyebrow text-green">Drug mi duguje</div>
          <div className="text-green num mt-1 text-2xl font-bold">{rsd(drug.total)}</div>
          <p className="text-ink-soft mt-1 text-xs">
            {num(drug.orderCount)} nefakturisanih porudžbina (uplaćeno, bez čekanja VP)
          </p>
        </div>

        {/* Saldo poštarine */}
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

        {/* Neto profit (izabrani mesec) */}
        <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Neto profit</div>
            <div className="flex items-center gap-1">
              <Link
                href={`/finansije?mesec=${shiftMonth(mesec, -1)}`}
                aria-label="Prethodni mesec"
                className="text-ink-faint hover:text-ink hover:bg-surface-2 rounded p-0.5"
              >
                <ChevronLeft className="size-4" />
              </Link>
              <span className="text-ink-soft text-xs capitalize">{monthLabel(mesec)}</span>
              <Link
                href={`/finansije?mesec=${shiftMonth(mesec, 1)}`}
                aria-label="Sledeći mesec"
                className="text-ink-faint hover:text-ink hover:bg-surface-2 rounded p-0.5"
              >
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>
          <div
            className={
              "num mt-1 text-2xl font-bold " + (neto.neto >= 0 ? "text-ink" : "text-warning")
            }
          >
            {rsd(neto.neto)}
          </div>
          <div className="text-ink-soft mt-2 space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span>Zarada</span>
              <span className="num">{rsd(neto.zarada)}</span>
            </div>
            <div className="flex justify-between">
              <span>Troškovi</span>
              <span className="num">{rsd(neto.troskovi)}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
