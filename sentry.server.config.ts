// Sentry — inicijalizacija na serveru (Node.js runtime).
// Ovaj fajl se učitava iz `instrumentation.ts` kad je NEXT_RUNTIME === "nodejs".
// Korak 0.6 — monitoring grešaka servera + performance tracing na niskoj stopi.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Uzorkovanje performansi (10%) — dovoljno za interni tim, čuva free-tier kvotu.
  tracesSampleRate: 0.1,

  // Bez Session Replay/logova u Fazi 0.
  enableLogs: false,

  // Debug samo lokalno; tišina u produkciji.
  debug: false,
});
