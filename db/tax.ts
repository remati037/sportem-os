import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { mustRows } from "@/lib/supabase/paginate";
import type { TaxRate } from "@/lib/tax";

/*
 * Stope poreza po mesecu (`tax_months`). Čita RLS klijent (Admin + Menadžer).
 */

type Row = { month: string; rate_bp: number };

/**
 * Stope za mesece koje dodiruje [from, to] (YYYY-MM-DD) → mapa „YYYY-MM" → bp.
 * Best-effort: kad čitanje padne (npr. migracija još nije primenjena), Dashboard
 * radi dalje bez poreza (prazna mapa, `ok: false`) — porez je dodatni prikaz.
 */
export async function getTaxRateMap(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<{ rates: Map<string, number>; ok: boolean }> {
  const res = await supabase
    .from("tax_months")
    .select("month, rate_bp")
    .gte("month", `${from.slice(0, 7)}-01`)
    .lte("month", to);
  if (res.error) {
    Sentry.captureException(new Error(`tax_months: ${res.error.message}`));
    return { rates: new Map(), ok: false };
  }
  const rows = (res.data ?? []) as Row[];
  return { rates: new Map(rows.map((r) => [r.month.slice(0, 7), r.rate_bp])), ok: true };
}

/** Sve upisane stope (Podešavanja), najnoviji mesec prvi. */
export async function listTaxMonths(): Promise<TaxRate[]> {
  const supabase = await createClient();
  const rows = mustRows<Row>(
    await supabase.from("tax_months").select("month, rate_bp").order("month", { ascending: false }),
    "porez: meseci",
  );
  return rows.map((r) => ({ month: r.month.slice(0, 7), rateBp: r.rate_bp }));
}
