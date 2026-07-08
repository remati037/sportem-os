import * as React from "react";

import { cn } from "@/lib/utils";

/* Prazno stanje (docs/Sportem-Dizajn-Sistem.md, sekcija 4 + 8).
   Kratka poruka + opciona akcija. Primer: „Nema porudžbina za ovaj period." */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-ink-faint [&_svg]:size-8">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-ink text-[0.9375rem] font-medium">{title}</p>
        {description ? <p className="text-ink-soft text-sm">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
