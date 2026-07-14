import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getPayoutDetail, getPayoutSpisak } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { PayoutActions } from "./payout-actions";
import { SpisakView } from "./spisak-view";

export const dynamic = "force-dynamic";

/*
 * Detalj uplate (Korak 1.6a): iznos, datumi, vezane porudžbine, Σ COD + razlika,
 * i spisak uplate (po porudžbini + zbirno po artiklu, kopiraj/štampa).
 */
export default async function UplataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const detail = await getPayoutDetail(id);
  if (!detail) notFound();
  const spisak = await getPayoutSpisak(id);

  const { payout, orders, otkupTotal, postageTotal, difference } = detail;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/finansije/uplate"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na uplate
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Uplata</div>
          <h1 className="text-ink num text-xl font-bold">{datum(payout.payout_date)}</h1>
          <p className="text-ink-soft text-sm">
            Isporuka (T−1): {payout.delivery_date ? datum(payout.delivery_date) : "—"}
            {payout.notes ? ` · ${payout.notes}` : ""}
          </p>
        </div>
        {isAdmin ? (
          <PayoutActions
            id={payout.id}
            amount={payout.amount}
            payoutDate={payout.payout_date}
            notes={payout.notes}
            orderIds={orders.map((o) => o.id)}
          />
        ) : null}
      </div>

      {/* Sažetak iznosa */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Uplaćeno" value={rsd(payout.amount)} />
        <SummaryCard label="Σ otkupnina" value={rsd(otkupTotal)} />
        <SummaryCard label="Poštarina" value={rsd(postageTotal)} />
        <SummaryCard
          label="Razlika"
          value={difference === 0 ? "0" : `${difference > 0 ? "+" : ""}${rsd(difference)}`}
          tone={difference === 0 ? "success" : "warning"}
        />
      </div>

      {/* Vezane porudžbine */}
      <h2 className="text-ink mb-2 text-sm font-semibold">
        Vezane porudžbine ({num(orders.length)})
      </h2>
      <div className="border-border bg-surface shadow-soft mb-8 overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Br.</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Kupac</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Isporučeno</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Otkup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-ink-soft px-4 py-6 text-sm">
                  Uplata bez vezanih porudžbina.
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell className="num text-ink px-4 py-2.5 font-medium">
                    {o.woo_order_id != null ? (
                      <Link href={`/porudzbine/${o.woo_order_id ?? o.id}`} className="hover:text-green underline-offset-2 hover:underline">
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
                  <TableCell className="num px-4 py-2.5 text-right">{rsd(o.otkup)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Spisak uplate */}
      <SpisakView spisak={spisak} payoutDate={datum(payout.payout_date)} />
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
