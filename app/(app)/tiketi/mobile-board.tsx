"use client";

import { useState } from "react";

import type { TicketBoard } from "@/db/tickets";
import { cn } from "@/lib/utils";

import { TicketCard } from "./ticket-card";
import type { TicketOptions } from "./ticket-dialog";

/*
 * Mobilni prikaz board-a (Korak T2, ispod md): tabovi po kolonama sa brojačem
 * + vertikalna lista kartica. Bez drag & drop-a (dodir + skrol se ne mešaju,
 * odluka iz T3) — kolona se menja kroz „⋮" meni kartice.
 */
export function MobileBoard({
  board,
  options,
  today,
}: {
  board: TicketBoard;
  options: TicketOptions;
  today: string;
}) {
  const [activeId, setActiveId] = useState(board.columns[0]?.id ?? "");
  const active = board.columns.find((c) => c.id === activeId) ?? board.columns[0];

  if (!active) return null;

  return (
    <div className="md:hidden">
      <div
        role="tablist"
        aria-label="Kolone tiketa"
        className="-mx-6 mb-3 flex gap-1.5 overflow-x-auto px-6 pb-1"
      >
        {board.columns.map((column) => {
          const selected = column.id === active.id;
          const count = column.tickets.length;
          const overLimit = column.wip_limit != null && count > column.wip_limit;
          return (
            <button
              key={column.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setActiveId(column.id)}
              className={cn(
                "rounded-pill flex shrink-0 items-center gap-1.5 border px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "border-green bg-green-soft text-green-deep"
                  : "border-border text-ink-soft bg-surface",
              )}
            >
              {column.name}
              <span
                className={cn(
                  "num text-xs font-semibold",
                  overLimit ? "text-danger" : "text-ink-faint",
                )}
              >
                {column.wip_limit != null ? `${count}/${column.wip_limit}` : count}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={active.name} className="space-y-2">
        {active.tickets.length === 0 ? (
          <p className="text-ink-faint border-border rounded-lg border border-dashed px-3 py-8 text-center text-sm">
            Nema tiketa u koloni „{active.name}“
          </p>
        ) : (
          active.tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} options={options} today={today} />
          ))
        )}
      </div>
    </div>
  );
}
