/**
 * Zajednički prikazni helperi modula Ponude (koriste ih i server strane i
 * klijentska tabela, pa stoje van „use client" modula).
 */

/** Mesto prikaza iz plugina (slug) → naziv u UI. */
const PLACEMENT_LABELS: Record<string, string> = {
  sidecart: "Side cart",
  cart: "Korpa",
  checkout: "Checkout",
};

export function placementLabel(slug: string): string {
  return PLACEMENT_LABELS[slug] ?? slug;
}

/** Stopa dodavanja (0–1) → procenat sa jednom decimalom, npr. „12,4 %". */
export function rate(value: number): string {
  return `${new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 1 }).format(value * 100)} %`;
}
