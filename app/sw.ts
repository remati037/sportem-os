/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

// Korak 0.7 — Serwist service worker (PWA skelet).
//
// USTAV: app je online-only. SW NE sme da kešira stranice, finansijske ni auth
// podatke — servirati zastarelu cifru offline bio bi bug. Zato NE koristimo
// `defaultCache` (koji radi SWR na navigacijama i kešira slike/fontove sa
// stranih domena), nego vlastiti, konzervativni `runtimeCaching`: keširaju se
// SAMO immutable, content-hash-ovani build asseti. Sve ostalo (navigacije,
// Supabase, /api/*, Sentry tunel) nema handler → ide network-only.
//
// Push handleri su na dnu fajla (Korak 1.9).

import {
  CacheFirst,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

// `__SW_MANIFEST` ubacuje Serwist build plugin (lista precache entrija).
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Precache: samo content-hash-ovani static asseti koje ubaci build plugin.
  // Uz `cacheOnNavigation: false` (next.config) nijedan HTML se ne precache-uje.
  precacheEntries: self.__SW_MANIFEST,
  // Kontrolisani update (obaveštenje o novoj verziji): novi SW ostaje u
  // „waiting" fazi dok mu klijent (update-toast) ne pošalje SKIP_WAITING —
  // tako korisnik dobija toast „Dostupna je nova verzija" umesto tihe smene.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: false,
  runtimeCaching: [
    {
      // Content-hash-ovani JS/CSS/font chunkovi — bezbedno zauvek.
      // Ovde padaju i `next/font` (Geist / Geist Mono) self-hostovani fontovi.
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 365,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    {
      // Statični brend asseti (PWA ikonice). Freshness nije kritičan.
      matcher: ({ url, sameOrigin }) =>
        sameOrigin &&
        (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest"),
      handler: new StaleWhileRevalidate({
        cacheName: "brand-assets",
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    // NAMERNO bez handlera za: navigacije (HTML), *.supabase.co, /api/*,
    // Sentry /monitoring-tunnel. Serwist ih pušta na mrežu (network-only) —
    // nikad iz keša. Ovo čuva online-only integritet.
  ],
});

serwist.addEventListeners();

// ── Obaveštenje o novoj verziji ─────────────────────────────────────────────
// Kad klijent (components/pwa) klikne „Osveži", pošalje SKIP_WAITING → novi SW
// preuzme kontrolu → `controllerchange` na klijentu → reload na najnoviju
// verziju. Ne dira `runtimeCaching` (online-only ustav ostaje).
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// ── Push notifikacije (Korak 1.9) ───────────────────────────────────────────
// Serwist ne pokriva `push`/`notificationclick` — dodajemo ih ručno. Payload je
// JSON { title, body, url?, tag? } iz lib/push.ts. Ne dira caching (online-only).

type PushPayload = { title: string; body: string; url?: string; tag?: string };

self.addEventListener("push", (event) => {
  let data: PushPayload;
  try {
    data = event.data?.json() as PushPayload;
  } catch {
    data = { title: "Sportem", body: event.data?.text() ?? "" };
  }
  const url = data.url ?? "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "Sportem", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        // Fokusiraj postojeći prozor app-a (bilo koja ruta) i navigiraj ga.
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && target) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
