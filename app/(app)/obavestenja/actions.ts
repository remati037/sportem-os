"use server";

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { firstZodError, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

/*
 * Čuvanje preferenci obaveštenja (Korak 1.9). Piše se SAMO sopstveni red
 * (RLS `notification_preferences_own`; user_id = auth.uid()).
 */

const channelSchema = z.object({ push: z.boolean(), email: z.boolean() });

const savePrefsSchema = z.object({
  enabled: z.boolean(),
  prefs: z.record(z.string(), channelSchema),
});

export type SavePrefsInput = z.infer<typeof savePrefsSchema>;
export type SavePrefsState = ActionState & { success?: string };

export async function savePreferences(input: SavePrefsInput): Promise<SavePrefsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Niste prijavljeni." };

  const parsed = savePrefsSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, enabled: parsed.data.enabled, prefs: parsed.data.prefs },
      { onConflict: "user_id" },
    );
  if (error) {
    Sentry.captureException(error);
    return { error: "Greška pri čuvanju." };
  }
  return { error: null, success: "Sačuvano." };
}
