"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRightLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { TicketListRow } from "@/db/tickets";
import { RowActions } from "@/components/patterns/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

import { deleteTicket, moveTicket, type TicketActionState } from "./actions";
import { TicketDialog, type TicketOptions } from "./ticket-dialog";

/*
 * „⋮" akcije tiketa (Korak T2): izmena, premeštanje u drugu kolonu i brisanje.
 * Premeštanje kroz meni je i rezerva za drag & drop (T3). Admin i Menadžer su
 * ravnopravni — nema dodatnog gejta u UI-ju (RLS pokriva obe role).
 */
export function TicketActions({
  ticket,
  options,
  afterDeleteHref,
}: {
  ticket: TicketListRow;
  options: TicketOptions;
  /** Kuda posle brisanja (detalj tiketa → nazad na board). */
  afterDeleteHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

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

  const targets = options.columns.filter((c) => c.id !== ticket.column_id);

  return (
    <>
      <RowActions label={`Akcije za SPT-${ticket.code}`}>
        <DropdownMenuItem onSelect={() => setEditOpen(true)}>
          <Pencil /> Izmeni
        </DropdownMenuItem>

        {targets.length > 0 ? <DropdownMenuSeparator /> : null}
        {targets.map((column) => (
          <DropdownMenuItem
            key={column.id}
            disabled={pending}
            onSelect={() => run(() => moveTicket(ticket.id, column.id))}
          >
            <ArrowRightLeft /> {column.name}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => {
            if (confirm(`Obrisati tiket SPT-${ticket.code}?`)) {
              run(
                () => deleteTicket(ticket.id),
                () => {
                  if (afterDeleteHref) router.push(afterDeleteHref);
                },
              );
            }
          }}
        >
          <Trash2 /> Obriši
        </DropdownMenuItem>
      </RowActions>

      <TicketDialog options={options} ticket={ticket} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
