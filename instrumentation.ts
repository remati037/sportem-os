// Next.js instrumentation hook — učitava odgovarajući Sentry config po runtime-u
// i prosleđuje greške ruta/server-komponenti Sentry-ju (Korak 0.6).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Hvata greške iz nested React Server Components (App Router).
export const onRequestError = Sentry.captureRequestError;
