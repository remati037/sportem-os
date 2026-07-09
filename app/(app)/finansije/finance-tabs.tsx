"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/* Sekundarna navigacija finansija (Uplate / Fakture / Poštarina). Link-based
   (svaka sekcija je svoja ruta), aktivna po prefiksu pathname-a. */
const TABS = [
  { href: "/finansije/uplate", label: "Uplate" },
  { href: "/finansije/fakture", label: "Fakture" },
  { href: "/finansije/postarina", label: "Poštarina" },
];

export function FinanceTabs() {
  const pathname = usePathname();

  return (
    <div className="bg-muted mb-6 inline-flex h-9 items-center gap-1 rounded-lg p-[3px]">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-foreground/60 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
