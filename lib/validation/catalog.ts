import { z } from "zod";

/*
 * Zod šeme za katalog (Korak 1.1a). Deljeno između client RHF formi i server
 * akcija. Cene su integer RSD (CLAUDE.md 5) — `z.coerce.number()` radi i sa
 * brojem (RHF NumberField) i sa stringom (FormData u server akciji).
 */

/** Prazan string → null (opciona tekstualna polja). */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Sentinel „nema kategorije" iz Select-a → null; inače validan uuid. */
const optionalCategoryId = z
  .string()
  .transform((v) => (v === "" || v === "none" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || z.string().uuid().safeParse(v).success, {
    message: "Neispravna kategorija.",
  });

const price = z.coerce
  .number({ message: "Unesite cenu." })
  .int("Cena mora biti ceo broj (RSD).")
  .positive("Cena mora biti veća od 0.");

const nonNegativeInt = (msg: string) => z.coerce.number({ message: msg }).int(msg).min(0, msg);

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Unesite naziv kategorije."),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, "Unesite naziv proizvoda."),
  description: optionalText,
  brand: optionalText,
  category_id: optionalCategoryId,
});

export const variantSchema = z.object({
  product_id: z.string().uuid("Neispravan proizvod."),
  sku: z.string().trim().min(1, "Unesite SKU."),
  variant_name: optionalText,
  mp_price: price,
  vp_price: price,
  stock_quantity: nonNegativeInt("Stanje mora biti ceo broj ≥ 0.").default(0),
  low_stock_threshold: nonNegativeInt("Prag mora biti ceo broj ≥ 0.").default(5),
  supplier_sku: optionalText,
  weight_grams: z.coerce
    .number()
    .int("Težina mora biti ceo broj (g).")
    .positive("Težina mora biti veća od 0.")
    .nullable()
    .optional(),
});

/* ── Uvoz iz CSV-a (Korak 1.1b) ─────────────────────────────────────────────
 * Vrednosti iz Sheets-a su slobodni stringovi. Srpski brojevi mogu imati tačku
 * kao separator hiljada („9.990" = 9990) → skini sve osim cifara pre parsiranja.
 */

/** CSV broj → int: zadrži samo cifre („9.990 RSD" → 9990). Prazno → undefined. */
const sanitizeInt = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const digits = v.replace(/\D/g, "");
  return digits === "" ? undefined : Number(digits);
};

const importPrice = (msg: string) =>
  z.preprocess(sanitizeInt, z.number({ message: msg }).int(msg).positive(msg));

const importIntOptional = z.preprocess(sanitizeInt, z.number().int().min(0).optional());

const importWeightOptional = z.preprocess(sanitizeInt, z.number().int().positive().optional());

/** Jedan red iz CSV-a (već mapiran na ciljna polja). `category` je NAZIV, ne id. */
export const importRowSchema = z.object({
  sku: z.string().trim().min(1, "SKU je obavezan."),
  name: z.string().trim().min(1, "Naziv proizvoda je obavezan."),
  mp_price: importPrice("MP cena je obavezna i mora biti > 0."),
  vp_price: importPrice("VP cena je obavezna i mora biti > 0."),
  description: optionalText,
  brand: optionalText,
  category: optionalText,
  variant_name: optionalText,
  stock_quantity: importIntOptional,
  low_stock_threshold: importIntOptional,
  weight_grams: importWeightOptional,
  supplier_sku: optionalText,
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** Ciljna polja uvoza — koristi UI za mapiranje kolona. */
export const IMPORT_FIELDS = [
  { key: "sku", label: "SKU", required: true },
  { key: "name", label: "Naziv proizvoda", required: true },
  { key: "mp_price", label: "MP cena", required: true },
  { key: "vp_price", label: "VP cena", required: true },
  { key: "category", label: "Kategorija", required: false },
  { key: "brand", label: "Brend", required: false },
  { key: "description", label: "Opis", required: false },
  { key: "variant_name", label: "Naziv varijante", required: false },
  { key: "stock_quantity", label: "Stanje", required: false },
  { key: "low_stock_threshold", label: "Prag niskog stanja", required: false },
  { key: "supplier_sku", label: "Šifra dobavljača", required: false },
  { key: "weight_grams", label: "Težina (g)", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;

/* ── Validacija slike (koristi se u server akciji, ne u RHF resolveru) ── */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const ACCEPTED_IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"];
