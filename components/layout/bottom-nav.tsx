"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import type { Role } from "@/lib/auth";
import { isNavItemActive, navPrimaryForRole, navSecondaryForRole } from "@/lib/nav";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/* Bottom nav (mobilni) — docs/Sportem-Dizajn-Sistem.md sekcija 4.
   Primarne sekcije (4) + dugme „Više" koje otvara panel odozdo sa sekundarnim stavkama
   (Troškovi, Korisnici, Podešavanja — po roli). Aktivna stavka: green-deep + gornja zelena traka.
   Ako roli nema sekundarnih stavki (Logistika), „Više" se ne prikazuje. */
export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = navPrimaryForRole(role);
  const secondary = navSecondaryForRole(role);
  const secondaryActive = secondary.some((item) => isNavItemActive(pathname, item.href));

  return (
    <nav className="border-border bg-surface fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      {primary.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] font-medium transition-colors",
              active ? "text-green-deep" : "text-ink-soft",
            )}
          >
            {active ? (
              <span className="bg-green absolute inset-x-3 top-0 h-0.5 rounded-full" />
            ) : null}
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}

      {secondary.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            aria-label="Više"
            className={cn(
              "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.6875rem] font-medium transition-colors",
              secondaryActive ? "text-green-deep" : "text-ink-soft",
            )}
          >
            {secondaryActive ? (
              <span className="bg-green absolute inset-x-3 top-0 h-0.5 rounded-full" />
            ) : null}
            <MoreHorizontal className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">Više</span>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Više</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1">
              {secondary.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-[0.9375rem] font-medium transition-colors",
                      active ? "bg-green-soft text-green-deep" : "text-ink hover:bg-surface-2",
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </nav>
  );
}
