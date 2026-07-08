// Sentry — inicijalizacija u browseru (Next.js App Router client instrumentation).
// Korak 0.6 — greške na klijentu + performance tracing. Bez Session Replay.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enableLogs: false,
  debug: false,
});

// Prati navigaciju kroz App Router (client-side tranzicije).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
