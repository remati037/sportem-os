/*
 * Prikaz Meta podataka (deljeno klijent/server — bez server-only).
 */

const STATUS: Record<
  string,
  { label: string; variant: "success" | "warning" | "info" | "danger" }
> = {
  ACTIVE: { label: "Aktivna", variant: "success" },
  PAUSED: { label: "Pauzirana", variant: "warning" },
  CAMPAIGN_PAUSED: { label: "Pauzirana", variant: "warning" },
  ARCHIVED: { label: "Arhivirana", variant: "info" },
  DELETED: { label: "Obrisana", variant: "info" },
  IN_PROCESS: { label: "U obradi", variant: "info" },
  WITH_ISSUES: { label: "Ima problem", variant: "danger" },
};

export function campaignStatus(status: string | null) {
  return (status && STATUS[status]) || { label: status ?? "Nepoznato", variant: "info" as const };
}

const USD = new Intl.NumberFormat("sr-Latn-RS", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centi → „12,34 US$" (valuta naloga, prikaz uz RSD). */
export function usd(minor: number): string {
  return USD.format(minor / 100);
}

/** Procenat sa do 2 decimale; null → „—". */
export function pct(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} %`;
}

/** ROAS „2,35×"; null → „—". */
export function roas(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}×`;
}

/** Svi kalendarski dani [from, to] — grafikon mora imati i dane bez potrošnje. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let s = from; s <= to;) {
    out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
    s = d.toISOString().slice(0, 10);
  }
  return out;
}
