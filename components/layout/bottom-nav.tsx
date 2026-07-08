"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/auth";
import { isNavItemActive, navForRole } from "@/lib/nav";
import { cn } from "@/lib/utils";

/* Bottom nav (mobilni) — docs/Sportem-Dizajn-Sistem.md sekcija 4.
   Samo primarne sekcije; aktivna stavka: green-soft + green-deep + gornja zelena traka. */
export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navForRole(role).filter((item) => item.primary);

  return (
    <nav className="border-border bg-surface fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden">
      {items.map((item) => {
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
            {active ? <span className="bg-green absolute inset-x-3 top-0 h-0.5 rounded-full" /> : null}
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
