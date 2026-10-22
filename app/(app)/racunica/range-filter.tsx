"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RANGE_PRESETS, rangePresetBounds, type RangePeriod } from "@/lib/period";

/*
 * Period Računice: preset linkovi + prilagođen raspon. Klijentska komponenta jer
 * filteri tabele žive u URL-u (history.replaceState), pa linkovi perioda moraju
 * da ih čitaju iz TRENUTNOG URL-a da ih promena perioda ne bi obrisala.
 */
export function RangeFilter({ period, today }: { period: RangePeriod; today: string }) {
  const params = useSearchParams();
  const keep = [...params.entries()].filter(([k]) => k !== "od" && k !== "do");
  const href = (from: string, to: string) => {
    const sp = new URLSearchParams(keep);
    sp.set("od", from);
    sp.set("do", to);
    return `/racunica?${sp.toString()}`;
  };

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map(({ key, label }) => {
            const b = rangePresetBounds(key, today);
            const active = period.preset === key;
            return (
              <Link
                key={key}
                href={href(b.from, b.to)}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active
                    ? "border-green/30 bg-green-soft text-green-deep"
                    : "border-border bg-surface text-ink-soft hover:bg-surface-2")
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
        <p className="text-ink-faint text-xs first-letter:uppercase">{period.label}</p>
      </div>

      <form method="get" action="/racunica" className="flex items-end gap-2">
        {keep.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-none">
          <span className="text-ink-faint text-xs">Od</span>
          <input
            type="date"
            name="od"
            defaultValue={period.from}
            max={period.to}
            className="border-border bg-surface text-ink w-full min-w-0 rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-none">
          <span className="text-ink-faint text-xs">Do</span>
          <input
            type="date"
            name="do"
            defaultValue={period.to}
            className="border-border bg-surface text-ink w-full min-w-0 rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="border-green/30 bg-green-soft text-green-deep hover:bg-green/10 shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Primeni
        </button>
      </form>
    </div>
  );
}
