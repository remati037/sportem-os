"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { TicketBoard, TicketBoardColumn, TicketListRow } from "@/db/tickets";
import { formatTicketCode } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { moveTicket } from "./actions";
import { TicketCard } from "./ticket-card";
import { TicketDialog, type TicketOptions } from "./ticket-dialog";

/*
 * Desktop kanban (md+) sa drag & drop-om (Korak T3).
 *
 * - Prevlačenje IZMEĐU kolona i ručni redosled UNUTAR kolone; na telefonu
 *   ostaje `mobile-board.tsx` (dodir + skrol se ne mešaju), a meni „⋮" je i
 *   dalje rezerva na oba prikaza.
 * - Optimistički UI: lokalno stanje se pomera odmah, pa se šalje akcija.
 *   Greška → povratak na stanje pre prevlačenja + toast.
 * - Server NE dobija broj pozicije, nego SUSEDE (kartica iznad/ispod) i sam
 *   računa `position` (fractional indexing) — zastareo board ne može da upiše
 *   pogrešan redosled.
 * - WIP limit je i dalje SOFT: kolona pocrveni i broji „4/3", ništa ne blokira.
 */

/** Prefiks droppable id-ja kolone (da se ne meša sa id-jem tiketa). */
const COLUMN_DROP_PREFIX = "kolona:";

function findTicketColumn(
  columns: TicketBoardColumn[],
  ticketId: string,
): TicketBoardColumn | null {
  return columns.find((c) => c.tickets.some((t) => t.id === ticketId)) ?? null;
}

/** Id kolone nad kojom se lebdi — bilo da je „over" sama kolona ili kartica u njoj. */
function resolveOverColumnId(columns: TicketBoardColumn[], overId: string): string | null {
  if (overId.startsWith(COLUMN_DROP_PREFIX)) {
    const id = overId.slice(COLUMN_DROP_PREFIX.length);
    return columns.some((c) => c.id === id) ? id : null;
  }
  return findTicketColumn(columns, overId)?.id ?? null;
}

/** Novo stanje kolona sa tiketom prebačenim na `toIndex` u `toColumnId`. */
function withTicketAt(
  columns: TicketBoardColumn[],
  ticketId: string,
  toColumnId: string,
  toIndex: number,
): TicketBoardColumn[] {
  const from = findTicketColumn(columns, ticketId);
  const ticket = from?.tickets.find((t) => t.id === ticketId);
  if (!from || !ticket) return columns;

  return columns.map((column) => {
    const isSource = column.id === from.id;
    const isTarget = column.id === toColumnId;
    if (!isSource && !isTarget) return column;

    const rest = isSource ? column.tickets.filter((t) => t.id !== ticketId) : column.tickets;
    if (!isTarget) return { ...column, tickets: rest };

    const index = Math.max(0, Math.min(toIndex, rest.length));
    return { ...column, tickets: [...rest.slice(0, index), ticket, ...rest.slice(index)] };
  });
}

/** Kolona + susedi tiketa (ono što server dobija umesto pozicije). */
function neighborsOf(columns: TicketBoardColumn[], ticketId: string) {
  const column = findTicketColumn(columns, ticketId);
  if (!column) return null;
  const index = column.tickets.findIndex((t) => t.id === ticketId);
  return {
    columnId: column.id,
    beforeId: index > 0 ? column.tickets[index - 1]!.id : null,
    afterId: index < column.tickets.length - 1 ? column.tickets[index + 1]!.id : null,
  };
}

export function Board({
  board,
  options,
  today,
}: {
  board: TicketBoard;
  options: TicketOptions;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Lokalno (optimističko) stanje board-a; sveži podaci sa servera imaju
  // prednost — kad se promeni identitet propsa, prikaz se poravna sa bazom.
  const [columns, setColumns] = useState(board.columns);
  const [serverColumns, setServerColumns] = useState(board.columns);
  if (serverColumns !== board.columns) {
    setServerColumns(board.columns);
    setColumns(board.columns);
  }

  const [activeId, setActiveId] = useState<string | null>(null);
  /** Stanje pre prevlačenja — meta rollback-a kad akcija padne. */
  const beforeDrag = useRef<TicketBoardColumn[] | null>(null);

  const sensors = useSensors(
    // Mali prag pomeraja da klik na karticu (link) i „⋮" meni i dalje rade.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTicket = activeId
    ? (findTicketColumn(columns, activeId)?.tickets.find((t) => t.id === activeId) ?? null)
    : null;

  function label(id: string): string {
    const ticket = findTicketColumn(columns, id)?.tickets.find((t) => t.id === id);
    return ticket ? formatTicketCode(ticket.code) : "Tiket";
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Podignut tiket ${label(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Tiket ${label(String(active.id))} je iznad ${
            String(over.id).startsWith(COLUMN_DROP_PREFIX)
              ? "kolone"
              : `tiketa ${label(String(over.id))}`
          }.`
        : `Tiket ${label(String(active.id))} nije iznad mesta za ispuštanje.`,
    onDragEnd: ({ active }) => `Tiket ${label(String(active.id))} je ispušten.`,
    onDragCancel: ({ active }) => `Prevlačenje tiketa ${label(String(active.id))} je otkazano.`,
  };

  function handleDragStart(event: DragStartEvent) {
    beforeDrag.current = columns;
    setActiveId(String(event.active.id));
  }

  /** Prelazak u DRUGU kolonu se prikazuje odmah (kolona otvara mesto). */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeTicketId = String(active.id);
    const overId = String(over.id);
    const fromColumn = findTicketColumn(columns, activeTicketId);
    const toColumnId = resolveOverColumnId(columns, overId);
    if (!fromColumn || !toColumnId || fromColumn.id === toColumnId) return;

    const target = columns.find((c) => c.id === toColumnId);
    if (!target) return;

    const overIndex = target.tickets.findIndex((t) => t.id === overId);
    const translated = active.rect.current.translated;
    const below =
      overIndex >= 0 && translated != null && translated.top > over.rect.top + over.rect.height / 2;
    const index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.tickets.length;

    setColumns((prev) => withTicketAt(prev, activeTicketId, toColumnId, index));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const rollback = beforeDrag.current ?? columns;
    beforeDrag.current = null;
    setActiveId(null);

    const activeTicketId = String(active.id);
    const overId = over ? String(over.id) : null;
    const toColumnId = overId ? resolveOverColumnId(columns, overId) : null;
    if (!overId || !toColumnId) {
      setColumns(rollback);
      return;
    }

    let next = columns;
    if (overId !== activeTicketId) {
      const target = columns.find((c) => c.id === toColumnId);
      if (!target) {
        setColumns(rollback);
        return;
      }
      const overIndex = target.tickets.findIndex((t) => t.id === overId);
      next = withTicketAt(
        columns,
        activeTicketId,
        toColumnId,
        overIndex >= 0 ? overIndex : target.tickets.length,
      );
    }

    const target = neighborsOf(next, activeTicketId);
    if (!target) {
      setColumns(rollback);
      return;
    }
    setColumns(next);

    // Ništa se stvarno nije pomerilo u odnosu na bazu → nema upisa.
    const saved = neighborsOf(board.columns, activeTicketId);
    if (
      saved &&
      saved.columnId === target.columnId &&
      saved.beforeId === target.beforeId &&
      saved.afterId === target.afterId
    ) {
      return;
    }

    startTransition(async () => {
      const result = await moveTicket(activeTicketId, target.columnId, {
        beforeId: target.beforeId,
        afterId: target.afterId,
      });
      if (result.error) {
        setColumns(rollback);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDragCancel() {
    const rollback = beforeDrag.current;
    beforeDrag.current = null;
    setActiveId(null);
    if (rollback) setColumns(rollback);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="hidden gap-4 overflow-x-auto pb-2 md:flex">
        {columns.map((column) => (
          <BoardColumn key={column.id} column={column} options={options} today={today} />
        ))}
      </div>

      <DragOverlay modifiers={[restrictToWindowEdges]}>
        {activeTicket ? (
          <div className="w-72 rotate-2 cursor-grabbing">
            <TicketCard ticket={activeTicket} options={options} today={today} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  options,
  today,
}: {
  column: TicketBoardColumn;
  options: TicketOptions;
  today: string;
}) {
  // Kolona je i sama meta ispuštanja — inače se u praznu ne može ispustiti.
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_DROP_PREFIX}${column.id}` });

  const count = column.tickets.length;
  const overLimit = column.wip_limit != null && count > column.wip_limit;
  const hex = column.color ?? "#6B7280";

  return (
    <section
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
            <Button variant="ghost" size="icon-sm" aria-label={`Nov tiket u „${column.name}“`}>
              <Plus />
            </Button>
          }
        />
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-md transition-colors",
          isOver && "bg-green-soft/60 outline-green outline-2 outline-dashed",
        )}
      >
        <SortableContext
          items={column.tickets.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {count === 0 ? (
            <p className="text-ink-faint border-border rounded-lg border border-dashed px-3 py-6 text-center text-xs">
              Nema tiketa
            </p>
          ) : (
            column.tickets.map((ticket) => (
              <SortableTicket key={ticket.id} ticket={ticket} options={options} today={today} />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  );
}

function SortableTicket({
  ticket,
  options,
  today,
}: {
  ticket: TicketListRow;
  options: TicketOptions;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        // Bez `@dnd-kit/utilities` — transform se ispisuje ručno (jedna linija).
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition: transition ?? undefined,
      }}
      className={cn("touch-none outline-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <TicketCard ticket={ticket} options={options} today={today} />
    </div>
  );
}
