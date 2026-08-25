"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";

import type { TicketLinkOption } from "@/db/tickets";
import { formatTicketCode } from "@/lib/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { searchTicketLinks, setBlockedBy, type TicketActionState } from "../actions";

/*
 * Izbor tiketa koji blokira ovaj („čeka drugi tiket", Korak T4).
 *
 * Zavisnost je SAMO UPOZORENJE — ne blokira nijednu akciju (zaključana
 * odluka). Ciklus (A čeka B, B čeka A) odbija server srpskom porukom.
 */
export function BlockedControl({
  ticketId,
  current,
}: {
  ticketId: string;
  /** Trenutni blokirajući tiket (ako postoji). */
  current: { id: string; code: number; title: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<TicketLinkOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [openList, setOpenList] = useState(false);

  // Debounce pretrage (300ms) — isti obrazac kao `LinkPicker` u dijalogu.
  useEffect(() => {
    if (!openList) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const options = await searchTicketLinks("ticket", term, ticketId);
      if (cancelled) return;
      setResults(options);
      setSearching(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, openList, ticketId]);

  function run(fn: () => Promise<TicketActionState>, after?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      after?.();
      router.refresh();
    });
  }

  if (current) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-ink text-sm">
          Čeka <span className="num font-medium">{formatTicketCode(current.code)}</span>
          <span className="text-ink-faint"> · {current.title}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Skini zavisnost"
          disabled={pending}
          onClick={() => run(() => setBlockedBy(ticketId, null))}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xs space-y-1">
      <div className="relative">
        <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={term}
          placeholder="Šifra ili naslov tiketa…"
          onFocus={() => setOpenList(true)}
          onChange={(e) => setTerm(e.target.value)}
          className="h-9 pl-9"
        />
      </div>
      {openList ? (
        <div className="border-border bg-surface max-h-44 overflow-y-auto rounded-md border">
          {searching ? (
            <p className="text-ink-faint px-3 py-2 text-sm">Pretraga…</p>
          ) : results.length === 0 ? (
            <p className="text-ink-faint px-3 py-2 text-sm">Nema rezultata.</p>
          ) : (
            results.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setBlockedBy(ticketId, option.id),
                    () => {
                      setOpenList(false);
                      setTerm("");
                    },
                  )
                }
                className="hover:bg-surface-2 block w-full px-3 py-2 text-left text-sm"
              >
                <span className="text-ink num font-medium">{option.label}</span>
                {option.hint ? <span className="text-ink-faint"> · {option.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
