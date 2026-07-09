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

/** Da li je varijanta na niskom stanju (aktivna i ≤ prag). */
export function isVariantLowStock(v: VariantRow): boolean {
  return v.archived_at == null && v.stock_quantity <= v.low_stock_threshold;
}
