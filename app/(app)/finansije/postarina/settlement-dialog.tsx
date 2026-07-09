"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Coins } from "lucide-react";
import { toast } from "sonner";

import { rsd } from "@/lib/format";
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

import { settlePostage } from "../actions";

/*
 * Poravnanje salda poštarine (Korak 1.6c, Admin). Iznos je pred-popunjen
 * trenutnim saldom → „Poravnato keš" (klik snimi = saldo na 0), ali se sme
 * izmeniti. Iznos ide sa predznakom (saldo može biti negativan).
 */
export function SettlementDialog({ balance }: { balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [amount, setAmount] = useState(String(balance));
  const [notes, setNotes] = useState("");
  const [presetDone, setPresetDone] = useState(false);

  // Pri otvaranju pred-popuni iznos trenutnim saldom (poravnanje na nulu).
  if (open && !presetDone) {
    setPresetDone(true);
    setAmount(String(balance));
  }

  function submit() {
    startTransition(async () => {
      const result = await settlePostage({ amount, notes });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Poravnanje sačuvano.");
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  const parsed = Number(amount);
  const newBalance = Number.isFinite(parsed) ? balance - parsed : balance;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPresetDone(false);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Coins /> Poravnaj keš
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Poravnanje poštarine</DialogTitle>
          <DialogDescription>
            Iznos je pred-popunjen trenutnim saldom ({rsd(balance)}) — snimi da ga svedeš na nulu,
            ili unesi drugačiji iznos. Poravnanje je sa predznakom.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settle_amount">Iznos poravnanja (RSD)</Label>
            <Input
              id="settle_amount"
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="border-border bg-surface-2 text-ink-soft flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm">
            <span>Saldo posle poravnanja</span>
            <span
              className={"num font-semibold " + (newBalance === 0 ? "text-success" : "text-warning")}
            >
              {newBalance === 0 ? "0" : `${newBalance > 0 ? "+" : ""}${rsd(newBalance)}`}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settle_notes">Napomena (opciono)</Label>
            <Input
              id="settle_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="npr. isplaćeno drugu u kešu"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            Otkaži
          </Button>
          <Button type="button" disabled={pending || amount.trim() === ""} onClick={submit}>
            Sačuvaj poravnanje
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
