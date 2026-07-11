"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * Detekcija nove verzije aplikacije (PWA update prompt). Registraciju SW-a radi
 * Serwist (auto), pa ovde samo `getRegistration()`/`ready`. SW je `skipWaiting:
 * false` (app/sw.ts) → novi worker čeka u „waiting" fazi dok mu ne pošaljemo
 * SKIP_WAITING. Tok: novi SW instaliran → `updateReady` → korisnik klikne
 * „Osveži" → `applyUpdate()` → controllerchange → reload.
 *
 * Radi isključivo u produkcionom build-u (dev = Turbopack, SW isključen) i
 * preko HTTPS/localhost.
 */

// Van React-a: `controllerchange` se veže jednom po učitavanju stranice.
let controllerListenerBound = false;
let refreshing = false;

function isSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function useAppUpdate() {
  const [updateReady, setUpdateReady] = useState(false);

  const applyUpdate = useCallback(async () => {
    if (!isSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    // Ako iz nekog razloga nema waiting worker-a, tvrdi reload je bezbedan fallback.
    if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    else window.location.reload();
  }, []);

  useEffect(() => {
    if (!isSupported()) return;

    let reg: ServiceWorkerRegistration | undefined;
    let cancelled = false;

    // Reload tek kad novi SW stvarno preuzme kontrolu (posle SKIP_WAITING).
    if (!controllerListenerBound) {
      controllerListenerBound = true;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    const markReady = () => {
      if (!cancelled) setUpdateReady(true);
    };

    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        // `controller` postoji → update postojeće instalacije (ne prvi install).
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          markReady();
        }
      });
    };

    void navigator.serviceWorker.ready.then((registration) => {
      if (cancelled) return;
      reg = registration;

      // Novi SW već čeka (npr. instaliran pre nego što se hook montirao).
      if (registration.waiting && navigator.serviceWorker.controller) markReady();

      // Novi SW koji se upravo instalira.
      watchInstalling(registration.installing);
      registration.addEventListener("updatefound", () => {
        watchInstalling(registration.installing);
      });
    });

    // Proaktivna provera nove verzije dok app stoji otvoren: kad tab ponovo
    // postane vidljiv + periodično (na sat vremena).
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void reg?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", checkForUpdate);
    const intervalId = setInterval(checkForUpdate, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
      clearInterval(intervalId);
    };
  }, []);

  return { updateReady, applyUpdate };
}
