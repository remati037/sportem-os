import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRoles } from "@/lib/push";
import { rsd } from "@/lib/format";
import type { MetaSyncResult } from "@/lib/meta/sync";

/*
 * Push obaveštenja modula Reklame (plan Reklame, M2) — okida ih SAMO dnevni
 * cron (ručno dugme grešku već prikazuje na strani). Admin + Menadžer, kroz
 * postojeći `notifyRoles` (preference + dedup u notification_log).
 *
 *   ad_sync_failed — sync pao (token istekao, Meta greška). Dedup po danu.
 *   ad_spend_high  — potrošnja JUČE prešla `META_DAILY_SPEND_ALERT_RSD`
 *                    (prazno = isključeno). Dedup po danu potrošnje.
 *
 * Cron je dnevni (Hobby), pa ovo nije upozorenje u realnom vremenu. Best-effort:
 * nikad ne baca.
 */

const STAFF = ["admin", "manager"] as const;

function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Prag iz env-a (ceo RSD); prazno/neispravno → null (isključeno). */
export function spendAlertThreshold(): number | null {
  const raw = (process.env.META_DAILY_SPEND_ALERT_RSD ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

export async function notifyAfterMetaSync(
  result: MetaSyncResult,
  today: string,
): Promise<string[]> {
  const sent: string[] = [];
  try {
    if (!result.ok) {
      await notifyRoles("ad_sync_failed", `ad_sync_failed:${today}`, [...STAFF], {
        title: "Meta sinhronizacija nije uspela",
        body: result.error ?? "Potrošnja reklama danas nije povučena.",
        url: "/reklame",
        tag: "ad-sync-failed",
      });
      sent.push("ad_sync_failed");
      return sent;
    }

    const threshold = spendAlertThreshold();
    if (threshold == null) return sent;

    const yesterday = previousDay(today);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("ad_insights_daily")
      .select("spend_rsd")
      .eq("date", yesterday)
      .limit(1000);
    if (error) throw new Error(`Potrošnja za ${yesterday}: ${error.message}`);
    const spent = (data ?? []).reduce(
      (s, r) => s + ((r as { spend_rsd: number | null }).spend_rsd ?? 0),
      0,
    );

    if (spent > threshold) {
      const [y, m, d] = yesterday.split("-");
      await notifyRoles("ad_spend_high", `ad_spend_high:${yesterday}`, [...STAFF], {
        title: "Meta potrošnja preko praga",
        body: `Juče (${Number(d)}.${Number(m)}.${y}.) potrošeno ${rsd(spent)} — prag je ${rsd(threshold)}.`,
        url: `/reklame?od=${yesterday}&do=${yesterday}`,
        tag: "ad-spend-high",
      });
      sent.push("ad_spend_high");
    }
  } catch (err) {
    Sentry.captureException(err);
  }
  return sent;
}
