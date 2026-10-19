"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { ChartTooltip, compact, niceTicks, useWidth } from "./core";

/*
 * Linijski grafikon kroz vreme (više serija iste jedinice → jedna osa).
 * Linija 2px + blaga površina (~10%), krstić koji „hvata" najbliži X i opis sa
 * SVIM serijama u toj tački. Tastatura: ←/→ pomeraju tačku.
 */

export type TrendSeries = { key: string; label: string; color: string };
export type TrendPoint = { key: string; axisLabel: string; title: string; values: Record<string, number> };

const PAD_T = 12;
const PAD_B = 24;
const PAD_R = 8;

export function TrendChart({
  points,
  series,
  format,
  height = 240,
}: {
  points: TrendPoint[];
  series: TrendSeries[];
  format: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const padL = Math.max(...ticks.map((t) => compact(t).length)) * 6.2 + 10;

  const plotW = Math.max(width - padL - PAD_R, 1);
  const plotH = height - PAD_T - PAD_B;
  const n = points.length;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD_T + plotH - (top === 0 ? 0 : (v / top) * plotH);

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((x - padL) / plotW) * (n - 1));
    setActive(Math.min(Math.max(i, 0), n - 1));
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -1 : 1;
    setActive((cur) => Math.min(Math.max((cur ?? (d > 0 ? -1 : n)) + d, 0), n - 1));
  }

  const linePath = (key: string) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.values[key] ?? 0)}`).join(" ");
  const areaPath = (key: string) =>
    `${linePath(key)} L${xAt(n - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;

  const hovered = active != null ? points[active] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Grafikon: ${series.map((s) => s.label).join(", ")}`}
          tabIndex={0}
          className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-[var(--green-ring)]"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {/* mreža + y-osa */}
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

          {/* x oznake */}
          {points.map((p, i) =>
            i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery > labelEvery / 2) ? (
              <text
                key={p.key}
                x={xAt(i)}
                y={height - 6}
                textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}
                fontSize={11}
                fill="var(--ink-faint)"
              >
                {p.axisLabel}
              </text>
            ) : null,
          )}

          {/* površine pa linije (linije iznad svih površina) */}
          {series.map((s) => (
            <path key={`a-${s.key}`} d={areaPath(s.key)} fill={s.color} opacity={0.1} />
          ))}
          {series.map((s) => (
            <path
              key={`l-${s.key}`}
              d={linePath(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* jedna tačka: bez linije se ne vidi ništa — nacrtaj marker */}
          {n === 1
            ? series.map((s) => (
                <circle
                  key={`d-${s.key}`}
                  cx={xAt(0)}
                  cy={yAt(points[0].values[s.key] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))
            : null}

          {/* krstić + markeri na aktivnoj tački */}
          {hovered ? (
            <g pointerEvents="none">
              <line
                x1={xAt(active!)}
                x2={xAt(active!)}
                y1={PAD_T}
                y2={PAD_T + plotH}
                stroke="var(--ink-faint)"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={xAt(active!)}
                  cy={yAt(hovered.values[s.key] ?? 0)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
        </svg>
      ) : null}

      {hovered ? (
        <ChartTooltip
          x={xAt(active!)}
          containerWidth={width}
          title={hovered.title}
          rows={series.map((s) => ({
            key: s.key,
            label: s.label,
            value: format(hovered.values[s.key] ?? 0),
            color: s.color,
          }))}
        />
      ) : null}
    </div>
  );
}
