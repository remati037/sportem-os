import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase klijent za server (server komponente, server akcije, route handleri).
 * Vezuje sesiju za kolačiće; anon ključ + RLS su izvor sigurnosti (Korak 0.5).
 *
 * U Next 16 je `cookies()` async — zato je i ovaj helper async.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Poziv iz server komponente (read-only cookies) — refresh radi
            // middleware, pa se ovaj izuzetak može bezbedno ignorisati.
          }
        },
      },
    },
  );
}
