/*
 * Tipovi kataloga + čiste funkcije (client-safe, bez server-only).
 * Server upiti su u db/catalog.ts; ovo dele i klijentske komponente.
 */

export type CategoryRow = { id: string; name: string; sort_order: number };

export type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  variant_name: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  supplier_sku: string | null;
  weight_grams: number | null;
  image: string | null;
  archived_at: string | null;
  /** Kad je stanje poslednji put popisano; null = količina nikad uneta. */
  stock_counted_at: string | null;
  /** Vrednosti atributa po nazivu (npr. {"Težina": "1 kg"}). Vidi i Logistika. */
  attributes: Record<string, string>;
  // Samo Admin/Menadžer (Logistika: undefined — kolone ne postoje):
  mp_price?: number;
  vp_price?: number;
  profit?: number;
};

export type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  image: string | null;
  category_id: string | null;
  /** Atributi koje varijante ovog proizvoda imaju (npr. ["Težina"]). */
  attribute_names: string[];
  archived_at: string | null;
  updated_at: string;
};

export type ProductWithVariants = ProductRow & {
  category: CategoryRow | null;
  variants: VariantRow[];
};

/**
 * Da li je varijanta na niskom stanju (aktivna, POPISANA i ≤ prag).
 *
 * Nepopisane se namerno ne broje: `stock_quantity` je `default 0`, pa bi svaka
 * varijanta čija količina nikad nije uneta lažno padala u nisko stanje.
 * Popisana nula JESTE nisko stanje — to je stvarno prazna polica.
 */
export function isVariantLowStock(v: VariantRow): boolean {
  return (
    v.archived_at == null &&
    v.stock_counted_at != null &&
    v.stock_quantity <= v.low_stock_threshold
  );
}

/** Aktivna varijanta kojoj količina nikad nije uneta („Fali količina"). */
export function isVariantUncounted(v: VariantRow): boolean {
  return v.archived_at == null && v.stock_counted_at == null;
}
