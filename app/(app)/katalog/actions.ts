"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteCatalogImage, uploadCatalogImage } from "@/lib/storage";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  categorySchema,
  productSchema,
  variantSchema,
} from "@/lib/validation/catalog";

export type CatalogActionState = {
  error: string | null;
  success?: string | null;
  /** ID kreiranog/izmenjenog reda (npr. za navigaciju na detalj). */
  id?: string;
};

/* ── helperi ─────────────────────────────────────────────────────────────── */

function revalidateCatalog(productId?: string) {
  revalidatePath("/katalog");
  if (productId) revalidatePath(`/katalog/${productId}`);
}

/** Postgres unique violation (npr. duplikat SKU). */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

type ImageResult = { path: string | null; uploaded: boolean; error?: string };

/**
 * Pročita `image` iz FormData; ako je zadata slika — validira i uploaduje
 * (resize + webp). Prazan unos → nema promene.
 */
async function handleImageUpload(
  formData: FormData,
  prefix: "products" | "variants",
): Promise<ImageResult> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { path: null, uploaded: false };
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { path: null, uploaded: false, error: "Slika mora biti JPG, PNG ili WEBP." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { path: null, uploaded: false, error: "Slika je veća od 5 MB." };
  }
  const path = await uploadCatalogImage(file, prefix);
  return { path, uploaded: true };
}

/* ── kategorije ──────────────────────────────────────────────────────────── */

export async function createCategory(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert(parsed.data);
  if (error) return { error: "Dodavanje kategorije nije uspelo." };

  revalidateCatalog();
  return { error: null, success: "Kategorija dodata." };
}

export async function updateCategory(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "");
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!id) return { error: "Neispravan unos." };
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").update(parsed.data).eq("id", id);
  if (error) return { error: "Izmena kategorije nije uspela." };

  revalidateCatalog();
  return { error: null, success: "Kategorija izmenjena." };
}

export async function deleteCategory(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  // FK products.category_id je ON DELETE SET NULL → proizvodi ostaju bez kategorije.
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { error: "Brisanje kategorije nije uspelo." };

  revalidateCatalog();
  return { error: null, success: "Kategorija obrisana." };
}

/* ── proizvodi ───────────────────────────────────────────────────────────── */

export async function createProduct(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    brand: formData.get("brand"),
    category_id: formData.get("category_id"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const image = await handleImageUpload(formData, "products");
  if (image.error) return { error: image.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...parsed.data, image: image.path })
    .select("id")
    .single();

  if (error || !data) {
    if (image.uploaded) await deleteCatalogImage(image.path);
    return { error: "Dodavanje proizvoda nije uspelo." };
  }

  revalidateCatalog(data.id);
  return { error: null, success: "Proizvod dodat.", id: data.id };
}

export async function updateProduct(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Neispravan unos." };

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    brand: formData.get("brand"),
    category_id: formData.get("category_id"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("products")
    .select("image")
    .eq("id", id)
    .maybeSingle();

  const removeImage = formData.get("remove_image") === "1";
  const image = await handleImageUpload(formData, "products");
  if (image.error) return { error: image.error };

  const patch: Record<string, unknown> = { ...parsed.data };
  if (image.uploaded) patch.image = image.path;
  else if (removeImage) patch.image = null;

  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (error) {
    if (image.uploaded) await deleteCatalogImage(image.path);
    return { error: "Izmena proizvoda nije uspela." };
  }

  // Očisti staru sliku ako je zamenjena ili uklonjena.
  if ((image.uploaded || removeImage) && current?.image) {
    await deleteCatalogImage(current.image);
  }

  revalidateCatalog(id);
  return { error: null, success: "Proizvod izmenjen.", id };
}

export async function archiveProduct(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Arhiviranje nije uspelo." };

  revalidateCatalog(id);
  return { error: null, success: "Proizvod arhiviran." };
}

export async function unarchiveProduct(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ archived_at: null }).eq("id", id);
  if (error) return { error: "Vraćanje iz arhive nije uspelo." };

  revalidateCatalog(id);
  return { error: null, success: "Proizvod vraćen iz arhive." };
}

/**
 * Hard-delete samo ako proizvod nema varijanti (FK je RESTRICT). Ako ima —
 * arhivira se, da istorija ostane netaknuta.
 */
export async function deleteProduct(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();

  const { count } = await supabase
    .from("product_variants")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  if ((count ?? 0) > 0) {
    return archiveProduct(id).then((r) =>
      r.error ? r : { error: null, success: "Proizvod ima varijante — arhiviran umesto brisanja." },
    );
  }

  const { data: current } = await supabase
    .from("products")
    .select("image")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: "Brisanje proizvoda nije uspelo." };

  await deleteCatalogImage(current?.image ?? null);
  revalidateCatalog();
  return { error: null, success: "Proizvod obrisan." };
}

/* ── varijante ───────────────────────────────────────────────────────────── */

export async function createVariant(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const parsed = variantSchema.safeParse({
    product_id: formData.get("product_id"),
    sku: formData.get("sku"),
    variant_name: formData.get("variant_name"),
    mp_price: formData.get("mp_price"),
    vp_price: formData.get("vp_price"),
    stock_quantity: formData.get("stock_quantity") ?? undefined,
    low_stock_threshold: formData.get("low_stock_threshold") ?? undefined,
    supplier_sku: formData.get("supplier_sku"),
    weight_grams: formData.get("weight_grams") || undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const image = await handleImageUpload(formData, "variants");
  if (image.error) return { error: image.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .insert({ ...parsed.data, image: image.path });

  if (error) {
    if (image.uploaded) await deleteCatalogImage(image.path);
    if (isUniqueViolation(error)) return { error: `SKU „${parsed.data.sku}" već postoji.` };
    return { error: "Dodavanje varijante nije uspelo." };
  }

  revalidateCatalog(parsed.data.product_id);
  return { error: null, success: "Varijanta dodata." };
}

export async function updateVariant(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Neispravan unos." };

  const parsed = variantSchema.safeParse({
    product_id: formData.get("product_id"),
    sku: formData.get("sku"),
    variant_name: formData.get("variant_name"),
    mp_price: formData.get("mp_price"),
    vp_price: formData.get("vp_price"),
    stock_quantity: formData.get("stock_quantity") ?? undefined,
    low_stock_threshold: formData.get("low_stock_threshold") ?? undefined,
    supplier_sku: formData.get("supplier_sku"),
    weight_grams: formData.get("weight_grams") || undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("product_variants")
    .select("image")
    .eq("id", id)
    .maybeSingle();

  const removeImage = formData.get("remove_image") === "1";
  const image = await handleImageUpload(formData, "variants");
  if (image.error) return { error: image.error };

  const { product_id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (image.uploaded) patch.image = image.path;
  else if (removeImage) patch.image = null;

  const { error } = await supabase.from("product_variants").update(patch).eq("id", id);
  if (error) {
    if (image.uploaded) await deleteCatalogImage(image.path);
    if (isUniqueViolation(error)) return { error: `SKU „${parsed.data.sku}" već postoji.` };
    return { error: "Izmena varijante nije uspela." };
  }

  if ((image.uploaded || removeImage) && current?.image) {
    await deleteCatalogImage(current.image);
  }

  revalidateCatalog(product_id);
  return { error: null, success: "Varijanta izmenjena." };
}

export async function archiveVariant(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Arhiviranje varijante nije uspelo." };

  revalidateCatalog();
  return { error: null, success: "Varijanta arhivirana." };
}

export async function unarchiveVariant(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) return { error: "Vraćanje varijante nije uspelo." };

  revalidateCatalog();
  return { error: null, success: "Varijanta vraćena iz arhive." };
}

/**
 * Ako varijanta ima istorijske stavke (`order_items`) → arhivira se (da veza
 * `variant_id` ostane; FK je SET NULL pa bi hard-delete raskinuo istoriju).
 * Bez istorije → hard-delete + brisanje slike.
 */
export async function deleteVariant(id: string): Promise<CatalogActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();

  const { count } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("variant_id", id);

  if ((count ?? 0) > 0) {
    return archiveVariant(id).then((r) =>
      r.error
        ? r
        : { error: null, success: "Varijanta ima porudžbine — arhivirana umesto brisanja." },
    );
  }

  const { data: current } = await supabase
    .from("product_variants")
    .select("image")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("product_variants").delete().eq("id", id);
  if (error) return { error: "Brisanje varijante nije uspelo." };

  await deleteCatalogImage(current?.image ?? null);
  revalidateCatalog();
  return { error: null, success: "Varijanta obrisana." };
}
