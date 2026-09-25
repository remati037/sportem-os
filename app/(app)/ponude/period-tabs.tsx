import Link from "next/link";

import { cn } from "@/lib/utils";
import { OFFER_PERIODS, type OfferPeriodDays } from "@/lib/offers/period";

/* Izbor perioda (7 / 30 / 90 dana) kao linkovi — period živi u URL-u (?dana=),
   pa je pogled deljiv i preživljava osvežavanje. Obrazac iz finance-tabs.tsx,
   samo bez `usePathname` (osnovnu rutu prosleđuje stranica). */
export function PeriodTabs({ active, basePath }: { active: OfferPeriodDays; basePath: string }) {
  return (
    <div
      className="bg-muted inline-flex h-9 items-center gap-1 rounded-lg p-[3px]"
      role="group"
      aria-label="Period"
    >
      {OFFER_PERIODS.map((days) => (
        <Link
          key={days}
          href={`${basePath}?dana=${days}`}
          aria-current={days === active ? "page" : undefined}
          className={cn(
            "num inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors",
            days === active
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground",
          )}
        >
          {days} dana
        </Link>
      ))}
    </div>
  );
}
