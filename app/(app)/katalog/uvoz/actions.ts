"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { importRowSchema, type ImportRow } from "@/lib/validation/catalog";

import type { ImportItem, ImportReport } from "./types";

/* ── helperi ─────────────────────────────────────────────────────────────── */

/** Normalizacija naziva kategorije za poređenje (bez dijakritika, lowercase). */
function normalize(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Osnova SKU = deo pre PRVE crtice; sufiks = ostatak. */
function splitSku(sku: string): { base: string; suffix: string | null } {
  const i = sku.indexOf("-");
  if (i === -1) return { base: sku, suffix: null };
  return { base: sku.slice(0, i), suffix: sku.slice(i + 1) };
}

/** Naziv varijante: eksplicitni → sufiks SKU → „Default". */
function deriveVariantName(sku: string, explicit: string | null | undefined): string {
  if (explicit && explicit.trim() !== "") return explicit.trim();
  const { suffix } = splitSku(sku);
  return suffix && suffix.trim() !== "" ? suffix.trim() : "Default";
}

type ValidRow = { rowNo: number; base: string; data: ImportRow };

type ImportPlan = {
  report: ImportReport;
  validRows: ValidRow[];
  /** sku → postojeća varijanta */
  existingBySku: Map<string, { id: string; product_id: string }>;
  /** normalizovan naziv → id postojeće kategorije */
  categoryByNorm: Map<string, string>;
  /** novi nazivi kategorija (original casing) po normalizovanom ključu */
  newCategories: Map<string, string>;
  /** grupe po osnovi SKU, u redosledu pojavljivanja */
  groups: Map<string, ValidRow[]>;
};

async function fetchExistingVariants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skus: string[],
): Promise<Map<string, { id: string; product_id: string }>> {
  const map = new Map<string, { id: string; product_id: string }>();
  const chunkSize = 300;
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const { data } = await supabase
      .from("product_variants")
      .select("id, sku, product_id")
      .in("sku", chunk);
    for (const v of (data as { id: string; sku: string; product_id: string }[]) ?? []) {
      map.set(v.sku, { id: v.id, product_id: v.product_id });
    }
  }
  return map;
}

/** Validacija + analiza (bez upisa). Vraća izveštaj + interni plan za commit. */
async function buildPlan(items: ImportItem[]): Promise<ImportPlan> {
  const supabase = await createClient();

  const validRows: ValidRow[] = [];
  const errors: ImportReport["errors"] = [];
  const seenSkus = new Set<string>();

  items.forEach((raw, idx) => {
    const rowNo = idx + 1;
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        row: rowNo,
        sku: (raw.sku ?? "").trim(),
        message: firstZodError(parsed.error),
      });
      return;
    }
    const sku = parsed.data.sku;
    if (seenSkus.has(sku)) {
      errors.push({ row: rowNo, sku, message: "Dvostruki SKU u fajlu — red preskočen." });
      return;
    }
    seenSkus.add(sku);
    validRows.push({ rowNo, base: splitSku(sku).base, data: parsed.data });
  });

  // Postojeće varijante (za update vs insert) i kategorije (za auto-kreiranje).
  const existingBySku = await fetchExistingVariants(
    supabase,
    validRows.map((r) => r.data.sku),
  );

  const { data: catData } = await supabase.from("categories").select("id, name");
  const categoryByNorm = new Map<string, string>();
  for (const c of (catData as { id: string; name: string }[]) ?? []) {
    categoryByNorm.set(normalize(c.name), c.id);
  }

  // Nove kategorije (naziv se javlja u CSV-u, a ne postoji).
  const newCategories = new Map<string, string>();
  for (const r of validRows) {
    const name = r.data.category;
    if (!name) continue;
    const norm = normalize(name);
    if (!categoryByNorm.has(norm) && !newCategories.has(norm)) {
      newCategories.set(norm, name.trim());
    }
  }

  // Grupisanje po osnovi SKU + brojanje.
  const groups = new Map<string, ValidRow[]>();
  for (const r of validRows) {
    const list = groups.get(r.base) ?? [];
    list.push(r);
    groups.set(r.base, list);
  }

  let newProducts = 0;
  for (const [, rows] of groups) {
    const hasExistingProduct = rows.some((r) => existingBySku.has(r.data.sku));
    if (!hasExistingProduct) newProducts += 1;
  }

  const updatedSkus: string[] = [];
  let newVariants = 0;
  for (const r of validRows) {
    if (existingBySku.has(r.data.sku)) updatedSkus.push(r.data.sku);
    else newVariants += 1;
  }

  const report: ImportReport = {
    totalRows: items.length,
    newProducts,
    newVariants,
    updatedVariants: updatedSkus.length,
    newCategories: [...newCategories.values()],
    updatedSkus,
    errors,
  };

  return { report, validRows, existingBySku, categoryByNorm, newCategories, groups };
}

/* ── akcije ──────────────────────────────────────────────────────────────── */

/** Dry-run: analizira CSV i vraća izveštaj (bez upisa u bazu). */
export async function previewImport(items: ImportItem[]): Promise<ImportReport> {
  await requireRole("admin");
  if (!Array.isArray(items) || items.length === 0) {
    return {
      totalRows: 0,
      newProducts: 0,
      newVariants: 0,
      updatedVariants: 0,
      newCategories: [],
      updatedSkus: [],
      errors: [],
      fatalError: "Nema redova za uvoz.",
    };
  }
  const { report } = await buildPlan(items);
  return report;
}

/** Upis: kreira kategorije/proizvode, insert/update varijanti (idempotentno po SKU). */
export async function commitImport(items: ImportItem[]): Promise<ImportReport> {
  await requireRole("admin");
  if (!Array.isArray(items) || items.length === 0) {
    return {
      totalRows: 0,
      newProducts: 0,
      newVariants: 0,
      updatedVariants: 0,
      newCategories: [],
      updatedSkus: [],
      errors: [],
      fatalError: "Nema redova za uvoz.",
    };
  }

  const supabase = await createClient();
  const plan = await buildPlan(items);
  const { report, validRows, existingBySku, categoryByNorm, newCategories, groups } = plan;

  try {
    // 1) Kreiraj nedostajuće kategorije → dopuni mapu naziv→id.
    for (const [norm, name] of newCategories) {
      const { data, error } = await supabase
        .from("categories")
        .insert({ name })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Kreiranje kategorije „${name}" nije uspelo.`);
      categoryByNorm.set(norm, data.id);
    }

    // 2) Razreši product_id po grupi (osnovi SKU).
    const productIdByBase = new Map<string, string>();
    for (const [base, rows] of groups) {
      const first = rows[0].data;
      const categoryId = first.category
        ? (categoryByNorm.get(normalize(first.category)) ?? null)
        : null;
      const productFields = {
        name: first.name,
        description: first.description,
        brand: first.brand,
        category_id: categoryId,
      };

      const existingRow = rows.find((r) => existingBySku.has(r.data.sku));
      if (existingRow) {
        const productId = existingBySku.get(existingRow.data.sku)!.product_id;
        await supabase.from("products").update(productFields).eq("id", productId);
        productIdByBase.set(base, productId);
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(productFields)
          .select("id")
          .single();
        if (error || !data) throw new Error(`Kreiranje proizvoda „${first.name}" nije uspelo.`);
        productIdByBase.set(base, data.id);
      }
    }

    // 3) Varijante: postojeći SKU → update; novi → insert.
    for (const r of validRows) {
      const d = r.data;
      const fields = {
        variant_name: deriveVariantName(d.sku, d.variant_name),
        mp_price: d.mp_price,
        vp_price: d.vp_price,
        stock_quantity: d.stock_quantity ?? 0,
        low_stock_threshold: d.low_stock_threshold ?? 5,
        supplier_sku: d.supplier_sku,
        weight_grams: d.weight_grams ?? null,
      };

      const existing = existingBySku.get(d.sku);
      if (existing) {
        const { error } = await supabase
          .from("product_variants")
          .update(fields)
          .eq("id", existing.id);
        if (error)
          report.errors.push({ row: r.rowNo, sku: d.sku, message: "Ažuriranje nije uspelo." });
      } else {
        const { error } = await supabase.from("product_variants").insert({
          ...fields,
          sku: d.sku,
          product_id: productIdByBase.get(r.base)!,
        });
        if (error) report.errors.push({ row: r.rowNo, sku: d.sku, message: "Upis nije uspeo." });
      }
    }
  } catch (e) {
    report.fatalError = e instanceof Error ? e.message : "Uvoz nije uspeo.";
    return report;
  }

  revalidatePath("/katalog");
  return report;
}
