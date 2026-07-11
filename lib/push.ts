import "server-only";

import webpush, { WebPushError } from "web-push";
import * as Sentry from "@sentry/nextjs";

import type { Role } from "@/lib/auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import { resolveChannel, type ChannelPref } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Obaveštenja — jezgro fan-out-a (Korak 1.9). Šalje događaj korisnicima traženih
 * rola, poštujući svaku korisničku preferencu: master prekidač (enabled) i izbor
 * kanala po tipu (push / email / oba / isključeno).
 *
 * ISKLJUČIVO server (`server-only`): service-role klijent (zaobilazi RLS) čita
 * tuđe `push_subscriptions` + `notification_preferences` i piše `notification_log`.
 * Dedup: `notification_log` UNIQUE (type, reference_id) — događaj se šalje najviše
 * jednom (Woo retry, višestruko okidanje crona). NE dira snapshot ni finansije.
 * Best-effort: nikad ne baca — pozivaoci (webhook, cron) ne smeju pući zbog ovoga.
 */

let configured = false;

/** Lenjo konfiguriše VAPID (jednom po runtime-u). Vraća false ako fale ključevi. */
function pushConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
    ? process.env.NEXT_PUBLIC_APP_URL
    : "mailto:info@sportem.rs";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Sadržaj notifikacije (push payload + email tekst). */
export type PushPayload = {
  title: string;
  body: string;
  /** Relativan link koji se otvara na klik (default „/"). */
  url?: string;
  /** Dedup na uređaju — isti tag zamenjuje prethodnu notifikaciju. */
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  subscription: webpush.PushSubscription;
};

type PrefRow = {
  user_id: string;
  enabled: boolean;
  prefs: Partial<Record<string, ChannelPref>> | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Šalje jedan push. Na `410 Gone`/`404` (endpoint više ne postoji) briše taj red
 * iz `push_subscriptions` (self-cleanup). Ostale greške → Sentry.
 */
async function sendOnePush(supabase: Admin, row: SubscriptionRow, payload: string): Promise<void> {
  try {
    // `urgency: "high"` → push servis (FCM/APNs) isporučuje ODMAH, ne čeka da se
    // telefon probudi zbog nečeg drugog (Doze/štednja baterije). Bez ovoga default
    // je „normal" pa obaveštenje ume da stigne sa velikim zakašnjenjem. `TTL`
    // (24h) = koliko dugo servis pokušava ako je uređaj offline.
    await webpush.sendNotification(row.subscription, payload, {
      urgency: "high",
      TTL: 60 * 60 * 24,
    });
  } catch (err) {
    if (err instanceof WebPushError && (err.statusCode === 410 || err.statusCode === 404)) {
      await supabase.from("push_subscriptions").delete().eq("id", row.id);
      return;
    }
    Sentry.captureException(err);
  }
}

/** Email korisnika (iz auth-a; `profiles` ga ne drži). */
async function userEmail(supabase: Admin, userId: string): Promise<string | null> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}

/**
 * Glavni fan-out. Za svakog korisnika traženih rola:
 *  - master `enabled=false` → preskoči;
 *  - `resolveChannel(prefs, type)` → push i/ili email (default: push, bez email-a).
 * Kanal se broji samo ako je konfigurisan (VAPID / RESEND). Dedup log se piše tek
 * kad postoji makar jedan primalac na nekom kanalu (da se ne „potroši" ključ).
 */
export async function notifyRoles(
  type: string,
  referenceId: string,
  roles: Role[],
  payload: PushPayload,
): Promise<void> {
  try {
    const pushReady = pushConfigured();
    const emailReady = emailConfigured();
    if (!pushReady && !emailReady) return; // nijedan kanal nije konfigurisan

    const supabase = createAdminClient();

    // Korisnici traženih rola (nema direktnog FK profiles↔subs; oba gledaju auth.users).
    const { data: profiles } = await supabase.from("profiles").select("id").in("role", roles);
    const userIds = (profiles ?? []).map((p) => p.id as string);
    if (userIds.length === 0) return;

    // Preference po korisniku (nedostaje red → default: sve uključeno, push).
    const { data: prefData } = await supabase
      .from("notification_preferences")
      .select("user_id, enabled, prefs")
      .in("user_id", userIds);
    const prefByUser = new Map((prefData as PrefRow[] | null)?.map((p) => [p.user_id, p]) ?? []);

    // Podeli primaoce po kanalu prema preferenci + dostupnosti kanala.
    const pushUserIds: string[] = [];
    const emailUserIds: string[] = [];
    for (const uid of userIds) {
      const row = prefByUser.get(uid);
      if (row && row.enabled === false) continue; // master isključen
      const ch = resolveChannel(row?.prefs, type);
      if (ch.push && pushReady) pushUserIds.push(uid);
      if (ch.email && emailReady) emailUserIds.push(uid);
    }
    if (pushUserIds.length === 0 && emailUserIds.length === 0) return;

    // Dedup ledger — tek kad ima kome slati.
    const { error: logError } = await supabase
      .from("notification_log")
      .insert({ type, reference_id: referenceId });
    if (logError) {
      if ((logError as { code?: string }).code === "23505") return; // već poslato
      throw logError;
    }

    const tasks: Promise<unknown>[] = [];

    // Push kanal — svi uređaji odabranih korisnika.
    if (pushUserIds.length > 0) {
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, user_id, subscription")
        .in("user_id", pushUserIds);
      const rows = (subs as SubscriptionRow[] | null) ?? [];
      const body = JSON.stringify(payload);
      for (const row of rows) tasks.push(sendOnePush(supabase, row, body));
    }

    // Email kanal.
    if (emailUserIds.length > 0) {
      for (const uid of emailUserIds) {
        tasks.push(
          userEmail(supabase, uid).then((email) =>
            email ? sendEmail(email, payload.title, payload.body, payload.url) : false,
          ),
        );
      }
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    Sentry.captureException(err);
  }
}
