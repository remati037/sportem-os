import type { ZodError } from "zod";

/**
 * Jedinstven oblik rezultata server akcije (Korak 0.8).
 * Akcije vraćaju `{ error }`; klijent kroz `useActionToast` prikazuje toast.
 * Akcije koje javljaju i uspeh proširuju tip poljem `success`.
 */
export type ActionState = { error: string | null };

export const initialActionState: ActionState = { error: null };

/** Prva zod poruka ili generički fallback — za jedinstven error tekst. */
export function firstZodError(error: ZodError): string {
  return error.issues[0]?.message ?? "Neispravan unos.";
}
