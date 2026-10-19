import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, TriangleAlert } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { datum, num, rsd } from "@/lib/format";
import {
  getCustomerFlags,
  getCustomerNotes,
  getCustomerProfile,
  isRepeatCustomer,
  isRiskyCustomer,
} from "@/db/customers";
import { listTicketsForCustomers } from "@/db/tickets";
import { Badge } from "@/components/ui/badge";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { RelatedTickets } from "../../tiketi/related-tickets";
import { AskAssistantButton } from "../../asistent/ask-button";
import { StatusPill } from "../../porudzbine/status-pill";
import { CustomerFlags } from "./flags";
import { CustomerNotes } from "./notes";

export const dynamic = "force-dynamic";

/*
 * Profil kupca (Korak C2, docs/Sportem-Plan-Kupci.md). `id` je `customers.id`
 * najnovije porudžbine grupe (repId iz C1); bilo koji drugi red iste grupe
 * preusmerava na njega, nepoznat id → 404. Pristup: Admin i Menadžer.
 * Promet/zarada iz zamrznutih `order_items`; otkazane/vraćene su u spisku i
 * broju porudžbina, ali ne u prometu, zaradi ni artiklima.
 */
export default async function KupacPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireRole("admin", "manager");
  const { id } = await params;

  const profile = await getCustomerProfile(id);
  if (!profile) notFound();
  const { group, address, orders, articles, cancellations } = profile;
  if (group.repId !== id) redirect(`/kupci/${group.repId}`);

  const [tickets, notes, flags] = await Promise.all([
    listTicketsForCustomers(group.customerIds, group.orderIds),
    getCustomerNotes(group),
    getCustomerFlags(group),
  ]);

  const name = group.name ?? "(bez imena)";
  const cancelPct =
    group.orderCount > 0 ? Math.round((group.cancelledCount / group.orderCount) * 100) : 0;
  const avgBasket = group.realizedCount > 0 ? Math.round(group.revenue / group.realizedCount) : 0;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/kupci"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na kupce
      </Link>

      {/* 1. Zaglavlje */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="eyebrow">Kupac</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-ink text-xl font-bold break-words">{name}</h1>
            {isRepeatCustomer(group) ? <Badge variant="success">Ponovni</Badge> : null}
            {isRiskyCustomer(group) ? <Badge variant="danger">Rizičan</Badge> : null}
          </div>
          <div className="text-ink-soft flex flex-col gap-1 text-sm">
            {group.phone ? (
              <a
                href={`tel:${group.phone.replace(/[^\d+]/g, "")}`}
                className="hover:text-ink inline-flex items-center gap-1.5"
              >
                <Phone className="size-3.5 shrink-0" />
                <span className="num">{group.phone}</span>
              </a>
            ) : null}
            {group.email ? (
              <a
                href={`mailto:${group.email}`}
                className="hover:text-ink inline-flex min-w-0 items-center gap-1.5"
              >
                <Mail className="size-3.5 shrink-0" />
                <span className="break-all">{group.email}</span>
              </a>
            ) : null}
            {address || group.city ? (
              <span className="inline-flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span className="break-words">{address ?? group.city}</span>
              </span>
            ) : null}
          </div>
          <div className="pt-1">
            <CustomerFlags key={flags.join(",")} customerId={group.repId} initial={flags} />
          </div>
        </div>
        <AskAssistantButton
          question={`Analiziraj kupca ${name}: šta kupuje, koliko vredi, da li je rizičan.`}
        />
      </div>

      {group.needsVpCount > 0 ? (
        <div className="bg-warning-soft text-warning mb-6 flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            Zarada je nepotpuna — {num(group.needsVpCount)}{" "}
            {group.needsVpCount === 1 ? "porudžbina nema" : "porudžbine nemaju"} unetu VP cenu.
          </p>
        </div>
      ) : null}

      {/* 2. Kartice */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi
          label="Porudžbine"
          value={num(group.orderCount)}
          hint={
            group.cancelledCount > 0
              ? `${num(group.cancelledCount)} otkazano/vraćeno (${cancelPct}%)`
              : "Nijedna otkazana"
          }
          hintDanger={group.cancelledCount > 0}
        />
        <Kpi label="Promet" value={rsd(group.revenue)} hint="Bez otkazanih/vraćenih" />
        <Kpi
          label="Zarada"
          value={`${rsd(group.profit)}${group.needsVpCount > 0 ? "*" : ""}`}
          hint="Iz zamrznutih cena"
        />
        <Kpi label="Prosečna korpa" value={rsd(avgBasket)} />
        <Kpi label="Prva kupovina" value={datum(group.firstOrderAt)} />
        <Kpi label="Poslednja kupovina" value={datum(group.lastOrderAt)} />
      </div>

      {/* Beleške (C3) — znanje o kupcu ostaje u app-u */}
      <CustomerNotes customerId={group.repId} notes={notes} currentUserId={userId} />

      {/* 3. Porudžbine */}
      <section className="mb-8">
        <h2 className="text-ink mb-3 text-base font-semibold">Porudžbine</h2>
        <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Broj</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Vrednost</TableHead>
                <TableHead className="text-right">Zarada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="border-border">
                  <TableCell>
                    <Link
                      href={`/porudzbine/${o.woo_order_id ?? o.id}`}
                      className="num text-ink hover:text-green font-medium"
                    >
                      {o.woo_order_id != null ? `#${o.woo_order_id}` : "Bez broja"}
                    </Link>
                  </TableCell>
                  <TableCell className="num text-ink-soft">{datum(o.ordered_at)}</TableCell>
                  <TableCell>
                    {o.status ? <StatusPill name={o.status.name} color={o.status.color} /> : "—"}
                  </TableCell>
                  <TableCell className={cn("num text-right", o.cancelled && "text-ink-faint")}>
                    {rsd(o.revenue)}
                  </TableCell>
                  <TableCell className="text-right">
                    <OrderProfit order={o} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <MobileCardList>
          {orders.map((o) => (
            <MobileCard
              key={o.id}
              href={`/porudzbine/${o.woo_order_id ?? o.id}`}
              ariaLabel={`Porudžbina ${o.woo_order_id ?? ""}`}
            >
              <MobileCardHeader
                title={
                  <span className="num">
                    {o.woo_order_id != null ? `#${o.woo_order_id}` : "Bez broja"}
                  </span>
                }
                subtitle={<span className="num">{datum(o.ordered_at)}</span>}
                trailing={
                  o.status ? <StatusPill name={o.status.name} color={o.status.color} /> : null
                }
              />
              <div className="mt-3 space-y-1.5">
                <MobileCardField label="Vrednost">
                  <span className={cn("num", o.cancelled && "text-ink-faint")}>
                    {rsd(o.revenue)}
                  </span>
                </MobileCardField>
                <MobileCardField label="Zarada">
                  <OrderProfit order={o} />
                </MobileCardField>
              </div>
            </MobileCard>
          ))}
        </MobileCardList>
        {group.cancelledCount > 0 ? (
          <p className="text-ink-faint mt-2 text-xs">
            Otkazane i vraćene porudžbine ne ulaze u promet, zaradu ni artikle.
          </p>
        ) : null}
      </section>

      {/* 4. Šta kupuje */}
      <section className="mb-8">
        <h2 className="text-ink mb-3 text-base font-semibold">Šta kupuje</h2>
        {articles.length === 0 ? (
          <p className="text-ink-soft text-sm">Nema realizovanih kupovina.</p>
        ) : (
          <ul className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
            {articles.map((a) => (
              <li key={a.sku} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-ink text-sm font-medium break-words">{a.name ?? a.sku}</div>
                  <div className="num text-ink-faint text-xs break-all">{a.sku}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-ink text-sm font-semibold">{num(a.units)} kom.</div>
                  <div className="text-ink-faint text-xs">
                    <span className="num">{num(a.orders)}</span>{" "}
                    {a.orders === 1 ? "porudžbina" : "porudžbine"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Otkazivanja */}
      {cancellations.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-ink mb-3 text-base font-semibold">Otkazivanja i povraćaji</h2>
          <ul className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
            {cancellations.map((c) => (
              <li key={c.orderId} className="space-y-1 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Link
                    href={`/porudzbine/${c.woo_order_id ?? c.orderId}`}
                    className="num text-ink hover:text-green font-medium"
                  >
                    {c.woo_order_id != null ? `#${c.woo_order_id}` : "Bez broja"}
                  </Link>
                  <span className="num text-ink-faint text-xs">{datum(c.ordered_at)}</span>
                  {c.status ? <span className="text-danger text-xs">{c.status}</span> : null}
                </div>
                <p
                  className={cn(
                    "text-sm break-words",
                    c.reason ? "text-ink-soft" : "text-ink-faint italic",
                  )}
                >
                  {c.reason ?? "Razlog nije upisan (npr. otkazano kroz WooCommerce)."}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 6. Tiketi */}
      <RelatedTickets
        tickets={tickets}
        emptyText="Nema tiketa vezanih za ovog kupca."
        prefill={{
          customer: {
            id: group.repId,
            label: name,
            hint: group.phone ?? undefined,
          },
        }}
      />
    </main>
  );
}

function Kpi({
  label,
  value,
  hint,
  hintDanger,
}: {
  label: string;
  value: string;
  hint?: string;
  hintDanger?: boolean;
}) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-lg font-bold break-words">{value}</div>
      {hint ? (
        <div className={cn("mt-0.5 text-xs", hintDanger ? "text-danger" : "text-ink-faint")}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function OrderProfit({ order }: { order: { cancelled: boolean; profit: number | null } }) {
  if (order.cancelled) return <span className="text-ink-faint">—</span>;
  if (order.profit == null)
    return <span className="text-warning text-xs font-semibold">Nema VP</span>;
  return <span className="num text-ink font-semibold">{rsd(order.profit)}</span>;
}
