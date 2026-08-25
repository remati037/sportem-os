import Link from "next/link";
import { CalendarClock, CheckCircle2, Plus } from "lucide-react";

import { listStaffProfiles } from "@/db/profiles";
import { sortLinkedTickets, type TicketListRow } from "@/db/tickets";
import { getTicketColumns, getTicketPriorities, getTicketTags } from "@/db/tickets-config";
import { todayBelgrade } from "@/lib/date-belgrade";
import { datum } from "@/lib/format";
import { dueState, formatTicketCode, initials } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { TicketDialog, type TicketOptions, type TicketPrefill } from "./ticket-dialog";

/*
 * Sekcija „Tiketi" na detalju porudžbine i proizvoda (Korak T6): vezani tiketi
 * + „Napravi tiket" sa unapred popunjenom vezom.
 *
 * Server komponenta — sama učitava config board-a (kolone/prioriteti/tagovi) i
 * tim, pa je pozivalac ubacuje jednim tagom. Prikaz je SAMO ČITANJE nad
 * tiketima; porudžbine, `order_items` (zamrznute cene) i finansije se ne diraju.
 *
 * Pozivalac mora prethodno da propusti samo Admina i Menadžera (`requireRole`) —
 * Logistika nema pristup tiketima ni na nivou RLS-a.
 */
export async function RelatedTickets({
  tickets,
  prefill,
  emptyText,
  className,
}: {
  tickets: TicketListRow[];
  /** Veza koja se pred-popunjava u dijalogu „Novi tiket". */
  prefill: TicketPrefill;
  emptyText: string;
  className?: string;
}) {
  const [columns, priorities, tags, staff] = await Promise.all([
    getTicketColumns(),
    getTicketPriorities(),
    getTicketTags(),
    listStaffProfiles(),
  ]);

  const options: TicketOptions = { columns, priorities, tags, staff };
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const today = todayBelgrade();
  // Isti redosled kao na board-u (kolona → position), bez dodatnog upita.
  const ordered = sortLinkedTickets(tickets, columns);

  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink text-base font-semibold">Tiketi</h2>
        {columns.length > 0 ? (
          <TicketDialog
            options={options}
            prefill={prefill}
            trigger={
              <Button size="sm" variant="subtle">
                <Plus /> Napravi tiket
              </Button>
            }
          />
        ) : null}
      </div>

      {tickets.length === 0 ? (
        <p className="text-ink-soft text-sm">{emptyText}</p>
      ) : (
        <ul className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
          {ordered.map((t) => {
            const column = columnById.get(t.column_id);
            const done = t.completed_at != null || column?.is_done === true;
            const due = dueState(t.due_date, today, t.completed_at);

            return (
              <li key={t.id}>
                <Link
                  href={`/tiketi/${formatTicketCode(t.code)}`}
                  className="hover:bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors"
                >
                  <span className="num text-ink-faint shrink-0 text-xs font-semibold">
                    {formatTicketCode(t.code)}
                  </span>
                  <span
                    className={cn(
                      "text-ink min-w-0 flex-1 truncate text-sm font-medium",
                      done && "text-ink-soft line-through",
                    )}
                  >
                    {t.title}
                  </span>

                  {t.priority ? (
                    <span
                      className="rounded-pill shrink-0 px-1.5 py-0.5 text-[0.625rem] font-semibold"
                      style={{
                        color: t.priority.color ?? undefined,
                        backgroundColor: t.priority.color ? `${t.priority.color}1A` : undefined,
                      }}
                    >
                      {t.priority.name}
                    </span>
                  ) : null}

                  {done ? (
                    <span className="text-green-deep inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                      <CheckCircle2 className="size-3.5" /> Završen
                    </span>
                  ) : column ? (
                    <span
                      className="rounded-pill shrink-0 px-2 py-0.5 text-[0.625rem] font-semibold"
                      style={{
                        color: column.color ?? undefined,
                        backgroundColor: column.color ? `${column.color}1A` : undefined,
                      }}
                    >
                      {column.name}
                    </span>
                  ) : null}

                  {t.due_date && !done ? (
                    <span
                      className={cn(
                        "num inline-flex shrink-0 items-center gap-1 text-xs",
                        due === "overdue"
                          ? "text-danger font-semibold"
                          : due === "today"
                            ? "text-warning font-semibold"
                            : "text-ink-faint",
                      )}
                    >
                      <CalendarClock className="size-3.5" /> {datum(t.due_date)}
                    </span>
                  ) : null}

                  {t.assignees.length > 0 ? (
                    <span className="flex shrink-0 -space-x-1.5">
                      {t.assignees.slice(0, 3).map((a) => (
                        <span
                          key={a.user_id}
                          title={a.full_name ?? "Bez imena"}
                          className="border-surface bg-surface-2 text-ink-soft flex size-5 items-center justify-center rounded-full border text-[0.5625rem] font-semibold"
                        >
                          {initials(a.full_name)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
