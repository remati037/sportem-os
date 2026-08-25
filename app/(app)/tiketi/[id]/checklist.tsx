"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { TicketChecklistItem } from "@/db/tickets";
import { datumVreme } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  addChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
  type TicketActionState,
} from "../actions";

/*
 * Checklist tiketa sa progresom „2/3" (Korak T4).
 *
 * Štikliranje upisuje `done_at` / `done_by` (ko je i kada odradio) i ostavlja
 * red u istoriji promena. Checklist NE utiče na kolonu ni na `completed_at` —
 * završetak tiketa i dalje ide isključivo kroz `is_done` kolonu.
 */

const initial: TicketActionState = { error: null };

export function Checklist({ ticketId, items }: { ticketId: string; items: TicketChecklistItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const done = items.filter((i) => i.done).length;
  const percent = items.length > 0 ? Math.round((done / items.length) * 100) : 0;

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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(
      () => addChecklistItem(initial, fd),
      () => form.reset(),
    );
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink text-base font-semibold">Checklist</h2>
        {items.length > 0 ? (
          <span className="num text-ink-soft text-sm font-medium">
            {done}/{items.length}
          </span>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="bg-surface-2 mb-3 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-green h-full rounded-full transition-all"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label={`Urađeno ${done} od ${items.length}`}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-ink-soft mb-3 text-sm">Nema stavki — dodaj prvu ispod.</p>
      ) : (
        <ul className="border-border bg-surface shadow-soft divide-border mb-3 divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <input
                type="checkbox"
                id={`stavka-${item.id}`}
                checked={item.done}
                disabled={pending}
                onChange={(e) => run(() => toggleChecklistItem(item.id, e.target.checked))}
                className="accent-green size-4 shrink-0"
              />
              <label
                htmlFor={`stavka-${item.id}`}
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  item.done ? "text-ink-faint line-through" : "text-ink",
                )}
              >
                {item.label}
                {item.done && item.done_at ? (
                  <span className="text-ink-faint block text-xs">
                    <span className="num">{datumVreme(item.done_at)}</span>
                    {item.doneByName ? ` · ${item.doneByName}` : ""}
                  </span>
                ) : null}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Obriši stavku: ${item.label}`}
                disabled={pending}
                onClick={() => run(() => deleteChecklistItem(item.id))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <Input name="label" required maxLength={200} placeholder="Nova stavka…" />
        <Button type="submit" variant="ghost" disabled={pending}>
          Dodaj
        </Button>
      </form>
    </section>
  );
}
