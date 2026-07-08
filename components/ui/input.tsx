import * as React from "react";

import { cn } from "@/lib/utils";

/* Brend input (docs/Sportem-Dizajn-Sistem.md, sekcija 4).
   Visina 40px, border-strong, radius-md; fokus → zeleni border + prsten.
   Greška preko aria-invalid → danger border. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "text-ink border-input bg-surface flex h-10 w-full min-w-0 rounded-md border px-3 text-[0.9375rem] transition-[color,box-shadow] outline-none",
        "placeholder:text-ink-faint file:text-ink file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:bg-surface-2 disabled:text-ink-faint disabled:cursor-not-allowed",
        "focus-visible:border-green focus-visible:ring-green/20 focus-visible:ring-[3px]",
        "aria-invalid:border-danger aria-invalid:ring-danger/20 aria-invalid:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
