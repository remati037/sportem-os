import "server-only";

import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { chunked, must, selectAll } from "@/lib/supabase/paginate";
import type { CategoryRow, ProductRow, ProductWithVariants, VariantRow } from "@/db/catalog-types";

/*
 * Upiti kataloga (Korak 1.1a). Role-aware: Admin/Menadžer čitaju base
 * `product_variants` (sa MP/VP/profit); Logistika čita restriktovani view
 * `product_variants_public` (bez finansijskih kolona) — kolone se NE renderuju.
 *
 * Varijante se dohvataju zasebnim upitom i spajaju u JS po product_id (view
 * nema FK relaciju za automatski embed). Dataset kataloga je mali.
 *
 * Tipovi i čiste funkcije (isVariantLowStock) su u db/catalog-types.ts
 * (client-safe); ovde su re-export-ovani radi kompatibilnosti.
 */

export type { CategoryRow, ProductRow, ProductWithVariants, VariantRow };
export { isVariantLowStock, isVariantUncounted } from "@/db/catalog-types";

const PRODUCT_COLS =
  "id, name, description, brand, image, category_id, attribute_names, archived_at, updated_at";
const VARIANT_PUBLIC_COLS =
  "id, product_id, sku, variant_name, stock_quantity, low_stock_threshold, supplier_sku, weight_grams, image, archived_at, attributes, stock_counted_at";
const VARIANT_STAFF_COLS = `${VARIANT_PUBLIC_COLS}, mp_price, vp_price, profit`;

function canSeeFinance(role: Role): boolean {
  return role === "admin" || role === "manager";
}

export async function getCategories(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  return await selectAll<CategoryRow>("kategorije", () =>
    supabase
      .from("categories")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true }),
  );
}

/**
 * Varijante po roli. Bez `productIds` vraća sve; sa listom se ide u parčadima po
 * `IN_CHUNK` (dugačak `.in()` URL obori zahtev), a svako parče je paginirano —
 * inače katalog preko 1000 varijanti tiho prikaže proizvode bez cena.
 */
async function fetchVariants(role: Role, productIds?: string[]): Promise<VariantRow[]> {
  const supabase = await createClient();
  const source = canSeeFinance(role) ? "product_variants" : "product_variants_public";
  const cols = canSeeFinance(role) ? VARIANT_STAFF_COLS : VARIANT_PUBLIC_COLS;

  const build = (ids?: string[]) => {
    let query = supabase.from(source).select(cols);
    if (ids) query = query.in("product_id", ids);
    return query.order("sku", { ascending: true }).order("id", { ascending: true });
  };

  if (!productIds) return await selectAll<VariantRow>("varijante kataloga", () => build());

  const rows: VariantRow[] = [];
  for (const chunk of chunked(productIds)) {
    rows.push(...(await selectAll<VariantRow>("varijante kataloga", () => build(chunk))));
  }
  return rows;
}

/** Katalog: proizvodi + varijante + kategorija, spojeni po roli. */
export async function getCatalog({
  role,
  includeArchived = false,
}: {
  role: Role;
  includeArchived?: boolean;
}): Promise<ProductWithVariants[]> {
  const supabase = await createClient();

  let productQuery = supabase.from("products").select(PRODUCT_COLS);
  if (!includeArchived) productQuery = productQuery.is("archived_at", null);

  const [productRows, categories] = await Promise.all([
    selectAll<ProductRow>("katalog: products", () =>
      productQuery.order("name", { ascending: true }).order("id", { ascending: true }),
    ),
    getCategories(),
  ]);

  if (productRows.length === 0) return [];

  const variants = await fetchVariants(
    role,
    productRows.map((p) => p.id),
  );

  const catById = new Map(categories.map((c) => [c.id, c]));
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  return productRows.map((p) => ({
    ...p,
    category: p.category_id ? (catById.get(p.category_id) ?? null) : null,
    variants: variantsByProduct.get(p.id) ?? [],
  }));
}

export type LowStockVariant = {
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  variant_name: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
};

/**
 * Varijante na niskom stanju (aktivne, POPISANE, `stock_quantity ≤ prag`,
 * proizvod nearhiviran) — za Dashboard (Korak 1.8). Poređenje dve kolone se ne
 * može kroz PostgREST filter, pa se aktivne varijante filtriraju u JS-u (dataset
 * kataloga je mali). Samo Admin/Menadžer čitaju base tabelu (Dashboard je STAFF).
 *
 * Nepopisane (`stock_counted_at is null`) su isključene — v. `isVariantLowStock`.
 */
export async function getLowStockVariants(): Promise<LowStockVariant[]> {
  const supabase = await createClient();
  const rows = await selectAll<{
    id: string;
    product_id: string;
    sku: string;
    variant_name: string | null;
    stock_quantity: number;
    low_stock_threshold: number;
    products: { name: string; archived_at: string | null } | null;
  }>("nisko stanje: varijante", () =>
    supabase
      .from("product_variants")
      .select(
        "id, product_id, sku, variant_name, stock_quantity, low_stock_threshold, archived_at, products(name, archived_at)",
      )
      .is("archived_at", null)
      .not("stock_counted_at", "is", null)
      .order("id", { ascending: true }),
  );

  return rows
    .filter(
      (r) =>
        r.products != null &&
        r.products.archived_at == null &&
        r.stock_quantity <= r.low_stock_threshold,
    )
    .map((r) => ({
      variant_id: r.id,
      product_id: r.product_id,
      sku: r.sku,
      product_name: r.products!.name,
      variant_name: r.variant_name,
      stock_quantity: r.stock_quantity,
      low_stock_threshold: r.low_stock_threshold,
    }))
    .sort((a, b) => a.stock_quantity - b.stock_quantity || a.sku.localeCompare(b.sku));
}

/**
 * Broj aktivnih varijanti kojima količina nikad nije uneta („Fali količina").
 * Za napomenu na Dashboardu — te varijante ne ulaze u nisko stanje.
 */
export async function getUncountedVariantCount(): Promise<number> {
  const supabase = await createClient();
  const rows = await selectAll<{ products: { archived_at: string | null } | null }>(
    "varijante bez unete količine",
    () =>
      supabase
        .from("product_variants")
        .select("id, products(archived_at)")
        .is("archived_at", null)
        .is("stock_counted_at", null)
        .order("id", { ascending: true }),
  );
  return rows.filter((r) => r.products != null && r.products.archived_at == null).length;
}

/** Jedan proizvod sa svim varijantama (uklj. arhivirane — za detalj/edit). */
export async function getProductWithVariants(
  id: string,
  role: Role,
): Promise<ProductWithVariants | null> {
  const supabase = await createClient();

  const productRes = await supabase
    .from("products")
    .select(PRODUCT_COLS)
    .eq("id", id)
    .maybeSingle();
  const product = must(productRes, "detalj proizvoda");

  if (!product) return null;

  const [variants, categories] = await Promise.all([fetchVariants(role, [id]), getCategories()]);

  const p = product as ProductRow;
  const category = p.category_id ? (categories.find((c) => c.id === p.category_id) ?? null) : null;

  return { ...p, category, variants };
}
