"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";

import { deleteInvoice, markInvoicePaid } from "../../actions";

/*
 * Akcije nad fakturom (Korak 1.6b, Admin): „Označi plaćeno" (izdato → placeno)
 * i brisanje. Brisanje re-otvara vezane porudžbine (nazad u kandidate). Plaćena
 * i „ISTORIJA-BACKFILL" faktura su zaštićene (dugmad se ne prikazuju).
 */
export function InvoiceActions({
  id,
  status,
  isBackfill,
}: {
  id: string;
  status: string;
  isBackfill: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isPaid = status === "placeno";

  function markPaid() {
    startTransition(async () => {
      const result = await markInvoicePaid({ id });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Faktura označena kao plaćena.");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteInvoice(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Faktura obrisana.");
      router.push("/finansije/fakture");
      router.refresh();
    });
  }

  if (isBackfill) return null;

  return (
    <div className="flex gap-2">
      {!isPaid ? (
        <Button variant="subtle" size="sm" disabled={pending} onClick={markPaid}>
          <Check /> Označi plaćeno
        </Button>
      ) : null}
      {!isPaid ? (
        <ConfirmDialog
          trigger={
            <Button variant="danger" size="sm" disabled={pending}>
              <Trash2 /> Obriši
            </Button>
          }
          title="Obrisati fakturu?"
          description={
            "Vezane porudžbine se vraćaju u kandidate za fakturu. Ova radnja se ne može opozvati."
          }
          confirmLabel="Obriši"
          variant="danger"
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}
