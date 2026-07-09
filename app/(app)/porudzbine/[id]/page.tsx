import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getActiveVariantOptions, getOrderDetail } from "@/db/orders";
import { rsd, datumVreme } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

import { StatusPill } from "../status-pill";
import { OrderItemsEditor } from "./order-items-editor";

export const dynamic = "force-dynamic";

/*
 * Detalj porudžbine (Korak 1.2 — minimalno). Sve cifre su ZAMRZNUTE vrednosti
 * iz order_items, nikad iz kataloga. Admin edituje stavke; fakturisana
 * porudžbina je zaključana. Pun UX (promena statusa, istorija) stiže u 1.4.
 */
export default async function PorudzbinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const order = await getOrderDetail(id);
  if (!order) notFound();

  const variantOptions = isAdmin && !order.invoice_id ? await getActiveVariantOptions() : [];

  const profitTotal = order.items.reduce((sum, i) => sum + (i.profit_at_sale ?? 0), 0);

  const timeline = [
    { label: "Kreirana", at: order.ordered_at },
    { label: "Poslata", at: order.shipped_at },
    { label: "Isporučena", at: order.delivered_at },
    { label: "Uplaćena", at: order.paid_at },
    { label: "Otkazana", at: order.cancelled_at },
  ].filter((t) => t.at);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
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
          </div>
          <div className="text-ink-soft flex flex-wrap gap-x-3 text-sm">
            {timeline.map((t) => (
              <span key={t.label}>
                {t.label}: <span className="num">{datumVreme(t.at!)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {order.needs_review ? (
        <div className="bg-danger-soft text-danger mb-6 flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Potrebna ručna odluka</p>
            <p>{order.review_reason ?? "Porudžbina čeka proveru."}</p>
          </div>
        </div>
      ) : null}

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

      <OrderItemsEditor
        orderId={order.id}
        items={order.items}
        isAdmin={isAdmin}
        locked={Boolean(order.invoice_id)}
        variantOptions={variantOptions}
      />

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
