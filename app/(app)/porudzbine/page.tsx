import { ShoppingCart } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getOrders, getOrderStatuses, ORDERS_PER_PAGE_OPTIONS } from "@/db/orders";
import { EmptyState } from "@/components/patterns/empty-state";

import { OrdersFilterBar } from "./orders-filter-bar";
import { OrdersPagination } from "./orders-pagination";
import { OrdersBulkTable } from "./orders-bulk-table";
import { OrdersRefresh } from "./orders-refresh";

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

  const qfRaw = one(sp.qf);
  const searchField = (["all", "name", "email", "phone"] as const).includes(
    qfRaw as "all" | "name" | "email" | "phone",
  )
    ? (qfRaw as "all" | "name" | "email" | "phone")
    : "name";

  const [{ rows: orders, total }, statuses] = await Promise.all([
    getOrders({
      search: one(sp.q),
      searchField,
      statusId: one(sp.status),
      deliveryMethod: one(sp.delivery),
      paymentStatus: one(sp.payment),
      needsVp: one(sp.needs_vp) === "1",
      needsReview: one(sp.needs_review) === "1",
      from: one(sp.from),
      to: one(sp.to),
      page,
      perPage,
    }),
    getOrderStatuses(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="eyebrow">Operativa</div>
          <h1 className="text-ink text-xl font-bold">Porudžbine</h1>
        </div>
        <OrdersRefresh />
      </div>

      <OrdersFilterBar statuses={statuses} />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title="Nema porudžbina za ovaj period"
          description="Nijedna porudžbina ne odgovara filterima."
        />
      ) : (
        <OrdersBulkTable orders={orders} />
      )}

      {total > 0 ? <OrdersPagination total={total} page={page} perPage={perPage} /> : null}
    </main>
  );
}
