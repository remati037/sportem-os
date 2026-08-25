import Link from "next/link";
import { Package, ShoppingCart, User } from "lucide-react";

import type { TicketLinkedContext } from "@/db/tickets";
import { datum, num } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

import { StatusPill } from "../../porudzbine/status-pill";

/*
 * Panel vezanih zapisa (Korak T4): porudžbina, artikal i kupac sa linkovima na
 * njihove ekrane.
 *
 * NIKAD ne prikazuje finansije — samo broj/naziv/status/kontakt i stanje
 * zaliha. Iznosi, MP/VP i profit se ovde ne čitaju (zamrznute cene ostaju
 * netaknute), pa panel ne otvara ništa što tiket ne treba da zna.
 */
export function LinkedPanel({ context }: { context: TicketLinkedContext }) {
  const { order, variant, customer } = context;
  if (!order && !variant && !customer) return null;

  return (
    <section className="mb-6">
      <h2 className="text-ink mb-3 text-base font-semibold">Vezani zapisi</h2>
      <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
        {order ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <ShoppingCart className="text-ink-faint size-4 shrink-0" />
            <Link
              href={`/porudzbine/${order.woo_order_id ?? order.id}`}
              className="text-green-deep num text-sm font-medium underline"
            >
              {order.woo_order_id != null ? `#${order.woo_order_id}` : "Porudžbina"}
            </Link>
            {order.statusName ? (
              <StatusPill name={order.statusName} color={order.statusColor} />
            ) : null}
            {order.delivery_method === "licno" ? <Badge variant="info">Lično</Badge> : null}
            <span className="text-ink-soft text-sm">
              {order.ship_name ?? "Bez primaoca"}
              {order.ship_city ? `, ${order.ship_city}` : ""}
            </span>
            {order.ordered_at ? (
              <span className="num text-ink-faint ml-auto text-xs">{datum(order.ordered_at)}</span>
            ) : null}
          </div>
        ) : null}

        {variant ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <Package className="text-ink-faint size-4 shrink-0" />
            {variant.productId ? (
              <Link
                href={`/katalog/${variant.productId}`}
                className="text-green-deep num text-sm font-medium underline"
              >
                {variant.sku}
              </Link>
            ) : (
              <span className="num text-ink text-sm font-medium">{variant.sku}</span>
            )}
            <span className="text-ink-soft text-sm">
              {[variant.productName, variant.variantName].filter(Boolean).join(" — ") ||
                "Bez naziva"}
            </span>
            {variant.archived ? <Badge variant="warning">Arhiviran</Badge> : null}
            <span className="text-ink-faint ml-auto text-xs">
              Stanje: <span className="num">{num(variant.stockQuantity)}</span>
            </span>
          </div>
        ) : null}

        {customer ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <User className="text-ink-faint size-4 shrink-0" />
            <span className="text-ink text-sm font-medium">{customer.name ?? "Bez imena"}</span>
            {customer.phone ? (
              <a
                href={`tel:${customer.phone}`}
                className="text-green-deep num text-sm font-medium underline"
              >
                {customer.phone}
              </a>
            ) : null}
            {customer.city ? <span className="text-ink-soft text-sm">{customer.city}</span> : null}
            {customer.phone ? (
              <Link
                href={`/porudzbine?q=${encodeURIComponent(customer.phone)}`}
                className="text-ink-soft hover:text-ink ml-auto text-xs underline"
              >
                Porudžbine kupca
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
