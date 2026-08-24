import Link from "next/link";
import { CalendarClock, Clock, Link2, Package, ShoppingCart, User } from "lucide-react";

import type { TicketListRow } from "@/db/tickets";
import { datum } from "@/lib/format";
import { dueState, formatEstimate, formatTicketCode, initials } from "@/lib/tickets";
import { cn } from "@/lib/utils";

import { TicketActions } from "./ticket-actions";
import type { TicketOptions } from "./ticket-dialog";

/*
 * Kartica tiketa na board-u (Korak T2): šifra, naslov, tagovi, prioritet,
 * izvršioci (inicijali), rok (bojen kad kasni) i badge-ovi veza.
 * Cela kartica vodi na detalj; „⋮" akcije stoje iznad overlay linka (z-10).
 */
export function TicketCard({
  ticket,
  options,
  today,
}: {
  ticket: TicketListRow;
  options: TicketOptions;
  /** Današnji Belgrade datum („YYYY-MM-DD") — bojenje roka. */
  today: string;
}) {
  const due = dueState(ticket.due_date, today, ticket.completed_at);
  const estimate = formatEstimate(ticket.estimate_minutes);
  const priorityHex = ticket.priority?.color ?? null;

  return (
    <div className="border-border bg-surface shadow-soft hover:bg-green-soft relative rounded-lg border p-3 transition-colors">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-ink-faint text-xs font-semibold">
              {formatTicketCode(ticket.code)}
            </span>
            {ticket.priority ? (
              <span
                className="rounded-pill px-1.5 py-0.5 text-[0.625rem] font-semibold"
                style={{
                  color: priorityHex ?? undefined,
                  backgroundColor: priorityHex ? `${priorityHex}1A` : undefined,
                }}
              >
                {ticket.priority.name}
              </span>
            ) : null}
          </div>
          <p className="text-ink mt-1 text-sm font-medium">{ticket.title}</p>
        </div>
        <div className="relative z-10 shrink-0">
          <TicketActions ticket={ticket} options={options} />
        </div>
      </div>

      {ticket.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.tags.map((tag) => {
            const hex = tag.color ?? "#6B7280";
            return (
              <span
                key={tag.id}
                className="rounded-pill px-2 py-0.5 text-[0.625rem] font-semibold"
                style={{ color: hex, backgroundColor: `${hex}1A` }}
              >
                {tag.name}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="text-ink-faint mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {due ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              due === "overdue" && "text-danger font-semibold",
              due === "today" && "text-warning font-semibold",
            )}
          >
            <CalendarClock className="size-3.5" />
            <span className="num">{datum(ticket.due_date!)}</span>
          </span>
        ) : null}

        {estimate ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {estimate}
          </span>
        ) : null}

        {ticket.order ? (
          <span className="inline-flex items-center gap-1">
            <ShoppingCart className="size-3.5" />
            <span className="num">
              {ticket.order.woo_order_id != null ? `#${ticket.order.woo_order_id}` : "Porudžbina"}
            </span>
          </span>
        ) : null}

        {ticket.variant ? (
          <span className="inline-flex items-center gap-1">
            <Package className="size-3.5" /> {ticket.variant.sku}
          </span>
        ) : null}

        {ticket.customer ? (
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" /> {ticket.customer.name ?? "Kupac"}
          </span>
        ) : null}

        {ticket.blocked_by && !ticket.blocked_by.done ? (
          <span className="text-warning inline-flex items-center gap-1 font-semibold">
            <Link2 className="size-3.5" /> Čeka {formatTicketCode(ticket.blocked_by.code)}
          </span>
        ) : null}

        {ticket.assignees.length > 0 ? (
          <span className="ml-auto flex items-center -space-x-1.5">
            {ticket.assignees.map((a) => (
              <span
                key={a.user_id}
                title={a.full_name ?? "Bez imena"}
                className="border-surface bg-surface-2 text-ink-soft flex size-6 items-center justify-center rounded-full border text-[0.625rem] font-semibold"
              >
                {initials(a.full_name)}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      {/* `draggable={false}`: bez toga browser pokreće NATIVNO prevlačenje
          linka i otima pokret od drag & drop-a board-a (T3). */}
      <Link
        href={`/tiketi/${formatTicketCode(ticket.code)}`}
        aria-label={`${formatTicketCode(ticket.code)} — ${ticket.title}`}
        draggable={false}
        className="absolute inset-0 rounded-lg"
      />
    </div>
  );
}
