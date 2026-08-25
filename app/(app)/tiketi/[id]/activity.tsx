import { datumVreme } from "@/lib/format";
import { describeTicketEvent, type TicketEventRow } from "@/lib/ticket-events";

/*
 * Hronologija promena tiketa (Korak T4) — „Marko je 25.08. prebacio u U toku".
 *
 * Redovi dolaze iz `ticket_events` koje upisuju SAME AKCIJE (ne DB trigeri),
 * pa se uvek zna ko je akter. Prikaz je samo za čitanje; istorija je
 * append-only i briše se jedino sa tiketom (cascade).
 */
export function Activity({ events }: { events: TicketEventRow[] }) {
  if (events.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="text-ink mb-3 text-base font-semibold">Istorija promena</h2>
        <p className="text-ink-soft text-sm">Još nema zabeleženih promena.</p>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <h2 className="text-ink mb-3 text-base font-semibold">Istorija promena</h2>
      <ol className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
        {events.map((event) => {
          const { action, detail } = describeTicketEvent(event);
          return (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5"
            >
              <span className="text-ink text-sm font-medium">{event.actorName ?? "Sistem"}</span>
              <span className="text-ink-soft text-sm">{action}</span>
              {detail ? <span className="text-ink text-sm font-medium">{detail}</span> : null}
              <span className="num text-ink-faint ml-auto text-xs">
                {datumVreme(event.created_at)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
