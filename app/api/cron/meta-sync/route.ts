import { todayBelgrade } from "@/lib/date-belgrade";
import { notifyAfterMetaSync } from "@/lib/meta/notify";
import { syncMeta } from "@/lib/meta/sync";

/*
 * Cron sinhronizacije Meta Ads potrošnje (plan Reklame, M1).
 *
 * Guard isti kao `/api/cron/offers-sync`: `Authorization: Bearer ${CRON_SECRET}`
 * → inače 401 bez tela. `/api/cron` je u PUBLIC_PATHS jer se ruta sama
 * autentifikuje. Upis ide kroz service role u `syncMeta` (ad_* nemaju write
 * politiku); sync nikad ne baca — greška ide u `ad_sync_state.last_error`.
 * Posle sync-a push: pao sync / juče preko praga (lib/meta/notify.ts, M2).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // prvi uvoz povlači celu istoriju, mesec po mesec

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  const result = await syncMeta();
  const notified = await notifyAfterMetaSync(result, todayBelgrade());

  return Response.json({ ...result, notified }, { status: result.ok ? 200 : 500 });
}
