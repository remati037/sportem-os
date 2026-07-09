"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { InvoiceCandidate } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { belgradeDate, todayBelgrade } from "@/lib/date-belgrade";
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

import { issueInvoice } from "../actions";

/*
 * Nova faktura drugu (Korak 1.6b, Admin). Kandidati (uplaćene nefakturisane
 * XExpress porudžbine) su podrazumevano svi čekirani; total = Σ zamrznute zarade.
 * Broj fakture je ručni; period se predlaže iz datuma isporuke izabranih.
 */
export function IssueInvoicePanel({ candidates }: { candidates: InvoiceCandidate[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  // Da li je korisnik ručno menjao period (ne prepisuj ga tada iz selekcije).
  const [periodTouched, setPeriodTouched] = useState(false);
  const [presetDone, setPresetDone] = useState(false);

  // Pri otvaranju pred-čekiraj sve kandidate (React obrazac za izvedeni preset).
  if (open && !presetDone) {
    setPresetDone(true);
    setSelected(new Set(candidates.map((c) => c.id)));
  }

  const total = useMemo(
    () =>
      candidates.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + c.profit, 0),
    [candidates, selected],
  );

  // Predloži period iz min/max datuma isporuke izabranih (dok ga korisnik ne dotakne).
  const suggestedPeriod = useMemo(() => {
    const days = candidates
      .filter((c) => selected.has(c.id) && c.delivered_at)
      .map((c) => belgradeDate(c.delivered_at!))
      .sort();
    if (days.length === 0) return null;
    return { from: days[0], to: days[days.length - 1] };
  }, [candidates, selected]);

  const effFrom = periodTouched ? periodFrom : (suggestedPeriod?.from ?? periodFrom);
  const effTo = periodTouched ? periodTo : (suggestedPeriod?.to ?? periodTo);

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
      const result = await issueInvoice({
        invoice_number: invoiceNumber,
        period_from: effFrom || todayBelgrade(),
        period_to: effTo || todayBelgrade(),
        order_ids: [...selected],
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Faktura izdata.");
      setOpen(false);
      setInvoiceNumber("");
      setSelected(new Set());
      setPeriodTouched(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPresetDone(false); // sledeće otvaranje ponovo pred-čekira sve
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={candidates.length === 0}>
          <Plus /> Nova faktura
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova faktura drugu</DialogTitle>
          <DialogDescription>
            Uplaćene nefakturisane porudžbine. Total = Σ zarada izabranih (zamrznuto). Izabrane
            porudžbine dobijaju broj fakture i zaključavaju stavke.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice_number">Broj fakture</Label>
              <Input
                id="invoice_number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="npr. 2026-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period_from">Period od</Label>
              <Input
                id="period_from"
                type="date"
                value={effFrom}
                onChange={(e) => {
                  setPeriodTouched(true);
                  setPeriodFrom(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period_to">Period do</Label>
              <Input
                id="period_to"
                type="date"
                value={effTo}
                onChange={(e) => {
                  setPeriodTouched(true);
                  setPeriodTo(e.target.value);
                }}
              />
            </div>
          </div>

          {/* Zbir zarade */}
          <div className="border-green/30 bg-green-soft text-green flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm">
            <span>
              Izabrano: <span className="num font-medium">{num(selected.size)}</span> porudžbina
            </span>
            <span className="num font-semibold">Zarada: {rsd(total)}</span>
          </div>

          {/* Kandidati */}
          <div className="border-border divide-border max-h-72 divide-y overflow-y-auto rounded-lg border">
            {candidates.length === 0 ? (
              <p className="text-ink-soft px-4 py-6 text-sm">Nema kandidata za fakturu.</p>
            ) : (
              candidates.map((c) => (
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
                  </span>
                  <span className="num text-ink text-sm">{rsd(c.profit)}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            Otkaži
          </Button>
          <Button
            type="button"
            disabled={pending || invoiceNumber.trim() === "" || selected.size === 0}
            onClick={submit}
          >
            Izdaj fakturu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
