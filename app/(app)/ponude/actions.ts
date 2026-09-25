"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { syncOffers } from "@/lib/offers/sync";

/*
 * Server akcije modula Ponude.
 *
 * Jedina akcija je ručna sinhronizacija („Sinhronizuj sada"). Cron je dnevni
 * (Hobby plan), pa je ovo način da se podaci osveže kad zatreba.
 *
 * Kapija je `requireRole("admin","manager")` — Logistika nema pristup modulu.
 * Sam upis ide kroz service role u `syncOffers` (offer_* tabele nemaju write
 * politiku); API ključ plugina ostaje na serveru i nikad ne ide klijentu.
 */

export type OffersActionState = {
  error: string | null;
  success?: string | null;
};

/** Srpska množina za tri oblika (1 / 2–4 / 5+). */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export async function syncOffersNow(): Promise<OffersActionState> {
  await requireRole("admin", "manager");

  const result = await syncOffers();

  if (!result.ok) {
    return { error: result.error ?? "Sinhronizacija nije uspela." };
  }

  revalidatePath("/ponude");

  const success =
    result.events === 0
      ? "Sinhronizovano — nema novih događaja."
      : `Sinhronizovano: ${result.events} ${plural(result.events, "nov događaj", "nova događaja", "novih događaja")}.`;

  return { error: null, success };
}
