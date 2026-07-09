import "server-only";

import sharp from "sharp";

import { CATALOG_BUCKET, EXPENSE_BUCKET } from "@/lib/storage-constants";
import { createClient } from "@/lib/supabase/server";

/*
 * Upload slika kataloga u Supabase Storage (Korak 1.1a). Slika se na serveru
 * resize-uje i kompresuje (sharp → webp) pre upisa. Upload ide kroz server
 * klijent (RLS); storage politika dozvoljava upis samo Adminu.
 */

export { CATALOG_BUCKET };

/** Resize (max 1000px, unutar okvira) + webp q80 → upload → vrati object path. */
export async function uploadCatalogImage(
  file: File,
  prefix: "products" | "variants",
): Promise<string> {
  const input = Buffer.from(await file.arrayBuffer());
  const output = await sharp(input)
    .rotate() // ispoštuj EXIF orijentaciju
    .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const path = `${prefix}/${crypto.randomUUID()}.webp`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from(CATALOG_BUCKET).upload(path, output, {
    contentType: "image/webp",
    upsert: false,
  });

  if (error) throw new Error(`Upload slike nije uspeo: ${error.message}`);
  return path;
}

/** Obriši sliku iz bucket-a (npr. pri zameni ili brisanju). Tiho ignoriše greške. */
export async function deleteCatalogImage(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const supabase = await createClient();
  await supabase.storage.from(CATALOG_BUCKET).remove([path]);
}

/*
 * Prilozi troškova (Korak 1.7). Bucket je PRIVATAN → upload sirovog fajla (bez
 * sharp obrade jer prilog može biti PDF); prikaz isključivo kroz signed URL.
 */

export { EXPENSE_BUCKET };

/** Ekstenzija fajla iz MIME tipa (za priloge troškova). */
function extForMime(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/** Upload sirovog priloga (slika ili PDF) → vrati object path. */
export async function uploadExpenseAttachment(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const path = `${crypto.randomUUID()}.${extForMime(file.type)}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from(EXPENSE_BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new Error(`Upload priloga nije uspeo: ${error.message}`);
  return path;
}

/** Obriši prilog iz bucket-a (pri zameni ili brisanju). Tiho ignoriše greške. */
export async function deleteExpenseAttachment(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const supabase = await createClient();
  await supabase.storage.from(EXPENSE_BUCKET).remove([path]);
}

/** Signed URL za pregled priloga (privatan bucket). Vrati null ako nema puta. */
export async function expenseAttachmentUrl(
  path: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(EXPENSE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
