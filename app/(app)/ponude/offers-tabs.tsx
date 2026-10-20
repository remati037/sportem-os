"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { OfferPeriodDays } from "@/lib/offers/period";

/* Pravila (upsell/order bump) / Paketi (setovi). Obrazac finance-tabs.tsx;
   izabrani period (`?dana=`) se prenosi u drugi tab. „Paketi" su aktivni po
   prefiksu, a „Pravila" za sve ostalo pod /ponude (uklj. detalj pravila). */
export function OffersTabs({ days }: { days: OfferPeriodDays }) {
  const pathname = usePathname();
  const onPackages = pathname === "/ponude/paketi" || pathname.startsWith("/ponude/paketi/");

  const tabs = [
    { href: `/ponude?dana=${days}`, label: "Pravila", active: !onPackages },
    { href: `/ponude/paketi?dana=${days}`, label: "Paketi", active: onPackages },
  ];

  return (
    <div className="bg-muted mb-6 inline-flex h-9 items-center gap-1 rounded-lg p-[3px]">
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors",
            t.active
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
