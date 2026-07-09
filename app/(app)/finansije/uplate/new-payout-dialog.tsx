"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { PayoutCandidate } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { belgradeDate, previousWorkingDay } from "@/lib/date-belgrade";
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

import { createPayout } from "../actions";

/*
 * Nova uplata (Korak 1.6a, Admin). Datum uplate → app izvede T−1 radni dan i
 * pred-čekira porudžbine isporučene tog dana; admin dočekira/odčekira. Baner
 * poredi Σ COD izabranih sa unetim iznosom (informativno, ne blokira).
 */
export function NewPayoutDialog({
  candidates,
  defaultDate,
}: {
  candidates: PayoutCandidate[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [payoutDate, setPayoutDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Dan za koji je selekcija pred-čekirana — okida ponovni preset pri promeni datuma.
  const [presetDay, setPresetDay] = useState<string | null>(null);

  const targetDay = useMemo(() => previousWorkingDay(payoutDate), [payoutDate]);

  // Pred-čekiraj porudžbine isporučene na T−1 radni dan pri otvaranju / promeni
  // datuma (state podešen tokom rendera — React obrazac za izvedeni preset, bez efekta).
  if (open && presetDay !== targetDay) {
    setPresetDay(targetDay);
    setSelected(
      new Set(
        candidates
          .filter((c) => c.delivered_at && belgradeDate(c.delivered_at) === targetDay)
          .map((c) => c.id),
      ),
    );
  }

  const codTotal = useMemo(
    () =>
      candidates
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + (c.cod_amount ?? 0), 0),
    [candidates, selected],
  );

  const amountNum = Number(amount) || 0;
  const diff = amountNum - codTotal;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await createPayout({
        amount,
        payout_date: payoutDate,
        notes,
        order_ids: [...selected],
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Uplata sačuvana.");
      setOpen(false);
      setAmount("");
      setNotes("");
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPresetDay(null); // sledeće otvaranje ponovo pred-čekira T−1
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nova uplata
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova uplata</DialogTitle>
          <DialogDescription>
            Unesi iznos i datum uplate; app pred-čekira porudžbine isporučene na T−1 radni dan
            ({datum(targetDay)}). Vezane porudžbine postaju {'„uplaćeno".'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="payout_date">Datum uplate</Label>
              <Input
                id="payout_date"
                type="date"
                value={payoutDate}
                onChange={(e) => setPayoutDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Iznos (RSD)</Label>
              <Input
                id="amount"
                inputMode="numeric"
                className="num text-right"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Napomena (opciono)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* Baner razlike */}
          <div
            className={
              "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm " +
              (diff === 0
                ? "border-success/30 bg-success-soft text-success"
                : "border-warning/30 bg-warning-soft text-warning")
            }
          >
            <span>
              Izabrano: <span className="num font-medium">{num(selected.size)}</span> · Σ COD{" "}
              <span className="num font-medium">{rsd(codTotal)}</span>
            </span>
            <span className="num font-semibold">
              Razlika: {diff === 0 ? "0 — poklapa se" : `${diff > 0 ? "+" : ""}${rsd(diff)}`}
            </span>
          </div>

          {/* Kandidati */}
          <div className="border-border divide-border max-h-72 divide-y overflow-y-auto rounded-lg border">
            {candidates.length === 0 ? (
              <p className="text-ink-soft px-4 py-6 text-sm">
                Nema isporučenih neuplaćenih XExpress porudžbina.
              </p>
            ) : (
              candidates.map((c) => {
                const isT1 = c.delivered_at && belgradeDate(c.delivered_at) === targetDay;
                return (
                  <label
                    key={c.id}
                    className="hover:bg-green-soft flex cursor-pointer items-center gap-3 px-4 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="accent-green size-4 cursor-pointer"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="num text-ink font-medium">
                      {c.woo_order_id != null ? `#${c.woo_order_id}` : "—"}
                    </span>
                    <span className="text-ink-soft min-w-0 flex-1 truncate text-sm">
                      {c.ship_name ?? "—"}
                    </span>
                    <span className="num text-ink-faint text-xs">
                      {c.delivered_at ? datum(c.delivered_at) : "—"}
                      {isT1 ? " · T−1" : ""}
                    </span>
                    <span className="num text-ink text-sm">{rsd(c.cod_amount ?? 0)}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            Otkaži
          </Button>
          <Button type="button" disabled={pending || amount === ""} onClick={submit}>
            Sačuvaj uplatu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
