"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * Zajednički delovi grafikona (Dashboard). Čist SVG/HTML, bez chart biblioteke
 * (obrazac `ponude/offers-chart.tsx`). Grafikon se crta u STVARNIM pikselima
 * izmerenim kroz ResizeObserver — tekst ose ostaje oštar i iste veličine na 360 px
 * i na desktopu (viewBox skaliranje bi smanjivalo slova).
 *
 * Pravila (dataviz): jedna y-osa, tanke oznake, 4px zaobljen vrh stubića, 2px
 * linije, mreža hairline, tekst UVEK u ink tokenima (boja serije samo na oznaci).
 */

/** Širina elementa u pikselima (0 dok se ne izmeri). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Lepe podele ose: 0 … max u 1/2/5 × 10^n koracima (oko `count` podeoka). */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const step = ([1, 2, 2.5, 5, 10].find((s) => raw <= s * base) ?? 10) * base;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

// sr-Latn: „sr-RS" compact oznake izlaze ćirilicom („хиљ.").
const compactFmt = new Intl.NumberFormat("sr-Latn-RS", { notation: "compact", maximumFractionDigits: 1 });
/** Kratka oznaka ose: 12.000 → „12 hilj.", 1.250.000 → „1,3 mil.". */
export const compact = (n: number) => (Math.abs(n) < 1000 ? String(n) : compactFmt.format(n));

/** Okvir grafikona: naslov, podnaslov, kontrole desno, sadržaj. */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "border-border bg-surface shadow-soft flex min-w-0 flex-col rounded-lg border p-4 sm:p-5 " +
        className
      }
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">{title}</h2>
          {subtitle ? <p className="text-ink-soft mt-0.5 text-xs">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Segmentirani izbor (npr. Dan / Nedelja / Mesec). */
export function Segmented<K extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: K;
  options: { key: K; label: string; disabled?: boolean }[];
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-surface-2 border-border flex rounded-md border p-0.5">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            className={
              "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
              (active
                ? "bg-surface text-green-deep shadow-soft"
                : "text-ink-soft hover:text-ink")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type LegendItem = {
  key: string;
  label: string;
  color: string;
  shape?: "line" | "rect";
  value?: string;
};

/**
 * Legenda. Ključ prati oznaku (linija za linije, kvadrat za stubiće). Sa
 * `onToggle` stavke su dugmad koja pale/gase seriju — ugašena ostaje u legendi
 * (bledo), da se zna da postoji.
 */
export function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: LegendItem[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => {
        const off = hidden?.has(it.key) ?? false;
        const swatch =
          it.shape === "line" ? (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="size-2.5 rounded-[3px]" style={{ background: it.color }} />
          );
        const body = (
          <>
            {swatch}
            <span className="text-ink-soft">{it.label}</span>
            {it.value ? <span className="num text-ink font-medium">{it.value}</span> : null}
          </>
        );
        return (
          <li key={it.key}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => onToggle(it.key)}
                className={
                  "hover:bg-surface-2 -mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-opacity " +
                  (off ? "opacity-40" : "")
                }
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type TooltipRow = { key: string; label: string; value: string; color: string };

/**
 * Plutajući opis iznad grafikona. Vrednost je jača od naziva serije (čitalac već
 * zna seriju, traži broj); serija je obeležena kratkom linijom svoje boje.
 * Stoji pored tačke, nikad preko nje.
 */
export function ChartTooltip({
  x,
  containerWidth,
  title,
  rows,
  footer,
}: {
  x: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
  footer?: string;
}) {
  const W = 184;
  // Pored krstića (ne preko njega): desno, a kad nema mesta — levo.
  const right = x + 14;
  const left = Math.max(right + W <= containerWidth ? right : x - W - 14, 0);
  return (
    <div
      className="border-border bg-surface pointer-events-none absolute top-0 z-10 rounded-md border px-3 py-2 text-xs shadow-md"
      style={{ left, width: W }}
      role="status"
    >
      <div className="text-ink-soft mb-1 font-medium first-letter:uppercase">{title}</div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="text-ink-soft truncate">{r.label}</span>
            <span className="num text-ink ml-auto font-semibold">{r.value}</span>
          </div>
        ))}
      </div>
      {footer ? <div className="text-ink-faint border-border mt-1.5 border-t pt-1">{footer}</div> : null}
    </div>
  );
}

/** Prazno stanje unutar kartice grafikona. */
export function ChartEmpty({ children, height = 200 }: { children: ReactNode; height?: number }) {
  return (
    <div
      className="text-ink-faint bg-surface-2 border-border flex items-center justify-center rounded-md border border-dashed px-4 text-center text-sm"
      style={{ height }}
    >
      {children}
    </div>
  );
}
