import "server-only";

import sharp from "sharp";

import { CATALOG_BUCKET } from "@/lib/storage-constants";
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
