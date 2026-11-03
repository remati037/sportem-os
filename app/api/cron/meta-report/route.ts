import * as Sentry from "@sentry/nextjs";

import { buildDailyReport, formatReport, writeCommentary } from "@/lib/meta/daily-report";
import { sendTelegram, telegramConfigured, tgEscape } from "@/lib/telegram";

/*
 * Jutarnji izveštaj o Meta reklamama na Telegram (posle `/api/cron/meta-sync`).
 *
 * Guard isti kao ostali cron-ovi: `Authorization: Bearer ${CRON_SECRET}` →
 * inače 401 bez tela. `?dry=1` vraća tekst poruke bez slanja (provera).
 * Ako izveštaj padne, na Telegram ide kratka poruka o grešci (bez tajni).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Meta + baza + Claude ocena

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  try {
    const report = await buildDailyReport();
    const commentary = await writeCommentary(report);
    const text = formatReport(report, commentary);
    if (dry) return Response.json({ ok: true, dry: true, ai: !!commentary, text });
    if (!telegramConfigured()) return Response.json({ ok: false, error: "Telegram nije podešen." }, { status: 500 });
    const sent = await sendTelegram(text);
    return Response.json({ ok: true, sent, ai: !!commentary });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "meta-report" } });
    const message = err instanceof Error ? err.message : "nepoznata greška";
    if (!dry && telegramConfigured()) {
      await sendTelegram(`⚠️ Izveštaj o reklamama nije napravljen: ${tgEscape(message)}`).catch(() => {});
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
