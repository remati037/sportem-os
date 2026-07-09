"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote, Send, PackageCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

import type { OrderStatusRow } from "@/db/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { changeOrderStatus, markCashSale, resolveReview, type OrderActionState } from "../actions";

const initial: OrderActionState = { error: null };

/** Poznati (seed) statusi toka — ids se razrešavaju po imenu na serveru. */
export type FlowIds = {
  created?: string;
  sent?: string;
  delivered?: string;
  cancelled?: string;
};

/*
 * Promena statusa porudžbine kroz tok (Korak 1.4) — Admin + Menadžer. Keš/lična
 * prodaja je Admin-only (dira novac). Sve ide kroz server akciju sa
 * service-role klijentom; zamrznute cene se ne diraju.
 */
export function OrderStatusControl({
  orderId,
  currentStatusId,
  statuses,
  flow,
  canCashSale,
}: {
  orderId: string;
  currentStatusId: string | null;
  statuses: OrderStatusRow[];
  flow: FlowIds;
  canCashSale: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manualStatus, setManualStatus] = useState(currentStatusId ?? "");
  const [note, setNote] = useState("");

  function run(fn: () => Promise<OrderActionState>, onOk?: () => void) {
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

  function changeTo(statusId: string, statusNote?: string) {
    const fd = new FormData();
    fd.set("order_id", orderId);
    fd.set("status_id", statusId);
    if (statusNote) fd.set("note", statusNote);
    run(() => changeOrderStatus(initial, fd));
  }

  const isCancelled = currentStatusId === flow.cancelled;

  return (
    <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
      <h2 className="eyebrow mb-3">Status i tok</h2>

      {/* Brze akcije toka */}
      <div className="flex flex-wrap gap-2">
        {flow.sent && currentStatusId !== flow.sent && !isCancelled ? (
          <Button size="sm" disabled={pending} onClick={() => changeTo(flow.sent!)}>
            <Send /> Označi poslato
          </Button>
        ) : null}
        {flow.delivered && currentStatusId !== flow.delivered && !isCancelled ? (
          <Button
            size="sm"
            variant={currentStatusId === flow.sent ? "primary" : "subtle"}
            disabled={pending}
            onClick={() => changeTo(flow.delivered!)}
          >
            <PackageCheck /> Označi isporučeno
          </Button>
        ) : null}
        {flow.cancelled && !isCancelled ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm("Otkazati/vratiti porudžbinu?")) changeTo(flow.cancelled!);
            }}
          >
            <Undo2 /> Otkaži/Vrati
          </Button>
        ) : null}
        {canCashSale ? (
          <Button
            size="sm"
            variant="subtle"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  "Označiti kao keš/ličnu prodaju? Postavlja Lično + Isplaćeno + Isporučeno i ne ulazi u fakturu.",
                )
              ) {
                const fd = new FormData();
                fd.set("order_id", orderId);
                run(() => markCashSale(initial, fd));
              }
            }}
          >
            <Banknote /> Keš / Isplaćeno
          </Button>
        ) : null}
      </div>

      {/* Ručna promena na bilo koji status + napomena */}
      <div className="border-border mt-4 space-y-2 border-t pt-4">
        <Label className="text-ink-faint text-xs">Ručna promena statusa</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={manualStatus} onValueChange={setManualStatus}>
            <SelectTrigger className="h-9 w-full sm:w-48">
              <SelectValue placeholder="Izaberi status…" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Napomena (opciono)"
            className="h-9 w-full sm:flex-1"
          />
          <Button
            size="sm"
            variant="subtle"
            disabled={pending || !manualStatus || manualStatus === currentStatusId}
            onClick={() => changeTo(manualStatus, note.trim() || undefined)}
            className="w-full sm:w-auto"
          >
            Sačuvaj
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Dugme „Razreši" za needs_review callout (Admin + Menadžer). */
export function ResolveReviewButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="subtle"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await resolveReview(orderId);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.success ?? "Razrešeno.");
          router.refresh();
        })
      }
    >
      Razreši
    </Button>
  );
}
