import type { ImportFieldKey } from "@/lib/validation/catalog";

/** Jedan red iz CSV-a mapiran na ciljna polja (vrednosti su stringovi). */
export type ImportItem = Partial<Record<ImportFieldKey, string>>;

export type ImportError = { row: number; sku: string; message: string };

/** Rezultat dry-run analize (previewImport) i commit-a (commitImport). */
export type ImportReport = {
  totalRows: number;
  newProducts: number;
  newVariants: number;
  updatedVariants: number;
  /** Nazivi kategorija koje će biti (ili su) kreirane. */
  newCategories: string[];
  /** SKU-ovi postojećih varijanti koje se ažuriraju (za upozorenje). */
  updatedSkus: string[];
  errors: ImportError[];
  /** Poruka o grešci celog upisa (commit), ako je bilo. */
  fatalError?: string;
};
