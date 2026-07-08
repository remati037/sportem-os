"use client";

// Globalni error boundary (App Router) — hvata greške renderovanja i šalje ih
// Sentry-ju, uz brend-usklađen fallback na srpskom (Korak 0.6).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="sr">
      <body className="bg-paper text-ink flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center font-sans">
        <h1 className="text-xl font-semibold">Došlo je do greške</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Nešto je pošlo naopako. Greška je zabeležena — pokušaj ponovo.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Pokušaj ponovo
        </button>
      </body>
    </html>
  );
}
