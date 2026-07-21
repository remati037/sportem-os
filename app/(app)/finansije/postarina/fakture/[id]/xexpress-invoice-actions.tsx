"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";

import { deleteXexpressInvoice } from "../../../actions";

/*
 * Akcije nad XExpress fakturom (Admin): izmena i brisanje. Brisanje odveže
 * porudžbine i očisti njihovu stvarnu poštarinu (global saldo se vraća).
 */
export function XexpressInvoiceActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteXexpressInvoice(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Faktura obrisana.");
      router.push("/finansije/postarina");
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      <Button asChild variant="subtle" size="sm">
        <Link href={`/finansije/postarina/fakture/${id}/izmena`}>
          <Pencil /> Izmeni
        </Link>
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="danger" size="sm" disabled={pending}>
            <Trash2 /> Obriši
          </Button>
        }
        title="Obrisati XExpress fakturu?"
        description="Vezane porudžbine se odvezuju i njihova stvarna poštarina se briše. Ova radnja se ne može opozvati."
        confirmLabel="Obriši"
        variant="danger"
        onConfirm={remove}
      />
    </div>
  );
}
