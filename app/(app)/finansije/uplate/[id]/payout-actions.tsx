"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";

import { deletePayout, updatePayout } from "../../actions";

/*
 * Akcije nad uplatom (Korak 1.6a, Admin): izmena iznosa/datuma/napomene i
 * brisanje. Brisanje vraća vezane porudžbine na „neuplaćeno" (osim ako je neka
 * fakturisana — tada se odbija). Re-vezivanje porudžbina ide kroz delete+novo.
 */
export function PayoutActions({
  id,
  amount,
  payoutDate,
  notes,
  orderIds,
}: {
  id: string;
  amount: number;
  payoutDate: string;
  notes: string | null;
  orderIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [amountVal, setAmountVal] = useState(String(amount));
  const [dateVal, setDateVal] = useState(payoutDate);
  const [notesVal, setNotesVal] = useState(notes ?? "");

  function save() {
    startTransition(async () => {
      const result = await updatePayout({
        id,
        amount: amountVal,
        payout_date: dateVal,
        notes: notesVal,
        order_ids: orderIds, // linkage se ne menja odavde
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Uplata izmenjena.");
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deletePayout(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Uplata obrisana.");
      router.push("/finansije/uplate");
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="subtle" size="sm">
            <Pencil /> Izmeni
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Izmena uplate</DialogTitle>
            <DialogDescription>
              Iznos, datum i napomena. Vezane porudžbine se menjaju brisanjem i novom uplatom.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit_date">Datum uplate</Label>
              <Input
                id="edit_date"
                type="date"
                value={dateVal}
                onChange={(e) => setDateVal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_amount">Iznos (RSD)</Label>
              <Input
                id="edit_amount"
                inputMode="numeric"
                className="num text-right"
                value={amountVal}
                onChange={(e) => setAmountVal(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_notes">Napomena</Label>
              <Input
                id="edit_notes"
                value={notesVal}
                onChange={(e) => setNotesVal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="button" disabled={pending || amountVal === ""} onClick={save}>
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        trigger={
          <Button variant="danger" size="sm" disabled={pending}>
            <Trash2 /> Obriši
          </Button>
        }
        title="Obrisati uplatu?"
        description={'Vezane porudžbine se vraćaju na „neuplaćeno". Ova radnja se ne može opozvati.'}
        confirmLabel="Obriši"
        variant="danger"
        onConfirm={remove}
      />
    </div>
  );
}
