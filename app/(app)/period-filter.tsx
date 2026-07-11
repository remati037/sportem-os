import Link from "next/link";

import { todayBelgrade } from "@/lib/date-belgrade";
import { presetHref, type Period, type PresetKey } from "@/lib/period";

/*
 * Period filter za Dashboard (Korak 1.8) — server komponenta, bez client JS.
 * Preseti su linkovi na ?od&do; prilagođeni raspon je native GET forma sa dva
 * date inputa (URL-driven, kao ostali filteri u app-u).
 */

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "dan", label: "Danas" },
  { key: "nedelja", label: "Ova nedelja" },
  { key: "mesec", label: "Ovaj mesec" },
];

export function PeriodFilter({ period }: { period: Period }) {
  const today = todayBelgrade();

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(({ key, label }) => {
          const active = period.preset === key;
          return (
            <Link
              key={key}
              href={presetHref(key, today)}
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

      <form method="get" action="/" className="flex items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-faint text-xs">Od</span>
          <input
            type="date"
            name="od"
            defaultValue={period.from}
            max={period.to}
            className="border-border bg-surface text-ink rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-faint text-xs">Do</span>
          <input
            type="date"
            name="do"
            defaultValue={period.to}
            className="border-border bg-surface text-ink rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="border-green/30 bg-green-soft text-green-deep hover:bg-green/10 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Primeni
        </button>
      </form>
    </div>
  );
}
