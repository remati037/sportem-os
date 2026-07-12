"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";

import type { OrderListRow } from "@/db/orders";
import { rsd, datum } from "@/lib/format";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { StatusPill } from "./status-pill";
import { markOrdersShipped } from "./actions";

/*
 * Lista porudžbina sa selekcijom (Korak 1.5) — čekboks po redu + bulk akcije:
 * PDF „lista za slanje" i „Označi poslato". Klik na broj vodi na detalj; čekboks
 * je izolovan (z-10 + stopPropagation) da ne okine navigaciju preko celog reda.
 */
export function OrdersBulkTable({ orders }: { orders: OrderListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pageIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const allSelected = selected.size > 0 && pageIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageIds.every((id) => next.has(id))) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function openPdf() {
    const ids = [...selected].join(",");
    window.open(`/api/porudzbine/lista-za-slanje?ids=${ids}`, "_blank", "noopener");
  }

  function markShipped() {
    startTransition(async () => {
      const result = await markOrdersShipped([...selected]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Označeno poslato.");
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {selected.size > 0 ? (
        <div className="border-border bg-surface-2 mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5">
          <span className="text-ink num text-sm font-medium">Izabrano: {selected.size}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="subtle" disabled={pending} onClick={openPdf}>
              <FileText /> PDF lista za slanje
            </Button>
            <Button size="sm" disabled={pending} onClick={markShipped}>
              <Send /> Označi poslato
            </Button>
          </div>
        </div>
      ) : null}

      {/* Desktop tabela */}
      <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="bg-surface-2 h-9 w-10 px-4">
                <input
                  type="checkbox"
                  aria-label="Izaberi sve na strani"
                  className="accent-green size-4 cursor-pointer align-middle"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Br.</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Kupac</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Status</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Iznos</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id} className="border-border hover:bg-green-soft relative">
                <TableCell className="relative z-10 w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Izaberi porudžbinu ${o.woo_order_id ?? ""}`}
                    className="accent-green size-4 cursor-pointer align-middle"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <Link href={`/porudzbine/${o.id}`} className="after:absolute after:inset-0">
                    <span className="num text-ink font-medium">
                      {o.woo_order_id != null ? `#${o.woo_order_id}` : "—"}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="num text-ink-soft px-4 py-2.5">
                  {o.ordered_at ? datum(o.ordered_at) : "—"}
                </TableCell>
                <TableCell className="text-ink px-4 py-2.5">
                  {o.ship_name ?? o.customer?.name ?? "—"}
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  {o.status ? <StatusPill name={o.status.name} color={o.status.color} /> : "—"}
                </TableCell>
                <TableCell className="num px-4 py-2.5 text-right">
                  {o.goods_total != null ? rsd(o.goods_total) : "—"}
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <span className="flex items-center justify-end gap-1.5">
                    {o.needs_vp ? <Badge variant="warning">Nedostaje VP</Badge> : null}
                    {o.needs_review ? <Badge variant="danger">Za proveru</Badge> : null}
                    {o.risky_cancel_count > 0 ? (
                      <Badge variant="danger">
                        Rizičan kupac{o.risky_cancel_count > 1 ? ` (${o.risky_cancel_count})` : ""}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobilne kartice */}
      <MobileCardList>
        {orders.map((o) => (
          <MobileCard
            key={o.id}
            href={`/porudzbine/${o.id}`}
            ariaLabel={`Porudžbina ${o.woo_order_id ?? ""}`}
          >
            <MobileCardHeader
              leading={
                <input
                  type="checkbox"
                  aria-label={`Izaberi porudžbinu ${o.woo_order_id ?? ""}`}
                  className="accent-green mt-1 size-4 cursor-pointer"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              }
              title={<span className="num">{o.woo_order_id != null ? `#${o.woo_order_id}` : "—"}</span>}
              subtitle={
                <span>
                  {o.ordered_at ? datum(o.ordered_at) : "—"} · {o.ship_name ?? o.customer?.name ?? "—"}
                </span>
              }
              trailing={o.status ? <StatusPill name={o.status.name} color={o.status.color} /> : null}
            />
            <div className="mt-3 space-y-1.5">
              <MobileCardField label="Iznos">
                <span className="num font-medium">{o.goods_total != null ? rsd(o.goods_total) : "—"}</span>
              </MobileCardField>
              {o.needs_vp || o.needs_review || o.risky_cancel_count > 0 ? (
                <div className="relative z-10 flex flex-wrap gap-1.5">
                  {o.needs_vp ? <Badge variant="warning">Nedostaje VP</Badge> : null}
                  {o.needs_review ? <Badge variant="danger">Za proveru</Badge> : null}
                  {o.risky_cancel_count > 0 ? (
                    <Badge variant="danger">
                      Rizičan kupac{o.risky_cancel_count > 1 ? ` (${o.risky_cancel_count})` : ""}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
    </>
  );
}
