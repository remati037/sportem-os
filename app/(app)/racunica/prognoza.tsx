"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkle } from "lucide-react";

import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import {
  TREND_MIN_QTY,
  forecastQty,
  projectMonth,
  trendOf,
  type MonthInput,
  type Velocity,
} from "@/lib/sales-velocity";
import { SOON_DAYS } from "@/lib/racunica";
import { ChartCard } from "@/components/charts/core";

/*
 * Računica P3 — prognoze. Sve gleda unazad OD DANAS (ne zavisi od izabranog
 * perioda); pravila su u lib/sales-velocity.ts.
 */

const monthName = (day: string) =>
  new Intl.DateTimeFormat("sr-Latn-RS", { month: "long", timeZone: "Europe/Belgrade" }).format(
    new Date(`${day}T12:00:00Z`),
  );

export function MonthForecastCard({ month }: { month: MonthInput }) {
  const p = projectMonth(month);
  const doneShare = p.projected > 0 ? Math.min(p.mtdProfit / p.projected, 1) : 0;
  return (
    <ChartCard
      title={`Zarada do kraja meseca (${monthName(month.monthFrom)})`}
      subtitle="Procena po tempu poslednje 4 nedelje. Ne zavisi od izabranog perioda."
      className="mb-6"
    >
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="eyebrow">Procena</div>
          <div className="num text-ink text-2xl font-bold">{rsd(p.projected)}</div>
          <div className="text-ink-soft num text-xs">
            raspon {rsd(p.low)} – {rsd(p.high)}
          </div>
        </div>
        <div>
          <div className="eyebrow">Ostvareno do danas</div>
          <div className="num text-ink text-lg font-semibold">{rsd(p.mtdProfit)}</div>
          <div className="text-ink-soft num text-xs">promet {rsd(p.mtdRevenue)}</div>
        </div>
        <div>
          <div className="eyebrow">Tempo</div>
          <div className="num text-ink text-lg font-semibold">{rsd(p.dailyAvg)} / dan</div>
          <div className="text-ink-soft num text-xs">
            još {num(p.remainingDays)} {p.remainingDays === 1 ? "dan" : "dana"} u mesecu
          </div>
        </div>
      </div>
      <div
        className="bg-surface-2 mt-4 h-2 overflow-hidden rounded-full"
        role="img"
        aria-label={`Ostvareno ${Math.round(doneShare * 100)} % procene`}
      >
        <div className="bg-green h-full rounded-full" style={{ width: `${doneShare * 100}%` }} />
      </div>
      <p className="text-ink-faint mt-2 text-xs">
        Ostvareno računa kao Dashboard (kreirano u mesecu, bez otkazanih i vraćenih). Raspon je
        najslabija i najjača od poslednje 4 nedelje. Sezona nije uračunata — podaci postoje tek od
        2. 2. 2026.
      </p>
    </ChartCard>
  );
}

/** Trend artikla: poslednjih 30 dana prema prethodnih 30 (komadi). */
export function TrendValue({ vel }: { vel: Velocity }) {
  const t = trendOf(vel);
  if (t.dir === "few") {
    return (
      <span
        className="text-ink-faint text-xs"
        title={`Malo podataka: manje od ${TREND_MIN_QTY} komada u oba prozora od 30 dana`}
      >
        <span aria-hidden>—</span>
        <span className="sr-only">malo podataka</span>
      </span>
    );
  }
  if (t.dir === "new") {
    return (
      <span className="text-success inline-flex items-center gap-1" title="Nije prodavan prethodnih 30 dana">
        <Sparkle className="size-3.5" aria-hidden />
        novo
      </span>
    );
  }
  const Icon = t.dir === "up" ? ArrowUpRight : t.dir === "down" ? ArrowDownRight : ArrowRight;
  const label = t.dir === "up" ? "raste" : t.dir === "down" ? "pada" : "bez promene";
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5",
        t.dir === "up" && "text-success",
        t.dir === "down" && "text-danger",
        t.dir === "flat" && "text-ink-soft",
      )}
      title={`${num(vel.q30)} kom poslednjih 30 dana, ${num(vel.qPrev30)} kom prethodnih 30 — ${label}`}
    >
      <Icon className="size-3.5" aria-label={label} />
      {t.pct > 0 ? "+" : t.pct < 0 ? "−" : ""}
      {num(Math.round(Math.abs(t.pct)))} %
    </span>
  );
}

/** „12 kom" za narednih 30 dana (zaokruženo; ispod 1 → „< 1"). */
export function forecastLabel(vel: Velocity): string {
  const f = forecastQty(vel);
  if (f === 0) return "—";
  if (f < 1) return "< 1 kom";
  return `${num(Math.round(f))} kom`;
}

/** „za 12 d" (do nule) / „nema" / „—". */
export function DaysToZero({ days }: { days: number | null }) {
  if (days == null) return <span>—</span>;
  if (days === 0) return <span className="text-danger">nema na stanju</span>;
  const d = Math.round(days);
  return (
    <span
      className={cn(days < SOON_DAYS && "text-warning font-medium")}
      title="Za koliko dana stanje pada na nulu po trenutnom tempu"
    >
      {d > 365 ? "nula za > godinu" : `nula za ${num(Math.max(d, 1))} d`}
    </span>
  );
}
