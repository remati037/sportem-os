/*
 * Horizontalna rang-lista (top artikli, gradovi). Naziv levo, vrednost na kraju
 * — svaka vrednost je ispisana, pa opis na hover nije potreban. Traka je tanka
 * (8px), zaobljen kraj, osnova uvek levo. Jedna serija → bez legende.
 */

export type BarRow = { key: string; label: string; sublabel?: string; value: number; display: string };

export function BarList({ rows, color = "var(--green)" }: { rows: BarRow[]; color?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="min-w-0" title={r.sublabel ? `${r.label} · ${r.sublabel}` : r.label}>
          <div className="mb-1 flex items-baseline gap-2 text-xs">
            <span className="num text-ink-faint w-4 shrink-0 text-right">{i + 1}</span>
            <span className="text-ink min-w-0 truncate font-medium">{r.label}</span>
            {r.sublabel ? (
              <span className="text-ink-faint hidden shrink-0 truncate sm:inline">{r.sublabel}</span>
            ) : null}
            <span className="num text-ink ml-auto shrink-0 font-semibold">{r.display}</span>
          </div>
          <div className="bg-surface-2 ml-6 h-2 rounded-full">
            <div
              className="h-2 rounded-full transition-[width] duration-300"
              style={{ width: `${max === 0 ? 0 : Math.max((r.value / max) * 100, 1.5)}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
