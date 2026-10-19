"use client";

import { useState } from "react";

import { num } from "@/lib/format";

/*
 * Prsten (udeo celine) — samo za malo kategorija koje čine 100 % (npr. statusi).
 * Legenda pored prstena nosi broj i procenat, pa boja nikad nije jedini nosilac
 * značenja. Hover na segment ILI na red legende ističe isti segment.
 */

export type DonutSlice = { key: string; label: string; value: number; color: string };

const SIZE = 168;
const STROKE = 22;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function DonutChart({
  slices,
  centerLabel,
  format = num,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  format?: (v: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 1000) / 10);
  const activeSlice = shown.find((s) => s.key === active) ?? null;

  // 2px razmak (u boji površine) između segmenata — samo kad ih ima više.
  const gap = shown.length > 1 ? 2 : 0;
  const arcs = shown.reduce<{ slice: DonutSlice; len: number; offset: number }[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    acc.push({ slice: s, len: total === 0 ? 0 : (s.value / total) * C, offset: prev ? prev.offset + prev.len : 0 });
    return acc;
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={centerLabel}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map(({ slice: s, len, offset }) => {
              const dash = Math.max(len - gap, 0.5);
              return (
                <circle
                  key={s.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={active === s.key ? STROKE + 4 : STROKE}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  opacity={active && active !== s.key ? 0.4 : 1}
                  onPointerEnter={() => setActive(s.key)}
                  onPointerDown={() => setActive(s.key)}
                  onPointerLeave={() => setActive(null)}
                  className="cursor-default transition-[opacity,stroke-width]"
                >
                  <title>{`${s.label}: ${format(s.value)} (${pct(s.value)} %)`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-ink text-2xl font-bold">
            {format(activeSlice ? activeSlice.value : total)}
          </span>
          <span className="text-ink-soft max-w-[6.5rem] truncate text-xs">
            {activeSlice ? activeSlice.label : centerLabel}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-1">
        {slices.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => s.value > 0 && setActive(s.key)}
            onPointerLeave={() => setActive(null)}
            className={
              "flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors " +
              (active === s.key ? "bg-surface-2" : "") +
              (s.value === 0 ? " opacity-50" : "")
            }
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="text-ink-soft truncate">{s.label}</span>
            <span className="num text-ink ml-auto font-semibold">{format(s.value)}</span>
            <span className="num text-ink-faint w-12 text-right">{pct(s.value)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
