/*
 * Dnevni stubići — jedan panel = jedna serija (izdvojeno iz ponude/offers-chart).
 *
 * Kad dve veličine treba prikazati zajedno (npr. komadi i RSD), idu DVA panela
 * sa zajedničkom x-osom, nikad jedan grafikon sa dve y-ose — različite veličine
 * bi pravile lažne odnose. Naslov panela nosi identitet serije, legenda ne treba.
 *
 * Čist inline SVG (bez biblioteke): skalira se kroz viewBox, pa radi i na 360px.
 * Svaki stubić nosi <title> → tap/hover daje tačnu cifru za taj dan.
 */

const W = 720; // koordinatni sistem (viewBox), ne piksela na ekranu
const H = 132;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 18;

/** Gornja granica ose: zaokruženo naviše na „lepu" cifru (1/2/5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const step = [1, 2, 5, 10].find((s) => value <= s * base) ?? 10;
  return step * base;
}

/** „2026-09-25" → „25.9." (kratka oznaka na x-osi). */
function shortDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(d)}.${Number(m)}.`;
}

/** „2026-09-25" → „25. 9. 2026." (u tooltip-u). */
function longDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}.`;
}

export type DailyBarsPanel = {
  label: string;
  values: number[];
  format: (v: number) => string;
  /** Boja serije — brend zelena za količine, plava za novac. */
  color: string;
};

export function DailyBars({
  panel,
  days,
  showAxis,
}: {
  panel: DailyBarsPanel;
  days: string[];
  showAxis: boolean;
}) {
  const max = niceMax(Math.max(...panel.values, 0));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / Math.max(days.length, 1);
  // 2px razmak između stubića (spacer iz mark specifikacije), min 1px širine.
  const barW = Math.max(slot - 2, 1);

  // Do 5 oznaka na x-osi — gušće se ne čita ni na telefonu.
  const labelStep = Math.max(1, Math.ceil(days.length / 5));

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-ink-soft text-xs font-medium">{panel.label}</span>
        <span className="num text-ink-faint text-xs">max {panel.format(max)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${panel.label} po danima`}
      >
        {/* osnovna linija (recesivna) */}
        <line
          x1={PAD_L}
          y1={PAD_T + plotH}
          x2={W - PAD_R}
          y2={PAD_T + plotH}
          stroke="var(--border-strong)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {panel.values.map((v, i) => {
          const h = max === 0 ? 0 : (v / max) * plotH;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const y = PAD_T + plotH - h;
          return (
            <rect
              key={days[i]}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, v > 0 ? 1 : 0)}
              rx={1}
              fill={panel.color}
              opacity={v > 0 ? 1 : 0}
            >
              <title>{`${longDay(days[i])} — ${panel.format(v)}`}</title>
            </rect>
          );
        })}

        {showAxis
          ? days.map((d, i) =>
              i % labelStep === 0 || i === days.length - 1 ? (
                <text
                  key={d}
                  x={PAD_L + i * slot + slot / 2}
                  y={H - 5}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--ink-faint)"
                >
                  {shortDay(d)}
                </text>
              ) : null,
            )
          : null}
      </svg>
    </div>
  );
}
