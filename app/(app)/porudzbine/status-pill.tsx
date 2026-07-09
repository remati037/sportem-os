/*
 * Statusna pilula porudžbine — boja dolazi iz `order_statuses.color` (hex,
 * podesivo u bazi), pa ne može kroz fiksne Badge varijante.
 */
export function StatusPill({ name, color }: { name: string; color: string | null }) {
  const hex = color ?? "#6B7280";
  return (
    <span
      className="rounded-pill inline-flex h-6 w-fit shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold whitespace-nowrap"
      style={{ color: hex, backgroundColor: `${hex}1A` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: hex }} />
      {name}
    </span>
  );
}
