import * as Sentry from "@sentry/nextjs";

import { createClient } from "@/lib/supabase/server";
import { pushSubscriptionSchema } from "@/lib/validation/push";

/*
 * POST /api/push/subscribe (Korak 1.9) — čuva Web Push subscription za ulogovanog
 * korisnika. Ruta je AUTHED (nije u PUBLIC_PATHS; proxy.ts je štiti). User-scoped
 * klijent + RLS `push_subscriptions_own` garantuju user_id = auth.uid().
 * Idempotentno: upsert po (user_id, endpoint) — ista podrška ne pravi duplikat.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Niste prijavljeni." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Neispravno telo zahteva." }, { status: 400 });
  }

  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Neispravna podrška." },
      {
        status: 400,
      },
    );
  }

  const subscription = parsed.data;
  // Ručni „upsert": obriši eventualni postojeći red za ovaj endpoint (dedup index
  // je na (user_id, endpoint)), pa umetni svež. Izbegava zavisnost od onConflict
  // nad izraz-indeksom (subscription ->> 'endpoint').
  const { error: delError } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("subscription->>endpoint", subscription.endpoint);
  if (delError) {
    Sentry.captureException(delError);
    return Response.json({ error: "Greška pri čuvanju." }, { status: 500 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .insert({ user_id: user.id, subscription });
  if (error) {
    Sentry.captureException(error);
    return Response.json({ error: "Greška pri čuvanju." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
