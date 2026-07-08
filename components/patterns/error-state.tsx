import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* Error stanje (docs/Sportem-Dizajn-Sistem.md, sekcija 8).
   Jasno: šta se desilo + kako dalje. Upotrebljivo i kao error boundary fallback. */
function ErrorState({
  title = "Nešto nije u redu",
  description = "Došlo je do greške pri učitavanju. Pokušaj ponovo.",
  onRetry,
  retryLabel = "Pokušaj ponovo",
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-danger/40 bg-danger-soft/40 flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center",
        className,
      )}
    >
      <TriangleAlertIcon className="text-danger size-8" />
      <div className="space-y-1">
        <p className="text-ink text-[0.9375rem] font-medium">{title}</p>
        <p className="text-ink-soft text-sm">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export { ErrorState };
