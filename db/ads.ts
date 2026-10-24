import "server-only";

import { createClient } from "@/lib/supabase/server";

/*
 * Upiti modula Reklame (Meta Ads). Čitaju kroz RLS klijent: Admin i Menadžer
 * vide, Logistika nema nijednu politiku na ad_* tabelama.
 */

export type MetaSyncState = {
  lastSyncedAt: string | null;
  lastError: string | null;
};

/** Stanje poslednje Meta sinhronizacije (null kad tabela još ne postoji / nema reda). */
export async function getMetaSyncState(): Promise<MetaSyncState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_sync_state")
    .select("last_synced_at, last_error")
    .eq("key", "meta")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { last_synced_at: string | null; last_error: string | null };
  return { lastSyncedAt: row.last_synced_at, lastError: row.last_error };
}
