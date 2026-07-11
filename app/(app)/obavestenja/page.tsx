import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";
import type { ChannelPref, NotificationPrefs } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

import { NotificationPreferences } from "./notification-preferences";
import { PushSettings } from "./push-settings";

export const dynamic = "force-dynamic";

/*
 * Obaveštenja (Korak 1.9). Dva nivoa:
 *  1. Uređaj — uključi push na OVOM uređaju (pretplata je per-uređaj).
 *  2. Preference — master prekidač + izbor kanala (push/email) po tipu; vezano
 *     za nalog, ne za uređaj. Vidljivi tipovi zavise od role.
 */
export default async function ObavestenjaPage() {
  const session = await getProfile();
  if (!session) redirect("/prijava");

  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("enabled, prefs")
    .eq("user_id", session.userId)
    .maybeSingle();

  const initial: NotificationPrefs = {
    enabled: (data?.enabled as boolean | undefined) ?? true,
    prefs: (data?.prefs as Partial<Record<string, ChannelPref>> | undefined) ?? {},
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Sistem</div>
        <h1 className="text-ink text-xl font-bold">Obaveštenja</h1>
        <p className="text-ink-soft text-sm">
          Uključi push na ovom uređaju i izaberi koja obaveštenja i kako da ti stižu.
        </p>
      </div>

      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-ink text-sm font-semibold">Ovaj uređaj</h2>
          <PushSettings />
        </section>

        <section className="space-y-2">
          <h2 className="text-ink text-sm font-semibold">Šta i kako da stiže</h2>
          <NotificationPreferences role={session.profile.role} initial={initial} />
        </section>
      </div>
    </main>
  );
}
