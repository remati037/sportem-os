import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getOrders } from "@/db/orders";
import { rsd, datum } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";

import { StatusPill } from "./status-pill";

export const dynamic = "force-dynamic";

/*
 * Minimalna lista porudžbina (Korak 1.2) — filteri, pretraga i promena
 * statusa stižu u Koraku 1.4. Sve porudžbine ulaze kroz WooCommerce webhook.
 */
export default async function PorudzbinePage() {
  await requireRole("admin", "manager");

  const orders = await getOrders();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Operativa</div>
        <h1 className="text-ink text-xl font-bold">Porudžbine</h1>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title="Nema porudžbina za ovaj period"
          description="Porudžbine ulaze automatski kroz WooCommerce webhook."
        />
      ) : (
        <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
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
                  <TableCell className="text-ink px-4 py-2.5">{o.customer?.name ?? "—"}</TableCell>
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
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
