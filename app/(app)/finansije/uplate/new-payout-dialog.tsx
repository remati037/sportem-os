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
 * poredi Σ otkupa izabranih sa unetim iznosom (informativno, ne blokira).
 * Naplaćena poštarina se može upisati na licu mesta (polje u redu) — kad je
 * zaboravljena na koraku „Poslato"; čuva se na porudžbini zajedno sa uplatom.
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
  // Poštarina upisana u dijalogu, po porudžbini (string — prazno polje = nije uneta).
  const [shipEdits, setShipEdits] = useState<Map<string, string>>(new Map());
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

  function shippingInput(c: PayoutCandidate): string {
    return shipEdits.get(c.id) ?? (c.shipping_charged != null ? String(c.shipping_charged) : "");
  }

  // Otkup = vrednost robe + poštarina (kao `otkupOf`, koji je server-only).
  function otkupNow(c: PayoutCandidate): number {
    const ship = shippingInput(c);
    return ship === "" ? c.otkup : (c.goods_total ?? 0) + Number(ship);
  }

  const chosen = candidates.filter((c) => selected.has(c.id));
  const otkupTotal = chosen.reduce((sum, c) => sum + otkupNow(c), 0);
  const missingShipping = chosen.filter((c) => shippingInput(c) === "").length;

  const amountNum = Number(amount) || 0;
  const diff = amountNum - otkupTotal;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function editShipping(id: string, value: string) {
    setShipEdits((prev) => new Map(prev).set(id, value));
    // Upis poštarine znači da porudžbina ulazi u uplatu.
    if (value !== "") setSelected((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function submit() {
    startTransition(async () => {
      const result = await createPayout({
        amount,
        payout_date: payoutDate,
        notes,
        order_ids: [...selected],
        // Samo izabrane, upisane i stvarno promenjene.
        shipping: chosen
          .filter((c) => {
            const v = shipEdits.get(c.id);
            return v != null && v !== "" && Number(v) !== c.shipping_charged;
          })
          .map((c) => ({ order_id: c.id, shipping_charged: shipEdits.get(c.id)! })),
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
      setShipEdits(new Map());
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
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
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
              Izabrano: <span className="num font-medium">{num(selected.size)}</span> · Σ otkup{" "}
              <span className="num font-medium">{rsd(otkupTotal)}</span>
            </span>
            {missingShipping > 0 && (
              <span className="w-full text-xs sm:order-last">
                {missingShipping === 1
                  ? "1 izabrana porudžbina nema upisanu poštarinu."
                  : `${num(missingShipping)} izabranih porudžbina nema upisanu poštarinu.`}
              </span>
            )}
            <span className="num font-semibold">
              Razlika: {diff === 0 ? "0 — poklapa se" : `${diff > 0 ? "+" : ""}${rsd(diff)}`}
            </span>
          </div>

          {/* Kandidati — poštarina se može upisati odmah (zaboravljena na „Poslato") */}
          {candidates.length > 0 && (
            <div className="eyebrow text-ink-faint -mb-2 hidden justify-end gap-3 px-4 sm:flex">
              <span className="w-24 text-right">Poštarina</span>
              <span className="w-24 text-right">Otkup</span>
            </div>
          )}
          <div className="border-border divide-border max-h-72 divide-y overflow-y-auto rounded-lg border">
            {candidates.length === 0 ? (
              <p className="text-ink-soft px-4 py-6 text-sm">
                Nema isporučenih neuplaćenih XExpress porudžbina.
              </p>
            ) : (
              candidates.map((c) => {
                const isT1 = c.delivered_at && belgradeDate(c.delivered_at) === targetDay;
                const ship = shippingInput(c);
                return (
                  <div
                    key={c.id}
                    className="hover:bg-green-soft flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
                  >
                    <label className="flex min-w-[14rem] flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="accent-green size-4 shrink-0 cursor-pointer"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="num text-ink font-medium">
                        {c.woo_order_id != null ? `#${c.woo_order_id}` : "—"}
                      </span>
                      <span className="text-ink-soft min-w-0 flex-1 truncate text-sm">
                        {c.ship_name ?? "—"}
                      </span>
                      <span className="num text-ink-faint text-xs whitespace-nowrap">
                        {c.delivered_at ? datum(c.delivered_at) : "—"}
                        {isT1 ? " · T−1" : ""}
                      </span>
                    </label>
                    <div className="ml-7 flex flex-1 items-center justify-between gap-3 sm:ml-0 sm:flex-none">
                      <Input
                        aria-label={`Poštarina za porudžbinu ${c.woo_order_id ?? ""}`}
                        title="Naplaćena poštarina (RSD)"
                        inputMode="numeric"
                        className={
                          "num h-8 w-24 text-right text-sm " +
                          (ship === "" ? "border-warning/60 bg-warning-soft" : "")
                        }
                        value={ship}
                        onChange={(e) => editShipping(c.id, e.target.value.replace(/\D/g, ""))}
                        placeholder="Poštarina"
                      />
                      <span className="num text-ink w-24 text-right text-sm">
                        {rsd(otkupNow(c))}
                      </span>
                    </div>
                  </div>
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
