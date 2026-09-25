import { syncOffers } from "@/lib/offers/sync";

/*
 * Cron sinhronizacije ponuda (plugin „Sportem Offers" → Supabase).
 *
 * Guard je isti kao kod `/api/cron/notifikacije`: `Authorization: Bearer
 * ${CRON_SECRET}` → inače 401 bez tela (ruta ne sme ništa da otkrije).
 * `/api/cron` je u PUBLIC_PATHS (lib/supabase/middleware.ts) jer se ruta sama
 * autentifikuje — nema sesiju.
 *
 * Upis ide kroz service role klijent u `syncOffers` (offer_* tabele nemaju
 * nijednu write politiku). Sinhronizacija nikad ne baca — greška se vrati u
 * rezultatu i upiše u `offer_sync_state.last_error`, pa se vidi na /ponude.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // veliki prvi uvoz ide u više stranica po 1000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  const result = await syncOffers();

  return Response.json(result, { status: result.ok ? 200 : 500 });
}
