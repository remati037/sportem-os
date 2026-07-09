import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  // PDF „lista za slanje" (Korak 1.5): @react-pdf registruje Geist TTF čitanjem
  // sa diska u runtime-u. Vercel serverless trace-uje samo ono što statički
  // vidi — font se učitava dinamički (path.join), pa ga eksplicitno uključujemo
  // u bundle te rute, inače č/ć/đ padnu na fallback ili render pukne.
  outputFileTracingIncludes: {
    "/api/porudzbine/lista-za-slanje": ["./assets/fonts/**"],
  },
};

// PWA (Korak 0.7): Serwist service worker. Radi kroz webpack plugin → produkcioni
// build MORA biti `next build --webpack` (v. package.json). SW je isključen u dev-u
// (dev ostaje Turbopack). Online-only: bez keširanja navigacija.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  cacheOnNavigation: false,
  reloadOnOnline: false,
});

// Sentry build-time integracija (Korak 0.6): upload source-map-a, tunel za
// zaobilaženje ad-blocker-a. org/project idu iz env (nisu tajna); DSN i
// SENTRY_AUTH_TOKEN su u Vercel env. Bez tokena, upload se tiho preskače.
// Serwist unutra (ubacuje SW plugin), Sentry spolja (source-map upload vidi
// finalni build). Redosled bitan.
export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Tišina u lokalnom build-u; logovi samo u CI/Vercel.
  silent: !process.env.CI,

  // Bolji stack-trace za klijentski kod.
  widenClientFileUpload: true,

  // Tunel kroz sopstvenu rutu — zaobilazi ad-blocker-e koji seku ingest domen.
  tunnelRoute: "/monitoring-tunnel",
});
