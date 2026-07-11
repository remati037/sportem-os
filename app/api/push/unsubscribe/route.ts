import * as Sentry from "@sentry/nextjs";

import { createClient } from "@/lib/supabase/server";
import { unsubscribeSchema } from "@/lib/validation/push";

/*
 * POST /api/push/unsubscribe (Korak 1.9) — briše subscription za ulogovanog
 * korisnika i dati endpoint (kad user ugasi obaveštenja na uređaju). Authed;
 * RLS `push_subscriptions_own` ograničava brisanje na sopstvene redove.
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

  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Neispravan endpoint." }, { status: 400 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("subscription->>endpoint", parsed.data.endpoint);
  if (error) {
    Sentry.captureException(error);
    return Response.json({ error: "Greška pri brisanju." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
