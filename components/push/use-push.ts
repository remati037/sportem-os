"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * Web Push pretplata na klijentu (Korak 1.9). Registraciju SW-a radi Serwist
 * (auto), pa ovde samo `serviceWorker.ready` → `pushManager`. Radi isključivo u
 * produkcionom build-u (dev = Turbopack, SW isključen) i preko HTTPS/localhost.
 */

export type PushStatus =
  | "loading" // inicijalna provera
  | "unsupported" // nema SW/PushManager (npr. iOS Safari van „Dodaj na početni ekran")
  | "denied" // korisnik blokirao notifikacije u browseru
  | "subscribed" // pretplaćen na ovom uređaju
  | "unsubscribed"; // podržano, nije pretplaćen

/** VAPID public ključ (base64url) → Uint8Array za applicationServerKey. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePush() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "subscribed" : "unsubscribed");
    } catch {
      setStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    // Inicijalna sinhronizacija sa spoljnim sistemom (Notification.permission /
    // pushManager) — effect je ovde ispravno mesto (nije derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isSupported()) return { ok: false, error: "Uređaj ne podržava obaveštenja." };
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) return { ok: false, error: "Nedostaje VAPID ključ (konfiguracija)." };

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        return { ok: false, error: "Obaveštenja nisu dozvoljena." };
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? "Greška pri pretplati." };
      }
      setStatus("subscribed");
      return { ok: true };
    } catch {
      return { ok: false, error: "Greška pri pretplati na obaveštenja." };
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setStatus("unsubscribed");
      return { ok: true };
    } catch {
      return { ok: false, error: "Greška pri isključivanju obaveštenja." };
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, subscribe, unsubscribe, refresh };
}
