"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { PayoutInvoiceCandidate, PayoutSettlement } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { setCashReceived, setPayoutSettlement } from "../actions";

/*
 * Nefakturisane uplate: za svaku Admin bira način naplate zarade (faktura / keš)
 * i stopu poreza koji se ODUZIMA od zarade. Keš uplata izlazi iz „Za
 * fakturisanje"; kad drug da keš, označi se „Keš primljen". Menadžer samo čita.
 */

/** Bazni poeni → prikaz procenta („10", „12,5"). */
function bpToPercent(bp: number): string {
  if (bp === 0) return "";
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export function PayoutSettlementList({
  payouts,
  isAdmin,
}: {
  payouts: PayoutInvoiceCandidate[];
  isAdmin: boolean;
}) {
  if (payouts.length === 0) {
    return <p className="text-ink-soft px-4 py-6 text-sm">Nema nefakturisanih uplata.</p>;
  }
  return (
    <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
      {payouts.map((p) => (
        <SettlementRow key={`${p.id}:${p.settlement}:${p.tax_rate_bp}`} payout={p} isAdmin={isAdmin} />
      ))}
    </div>
  );
}

function SettlementRow({ payout, isAdmin }: { payout: PayoutInvoiceCandidate; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [settlement, setSettlement] = useState<PayoutSettlement>(payout.settlement);
  const [taxInput, setTaxInput] = useState(bpToPercent(payout.tax_rate_bp));

  const savedTax = bpToPercent(payout.tax_rate_bp);
  const dirty = settlement !== payout.settlement || taxInput.trim() !== savedTax;

  // Živ pregled poreza dok se kuca (samo prikaz; server ponovo računa).
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(taxInput.trim());
  const previewBp = taxInput.trim() === "" ? 0 : m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
  const previewTax =
    previewBp != null && previewBp <= 10000 && payout.profit > 0
      ? Math.round((payout.profit * previewBp) / 10000)
      : null;

  function save() {
    startTransition(async () => {
      const res = await setPayoutSettlement({
        payout_id: payout.id,
        settlement,
        tax_percent: taxInput,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.success ?? "Sačuvano.");
      router.refresh();
    });
  }

  function toggleReceived() {
    startTransition(async () => {
      const res = await setCashReceived({
        payout_id: payout.id,
        received: !payout.cash_received_at,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.success ?? "Sačuvano.");
      router.refresh();
    });
  }

  const tax = previewTax ?? payout.tax;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-[9rem] flex-1">
        <Link
          href={`/finansije/uplate/${payout.id}`}
          className="num text-ink font-medium underline-offset-2 hover:underline"
        >
          {datum(payout.payout_date)}
        </Link>
        <div className="text-ink-soft text-xs">
          {num(payout.linkedCount)} porudžbina
          {payout.settlement === "kes" ? (
            payout.cash_received_at ? (
              <Badge variant="success" className="ml-2 align-middle">
                Keš primljen
              </Badge>
            ) : (
              <Badge variant="warning" className="ml-2 align-middle">
                Keš — čeka
              </Badge>
            )
          ) : null}
        </div>
      </div>

      <div className="num text-right text-sm sm:w-48">
        <div className="text-ink">{rsd(payout.profit)}</div>
        {tax > 0 ? (
          <div className="text-ink-soft text-xs">
            − {rsd(tax)} porez = <span className="text-ink font-medium">{rsd(payout.profit - tax)}</span>
          </div>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="border-border inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Način naplate">
            {(["faktura", "kes"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={settlement === v}
                onClick={() => setSettlement(v)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  settlement === v ? "bg-green text-white" : "text-ink-soft hover:text-ink",
                )}
              >
                {v === "faktura" ? "Faktura" : "Keš"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input
              aria-label="Porez u procentima"
              inputMode="decimal"
              value={taxInput}
              onChange={(e) => setTaxInput(e.target.value)}
              placeholder="0"
              className="num h-8 w-16 text-right"
            />
            <span className="text-ink-soft text-xs">% porez</span>
          </div>
          <Button size="sm" disabled={!dirty || pending} onClick={save}>
            Sačuvaj
          </Button>
          {payout.settlement === "kes" && !dirty ? (
            <Button size="sm" variant="subtle" disabled={pending} onClick={toggleReceived}>
              {payout.cash_received_at ? "Poništi primljen" : "Keš primljen"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="text-ink-soft text-xs">
          {payout.settlement === "kes" ? "Keš" : "Faktura"}
          {payout.tax_rate_bp > 0 ? ` · porez ${bpToPercent(payout.tax_rate_bp)} %` : ""}
        </div>
      )}
    </div>
  );
}
