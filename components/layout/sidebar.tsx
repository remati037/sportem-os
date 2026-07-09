"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/prijava/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/auth";
import { isNavItemActive, navForRole } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";
import { cn } from "@/lib/utils";

/* Sidebar (desktop) — docs/Sportem-Dizajn-Sistem.md sekcija 4.
   Aktivna stavka: green-soft pozadina + green-deep tekst + leva zelena traka. */
export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const items = navForRole(profile.role);

  return (
    <aside className="border-border bg-surface hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="border-border flex flex-col gap-1 border-b px-5 py-5">
        <div className="eyebrow">Sportem</div>
        <Badge variant="info" className="w-fit">
          {ROLE_LABEL[profile.role]}
        </Badge>
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {items.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium transition-colors",
                active
                  ? "bg-green-soft text-green-deep"
                  : "text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
            >
              {active ? (
                <span className="bg-green absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" />
              ) : null}
              <Icon className="size-4.5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-border space-y-2 border-t px-3 py-4">
        <p className="text-ink-soft truncate px-3 text-sm">{profile.full_name ?? "—"}</p>
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full justify-start">
            Odjava
          </Button>
        </form>
      </div>
    </aside>
  );
}
