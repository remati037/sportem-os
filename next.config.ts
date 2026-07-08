import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {/* config options here */};

// Sentry build-time integracija (Korak 0.6): upload source-map-a, tunel za
// zaobilaženje ad-blocker-a. org/project idu iz env (nisu tajna); DSN i
// SENTRY_AUTH_TOKEN su u Vercel env. Bez tokena, upload se tiho preskače.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Tišina u lokalnom build-u; logovi samo u CI/Vercel.
  silent: !process.env.CI,

  // Bolji stack-trace za klijentski kod.
  widenClientFileUpload: true,

  // Tunel kroz sopstvenu rutu — zaobilazi ad-blocker-e koji seku ingest domen.
  tunnelRoute: "/monitoring-tunnel",
});
