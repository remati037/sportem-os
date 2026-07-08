import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase klijent za browser (klijentske komponente).
 * Koristi anon ključ — pristup je ograničen RLS politikama (Korak 0.5).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
