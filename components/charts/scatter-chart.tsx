"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { ChartTooltip, compact, useWidth, type TooltipRow } from "./core";

/*
 * Grafikon tačaka (Računica P2 — matrica obim × marža). Čist SVG u stvarnim
 * pikselima (obrazac `core.tsx`). X osa je LOGARITAMSKA kad je `xLog` — broj
 * prodatih komada je jako nakrivljen (par artikala po 80+, većina 1–5), pa bi
 * linearna osa sabila sve u levi ugao. Isprekidane linije su granice kvadranata.
 * `jitter` (px) razmiče tačke sa istim x (npr. 1 ili 2 komada) stalnim pomakom
 * po ključu, da se ne slože u stub. Hover/tap bira najbližu tačku (meta 18px), ←/→ šeta po tačkama, Enter bira.
 */

export type ScatterPoint = {
  key: string;
  x: number;
  y: number;
  color: string;
  title: string;
  rows: TooltipRow[];
};

const PAD_T = 12;
const PAD_B = 30;
const PAD_R = 12;
const HIT = 18;

/** Stalan pomak u [-1, 1] po ključu (isti pri svakom crtanju). */
function spread(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * 2 - 1;
}

function logTicks(max: number): number[] {
  const out: number[] = [];
  for (let p = 1; p <= Math.max(max, 1) * 1.0001; p *= 10) {
    for (const m of [1, 2, 5]) if (p * m <= Math.max(max, 1)) out.push(p * m);
  }
  return out;
}

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xLog = false,
  xThreshold,
  yThreshold,
  yFormat,
  cornerLabels,
  onSelect,
  jitter = 0,
  height = 300,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xLog?: boolean;
  xThreshold?: number;
  yThreshold?: number;
  yFormat: (v: number) => string;
  /** Natpisi u uglovima: [gore levo, gore desno, dole levo, dole desno]. */
  cornerLabels?: [string, string, string, string];
  onSelect?: (key: string) => void;
  jitter?: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMax = Math.max(1, ...xs, xThreshold ?? 0);
  const yTop = Math.ceil(Math.max(10, ...ys, yThreshold ?? 0) / 10) * 10;
  const yBottom = Math.min(0, Math.floor(Math.min(0, ...ys) / 10) * 10);
  const yStep = yTop - yBottom > 60 ? 20 : 10;
  const yTicks: number[] = [];
  for (let v = yBottom; v <= yTop; v += yStep) yTicks.push(v);

  const padL = Math.max(...yTicks.map((t) => yFormat(t).length)) * 6.2 + 12;
  const plotW = Math.max(width - padL - PAD_R, 1);
  const plotH = height - PAD_T - PAD_B;

  const xDomainMax = xLog ? Math.log10(xMax * 1.15) : xMax * 1.05;
  const xAt = (v: number) =>
    padL + ((xLog ? Math.log10(Math.max(v, 1)) : v) / (xDomainMax || 1)) * plotW;
  const yAt = (v: number) => PAD_T + plotH - ((v - yBottom) / (yTop - yBottom || 1)) * plotH;
  const xTicks = xLog
    ? logTicks(xMax)
    : Array.from({ length: 5 }, (_, i) => Math.round((xMax * i) / 4));
  const labelEvery = Math.max(1, Math.ceil(xTicks.length / Math.max(2, Math.floor(plotW / 44))));

  const px = (p: ScatterPoint) => xAt(p.x) + (jitter ? spread(p.key) * jitter : 0);

  // Redosled za tastaturu: po x, pa po y.
  const order = points
    .map((p, i) => ({ i, x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((o) => o.i);

  function nearest(e: PointerEvent<SVGSVGElement>): number | null {
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    let best: number | null = null;
    let bestD = HIT * HIT;
    points.forEach((p, i) => {
      const dx = px(p) - mx;
      const dy = yAt(p.y) - my;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "Enter" && active != null) {
      onSelect?.(points[active].key);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const pos = active == null ? -1 : order.indexOf(active);
    const next = e.key === "ArrowRight" ? Math.min(pos + 1, order.length - 1) : Math.max(pos - 1, 0);
    setActive(order[next] ?? null);
  }

  const hovered = active != null ? points[active] : null;
  const xT = xThreshold != null ? xAt(xThreshold) : null;
  const yT = yThreshold != null ? yAt(yThreshold) : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Grafikon tačaka: ${xLabel} i ${yLabel}, ${points.length} artikala`}
          tabIndex={0}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-[var(--green-ring)]"
          onPointerMove={(e) => setActive(nearest(e))}
          onPointerDown={(e) => setActive(nearest(e))}
          onPointerLeave={() => setActive(null)}
          onClick={(e) => {
            const i = nearest(e as unknown as PointerEvent<SVGSVGElement>);
            if (i != null) onSelect?.(points[i].key);
          }}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          style={{ cursor: hovered && onSelect ? "pointer" : undefined }}
        >
          {yTicks.map((t) => (
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
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) =>
            i % labelEvery === 0 ? (
              <text
                key={t}
                x={xAt(t)}
                y={height - PAD_B + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-faint)"
                className="num"
              >
                {compact(t)}
              </text>
            ) : null,
          )}
          <text
            x={width - PAD_R}
            y={height - 2}
            textAnchor="end"
            fontSize={11}
            fill="var(--ink-soft)"
          >
            {xLabel} →
          </text>

          {xT != null ? (
            <line x1={xT} x2={xT} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--border-strong)" strokeDasharray="4 4" />
          ) : null}
          {yT != null ? (
            <line x1={padL} x2={width - PAD_R} y1={yT} y2={yT} stroke="var(--border-strong)" strokeDasharray="4 4" />
          ) : null}

          {cornerLabels
            ? (
                [
                  [padL + 6, PAD_T + 12, "start"],
                  [width - PAD_R - 6, PAD_T + 12, "end"],
                  [padL + 6, PAD_T + plotH - 6, "start"],
                  [width - PAD_R - 6, PAD_T + plotH - 6, "end"],
                ] as const
              ).map(([x, y, anchor], i) => (
                <text
                  key={i}
                  x={x}
                  y={y}
                  textAnchor={anchor}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--ink-faint)"
                  pointerEvents="none"
                >
                  {cornerLabels[i]}
                </text>
              ))
            : null}

          {points.map((p, i) => (
            <circle
              key={p.key}
              cx={px(p)}
              cy={yAt(p.y)}
              r={active === i ? 6.5 : 4.5}
              fill={p.color}
              fillOpacity={active != null && active !== i ? 0.35 : 0.85}
              stroke="var(--surface)"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          ))}
        </svg>
      ) : null}

      {hovered ? (
        <ChartTooltip
          x={px(hovered)}
          containerWidth={width}
          title={hovered.title}
          rows={hovered.rows}
          footer={onSelect ? "Klik: prikaži u tabeli" : undefined}
        />
      ) : null}
    </div>
  );
}
