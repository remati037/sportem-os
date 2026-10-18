"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/*
 * Pretraga + sortiranje liste kupaca — URL-driven (server filtrira). Pretraga po
 * telefonu ide u `q` kao unos korisnika; identitet kupca u URL-u je samo repId.
 * Liste opcija su ogledalo `CUSTOMER_SORTS` / `INACTIVE_MONTH_OPTIONS` iz
 * db/customers.ts (server-only se ne uvozi u klijent); server validira vrednost.
 */

const SORTS = [
  { value: "promet", label: "Promet" },
  { value: "zarada", label: "Zarada" },
  { value: "porudzbine", label: "Broj porudžbina" },
  { value: "poslednja", label: "Poslednja kupovina" },
] as const;

const MONTHS = [3, 6, 12] as const;

export function CustomersToolbar({
  sort,
  months,
  showMonths,
}: {
  sort: string;
  months: number;
  showMonths: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") sp.delete(key);
      else sp.set(key, value);
    }
    sp.delete("strana"); // promena pretrage/sorta vraća na prvu stranu
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  // Debounce pretrage: upiši u URL 300ms posle poslednjeg kucanja.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search.trim() === current) return;
    const timer = setTimeout(() => apply({ q: search.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Ime, telefon, e-mail ili grad…"
        aria-label="Pretraga kupaca"
        className="min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto"
      />

      <Select value={sort} onValueChange={(v) => apply({ sort: v === "promet" ? null : v })}>
        <SelectTrigger className="h-10 w-48" aria-label="Sortiranje">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              Sort: {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showMonths ? (
        <Select
          value={String(months)}
          onValueChange={(v) => apply({ meseci: v === "3" ? null : v })}
        >
          <SelectTrigger className="h-10 w-44" aria-label="Neaktivan posle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                Bez kupovine {m} mes.
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
