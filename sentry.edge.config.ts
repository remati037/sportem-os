// Sentry — inicijalizacija za Edge runtime (npr. proxy.ts / edge rute).
// Učitava se iz `instrumentation.ts` kad je NEXT_RUNTIME === "edge".
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enableLogs: false,
  debug: false,
});
