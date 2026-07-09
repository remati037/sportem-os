import Link from "next/link";

import { cn } from "@/lib/utils";

/* Mobilni kartica-prikaz tabela (bez horizontalnog skrola) — docs/Sportem-Dizajn-Sistem.md.
   Kontejner `MobileCardList` je `md:hidden` (tabela ostaje na desktopu). Kartica opciono cela
   navigira preko overlay linka (`href`); interaktivni elementi (čekboks, „⋮" akcije) moraju
   dobiti `relative z-10` da budu iznad overlay-a. */

export function MobileCardList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("space-y-2 md:hidden", className)}>{children}</div>;
}

export function MobileCard({
  href,
  ariaLabel,
  className,
  children,
}: {
  /** Ako je zadat, cela kartica navigira na ovu rutu (overlay link). */
  href?: string;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface shadow-soft relative rounded-lg border p-3",
        href && "hover:bg-green-soft active:bg-green-soft transition-colors",
        className,
      )}
    >
      {children}
      {href ? (
        <Link href={href} aria-label={ariaLabel} className="absolute inset-0 rounded-lg" />
      ) : null}
    </div>
  );
}

/** Gornji red kartice: opciono levo (slika/čekboks), naslov+podnaslov, opciono desno (badge/akcije). */
export function MobileCardHeader({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {leading ? <div className="relative z-10 shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="text-ink font-medium">{title}</div>
        {subtitle ? <div className="text-ink-faint mt-0.5 text-xs">{subtitle}</div> : null}
      </div>
      {trailing ? (
        <div className="relative z-10 flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : null}
    </div>
  );
}

/** Red label/vrednost unutar kartice. */
export function MobileCardField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="text-ink-faint text-xs">{label}</span>
      <span className="text-ink text-sm">{children}</span>
    </div>
  );
}
