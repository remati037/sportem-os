"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, FileText, Send } from "lucide-react";
import { toast } from "sonner";

import type { OrderListRow, OrderStatusRow } from "@/db/orders";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { StatusPill } from "./status-pill";
import { markOrdersShipped, changeOrdersStatus } from "./actions";
import type { FlowIds } from "./[id]/order-status-control";

/*
 * Lista porudžbina sa selekcijom (Korak 1.5) — čekboks po redu + bulk akcije
 * kroz „Akcije" dropdown: promena statusa (svi osim Poslato), „Označi poslato"
 * i PDF „lista za slanje". Klik na broj vodi na detalj; čekboks je izolovan
 * (z-10 + stopPropagation) da ne okine navigaciju preko celog reda.
 */
export function OrdersBulkTable({
  orders,
  statuses,
  flow,
}: {
  orders: OrderListRow[];
  statuses: OrderStatusRow[];
  flow: FlowIds;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk promena statusa: izabrani ciljni status + (obavezan) razlog za Otkazano/Vraćeno.
  const [intent, setIntent] = useState<{ statusId: string; statusName: string; needsReason: boolean } | null>(
    null,
  );
  const [reason, setReason] = useState("");

  const pageIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const allSelected = selected.size > 0 && pageIds.every((id) => selected.has(id));

  // Statusi ponuđeni u „Promeni status na" — svi osim Poslato („Označi poslato"
  // je zasebna stavka sa svojim needs_review skip-om).
  const statusChoices = statuses.filter((s) => s.id !== flow.sent);

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

  function pickStatus(status: OrderStatusRow) {
    setReason("");
    setIntent({
      statusId: status.id,
      statusName: status.name,
      needsReason: status.id === flow.cancelled || status.id === flow.returned,
    });
  }

  function confirmStatusChange() {
    if (!intent) return;
    const note = reason.trim();
    startTransition(async () => {
      const result = await changeOrdersStatus([...selected], intent.statusId, note || undefined);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Status promenjen.");
      setSelected(new Set());
      setIntent(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      {selected.size > 0 ? (
        <div className="border-border bg-surface-2 mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5">
          <span className="text-ink num text-sm font-medium">Izabrano: {selected.size}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={pending}>
                  Akcije <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={markShipped}>
                  <Send /> Označi poslato
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openPdf}>
                  <FileText /> PDF lista za slanje
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Promeni status na</DropdownMenuLabel>
                {statusChoices.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => pickStatus(s)}>
                    <StatusPill name={s.name} color={s.color} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}

      {/* Bulk promena statusa — potvrda + (obavezan) razlog za Otkazano/Vraćeno. */}
      <Dialog
        open={intent !== null}
        onOpenChange={(o) => {
          if (!o) {
            setIntent(null);
            setReason("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Promeniti status za {selected.size} porudžbina?</DialogTitle>
            <DialogDescription>
              {intent ? `Novi status: „${intent.statusName}".` : null}
              {intent?.needsReason
                ? " Plaćene/fakturisane porudžbine se preskaču — za njih otkaži/vrati pojedinačno."
                : null}
            </DialogDescription>
          </DialogHeader>
          {intent?.needsReason ? (
            <div className="space-y-2">
              <Label htmlFor="bulk-reason" className="text-ink-faint text-xs">
                Razlog (obavezno)
              </Label>
              <Textarea
                id="bulk-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Zašto se porudžbine otkazuju/vraćaju?"
                autoFocus
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                setIntent(null);
                setReason("");
              }}
            >
              Odustani
            </Button>
            <Button
              type="button"
              variant={intent?.needsReason ? "danger" : "primary"}
              disabled={pending || (intent?.needsReason ? !reason.trim() : false)}
              onClick={confirmStatusChange}
            >
              Promeni status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Link href={`/porudzbine/${o.woo_order_id ?? o.id}`} className="after:absolute after:inset-0">
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
            href={`/porudzbine/${o.woo_order_id ?? o.id}`}
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
