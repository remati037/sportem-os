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

/**
 * `afterTax` — prekidač „Pre poreza / Posle poreza" (`?porez=1`). Prenosi se kroz
 * sve linkove i formu, da promena perioda ne gasi izabrani prikaz.
 */
export function PeriodFilter({ period, afterTax = false }: { period: Period; afterTax?: boolean }) {
  const today = todayBelgrade();
  const taxQs = afterTax ? "&porez=1" : "";
  const base = `/?od=${period.from}&do=${period.to}`;

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(({ key, label }) => {
          const active = period.preset === key;
          return (
            <Link
              key={key}
              href={presetHref(key, today) + taxQs}
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

      <div className="border-border bg-surface inline-flex self-start rounded-md border p-0.5 sm:self-auto" role="group" aria-label="Prikaz zarade">
        {[
          { on: false, label: "Pre poreza" },
          { on: true, label: "Posle poreza" },
        ].map(({ on, label }) => (
          <Link
            key={label}
            href={base + (on ? "&porez=1" : "")}
            aria-current={afterTax === on ? "true" : undefined}
            className={
              "rounded px-2.5 py-1 text-sm font-medium transition-colors " +
              (afterTax === on ? "bg-green-soft text-green-deep" : "text-ink-soft hover:bg-surface-2")
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <form method="get" action="/" className="flex items-end gap-2">
        {afterTax ? <input type="hidden" name="porez" value="1" /> : null}
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
