"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

import type { OrderStatusRow } from "@/db/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/*
 * Filter/pretraga porudžbina (Korak 1.4) — URL-driven (searchParams su izvor
 * istine, server refiltrira). Pretraga se debounce-uje; ostali filteri odmah.
 */

const ALL = "all";

export function OrdersFilterBar({ statuses }: { statuses: OrderStatusRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "" || value === ALL) sp.delete(key);
      else sp.set(key, value);
    }
    // Promena filtera vraća na prvu stranu.
    sp.delete("page");
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  // Debounce pretrage: upiši u URL 300ms posle poslednjeg kucanja.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => apply({ q: search || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const statusId = params.get("status") ?? ALL;
  const delivery = params.get("delivery") ?? ALL;
  const payment = params.get("payment") ?? ALL;
  const needsVp = params.get("needs_vp") === "1";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const hasFilters =
    Boolean(search) ||
    statusId !== ALL ||
    delivery !== ALL ||
    payment !== ALL ||
    needsVp ||
    Boolean(from) ||
    Boolean(to);

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraga po broju, imenu ili telefonu…"
          className="max-w-xs"
        />

        <Select value={statusId} onValueChange={(v) => apply({ status: v })}>
          <SelectTrigger className="h-10 w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Svi statusi</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={delivery} onValueChange={(v) => apply({ delivery: v })}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="Isporuka" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Sve isporuke</SelectItem>
            <SelectItem value="xexpress">XExpress</SelectItem>
            <SelectItem value="licno">Lično</SelectItem>
          </SelectContent>
        </Select>

        <Select value={payment} onValueChange={(v) => apply({ payment: v })}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="Plaćanje" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Sva plaćanja</SelectItem>
            <SelectItem value="neuplaceno">Neuplaćeno</SelectItem>
            <SelectItem value="uplaceno">Uplaćeno</SelectItem>
            <SelectItem value="kes">Keš/Isplaćeno</SelectItem>
          </SelectContent>
        </Select>

        <label className="text-ink-soft flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={needsVp}
            onChange={(e) => apply({ needs_vp: e.target.checked ? "1" : null })}
            className="accent-green size-4"
          />
          Samo „Nedostaje VP“
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-ink-faint text-xs">
            Od datuma
          </Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => apply({ from: e.target.value || null })}
            className="h-10 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-ink-faint text-xs">
            Do datuma
          </Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => apply({ to: e.target.value || null })}
            className="h-10 w-40"
          />
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              router.replace(pathname);
            }}
          >
            <X /> Poništi filtere
          </Button>
        ) : null}
      </div>
    </div>
  );
}
