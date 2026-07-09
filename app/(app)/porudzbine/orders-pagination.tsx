"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Ogledalo `ORDERS_PER_PAGE_OPTIONS` iz db/orders.ts (server-only modul se ne
// sme uvoziti u klijentsku komponentu). Server validira vrednost iz URL-a.
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

/*
 * Paginacija liste porudžbina (URL-driven): izbor redova po strani, navigacija
 * po stranama, ukupan broj strana i redova. `page` i `perPage` su u URL-u.
 */
export function OrdersPagination({
  total,
  page,
  perPage,
}: {
  total: number;
  page: number;
  perPage: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);

  function pushParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null) sp.delete(key);
      else sp.set(key, value);
    }
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function goTo(p: number) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    pushParams({ page: clamped === 1 ? null : String(clamped) });
  }

  const firstRow = total === 0 ? 0 : (current - 1) * perPage + 1;
  const lastRow = Math.min(current * perPage, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div className="text-ink-soft flex items-center gap-2 text-sm">
        <span>Redova po strani:</span>
        <Select
          value={String(perPage)}
          onValueChange={(v) => pushParams({ per_page: v, page: null })}
        >
          <SelectTrigger className="h-8 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-ink-soft text-sm">
        <span className="num">{num(firstRow)}</span>–<span className="num">{num(lastRow)}</span> od{" "}
        <span className="num text-ink font-medium">{num(total)}</span> porudžbina
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-ink-soft mr-1 text-sm">
          Strana <span className="num text-ink font-medium">{num(current)}</span> /{" "}
          <span className="num">{num(totalPages)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={current <= 1}
          aria-label="Prva strana"
          onClick={() => goTo(1)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={current <= 1}
          aria-label="Prethodna strana"
          onClick={() => goTo(current - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={current >= totalPages}
          aria-label="Sledeća strana"
          onClick={() => goTo(current + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={current >= totalPages}
          aria-label="Poslednja strana"
          onClick={() => goTo(totalPages)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}
