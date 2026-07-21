import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getXexpressInvoiceDetail } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { XexpressInvoiceActions } from "./xexpress-invoice-actions";

export const dynamic = "force-dynamic";

/*
 * Detalj XExpress fakture poštarine: P&L (naplaćeno kupcima vs osnovica + PDV) +
 * spisak vezanih porudžbina sa rezultatom po porudžbini. Akcije samo Admin.
 */
export default async function XexpressFakturaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const detail = await getXexpressInvoiceDetail(id);
  if (!detail) notFound();

  const { invoice, orders, naplaceno, osnovica, pdv, ukupno, rezultat } = detail;
  const dateLabel =
    invoice.period_from && invoice.period_to && invoice.period_from !== invoice.period_to
      ? `${datum(invoice.period_from)} – ${datum(invoice.period_to)}`
      : datum(invoice.invoice_date);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/finansije/postarina"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na poštarinu
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">XExpress faktura</div>
          <h1 className="text-ink text-xl font-bold">{invoice.invoice_number ?? "(bez broja)"}</h1>
          <p className="text-ink-soft text-sm">Datum: {dateLabel}</p>
          {invoice.notes ? <p className="text-ink-soft text-sm">{invoice.notes}</p> : null}
        </div>
        {isAdmin ? <XexpressInvoiceActions id={invoice.id} /> : null}
      </div>

      {/* P&L */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Naplaćeno kupcima" value={rsd(naplaceno)} />
        <SummaryCard label="Osnovica" value={rsd(osnovica)} />
        <SummaryCard label={`PDV ${invoice.vat_rate}%`} value={rsd(pdv)} />
        <SummaryCard label="Ukupno XExpress" value={rsd(ukupno)} />
        <SummaryCard
          label="Rezultat"
          value={rezultat === 0 ? "0" : `${rezultat > 0 ? "+" : ""}${rsd(rezultat)}`}
          tone={rezultat >= 0 ? "success" : "warning"}
        />
      </div>

      <p className="text-ink-faint mb-6 text-xs">
        {rezultat > 0
          ? "Zarada na poštarini — naplaćeno kupcima je više od plaćenog XExpress-u (sa PDV-om)."
          : rezultat < 0
            ? "Gubitak na poštarini — plaćeno XExpress-u (sa PDV-om) je više od naplaćenog kupcima."
            : "Poštarina se poklapa — naplaćeno kupcima jednako plaćenom XExpress-u."}
      </p>

      {/* Porudžbine */}
      <h2 className="text-ink mb-2 text-sm font-semibold">Porudžbine ({num(orders.length)})</h2>
      <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Br.</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Kupac</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Naplaćeno</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Osnovica</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">+PDV</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Rezultat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-ink-soft px-4 py-6 text-sm">
                  Faktura bez vezanih porudžbina.
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell className="num text-ink px-4 py-2.5 font-medium">
                    {o.woo_order_id != null ? (
                      <Link
                        href={`/porudzbine/${o.woo_order_id ?? o.id}`}
                        className="hover:text-green underline-offset-2 hover:underline"
                      >
                        #{o.woo_order_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-ink px-4 py-2.5">{o.ship_name ?? "—"}</TableCell>
                  <TableCell className="num text-ink px-4 py-2.5 text-right">
                    {rsd(o.shipping_charged ?? 0)}
                  </TableCell>
                  <TableCell className="num text-ink-soft px-4 py-2.5 text-right">
                    {rsd(o.shipping_actual ?? 0)}
                  </TableCell>
                  <TableCell className="num text-ink-soft px-4 py-2.5 text-right">
                    {rsd(o.pdv)}
                  </TableCell>
                  <TableCell
                    className={
                      "num px-4 py-2.5 text-right font-semibold " +
                      (o.rezultat >= 0 ? "text-success" : "text-warning")
                    }
                  >
                    {o.rezultat === 0 ? "0" : `${o.rezultat > 0 ? "+" : ""}${rsd(o.rezultat)}`}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className={
          "num mt-1 text-lg font-bold " +
          (tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
