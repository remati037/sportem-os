"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatRateBp, type TaxRate } from "@/lib/tax";

import { deleteTaxMonth, upsertTaxMonth, type SettingsActionState } from "./actions";

const initial: SettingsActionState = { error: null };

const monthFmt = new Intl.DateTimeFormat("sr-Latn-RS", { month: "long", year: "numeric", timeZone: "UTC" });

function monthLabel(month: string): string {
  const s = monthFmt.format(new Date(`${month}-01T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** „2000" bp → „20" (za polje forme). */
function bpToInput(bp: number): string {
  return formatRateBp(bp).replace(" %", "");
}

/*
 * Porez po mesecu (Dashboard „Posle poreza"). Admin piše, Menadžer samo čita.
 * Mesec bez upisa = 0 %. Keš porudžbine se nikad ne oporezuju.
 */
export function TaxSettings({
  rates,
  canEdit,
  currentMonth,
}: {
  rates: TaxRate[];
  canEdit: boolean;
  currentMonth: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<SettingsActionState>, onOk?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      onOk?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <TaxFormDialog
            defaultMonth={currentMonth}
            pending={pending}
            run={run}
            trigger={
              <Button>
                <Plus /> Dodaj mesec
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
        {rates.length === 0 ? (
          <p className="text-ink-soft px-4 py-6 text-sm">
            Nijedan mesec nema upisan porez — zarada na Dashboardu je ista pre i posle poreza.
          </p>
        ) : (
          rates.map((r) => (
            <div key={r.month} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-ink text-sm font-medium">{monthLabel(r.month)}</span>
              <span className="num text-ink ml-auto text-sm font-semibold">{formatRateBp(r.rateBp)}</span>
              {canEdit ? (
                <>
                  <TaxFormDialog
                    rate={r}
                    defaultMonth={r.month}
                    pending={pending}
                    run={run}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label="Izmeni stopu">
                        <Pencil />
                      </Button>
                    }
                  />
                  <Button
                    variant="danger"
                    size="icon-sm"
                    disabled={pending}
                    aria-label="Obriši stopu"
                    onClick={() => {
                      if (confirm(`Obrisati porez za ${monthLabel(r.month).toLowerCase()}?`)) {
                        run(() => deleteTaxMonth(r.month));
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TaxFormDialog({
  rate,
  defaultMonth,
  pending,
  run,
  trigger,
}: {
  rate?: TaxRate;
  defaultMonth: string;
  pending: boolean;
  run: (fn: () => Promise<SettingsActionState>, onOk?: () => void) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (rate) fd.set("month", rate.month);
    run(
      () => upsertTaxMonth(initial, fd),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{rate ? `Porez — ${monthLabel(rate.month)}` : "Porez za mesec"}</DialogTitle>
          <DialogDescription>
            Odbija se od zarade porudžbina kreiranih u tom mesecu. Keš porudžbine se ne oporezuju.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="month">Mesec</Label>
            <Input
              id="month"
              name="month"
              type="month"
              required
              disabled={!!rate}
              defaultValue={defaultMonth}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax_percent">Porez (%)</Label>
            <Input
              id="tax_percent"
              name="tax_percent"
              inputMode="decimal"
              required
              placeholder="npr. 20"
              defaultValue={rate ? bpToInput(rate.rateBp) : ""}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              Sačuvaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
