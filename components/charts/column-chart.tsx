"use client";

import { useState, type KeyboardEvent } from "react";

import { ChartTooltip, compact, niceTicks, useWidth } from "./core";

/*
 * Stubići (opciono naslagani). Stubić najviše 24px širok, vrh zaobljen 4px,
 * osnova ravna; 2px razmak između segmenata. Ceo stupac (i prazan prostor iznad
 * njega) je meta za hover/tap, ne samo obojeni pikseli.
 */

export type ColumnSeries = { key: string; label: string; color: string };
export type Column = {
  key: string;
  axisLabel: string;
  title: string;
  values: Record<string, number>;
  footer?: string;
};

const PAD_T = 12;
const PAD_B = 24;
const PAD_R = 4;
const MAX_BAR = 24;
const GAP = 2;

/** Pravougaonik sa zaobljenim GORNJIM uglovima (r), ravnom osnovom. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function ColumnChart({
  columns,
  series,
  format,
  height = 220,
  showTotal = false,
}: {
  columns: Column[];
  series: ColumnSeries[];
  format: (v: number) => string;
  height?: number;
  /** U opisu dodaj red „Ukupno" (za naslagane). */
  showTotal?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const totals = columns.map((c) => series.reduce((s, se) => s + (c.values[se.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  const padL = Math.max(...ticks.map((t) => compact(t).length)) * 6.2 + 10;

  const plotW = Math.max(width - padL - PAD_R, 1);
  const plotH = height - PAD_T - PAD_B;
  const n = columns.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(Math.min(MAX_BAR, slot * 0.62), Math.min(slot - 1, 2));
  const yAt = (v: number) => PAD_T + plotH - (top === 0 ? 0 : (v / top) * plotH);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 56))));

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -1 : 1;
    setActive((cur) => Math.min(Math.max((cur ?? (d > 0 ? -1 : n)) + d, 0), n - 1));
  }

  const hovered = active != null ? columns[active] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Stubičasti grafikon: ${series.map((s) => s.label).join(", ")}`}
          tabIndex={0}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-[var(--green-ring)]"
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={width - PAD_R}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke={t === 0 ? "var(--border-strong)" : "var(--border)"}
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={yAt(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-faint)"
                className="num"
              >
                {compact(t)}
              </text>
            </g>
          ))}

          {columns.map((c, i) => {
            const cx = padL + i * slot + slot / 2;
            const x = cx - barW / 2;
            const isActive = active === i;
            const dim = active != null && !isActive;
            // Segmenti odozdo nagore; vrh zaobljen samo poslednjem nenultom.
            const visible = series.filter((s) => (c.values[s.key] ?? 0) > 0);
            let acc = 0;
            return (
              <g key={c.key} opacity={dim ? 0.55 : 1}>
                {/* meta: ceo stupac */}
                <rect
                  x={padL + i * slot}
                  y={PAD_T}
                  width={slot}
                  height={plotH}
                  fill={isActive ? "var(--surface-2)" : "transparent"}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                />
                {visible.map((s, si) => {
                  const v = c.values[s.key] ?? 0;
                  const y0 = yAt(acc);
                  acc += v;
                  const y1 = yAt(acc);
                  const last = si === visible.length - 1;
                  // 2px razmak ispod svakog segmenta osim prvog
                  const h = Math.max(y0 - y1 - (si > 0 ? GAP : 0), 1);
                  const y = y1;
                  return last ? (
                    <path key={s.key} d={topRounded(x, y, barW, h, 4)} fill={s.color} pointerEvents="none" />
                  ) : (
                    <rect key={s.key} x={x} y={y} width={barW} height={h} fill={s.color} pointerEvents="none" />
                  );
                })}
                {i % labelEvery === 0 ? (
                  <text
                    x={cx}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--ink-faint)"
                    pointerEvents="none"
                  >
                    {c.axisLabel}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}

      {hovered ? (
        <ChartTooltip
          x={padL + active! * slot + slot / 2}
          containerWidth={width}
          title={hovered.title}
          rows={[
            ...series.map((s) => ({
              key: s.key,
              label: s.label,
              value: format(hovered.values[s.key] ?? 0),
              color: s.color,
            })),
            ...(showTotal
              ? [{ key: "__total", label: "Ukupno", value: format(totals[active!]), color: "transparent" }]
              : []),
          ]}
          footer={hovered.footer}
        />
      ) : null}
    </div>
  );
}
