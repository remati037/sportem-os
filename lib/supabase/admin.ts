import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin klijent — service role ključ, ZAOBILAZI RLS.
 * Isključivo server (invite korisnika, webhook, cron, seed). Nikad na klijent.
 *
 * `server-only` import obara build ako se fajl uveze u klijentski bundle.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
