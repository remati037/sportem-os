import Link from "next/link";
import { notFound } from "next/navigation";
import { Link2 } from "lucide-react";

import { getProfile } from "@/lib/auth";
import { listStaffProfiles } from "@/db/profiles";
import {
  getDependentTickets,
  getLinkedContext,
  getTicketChecklist,
  getTicketComments,
  getTicketDetail,
  getTicketEvents,
} from "@/db/tickets";
import { getTicketColumns, getTicketPriorities, getTicketTags } from "@/db/tickets-config";
import { todayBelgrade } from "@/lib/date-belgrade";
import { datum, datumVreme } from "@/lib/format";
import { dueState, formatEstimate, formatTicketCode, initials } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { Linkify } from "@/components/patterns/linkify";
import { Badge } from "@/components/ui/badge";

import { StatusPill } from "../porudzbine/status-pill";
import { Activity } from "./[id]/activity";
import { BlockedControl } from "./[id]/blocked-control";
import { Checklist } from "./[id]/checklist";
import { Comments } from "./[id]/comments";
import { LinkedPanel } from "./[id]/linked-panel";
import { TicketActions } from "./ticket-actions";
import type { TicketOptions } from "./ticket-dialog";

/*
 * Sadržaj detalja tiketa — deljen između PUNE STRANE (`/tiketi/[id]`, direktan
 * link / refresh / novi tab) i MODALA nad board-om (presretnuta ruta
 * `@modal/(.)tiketi/[id]`). Jedan izvor istine za prikaz; razlikuje se samo
 * okvir (naslov modala vs `<h1>` na strani).
 *
 * Korak T4: komentari, checklist sa progresom, istorija promena, zavisnost
 * („čeka drugi tiket" — upozorenje, ne blokira) i panel vezanih zapisa.
 * Panel NIKAD ne prikazuje finansije, a `order_items` (zamrznute cene) se ovde
 * i ne dodiruju.
 */
export async function TicketDetail({
  param,
  variant = "page",
}: {
  /** URL parametar: „SPT-42", „42" ili UUID (rezerva). */
  param: string;
  /** U modalu naslov nosi `DialogTitle`, pa se `<h1>` ne renderuje dvaput. */
  variant?: "page" | "modal";
}) {
  const ticket = await getTicketDetail(param);
  if (!ticket) notFound();

  const [columns, priorities, tags, staff, session, comments, checklist, events, linked, blocking] =
    await Promise.all([
      getTicketColumns(),
      getTicketPriorities(),
      getTicketTags(),
      listStaffProfiles(),
      getProfile(),
      getTicketComments(ticket.id),
      getTicketChecklist(ticket.id),
      getTicketEvents(ticket.id),
      getLinkedContext(ticket),
      getDependentTickets(ticket.id),
    ]);

  const options: TicketOptions = { columns, priorities, tags, staff };
  const column = columns.find((c) => c.id === ticket.column_id) ?? null;
  const due = dueState(ticket.due_date, todayBelgrade(), ticket.completed_at);
  const estimate = formatEstimate(ticket.estimate_minutes);
  const isModal = variant === "modal";
  const waiting = blocking.filter((t) => !t.done);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          {isModal ? null : (
            <>
              <div className="eyebrow num">{formatTicketCode(ticket.code)}</div>
              <h1 className="text-ink text-xl font-bold">{ticket.title}</h1>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {column ? <StatusPill name={column.name} color={column.color} /> : null}
            {ticket.priority ? (
              <StatusPill name={ticket.priority.name} color={ticket.priority.color} />
            ) : null}
            {ticket.completed_at ? <Badge variant="success">Završen</Badge> : null}
            {ticket.source !== "manual" ? <Badge variant="info">Automatski</Badge> : null}
          </div>
        </div>
        {/* Posle brisanja: nazad na board (u modalu to ujedno zatvara modal). */}
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
              — {ticket.blocked_by.title}. Zavisnost je samo upozorenje, ništa nije blokirano.
            </p>
          </div>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div className="border-border bg-surface-2 text-ink-soft mb-6 rounded-lg border px-4 py-3 text-sm">
          Ovaj tiket čeka{waiting.length > 1 ? "ju" : ""}:{" "}
          {waiting.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? ", " : ""}
              <Link
                href={`/tiketi/${formatTicketCode(t.code)}`}
                className="text-green-deep num font-medium underline"
              >
                {formatTicketCode(t.code)}
              </Link>
            </span>
          ))}
        </div>
      ) : null}

      {ticket.description ? (
        <section className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
          <div className="eyebrow mb-2">Opis</div>
          <p className="text-ink-soft text-sm whitespace-pre-wrap">
            <Linkify text={ticket.description} />
          </p>
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

        <Row label="Čeka tiket">
          <BlockedControl
            ticketId={ticket.id}
            current={
              ticket.blocked_by
                ? {
                    id: ticket.blocked_by.id,
                    code: ticket.blocked_by.code,
                    title: ticket.blocked_by.title,
                  }
                : null
            }
          />
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

      <LinkedPanel context={linked} />

      <Checklist ticketId={ticket.id} items={checklist} />

      <Comments ticketId={ticket.id} comments={comments} currentUserId={session?.userId ?? ""} />

      <Activity events={events} />
    </>
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
