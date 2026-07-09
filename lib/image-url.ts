import { CATALOG_BUCKET } from "@/lib/storage-constants";

/**
 * Javni URL slike iz kataloga (client-safe). Bucket `product-images` je public,
 * pa se URL gradi deterministički iz NEXT_PUBLIC_SUPABASE_URL — bez signed URL-a.
 */
export function catalogImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${CATALOG_BUCKET}/${path}`;
}
