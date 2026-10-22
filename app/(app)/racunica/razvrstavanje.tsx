"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, PackageX } from "lucide-react";

import { cn } from "@/lib/utils";
import { datum, num, rsd } from "@/lib/format";
import {
  ABC_A_PCT,
  ABC_B_PCT,
  DEAD_DAYS_OPTIONS,
  QUADRANTS,
  VIEW_KEYS,
  VIEW_LABELS,
  deadStock,
  pct,
  realMarginPct,
  type AbcClass,
  type Quadrant,
  type RacunicaRow,
  type ViewKey,
} from "@/lib/racunica";
import { ChartCard, ChartEmpty, Legend, Segmented } from "@/components/charts/core";
import { ScatterChart, type ScatterPoint } from "@/components/charts/scatter-chart";

/*
 * Računica P2 — razvrstavanje: prekidači pogleda, ABC (Pareto), matrica
 * obim × marža i mrtva roba. Svaki pogled se može ugasiti; ugašen se ne
 * renderuje uopšte (ni kartica, ni kolona, ni filter).
 */

/* Boje kvadranata: brend zelena za „zvezde", plava (promet na Dashboardu) za
   „obim", amber za „nišu", crvena za kandidate — uz natpis i legendu, boja
   nikad nije jedini nosilac značenja. */
export const QUADRANT_COLOR: Record<Quadrant, string> = {
  zvezde: "var(--green)",
  obim: "#2a78d6",
  nisa: "var(--warning)",
  kandidati: "var(--danger)",
};

export const ABC_VARIANT: Record<AbcClass, "success" | "info" | "warning"> = {
  A: "success",
  B: "info",
  C: "warning",
};

export function ViewToggles({
  views,
  onToggle,
}: {
  views: ViewKey[];
  onToggle: (key: ViewKey) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-ink-soft text-sm">Pogledi:</span>
      {VIEW_KEYS.map((key) => {
        const on = views.includes(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium transition-colors",
              on
                ? "border-green/30 bg-green-soft text-green-deep"
                : "border-border bg-surface text-ink-soft hover:bg-surface-2",
            )}
          >
            {on ? <Check className="size-3.5" /> : null}
            {VIEW_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

/* ── ABC ─────────────────────────────────────────────────────── */

export function AbcCard({
  rows,
  abc,
  selected,
  onSelect,
}: {
  rows: RacunicaRow[];
  abc: Map<string, AbcClass>;
  selected: AbcClass | "";
  onSelect: (c: AbcClass | "") => void;
}) {
  const summary = useMemo(() => {
    const total = rows.reduce((s, r) => s + Math.max(r.stats.profit, 0), 0);
    return (["A", "B", "C"] as AbcClass[]).map((c) => {
      const inClass = rows.filter((r) => abc.get(r.key) === c);
      const profit = inClass.reduce((s, r) => s + r.stats.profit, 0);
      return {
        c,
        count: inClass.length,
        sold: inClass.filter((r) => r.stats.qty > 0).length,
        profit,
        share: total > 0 ? (Math.max(profit, 0) / total) * 100 : null,
      };
    });
  }, [rows, abc]);

  const hint: Record<AbcClass, string> = {
    A: `nose prvih ${ABC_A_PCT} % zarade`,
    B: `sledećih ${ABC_B_PCT - ABC_A_PCT} %`,
    C: "ostatak i artikli bez zarade",
  };

  return (
    <ChartCard title="ABC po zaradi" subtitle="Klik na klasu filtrira tabelu.">
      <div className="space-y-2">
        {summary.map((s) => {
          const active = selected === s.c;
          return (
            <button
              key={s.c}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? "" : s.c)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                active ? "border-green/40 bg-green-soft" : "border-border hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold",
                  s.c === "A" && "bg-success-soft text-success",
                  s.c === "B" && "bg-info-soft text-info",
                  s.c === "C" && "bg-warning-soft text-warning",
                )}
              >
                {s.c}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink block text-sm font-medium">
                  <span className="num">{num(s.count)}</span> artikala
                  {s.c === "C" && s.count > s.sold ? (
                    <span className="text-ink-faint font-normal">
                      {" "}
                      (<span className="num">{num(s.count - s.sold)}</span> bez prodaje)
                    </span>
                  ) : null}
                </span>
                <span className="text-ink-faint block text-xs">{hint[s.c]}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num text-ink block text-sm font-semibold">{rsd(s.profit)}</span>
                <span className="num text-ink-faint block text-xs">{pct(s.share)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </ChartCard>
  );
}

/* ── Matrica ─────────────────────────────────────────────────── */

export function MatrixCard({
  rows,
  quadrantOf,
  median,
  target,
  selected,
  onSelect,
  onPick,
}: {
  rows: RacunicaRow[];
  quadrantOf: (r: RacunicaRow) => Quadrant | null;
  median: number;
  target: number;
  selected: Quadrant | "";
  onSelect: (q: Quadrant | "") => void;
  /** Klik na tačku: prikaži taj artikal u tabeli. */
  onPick: (row: RacunicaRow) => void;
}) {
  const { points, counts, outside } = useMemo(() => {
    const counts: Record<Quadrant, number> = { zvezde: 0, obim: 0, nisa: 0, kandidati: 0 };
    const points: ScatterPoint[] = [];
    let outside = 0;
    for (const r of rows) {
      const q = quadrantOf(r);
      if (!q) {
        outside += 1;
        continue;
      }
      counts[q] += 1;
      if (selected && q !== selected) continue;
      points.push({
        key: r.key,
        x: r.stats.qty,
        y: realMarginPct(r.stats) ?? 0,
        color: QUADRANT_COLOR[q],
        title: r.name,
        rows: [
          { key: "qty", label: "Prodato", value: `${num(r.stats.qty)} kom`, color: "transparent" },
          { key: "m", label: "Marža", value: pct(realMarginPct(r.stats)), color: "transparent" },
          { key: "p", label: "Zarada", value: rsd(r.stats.profit), color: "transparent" },
        ],
      });
    }
    return { points, counts, outside };
  }, [rows, quadrantOf, selected]);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  return (
    <ChartCard
      title="Matrica: komadi × marža"
      subtitle={
        <>
          Granice: medijana <span className="num">{num(median)}</span> kom i cilj{" "}
          <span className="num">{num(target)}</span> %. X osa je logaritamska.
        </>
      }
    >
      {points.length === 0 ? (
        <ChartEmpty height={280}>Nema artikala sa prodajom u ovom periodu.</ChartEmpty>
      ) : (
        <ScatterChart
          points={points}
          xLabel="Prodato (kom)"
          yLabel="Stvarna marža %"
          xLog
          xThreshold={median + 0.5}
          jitter={6}
          yThreshold={target}
          yFormat={(v) => `${v} %`}
          cornerLabels={["Niša", "Zvezde", "Kandidati", "Obim"]}
          onSelect={(key) => {
            const r = byKey.get(key);
            if (r) onPick(r);
          }}
          height={280}
        />
      )}
      <div className="mt-3">
        <Legend
          items={QUADRANTS.map((q) => ({
            key: q.key,
            label: q.label,
            color: QUADRANT_COLOR[q.key],
            value: num(counts[q.key]),
          }))}
          hidden={
            selected ? new Set(QUADRANTS.map((q) => q.key).filter((k) => k !== selected)) : undefined
          }
          onToggle={(key) => onSelect(selected === key ? "" : (key as Quadrant))}
        />
        <p className="text-ink-faint mt-2 text-xs">
          Klik na kvadrant u legendi filtrira tabelu. Van grafikona:{" "}
          <span className="num">{num(outside)}</span> artikala bez prodaje u periodu.
        </p>
      </div>
    </ChartCard>
  );
}

/* ── Mrtva roba ──────────────────────────────────────────────── */

const DEAD_PREVIEW = 10;

export function DeadStockCard({
  rows,
  today,
  days,
  onDays,
}: {
  rows: RacunicaRow[];
  today: string;
  days: number;
  onDays: (d: number) => void;
}) {
  const [all, setAll] = useState(false);
  const items = useMemo(() => deadStock(rows, today, days), [rows, today, days]);
  const total = items.reduce((s, i) => s + i.value, 0);
  const shown = all ? items : items.slice(0, DEAD_PREVIEW);

  return (
    <ChartCard
      title="Mrtva roba"
      subtitle={
        <>
          Popisano stanje &gt; 0, a bez prodaje{" "}
          <span className="num">{num(days)}</span> dana (od danas, ne zavisi od perioda). Ukupno{" "}
          <span className="num text-ink font-medium">{num(items.length)}</span> varijanti ·{" "}
          <span className="num text-ink font-medium">{rsd(total)}</span> po VP.
        </>
      }
      actions={
        <Segmented
          label="Bez prodaje"
          value={String(days)}
          options={DEAD_DAYS_OPTIONS.map((d) => ({ key: String(d), label: `${d} dana` }))}
          onChange={(k) => onDays(Number(k))}
        />
      }
      className="mt-6"
    >
      {items.length === 0 ? (
        <ChartEmpty height={96}>
          <span className="inline-flex items-center gap-2">
            <PackageX className="size-4" /> Nema mrtve robe.
          </span>
        </ChartEmpty>
      ) : (
        <>
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((i) => (
              <li key={i.variant.sku} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link
                    href={`/katalog/${i.productId}`}
                    className="text-ink hover:text-green font-medium break-words"
                  >
                    {i.productName}
                    {i.variant.label !== "—" ? (
                      <span className="text-ink-soft font-normal"> · {i.variant.label}</span>
                    ) : null}
                  </Link>
                  <div className="text-ink-faint text-xs">
                    <span className="font-mono">{i.variant.sku}</span> · poslednja prodaja:{" "}
                    {i.variant.lastSoldDay ? (
                      <span className="num">{datum(`${i.variant.lastSoldDay}T12:00:00Z`)}</span>
                    ) : (
                      "nikad (od 2. 2. 2026.)"
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-ink font-semibold">{rsd(i.value)}</div>
                  <div className="num text-ink-faint text-xs">{num(i.variant.stock ?? 0)} kom</div>
                </div>
              </li>
            ))}
          </ul>
          {items.length > DEAD_PREVIEW ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="text-green mt-2 text-sm font-medium"
            >
              {all ? "Prikaži manje" : `Prikaži sve (${num(items.length)})`}
            </button>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}
