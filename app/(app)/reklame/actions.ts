"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { syncMeta } from "@/lib/meta/sync";

export type AdsActionState = { error: string | null; success?: string | null };

/** Srpska množina: 1 mesec · 2–4 meseca · 5+ meseci (11–14 → meseci). */
function monthsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return "mesec";
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "meseca";
  return "meseci";
}

/**
 * „Sinhronizuj Meta" — isto što i dnevni cron: povuče potrošnju i ažurira
 * automatski mesečni trošak. Admin-only jer upisuje u `expenses`.
 */
export async function syncMetaNow(): Promise<AdsActionState> {
  await requireRole("admin");

  const result = await syncMeta();
  revalidatePath("/reklame");
  revalidatePath("/troskovi");
  revalidatePath("/finansije"); // neto profit čita expenses

  if (!result.ok) return { error: result.error ?? "Meta sinhronizacija nije uspela." };
  if (result.error) return { error: null, success: `Sinhronizovano, uz napomenu: ${result.error}` };
  return {
    error: null,
    success: `Meta sinhronizovana — ${result.months} ${monthsWord(result.months)} u troškovima.`,
  };
}
