"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import type { XexpressCandidate, XexpressOrderLine } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createXexpressInvoice, updateXexpressInvoice } from "../../actions";

/*
 * Forma XExpress fakture poštarine (Admin). Odaberi porudžbine sa specifikacije,
 * unesi naplaćenu (kupcu) i stvarnu poštarinu (osnovicu, bez PDV-a) po porudžbini.
 * App dodaje 20% PDV i računa zaradu/gubitak (naplaćeno vs osnovica + PDV). Radi
 * u create i edit modu (edit pred-čekira već vezane porudžbine sa vrednostima).
 */

const VAT_RATE = 20;
const pdvOf = (base: number) => Math.round((base * VAT_RATE) / 100);

type SelectableOrder = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  ship_name: string | null;
  shipping_charged: number | null;
  shipping_actual: number | null;
};

type EditInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  period_from: string | null;
  period_to: string | null;
  notes: string | null;
};

const toStr = (n: number | null | undefined) => (n != null ? String(n) : "");

export function XexpressInvoiceForm({
  today,
  candidates,
  invoice,
  linked = [],
}: {
  today: string;
  candidates: XexpressCandidate[];
  invoice?: EditInvoice;
  linked?: XexpressOrderLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!invoice;

  // Već vezane porudžbine (edit) idu prve i pred-čekirane su.
  const orders: SelectableOrder[] = useMemo(
    () => [
      ...linked.map((l) => ({
        id: l.id,
        woo_order_id: l.woo_order_id,
        ordered_at: l.ordered_at,
        ship_name: l.ship_name,
        shipping_charged: l.shipping_charged,
        shipping_actual: l.shipping_actual,
      })),
      ...candidates,
    ],
    [linked, candidates],
  );

  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoice_date ?? today);
  const [periodFrom, setPeriodFrom] = useState(invoice?.period_from ?? "");
  const [periodTo, setPeriodTo] = useState(invoice?.period_to ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(linked.map((l) => l.id)),
  );
  // Pred-popuni naplaćenu i osnovicu iz postojećih vrednosti porudžbine.
  const [chargeds, setChargeds] = useState<Record<string, string>>(() =>
    Object.fromEntries([...linked, ...candidates].map((o) => [o.id, toStr(o.shipping_charged)])),
  );
  const [actuals, setActuals] = useState<Record<string, string>>(() =>
    Object.fromEntries([...linked, ...candidates].map((o) => [o.id, toStr(o.shipping_actual)])),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pnl = useMemo(() => {
    let naplaceno = 0;
    let osnovica = 0;
    let pdv = 0;
    for (const o of orders) {
      if (!selected.has(o.id)) continue;
      naplaceno += Number(chargeds[o.id]) || 0;
      const base = Number(actuals[o.id]) || 0;
      osnovica += base;
      pdv += pdvOf(base);
    }
    const ukupno = osnovica + pdv;
    return { naplaceno, osnovica, pdv, ukupno, rezultat: naplaceno - ukupno };
  }, [orders, selected, chargeds, actuals]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        String(o.woo_order_id ?? "").includes(q) ||
        (o.ship_name ?? "").toLowerCase().includes(q),
    );
  }, [orders, search]);

  function submit() {
    const chosen = [...selected].map((id) => ({
      order_id: id,
      shipping_charged: Number(chargeds[id]) || 0,
      shipping_actual: Number(actuals[id]) || 0,
    }));
    if (chosen.length === 0) {
      toast.error("Izaberite bar jednu porudžbinu.");
      return;
    }
    const payload = {
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      period_from: periodFrom,
      period_to: periodTo,
      notes,
      orders: chosen,
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateXexpressInvoice({ ...payload, id: invoice.id })
        : await createXexpressInvoice(payload);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      if (isEdit) {
        router.push(`/finansije/postarina/fakture/${invoice.id}`);
      } else {
        router.push("/finansije/postarina");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Header fakture */}
      <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
        <h2 className="eyebrow mb-3">Podaci fakture</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="x_number">Broj XExpress fakture (opciono)</Label>
            <Input
              id="x_number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="npr. 2026-1234"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="x_date">Datum fakture</Label>
            <Input
              id="x_date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="x_from">Period od (opciono)</Label>
            <Input
              id="x_from"
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="x_to">Period do (opciono)</Label>
            <Input
              id="x_to"
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="x_notes">Napomena (opciono)</Label>
            <Input id="x_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      {/* P&L rezime */}
      <section className="border-border bg-surface shadow-soft grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-5">
        <Stat label="Naplaćeno kupcima" value={rsd(pnl.naplaceno)} />
        <Stat label="Osnovica" value={rsd(pnl.osnovica)} />
        <Stat label={`PDV ${VAT_RATE}%`} value={rsd(pnl.pdv)} />
        <Stat label="Ukupno XExpress" value={rsd(pnl.ukupno)} />
        <Stat
          label="Rezultat"
          value={pnl.rezultat === 0 ? "0" : `${pnl.rezultat > 0 ? "+" : ""}${rsd(pnl.rezultat)}`}
          tone={pnl.rezultat >= 0 ? "success" : "warning"}
        />
      </section>

      {/* Izbor porudžbina + unos poštarine */}
      <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow">Porudžbine sa specifikacije</h2>
          <span className="text-ink-faint text-xs">
            Izabrano: <span className="num">{num(selected.size)}</span> · Ukupno{" "}
            <span className="num">{num(orders.length)}</span>
          </span>
        </div>

        <div className="relative mb-3">
          <Search className="text-ink-faint pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pretraga po broju porudžbine ili kupcu…"
          />
        </div>

        {orders.length === 0 ? (
          <p className="text-ink-soft py-4 text-sm">
            Nema dostavljenih XExpress porudžbina koje već nisu na nekoj fakturi.
          </p>
        ) : (
          <div className="border-border divide-border max-h-128 divide-y overflow-y-auto rounded-lg border">
            {visible.length === 0 ? (
              <p className="text-ink-soft px-4 py-6 text-sm">Nema rezultata za pretragu.</p>
            ) : (
              visible.map((o) => {
                const isSel = selected.has(o.id);
                const base = Number(actuals[o.id]) || 0;
                return (
                  <div
                    key={o.id}
                    className={"px-3 py-2.5 " + (isSel ? "bg-green-soft" : "")}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="accent-green size-4 cursor-pointer"
                        checked={isSel}
                        onChange={() => toggle(o.id)}
                      />
                      <span className="num text-ink w-16 font-medium">
                        {o.woo_order_id != null ? `#${o.woo_order_id}` : "—"}
                      </span>
                      <span className="text-ink-soft min-w-0 flex-1 truncate text-sm">
                        {o.ship_name ?? "—"}
                      </span>
                      <span className="num text-ink-faint hidden text-xs sm:inline">
                        {o.ordered_at ? datum(o.ordered_at) : "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-7">
                      <label className="flex items-center gap-1.5">
                        <span className="text-ink-faint text-xs">Naplaćeno</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="num h-8 w-24 text-right"
                          value={chargeds[o.id] ?? ""}
                          onChange={(e) =>
                            setChargeds((prev) => ({ ...prev, [o.id]: e.target.value }))
                          }
                          placeholder="0"
                          disabled={!isSel}
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-ink-faint text-xs">Osnovica</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="num h-8 w-24 text-right"
                          value={actuals[o.id] ?? ""}
                          onChange={(e) =>
                            setActuals((prev) => ({ ...prev, [o.id]: e.target.value }))
                          }
                          placeholder="0"
                          disabled={!isSel}
                        />
                      </label>
                      <span className="text-ink-faint text-xs">+PDV {rsd(pdvOf(base))}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="subtle"
          onClick={() =>
            router.push(
              isEdit ? `/finansije/postarina/fakture/${invoice.id}` : "/finansije/postarina",
            )
          }
        >
          Otkaži
        </Button>
        <Button type="button" disabled={pending || selected.size === 0} onClick={submit}>
          {isEdit ? "Sačuvaj izmene" : "Sačuvaj fakturu"}
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}) {
  return (
    <div className="border-border bg-surface-2 rounded-lg border px-3 py-2.5">
      <div className="text-ink-faint text-xs">{label}</div>
      <div
        className={
          "num mt-0.5 text-base font-semibold " +
          (tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
