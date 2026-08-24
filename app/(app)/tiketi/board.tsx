import { Plus } from "lucide-react";

import type { TicketBoard } from "@/db/tickets";
import { Button } from "@/components/ui/button";

import { TicketCard } from "./ticket-card";
import { TicketDialog, type TicketOptions } from "./ticket-dialog";

/*
 * Desktop kanban (Korak T2, md+): kolone jedna do druge, kartice u
 * `position ASC` (drag & drop dolazi u T3 — do tada premeštanje ide kroz „⋮").
 * WIP limit je SOFT: kolona pocrveni i broji „4/3", ali ništa ne blokira.
 */
export function Board({
  board,
  options,
  today,
}: {
  board: TicketBoard;
  options: TicketOptions;
  today: string;
}) {
  return (
    <div className="hidden gap-4 overflow-x-auto pb-2 md:flex">
      {board.columns.map((column) => {
        const count = column.tickets.length;
        const overLimit = column.wip_limit != null && count > column.wip_limit;
        const hex = column.color ?? "#6B7280";

        return (
          <section
            key={column.id}
            className="bg-surface-2 flex w-72 shrink-0 flex-col rounded-lg p-2"
            aria-label={column.name}
          >
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: hex }} />
                <span className="text-ink text-sm font-semibold">{column.name}</span>
                <span
                  className={
                    overLimit
                      ? "bg-danger-soft text-danger num rounded-pill px-1.5 text-xs font-semibold"
                      : "text-ink-faint num text-xs font-semibold"
                  }
                  title={
                    column.wip_limit != null
                      ? `WIP limit: ${column.wip_limit} (samo upozorenje)`
                      : undefined
                  }
                >
                  {column.wip_limit != null ? `${count}/${column.wip_limit}` : count}
                </span>
              </div>
              <TicketDialog
                options={options}
                defaultColumnId={column.id}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Nov tiket u „${column.name}“`}
                  >
                    <Plus />
                  </Button>
                }
              />
            </header>

            <div className="flex flex-col gap-2">
              {count === 0 ? (
                <p className="text-ink-faint border-border rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                  Nema tiketa
                </p>
              ) : (
                column.tickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} options={options} today={today} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
