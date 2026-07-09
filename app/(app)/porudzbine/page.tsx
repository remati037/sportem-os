import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getOrders, getOrderStatuses, ORDERS_PER_PAGE_OPTIONS } from "@/db/orders";
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
import { OrdersFilterBar } from "./orders-filter-bar";
import { OrdersPagination } from "./orders-pagination";

export const dynamic = "force-dynamic";

/*
 * Lista porudžbina (Korak 1.4) — filteri (status, isporuka, plaćanje,
 * needs_vp, datum) + pretraga (broj/ime/telefon), sve URL-driven i server-side.
 * Sve porudžbine ulaze kroz WooCommerce webhook.
 */
export default async function PorudzbinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const perPageRaw = Number(one(sp.per_page));
  const perPage = (ORDERS_PER_PAGE_OPTIONS as readonly number[]).includes(perPageRaw)
    ? perPageRaw
    : 25;
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const [{ rows: orders, total }, statuses] = await Promise.all([
    getOrders({
      search: one(sp.q),
      statusId: one(sp.status),
      deliveryMethod: one(sp.delivery),
      paymentStatus: one(sp.payment),
      needsVp: one(sp.needs_vp) === "1",
      from: one(sp.from),
      to: one(sp.to),
      page,
      perPage,
    }),
    getOrderStatuses(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Operativa</div>
        <h1 className="text-ink text-xl font-bold">Porudžbine</h1>
      </div>

      <OrdersFilterBar statuses={statuses} />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title="Nema porudžbina za ovaj period"
          description="Nijedna porudžbina ne odgovara filterima."
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

      {total > 0 ? <OrdersPagination total={total} page={page} perPage={perPage} /> : null}
    </main>
  );
}
