import * as React from "react";

import { cn } from "@/lib/utils";

/** Višelinijski unos — isti brend stil kao `Input` (fokus zelena, border). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "text-ink border-input bg-surface flex w-full rounded-md border px-3 py-2 text-[0.9375rem] outline-none",
        "placeholder:text-ink-faint focus-visible:border-green focus-visible:ring-green/20 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
