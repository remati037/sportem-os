"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import type { StaffProfile } from "@/db/profiles";
import type { TicketColumnRow, TicketPriorityRow, TicketTagRow } from "@/db/tickets-config";
import { cn } from "@/lib/utils";
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
 * Filteri tiketa (Korak T2) — sve u URL-u (`?kolona=&osoba=&tag=&prioritet=
 * &q=&moji=1&rok=probijen|danas&arhiva=1`), pa je deljiv link = deljiv pogled.
 * Obrazac iz `porudzbine/orders-filter-bar.tsx`: pretraga i brze trake su
 * uvek vidljive, ostalo se staginguje u panelu.
 */

const ALL = "all";

type Draft = {
  kolona: string;
  osoba: string;
  tag: string;
  prioritet: string;
};

const EMPTY_DRAFT: Draft = { kolona: ALL, osoba: ALL, tag: ALL, prioritet: ALL };

export function TicketFilters({
  columns,
  priorities,
  tags,
  staff,
}: {
  columns: TicketColumnRow[];
  priorities: TicketPriorityRow[];
  tags: TicketTagRow[];
  staff: StaffProfile[];
}) {
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

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft({
        kolona: params.get("kolona") ?? ALL,
        osoba: params.get("osoba") ?? ALL,
        tag: params.get("tag") ?? ALL,
        prioritet: params.get("prioritet") ?? ALL,
      });
    }
    setOpen(next);
  }

  const mine = params.get("moji") === "1";
  const rok = params.get("rok");
  const arhiva = params.get("arhiva") === "1";

  const activeCount =
    (params.get("kolona") ? 1 : 0) +
    (params.get("osoba") ? 1 : 0) +
    (params.get("tag") ? 1 : 0) +
    (params.get("prioritet") ? 1 : 0);

  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraga po naslovu ili šifri (SPT-42)…"
          className="min-w-0 flex-1 sm:max-w-xs"
        />

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
                <Label className="text-ink-faint text-xs">Kolona</Label>
                <Select
                  value={draft.kolona}
                  onValueChange={(v) => setDraft((d) => ({ ...d, kolona: v }))}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Kolona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Sve kolone</SelectItem>
                    {columns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-ink-faint text-xs">Osoba</Label>
                <Select
                  value={draft.osoba}
                  onValueChange={(v) => setDraft((d) => ({ ...d, osoba: v }))}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Osoba" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Svi izvršioci</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name ?? "Bez imena"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-ink-faint text-xs">Tag</Label>
                <Select
                  value={draft.tag}
                  onValueChange={(v) => setDraft((d) => ({ ...d, tag: v }))}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Svi tagovi</SelectItem>
                    {tags.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-ink-faint text-xs">Prioritet</Label>
                <Select
                  value={draft.prioritet}
                  onValueChange={(v) => setDraft((d) => ({ ...d, prioritet: v }))}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Prioritet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Svi prioriteti</SelectItem>
                    {priorities.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-border mx-auto mt-4 flex w-full max-w-md gap-2 border-t pt-4">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  apply({ kolona: null, osoba: null, tag: null, prioritet: null });
                  setOpen(false);
                }}
              >
                Resetuj filtere
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  apply({
                    kolona: draft.kolona,
                    osoba: draft.osoba,
                    tag: draft.tag,
                    prioritet: draft.prioritet,
                  });
                  setOpen(false);
                }}
              >
                Primeni filtere
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Brze trake: „Samo moji" i rok. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={mine} onClick={() => apply({ moji: mine ? null : "1" })}>
          Samo moji
        </Chip>
        <Chip
          active={rok === "probijen"}
          onClick={() => apply({ rok: rok === "probijen" ? null : "probijen" })}
        >
          Probijen rok
        </Chip>
        <Chip
          active={rok === "danas"}
          onClick={() => apply({ rok: rok === "danas" ? null : "danas" })}
        >
          Rok danas
        </Chip>
        <Chip active={arhiva} onClick={() => apply({ arhiva: arhiva ? null : "1" })}>
          Prikaži arhivu
        </Chip>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-green bg-green-soft text-green-deep"
          : "border-border bg-surface text-ink-soft hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
