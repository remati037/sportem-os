import { ShoppingCart } from "lucide-react";

import { requireRole } from "@/lib/auth";
import {
  getOrders,
  getOrdersSummary,
  getOrderStatuses,
  ORDERS_PER_PAGE_OPTIONS,
} from "@/db/orders";
import { APP_STATUS } from "@/lib/woo";
import { rsd } from "@/lib/format";
import { EmptyState } from "@/components/patterns/empty-state";

import { OrdersFilterBar } from "./orders-filter-bar";
import { OrdersPagination } from "./orders-pagination";
import { OrdersBulkTable } from "./orders-bulk-table";
import { OrdersRefresh } from "./orders-refresh";
import type { FlowIds } from "./[id]/order-status-control";

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

  const filters = {
    search: one(sp.q),
    searchField,
    statusId: one(sp.status),
    deliveryMethod: one(sp.delivery),
    paymentStatus: one(sp.payment),
    needsVp: one(sp.needs_vp) === "1",
    needsReview: one(sp.needs_review) === "1",
    onlyRisky: one(sp.risky) === "1",
    from: one(sp.from),
    to: one(sp.to),
  };

  const [{ rows: orders, total }, statuses, summary] = await Promise.all([
    getOrders({ ...filters, page, perPage }),
    getOrderStatuses(),
    getOrdersSummary(filters),
  ]);

  const marzaPct = Math.round(summary.marza * 100);

  // Poznati (seed) statusi toka — ids po imenu (nikad hardkodovan UUID). Bulk
  // tabela ih koristi: koje statuse ponuditi (svi osim Poslato) i koji traže razlog.
  const flow: FlowIds = {
    created: statuses.find((s) => s.name === APP_STATUS.created)?.id,
    sent: statuses.find((s) => s.name === APP_STATUS.sent)?.id,
    delivered: statuses.find((s) => s.name === APP_STATUS.delivered)?.id,
    cancelled: statuses.find((s) => s.name === APP_STATUS.cancelled)?.id,
    returned: statuses.find((s) => s.name === APP_STATUS.returned)?.id,
  };

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

      {/* Zbir za trenutni filter (zarada iz zamrznutih stavki, bez otkazanih/vraćenih) */}
      <div className="border-border bg-surface-2 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5">
        <span className="eyebrow">Za ovaj filter</span>
        <SummaryStat label="Zarada" value={rsd(summary.zarada)} />
        <SummaryStat label="Promet" value={rsd(summary.promet)} />
        <SummaryStat label="Marža" value={`${marzaPct}%`} />
        <span className="text-ink-faint ml-auto text-xs">
          {summary.broj} porudžbina u zbiru (bez otkazanih/vraćenih)
        </span>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title="Nema porudžbina za ovaj period"
          description="Nijedna porudžbina ne odgovara filterima."
        />
      ) : (
        <OrdersBulkTable orders={orders} statuses={statuses} flow={flow} />
      )}

      {total > 0 ? <OrdersPagination total={total} page={page} perPage={perPage} /> : null}
    </main>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-ink-faint text-xs">{label}</span>
      <span className="num text-ink text-sm font-semibold">{value}</span>
    </span>
  );
}
