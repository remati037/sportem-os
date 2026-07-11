import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getInvoiceDetail } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { InvoiceActions } from "./invoice-actions";
import { InvoicePrint } from "./invoice-print";

export const dynamic = "force-dynamic";

/*
 * Detalj fakture (Korak 1.6b): broj, period, ukupna zarada + spisak porudžbina
 * sa zaradom po porudžbini. Bez PDF-a (Kopiraj/Štampaj). Akcije samo Admin.
 */
export default async function FakturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const detail = await getInvoiceDetail(id);
  if (!detail) notFound();

  const { invoice, orders, computedTotal, isBackfill } = detail;
  const frozen = invoice.total_amount ?? 0;
  // period_from == period_to za nove fakture (jedan datum); istorijske mogu imati
  // opseg — prikaži jedan datum ako se poklapaju, inače opseg.
  const dateLabel =
    invoice.period_from && invoice.period_to && invoice.period_from !== invoice.period_to
      ? `${datum(invoice.period_from)} – ${datum(invoice.period_to)}`
      : invoice.period_from
        ? datum(invoice.period_from)
        : "—";
  const mismatch = computedTotal !== frozen;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/finansije/fakture"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na fakture
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Faktura</div>
          <h1 className="text-ink num flex items-center gap-2 text-xl font-bold">
            {invoice.invoice_number ?? "—"}
            {invoice.status === "placeno" ? (
              <Badge variant="success">Plaćeno</Badge>
            ) : (
              <Badge variant="warning">Izdato</Badge>
            )}
          </h1>
          <p className="text-ink-soft text-sm">Datum: {dateLabel}</p>
        </div>
        {isAdmin ? (
          <InvoiceActions id={invoice.id} status={invoice.status} isBackfill={isBackfill} />
        ) : null}
      </div>

      {/* Sažetak */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <SummaryCard label="Ukupna zarada (faktura)" value={rsd(frozen)} />
        <SummaryCard label="Porudžbina" value={num(invoice.orderCount)} />
      </div>

      {mismatch ? (
        <p className="text-warning border-warning/30 bg-warning-soft mb-6 rounded-lg border px-4 py-2.5 text-sm">
          Napomena: trenutni zbir zarade ({rsd(computedTotal)}) razlikuje se od zamrznutog iznosa
          fakture — stavke su možda menjane posle izdavanja.
        </p>
      ) : null}

      {/* Porudžbine */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink text-sm font-semibold">Porudžbine ({num(orders.length)})</h2>
        <InvoicePrint
          invoiceNumber={invoice.invoice_number ?? "—"}
          date={dateLabel}
          total={frozen}
          orders={orders}
        />
      </div>
      <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Br.</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Kupac</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Isporučeno</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Zarada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-ink-soft px-4 py-6 text-sm">
                  Faktura bez vezanih porudžbina.
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell className="num text-ink px-4 py-2.5 font-medium">
                    {o.woo_order_id != null ? (
                      <Link
                        href={`/porudzbine/${o.id}`}
                        className="hover:text-green underline-offset-2 hover:underline"
                      >
                        #{o.woo_order_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-ink px-4 py-2.5">{o.ship_name ?? "—"}</TableCell>
                  <TableCell className="num text-ink-soft px-4 py-2.5">
                    {o.delivered_at ? datum(o.delivered_at) : "—"}
                  </TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{rsd(o.profit)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="text-ink num mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
