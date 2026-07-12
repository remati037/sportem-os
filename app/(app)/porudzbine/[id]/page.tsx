import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { requireRole } from "@/lib/auth";
import {
  getActiveVariantOptions,
  getOrderDetail,
  getOrderStatuses,
  getOrderStatusHistory,
} from "@/db/orders";
import { getOrderCancellationHistory, porudzbinePlural } from "@/db/customer-risk";
import { rsd, datum, datumVreme } from "@/lib/format";
import { APP_STATUS } from "@/lib/woo";
import { Badge } from "@/components/ui/badge";

import { StatusPill } from "../status-pill";
import { OrderItemsEditor } from "./order-items-editor";
import { OrderStatusControl, ResolveReviewButton, type FlowIds } from "./order-status-control";
import { ShippingForm } from "./shipping-form";

export const dynamic = "force-dynamic";

/*
 * Detalj porudžbine (Korak 1.4). Sve cifre su ZAMRZNUTE vrednosti iz
 * order_items, nikad iz kataloga. Admin/Menadžer menjaju status kroz tok
 * (istorija „ko i kada"); Admin edituje stavke i radi keš prodaju; fakturisana
 * porudžbina je zaključana za edit stavki.
 */
export default async function PorudzbinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const [statuses, history, variantOptions, riskyHistory] = await Promise.all([
    getOrderStatuses(),
    getOrderStatusHistory(order.id),
    isAdmin && !order.invoice_id ? getActiveVariantOptions() : Promise.resolve([]),
    getOrderCancellationHistory(order),
  ]);

  // Poznati (seed) statusi toka — razrešeni po imenu (nikad hardkodovan UUID).
  const flow: FlowIds = {
    created: statuses.find((s) => s.name === APP_STATUS.created)?.id,
    sent: statuses.find((s) => s.name === APP_STATUS.sent)?.id,
    delivered: statuses.find((s) => s.name === APP_STATUS.delivered)?.id,
    cancelled: statuses.find((s) => s.name === APP_STATUS.cancelled)?.id,
    returned: statuses.find((s) => s.name === APP_STATUS.returned)?.id,
  };
  const currentStatusId = statuses.find((s) => s.name === order.status?.name)?.id ?? null;
  const canCashSale = isAdmin && !order.invoice_id && order.payment_status === "neuplaceno";

  const profitTotal = order.items.reduce((sum, i) => sum + (i.profit_at_sale ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/porudzbine"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na porudžbine
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="eyebrow">Porudžbina</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="num text-ink text-xl font-bold">
              {order.woo_order_id != null ? `#${order.woo_order_id}` : "Bez Woo broja"}
            </h1>
            {order.status ? (
              <StatusPill name={order.status.name} color={order.status.color} />
            ) : null}
            {order.needs_vp ? <Badge variant="warning">Nedostaje VP</Badge> : null}
            {order.invoice_id ? <Badge variant="info">Fakturisana</Badge> : null}
            {riskyHistory.length > 0 ? <Badge variant="danger">Rizičan kupac</Badge> : null}
          </div>
          {order.ordered_at ? (
            <div className="text-ink-soft text-sm">
              Kreirana: <span className="num">{datumVreme(order.ordered_at)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {order.needs_review ? (
        <div className="bg-danger-soft text-danger mb-6 flex items-start justify-between gap-2.5 rounded-lg px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Potrebna ručna odluka</p>
              <p>{order.review_reason ?? "Porudžbina čeka proveru."}</p>
            </div>
          </div>
          <ResolveReviewButton orderId={order.id} />
        </div>
      ) : null}

      {riskyHistory.length > 0 ? (
        <div className="bg-danger-soft text-danger mb-6 flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Rizičan kupac</p>
            <p>
              Ranije otkazao/vratio {riskyHistory.length} {porudzbinePlural(riskyHistory.length)}{" "}
              (poklapanje po telefonu ili e-mailu):
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {riskyHistory.map((h) => (
                <li key={h.id}>
                  <Link href={`/porudzbine/${h.woo_order_id ?? h.id}`} className="num font-medium underline">
                    {h.woo_order_id != null ? `#${h.woo_order_id}` : "porudžbina"}
                  </Link>
                  {h.ordered_at ? (
                    <span className="text-danger/80 num"> · {datum(h.ordered_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="mb-6">
        <OrderStatusControl
          orderId={order.id}
          currentStatusId={currentStatusId}
          statuses={statuses}
          flow={flow}
          canCashSale={canCashSale}
        />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
          <h2 className="eyebrow mb-3">Kupac i isporuka</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="Ime" value={order.ship_name ?? order.customer?.name ?? "—"} />
            <Row label="Telefon" value={order.ship_phone ?? order.customer?.phone ?? "—"} num />
            <Row
              label="Adresa"
              value={
                [order.ship_address, order.ship_postal_code, order.ship_city]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            {order.customer?.email ? <Row label="E-mail" value={order.customer.email} /> : null}
            {order.ship_note ? <Row label="Napomena" value={order.ship_note} /> : null}
            <Row
              label="Isporuka"
              value={order.delivery_method === "licno" ? "Lično" : "XExpress"}
            />
          </dl>
        </section>

        <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
          <h2 className="eyebrow mb-3">Iznosi</h2>
          <dl className="space-y-1.5 text-sm">
            <Row
              label="Roba"
              value={order.goods_total != null ? rsd(order.goods_total) : "—"}
              num
            />
            <Row
              label="Poštarina (naplaćena)"
              value={order.shipping_charged != null ? rsd(order.shipping_charged) : "—"}
              num
            />
            <Row
              label="Otkupnina (COD)"
              value={order.cod_amount != null ? rsd(order.cod_amount) : "—"}
              num
            />
            <Row
              label="Plaćanje"
              value={
                order.payment_status === "uplaceno"
                  ? "Uplaćeno"
                  : order.payment_status === "kes"
                    ? "Keš/Isplaćeno"
                    : "Neuplaćeno"
              }
            />
            {isAdmin ? (
              <Row
                label="Zarada"
                value={order.needs_vp ? "— (nedostaje VP)" : rsd(profitTotal)}
                num
              />
            ) : null}
          </dl>
        </section>
      </div>

      <div className="mb-8">
        <ShippingForm
          orderId={order.id}
          values={{
            shipping_charged: order.shipping_charged,
            shipping_actual: order.shipping_actual,
            weight_grams: order.weight_grams,
            package_count: order.package_count,
          }}
        />
      </div>

      <OrderItemsEditor
        orderId={order.id}
        items={order.items}
        isAdmin={isAdmin}
        locked={Boolean(order.invoice_id)}
        variantOptions={variantOptions}
      />

      <section className="mt-8">
        <h2 className="text-ink mb-3 text-base font-semibold">Istorija statusa</h2>
        {history.length === 0 ? (
          <p className="text-ink-soft text-sm">Još nema zabeleženih promena statusa.</p>
        ) : (
          <ol className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                {h.toStatus ? (
                  <StatusPill name={h.toStatus.name} color={h.toStatus.color} />
                ) : (
                  <span className="text-ink-faint text-sm">—</span>
                )}
                <span className="text-ink-soft text-sm">{h.changedByName ?? "Sistem"}</span>
                <span className="num text-ink-faint text-sm">{datumVreme(h.created_at)}</span>
                {h.note ? <span className="text-ink-soft text-sm">· {h.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {order.woo_status ? (
        <p className="text-ink-faint mt-6 text-xs">
          WooCommerce status: <span className="num">{order.woo_status}</span>
        </p>
      ) : null}
    </main>
  );
}

function Row({ label, value, num: isNum }: { label: string; value: string; num?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft shrink-0">{label}</dt>
      <dd className={`text-ink text-right font-medium ${isNum ? "num" : ""}`}>{value}</dd>
    </div>
  );
}
