"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import type { OrderStatusRow } from "@/db/orders";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/*
 * Filter/pretraga porudžbina — URL-driven (searchParams su izvor istine, server
 * refiltrira). Kompaktno: uvek vidljivi su polje za pretragu + izbor atributa;
 * sekundarni filteri su u panelu koji se primenjuje dugmetom „Primeni filtere"
 * (staging), pa ne zauzimaju prostor na telefonu. Panel izleti sa dna na
 * telefonu, a kao drawer sa desne ivice na desktopu (md+).
 */

const ALL = "all";

const SEARCH_PLACEHOLDER: Record<string, string> = {
  all: "Pretraga po broju, imenu, e-mailu ili telefonu…",
  name: "Pretraga po imenu…",
  email: "Pretraga po e-mailu…",
  phone: "Pretraga po telefonu…",
};

/** Sekundarni filteri koji se staginguju u panelu (ne pretraga/atribut). */
type Draft = {
  status: string;
  delivery: string;
  payment: string;
  needsVp: boolean;
  from: string;
  to: string;
};

const EMPTY_DRAFT: Draft = {
  status: ALL,
  delivery: ALL,
  payment: ALL,
  needsVp: false,
  from: "",
  to: "",
};

export function OrdersFilterBar({ statuses }: { statuses: OrderStatusRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

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

  // Kad se panel otvori, kreni od trenutno primenjenih (URL) vrednosti.
  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft({
        status: params.get("status") ?? ALL,
        delivery: params.get("delivery") ?? ALL,
        payment: params.get("payment") ?? ALL,
        needsVp: params.get("needs_vp") === "1",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      });
    }
    setOpen(next);
  }

  const searchField = params.get("qf") ?? "name";

  // Broj aktivnih (primenjenih) sekundarnih filtera — za bedž na dugmetu.
  const activeCount =
    (params.get("status") ? 1 : 0) +
    (params.get("delivery") ? 1 : 0) +
    (params.get("payment") ? 1 : 0) +
    (params.get("needs_vp") === "1" ? 1 : 0) +
    (params.get("from") ? 1 : 0) +
    (params.get("to") ? 1 : 0);

  function applyDraft() {
    apply({
      status: draft.status,
      delivery: draft.delivery,
      payment: draft.payment,
      needs_vp: draft.needsVp ? "1" : null,
      from: draft.from || null,
      to: draft.to || null,
    });
    setOpen(false);
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    apply({
      status: null,
      delivery: null,
      payment: null,
      needs_vp: null,
      from: null,
      to: null,
    });
    setOpen(false);
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={SEARCH_PLACEHOLDER[searchField] ?? SEARCH_PLACEHOLDER.name}
        className="min-w-0 flex-1 sm:max-w-xs"
      />

      <Select value={searchField} onValueChange={(v) => apply({ qf: v === "name" ? null : v })}>
        <SelectTrigger className="h-10 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Ime</SelectItem>
          <SelectItem value="email">E-mail</SelectItem>
          <SelectItem value="phone">Telefon</SelectItem>
          <SelectItem value={ALL}>Sve</SelectItem>
        </SelectContent>
      </Select>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button variant="subtle" className="h-10">
            <SlidersHorizontal /> Filteri
            {activeCount > 0 ? (
              <Badge variant="info" className="ml-1">
                {activeCount}
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>

        <SheetContent
          side="responsive"
          className="max-h-[85vh] gap-0 rounded-t-2xl md:max-h-none md:rounded-t-none"
        >
          <SheetHeader className="pb-4">
            <SheetTitle>Filteri</SheetTitle>
            <SheetDescription>Izaberi filtere pa klikni „Primeni filtere“.</SheetDescription>
          </SheetHeader>

          <div className="mx-auto w-full max-w-md flex-1 space-y-4 overflow-x-hidden overflow-y-auto pb-2">
            <div className="space-y-1">
              <Label className="text-ink-faint text-xs">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}
              >
                <SelectTrigger className="h-10 w-full">
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
            </div>

            <div className="space-y-1">
              <Label className="text-ink-faint text-xs">Isporuka</Label>
              <Select
                value={draft.delivery}
                onValueChange={(v) => setDraft((d) => ({ ...d, delivery: v }))}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Isporuka" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Sve isporuke</SelectItem>
                  <SelectItem value="xexpress">XExpress</SelectItem>
                  <SelectItem value="licno">Lično</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-ink-faint text-xs">Plaćanje</Label>
              <Select
                value={draft.payment}
                onValueChange={(v) => setDraft((d) => ({ ...d, payment: v }))}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Plaćanje" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Sva plaćanja</SelectItem>
                  <SelectItem value="neuplaceno">Neuplaćeno</SelectItem>
                  <SelectItem value="uplaceno">Uplaćeno</SelectItem>
                  <SelectItem value="kes">Keš/Isplaćeno</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="text-ink-soft flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.needsVp}
                onChange={(e) => setDraft((d) => ({ ...d, needsVp: e.target.checked }))}
                className="accent-green size-4"
              />
              Samo „Nedostaje VP“
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="from" className="text-ink-faint text-xs">
                  Od datuma
                </Label>
                <Input
                  id="from"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="h-10 w-full"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="to" className="text-ink-faint text-xs">
                  Do datuma
                </Label>
                <Input
                  id="to"
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="h-10 w-full"
                />
              </div>
            </div>
          </div>

          <div className="border-border mx-auto mt-4 flex w-full max-w-md gap-2 border-t pt-4">
            <Button variant="ghost" className="flex-1" onClick={resetDraft}>
              Resetuj filtere
            </Button>
            <Button className="flex-1" onClick={applyDraft}>
              Primeni filtere
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
