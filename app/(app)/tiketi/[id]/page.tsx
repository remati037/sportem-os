import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2 } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { listStaffProfiles } from "@/db/profiles";
import { getTicketDetail } from "@/db/tickets";
import { getTicketColumns, getTicketPriorities, getTicketTags } from "@/db/tickets-config";
import { todayBelgrade } from "@/lib/date-belgrade";
import { datum, datumVreme } from "@/lib/format";
import { dueState, formatEstimate, formatTicketCode, initials } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { StatusPill } from "../../porudzbine/status-pill";
import { TicketActions } from "../ticket-actions";
import type { TicketOptions } from "../ticket-dialog";

export const dynamic = "force-dynamic";

/*
 * Detalj tiketa (Korak T2) — osnovna polja i veze. Komentari, checklist,
 * istorija promena i dupliranje dolaze u T4.
 *
 * URL prima šifru („/tiketi/SPT-42" i „/tiketi/42"); UUID ostaje rezerva za
 * direktne linkove (isti obrazac kao `/porudzbine/[id]`).
 */
export default async function TiketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("admin", "manager");

  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();

  const [columns, priorities, tags, staff] = await Promise.all([
    getTicketColumns(),
    getTicketPriorities(),
    getTicketTags(),
    listStaffProfiles(),
  ]);

  const options: TicketOptions = { columns, priorities, tags, staff };
  const column = columns.find((c) => c.id === ticket.column_id) ?? null;
  const due = dueState(ticket.due_date, todayBelgrade(), ticket.completed_at);
  const estimate = formatEstimate(ticket.estimate_minutes);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/tiketi"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na tikete
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="eyebrow num">{formatTicketCode(ticket.code)}</div>
          <h1 className="text-ink text-xl font-bold">{ticket.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {column ? <StatusPill name={column.name} color={column.color} /> : null}
            {ticket.priority ? (
              <StatusPill name={ticket.priority.name} color={ticket.priority.color} />
            ) : null}
            {ticket.completed_at ? <Badge variant="success">Završen</Badge> : null}
            {ticket.source !== "manual" ? <Badge variant="info">Automatski</Badge> : null}
          </div>
        </div>
        <TicketActions ticket={ticket} options={options} afterDeleteHref="/tiketi" />
      </div>

      {ticket.blocked_by && !ticket.blocked_by.done ? (
        <div className="bg-warning-soft text-warning mb-6 flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm">
          <Link2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Čeka drugi tiket</p>
            <p>
              Blokiran do završetka{" "}
              <Link
                href={`/tiketi/${formatTicketCode(ticket.blocked_by.code)}`}
                className="font-medium underline"
              >
                {formatTicketCode(ticket.blocked_by.code)}
              </Link>{" "}
              — {ticket.blocked_by.title}
            </p>
          </div>
        </div>
      ) : null}

      {ticket.description ? (
        <section className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
          <div className="eyebrow mb-2">Opis</div>
          <p className="text-ink-soft text-sm whitespace-pre-wrap">{ticket.description}</p>
        </section>
      ) : null}

      <section className="border-border bg-surface shadow-soft divide-border mb-6 divide-y rounded-lg border px-4">
        <Row label="Izvršioci">
          {ticket.assignees.length === 0 ? (
            <span className="text-ink-faint">Nedodeljen</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              {ticket.assignees.map((a) => (
                <span key={a.user_id} className="flex items-center gap-1.5">
                  <span className="bg-surface-2 text-ink-soft flex size-6 items-center justify-center rounded-full text-[0.625rem] font-semibold">
                    {initials(a.full_name)}
                  </span>
                  {a.full_name ?? "Bez imena"}
                </span>
              ))}
            </span>
          )}
        </Row>

        <Row label="Tagovi">
          {ticket.tags.length === 0 ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {ticket.tags.map((tag) => (
                <StatusPill key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </span>
          )}
        </Row>

        <Row label="Rok">
          {ticket.due_date ? (
            <span
              className={cn(
                "num",
                due === "overdue" && "text-danger font-semibold",
                due === "today" && "text-warning font-semibold",
              )}
            >
              {datum(ticket.due_date)}
              {due === "overdue" ? " · probijen" : due === "today" ? " · danas" : ""}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Row>

        <Row label="Procena">
          {estimate ? <span>{estimate}</span> : <span className="text-ink-faint">—</span>}
        </Row>

        <Row label="Porudžbina">
          {ticket.order ? (
            <Link
              href={`/porudzbine/${ticket.order.woo_order_id ?? ticket.order.id}`}
              className="text-green-deep num font-medium underline"
            >
              {ticket.order.woo_order_id != null
                ? `#${ticket.order.woo_order_id}`
                : "Otvori porudžbinu"}
            </Link>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Row>

        <Row label="Artikal">
          {ticket.variant ? (
            <span>
              <span className="num">{ticket.variant.sku}</span>
              <span className="text-ink-faint"> · {ticket.variant.label}</span>
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Row>

        <Row label="Kupac">
          {ticket.customer ? (
            <span>
              {ticket.customer.name ?? "Bez imena"}
              {ticket.customer.phone ? (
                <span className="text-ink-faint num"> · {ticket.customer.phone}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Row>

        <Row label="Kreiran">
          <span className="num">{datumVreme(ticket.created_at)}</span>
          {ticket.created_by_name ? (
            <span className="text-ink-faint"> · {ticket.created_by_name}</span>
          ) : null}
        </Row>

        {ticket.completed_at ? (
          <Row label="Završen">
            <span className="num">{datumVreme(ticket.completed_at)}</span>
          </Row>
        ) : null}
      </section>

      <p className="text-ink-faint text-xs">
        Komentari, checklist i istorija promena stižu u sledećem koraku.
      </p>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span className="text-ink-faint text-xs">{label}</span>
      <span className="text-ink text-sm">{children}</span>
    </div>
  );
}
