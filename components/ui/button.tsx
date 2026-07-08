import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/* Brend dugmad (docs/Sportem-Dizajn-Sistem.md, sekcija 4).
   Visine: sm 32px / md 40px (default) / lg 48px. Radijus radius-md, font 600. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-[0.9375rem] font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-green/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-green text-white shadow-soft hover:bg-green-deep hover:shadow-lift",
        dark: "bg-ink text-paper hover:bg-ink/90",
        ghost:
          "bg-surface text-ink border border-border hover:bg-surface-2 hover:border-border-strong",
        subtle: "bg-green-soft text-green-deep hover:bg-green-soft/70",
        danger: "bg-surface text-danger border border-danger hover:bg-danger-soft",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-12 px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
