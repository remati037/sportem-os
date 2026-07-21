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
 * Uplata poštarine (Korak 1.6c, Admin). Iznos je pred-popunjen trenutnim saldom
 * → klik snimi = saldo na 0, ali se sme izmeniti. Iznos ide sa predznakom:
 * plus = Simić uplaćuje Sportem-u (bili smo u plusu); minus = Sportem uplaćuje
 * Simiću (bili smo u minusu — taj trošak Admin ručno unese u Troškove).
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
      toast.success(result.success ?? "Uplata sačuvana.");
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  const parsed = Number(amount);
  const newBalance = Number.isFinite(parsed) ? balance - parsed : balance;

  const smer =
    balance > 0
      ? `Simić ti uplaćuje ${rsd(balance)}.`
      : balance < 0
        ? `Ti uplaćuješ Simiću ${rsd(Math.abs(balance))} (dodaj ručno kao trošak).`
        : "Saldo je na nuli — nema šta da se uplati.";

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
          <Coins /> Uplata poštarine
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uplata poštarine</DialogTitle>
          <DialogDescription>
            {smer} Iznos je pred-popunjen trenutnim saldom — snimi da ga svedeš na nulu, ili unesi
            drugačiji iznos. Iznos je sa predznakom (plus = Simić uplaćuje, minus = uplata Simiću).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settle_amount">Iznos uplate (RSD)</Label>
            <Input
              id="settle_amount"
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="border-border bg-surface-2 text-ink-soft flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm">
            <span>Saldo posle uplate</span>
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
              placeholder="npr. Simić uplatio u kešu"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            Otkaži
          </Button>
          <Button type="button" disabled={pending || amount.trim() === ""} onClick={submit}>
            Sačuvaj uplatu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
