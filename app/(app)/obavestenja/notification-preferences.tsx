"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/auth";
import {
  DEFAULT_CHANNEL,
  notificationTypesForRole,
  resolveChannel,
  type ChannelPref,
  type NotificationPrefs,
} from "@/lib/notifications";

import { savePreferences } from "./actions";

/*
 * Preference obaveštenja (Korak 1.9) — master prekidač + izbor kanala po tipu
 * (Push / Email / oba / nijedan). Vidljivi tipovi zavise od role (Logistika samo
 * „Nisko stanje"). Kanal ne zavisi od uređaja — vezan je za nalog.
 */
export function NotificationPreferences({
  role,
  initial,
}: {
  role: Role;
  initial: NotificationPrefs;
}) {
  const types = notificationTypesForRole(role);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [prefs, setPrefs] = useState<Record<string, ChannelPref>>(() => {
    const map: Record<string, ChannelPref> = {};
    for (const t of types) map[t.key] = resolveChannel(initial.prefs, t.key);
    return map;
  });
  const [pending, startTransition] = useTransition();

  const setChannel = (key: string, channel: keyof ChannelPref, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: { ...prev[key], [channel]: value } }));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await savePreferences({ enabled, prefs });
      if (res.error) toast.error(res.error);
      else toast.success(res.success ?? "Sačuvano.");
    });
  };

  return (
    <div className="border-border bg-card shadow-soft rounded-lg border p-6">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="text-ink block text-sm font-medium">Primaj obaveštenja</span>
          <span className="text-ink-soft block text-sm">
            Glavni prekidač — isključi da ne dobijaš nijedno obaveštenje.
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-5 shrink-0 accent-[#1B7A45]"
        />
      </label>

      <div
        className={enabled ? "mt-5 space-y-3" : "mt-5 space-y-3 opacity-50"}
        aria-disabled={!enabled}
      >
        <div className="text-ink-soft grid grid-cols-[1fr_auto_auto] items-center gap-x-6 text-xs font-medium">
          <span>Tip</span>
          <span className="w-12 text-center">Push</span>
          <span className="w-12 text-center">Email</span>
        </div>
        {types.map((t) => {
          const ch = prefs[t.key] ?? DEFAULT_CHANNEL;
          return (
            <div
              key={t.key}
              className="border-border/60 grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-t pt-3"
            >
              <span className="text-ink text-sm">{t.label}</span>
              <input
                type="checkbox"
                aria-label={`${t.label} — push`}
                checked={ch.push}
                disabled={!enabled}
                onChange={(e) => setChannel(t.key, "push", e.target.checked)}
                className="mx-auto size-5 accent-[#1B7A45]"
              />
              <input
                type="checkbox"
                aria-label={`${t.label} — email`}
                checked={ch.email}
                disabled={!enabled}
                onChange={(e) => setChannel(t.key, "email", e.target.checked)}
                className="mx-auto size-5 accent-[#1B7A45]"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={pending}>
          Sačuvaj
        </Button>
      </div>
    </div>
  );
}
