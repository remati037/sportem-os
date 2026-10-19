import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { PeriodMetrics } from "@/db/metrics";
import { num } from "@/lib/format";

/*
 * Kartica metrike Dashboarda + poređenje sa prethodnim periodom (strelica i
 * procenat; marža u procentnim poenima). Zelena = raste, crvena = pada.
 */

/* ── Poređenje sa prethodnim periodom ───────────────────────────────────── */

export type Delta = { direction: "up" | "down" | "flat"; text: string; vs: string; title: string };

/** Procentualna promena; kad je prethodna vrednost ≤ 0, procenat ne znači ništa → razlika. */
export function pctDelta(cur: number, prev: number, vs: string, fmt: (n: number) => string = num): Delta {
  const diff = cur - prev;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  let text: string;
  if (diff === 0) text = "isto";
  else if (prev > 0) text = `${diff > 0 ? "+" : "−"}${num(Math.round((Math.abs(diff) / prev) * 100))}%`;
  else text = "novo";
  return { direction, text, vs, title: `${vs} (isti broj dana): ${fmt(prev)}` };
}

/** Marža: razlika u procentnim poenima (procenat od procenta zbunjuje). */
export function marginDelta(cur: PeriodMetrics, prev: PeriodMetrics, vs: string): Delta {
  const pp = Math.round(cur.marza * 100) - Math.round(prev.marza * 100);
  return {
    direction: pp > 0 ? "up" : pp < 0 ? "down" : "flat",
    text: pp === 0 ? "isto" : `${pp > 0 ? "+" : "−"}${Math.abs(pp)} p.p.`,
    vs,
    title: `${vs} (isti broj dana): ${Math.round(prev.marza * 100)}%`,
  };
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "ink",
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "warning";
  delta?: Delta | null;
}) {
  const Icon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div
        className={"num mt-1 text-2xl font-bold " + (tone === "warning" ? "text-warning" : "text-ink")}
      >
        {value}
      </div>
      {hint ? <p className="text-ink-soft mt-1 truncate text-xs first-letter:uppercase">{hint}</p> : null}
      {delta ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs" title={delta.title}>
          <span
            className={
              "inline-flex items-center gap-0.5 rounded px-1 py-px font-semibold " +
              (delta.direction === "up"
                ? "bg-green-soft text-green-deep"
                : delta.direction === "down"
                  ? "bg-danger-soft text-danger"
                  : "bg-surface-2 text-ink-soft")
            }
          >
            <Icon className="size-3" aria-hidden />
            {delta.text}
          </span>
          <span className="text-ink-faint">vs {delta.vs}</span>
        </p>
      ) : null}
    </div>
  );
}
