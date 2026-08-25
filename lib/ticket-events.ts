import "server-only";

import * as Sentry from "@sentry/nextjs";

import { listStaffProfiles } from "@/db/profiles";
import { getTicketColumns, getTicketPriorities, getTicketTags } from "@/db/tickets-config";
import { createClient } from "@/lib/supabase/server";
import { formatEstimate, formatTicketCode } from "@/lib/tickets";

/*
 * Istorija promena tiketa (Korak T4) — JEDINSTVEN upis audit reda.
 *
 * Piše se IZ AKCIJA, ne iz DB trigera (isti obrazac kao `order_status_history`)
 * — samo akcija zna ko je akter (`auth.uid()` u trigeru ne pokriva service-role
 * automatiku iz T6).
 *
 * Sve je BEST-EFFORT: greška u audit-u nikad ne obara samu akciju (Sentry +
 * tišina). Upis ide kroz RLS klijent — politika `ticket_events_staff_all`
 * pokriva i Admina i Menadžera.
 *
 * `from_text` / `to_text` čuvaju ČITLJIVE nazive (a ne UUID-jeve) da istorija
 * ostane tačna i kad Admin kasnije obriše kolonu, prioritet ili tag.
 */

/** Vrste događaja (`ticket_events.kind` je bez CHECK-a — lista raste kroz faze). */
export type TicketEventKind =
  | "created"
  | "title"
  | "description"
  | "column"
  | "priority"
  | "due"
  | "estimate"
  | "assignee"
  | "tag"
  | "blocked"
  | "link"
  | "checklist"
  | "comment"
  | "comment_deleted"
  | "duplicated";

export type TicketEventInput = {
  ticketId: string;
  actorId: string | null;
  kind: TicketEventKind;
  /** Stara vrednost (skinut izvršilac/tag → samo ovo polje). */
  from?: string | null;
  /** Nova vrednost (dodat izvršilac/tag → samo ovo polje). */
  to?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Upis jednog audit reda. Nikad ne baca. Vraća `ticket_events.id` — obaveštenja
 * (T5) ga koriste kao `reference_id` (dedup je vezan za DOGAĐAJ, ne za tiket, pa
 * ponovna dodela iste osobe nije zauvek „već poslato"). `null` = upis nije uspeo.
 */
export async function logTicketEvent(event: TicketEventInput): Promise<string | null> {
  const ids = await logTicketEvents([event]);
  return ids[0] ?? null;
}

/**
 * Upis više audit redova odjednom (jedan insert). Nikad ne baca.
 * Vraća id-jeve upisanih redova PO REDOSLEDU ulaza (PostgREST vraća redove
 * onim redom kojim su umetnuti) — prazan niz znači da upis nije uspeo.
 */
export async function logTicketEvents(events: TicketEventInput[]): Promise<string[]> {
  if (events.length === 0) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ticket_events")
      .insert(
        events.map((e) => ({
          ticket_id: e.ticketId,
          actor_id: e.actorId,
          kind: e.kind,
          from_text: e.from ?? null,
          to_text: e.to ?? null,
          meta: e.meta ?? null,
        })),
      )
      .select("id");
    if (error) throw new Error(error.message);
    return ((data as { id: string }[]) ?? []).map((r) => r.id);
  } catch (err) {
    Sentry.captureException(err);
    return [];
  }
}

/* ── Diff izmene tiketa ──────────────────────────────────────────────────── */

/** Stanje polja tiketa pre/posle izmene (id-jevi; nazivi se razrešavaju ovde). */
export type TicketFieldSnapshot = {
  title: string;
  description: string | null;
  column_id: string;
  priority_id: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  blocked_by_ticket_id: string | null;
  order_id: string | null;
  variant_id: string | null;
  customer_id: string | null;
  assignee_ids: string[];
  tag_ids: string[];
};

/** Jedan audit red bez identiteta tiketa/aktera (dodaje ih upis). */
export type TicketChange = Omit<TicketEventInput, "ticketId" | "actorId">;

/** Nazivi tiketa (šifre) za id-jeve zavisnosti — istorija ne čuva UUID. */
async function ticketCodeLabels(ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return new Map();

  const supabase = await createClient();
  const { data } = await supabase.from("tickets").select("id, code").in("id", clean);
  return new Map(
    ((data as { id: string; code: number }[]) ?? []).map((t) => [t.id, formatTicketCode(t.code)]),
  );
}

/**
 * Razlika dva stanja tiketa → lista audit redova. Prazna lista = ništa se nije
 * promenilo (izmena bez promene ne prlja istoriju).
 *
 * Nazivi kolona/prioriteta/tagova/izvršilaca se čitaju TEK ako se to polje
 * promenilo — obična izmena naslova ne pravi dodatne upite.
 */
export async function ticketUpdateChanges(
  before: TicketFieldSnapshot,
  after: TicketFieldSnapshot,
): Promise<TicketChange[]> {
  const changes: TicketChange[] = [];

  if (before.title !== after.title) {
    changes.push({ kind: "title", from: before.title, to: after.title });
  }

  if ((before.description ?? "") !== (after.description ?? "")) {
    changes.push({
      kind: "description",
      from: before.description ? "postojao" : null,
      to: after.description ? "izmenjen" : "uklonjen",
    });
  }

  if (before.column_id !== after.column_id || before.priority_id !== after.priority_id) {
    const [columns, priorities] = await Promise.all([
      before.column_id !== after.column_id ? getTicketColumns() : Promise.resolve([]),
      before.priority_id !== after.priority_id ? getTicketPriorities() : Promise.resolve([]),
    ]);

    if (before.column_id !== after.column_id) {
      const name = (id: string) => columns.find((c) => c.id === id)?.name ?? null;
      changes.push({ kind: "column", from: name(before.column_id), to: name(after.column_id) });
    }
    if (before.priority_id !== after.priority_id) {
      const name = (id: string | null) =>
        id ? (priorities.find((p) => p.id === id)?.name ?? null) : null;
      changes.push({
        kind: "priority",
        from: name(before.priority_id),
        to: name(after.priority_id),
      });
    }
  }

  if (before.due_date !== after.due_date) {
    changes.push({ kind: "due", from: before.due_date, to: after.due_date });
  }

  if (before.estimate_minutes !== after.estimate_minutes) {
    changes.push({
      kind: "estimate",
      from: formatEstimate(before.estimate_minutes),
      to: formatEstimate(after.estimate_minutes),
    });
  }

  if (before.blocked_by_ticket_id !== after.blocked_by_ticket_id) {
    const labels = await ticketCodeLabels([
      before.blocked_by_ticket_id ?? "",
      after.blocked_by_ticket_id ?? "",
    ]);
    changes.push({
      kind: "blocked",
      from: before.blocked_by_ticket_id ? (labels.get(before.blocked_by_ticket_id) ?? null) : null,
      to: after.blocked_by_ticket_id ? (labels.get(after.blocked_by_ticket_id) ?? null) : null,
    });
  }

  for (const field of ["order_id", "variant_id", "customer_id"] as const) {
    if (before[field] === after[field]) continue;
    changes.push({
      kind: "link",
      from: before[field] ? "postojala" : null,
      to: after[field] ? "postavljena" : "uklonjena",
      meta: { field },
    });
  }

  changes.push(...(await assigneeChanges(before.assignee_ids, after.assignee_ids)));
  changes.push(...(await tagChanges(before.tag_ids, after.tag_ids)));

  return changes;
}

function diffIds(before: string[], after: string[]): { added: string[]; removed: string[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}

/** Promene izvršilaca → po jedan red za svakog dodatog/sklonjenog. */
export async function assigneeChanges(before: string[], after: string[]): Promise<TicketChange[]> {
  const { added, removed } = diffIds(before, after);
  if (added.length === 0 && removed.length === 0) return [];

  const staff = await listStaffProfiles();
  const name = (id: string) => staff.find((s) => s.id === id)?.full_name ?? "Bez imena";
  // `meta.user_id` je jedini pouzdan način da se posle upisa zna KOME je tiket
  // dodeljen (prikaz koristi čitljivo ime iz `to_text`) — obaveštenje
  // `ticket_assigned` iz T5 pari korisnika sa id-jem upravo upisanog događaja.
  return [
    ...added.map((id) => ({ kind: "assignee" as const, to: name(id), meta: { user_id: id } })),
    ...removed.map((id) => ({ kind: "assignee" as const, from: name(id), meta: { user_id: id } })),
  ];
}

/** Promene tagova → po jedan red za svaki dodat/sklonjen tag. */
export async function tagChanges(before: string[], after: string[]): Promise<TicketChange[]> {
  const { added, removed } = diffIds(before, after);
  if (added.length === 0 && removed.length === 0) return [];

  // Arhivirani tagovi ostaju na starim tiketima — zato `includeArchived`.
  const tags = await getTicketTags({ includeArchived: true });
  const name = (id: string) => tags.find((t) => t.id === id)?.name ?? "Obrisan tag";
  return [
    ...added.map((id) => ({ kind: "tag" as const, to: name(id) })),
    ...removed.map((id) => ({ kind: "tag" as const, from: name(id) })),
  ];
}

/** Upisana promena — `eventId` je `null` ako audit red nije uspeo (best-effort). */
export type LoggedTicketChange = TicketChange & { eventId: string | null };

/**
 * Upis liste promena za jedan tiket (dopisuje identitet tiketa i aktera).
 * Vraća iste promene sa id-jem upisanog događaja — obaveštenja (T5) traže
 * svoj okidač u toj listi (npr. `kind === "assignee"` sa `to`).
 */
export async function logTicketChanges(
  ticketId: string,
  actorId: string | null,
  changes: TicketChange[],
): Promise<LoggedTicketChange[]> {
  const ids = await logTicketEvents(changes.map((c) => ({ ...c, ticketId, actorId })));
  return changes.map((c, i) => ({ ...c, eventId: ids[i] ?? null }));
}

/** Diff + upis u jednom pozivu (best-effort, kao i sve ostalo ovde). */
export async function logTicketUpdate(
  ticketId: string,
  actorId: string | null,
  before: TicketFieldSnapshot,
  after: TicketFieldSnapshot,
): Promise<LoggedTicketChange[]> {
  try {
    return await logTicketChanges(ticketId, actorId, await ticketUpdateChanges(before, after));
  } catch (err) {
    Sentry.captureException(err);
    return [];
  }
}

/* ── Prikaz (hronologija na detalju tiketa) ──────────────────────────────── */

export type TicketEventRow = {
  id: string;
  kind: string;
  from_text: string | null;
  to_text: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  actorName: string | null;
};

/** Naziv veze za `kind = "link"` (meta.field). */
const LINK_LABELS: Record<string, string> = {
  order_id: "porudžbinu",
  variant_id: "artikal",
  customer_id: "kupca",
};

/**
 * Događaj → rečenica na srpskom („prebacio u U toku"). Vraća radnju i opcioni
 * detalj; ime aktera i vreme dodaje sam prikaz.
 */
export function describeTicketEvent(event: TicketEventRow): { action: string; detail?: string } {
  const { kind, from_text: from, to_text: to } = event;
  const metaField = typeof event.meta?.field === "string" ? event.meta.field : null;
  const metaAction = typeof event.meta?.action === "string" ? event.meta.action : null;

  switch (kind) {
    case "created":
      return { action: "napravio tiket" };
    case "duplicated":
      return to
        ? { action: "napravio kopiju", detail: to }
        : { action: "nastao dupliranjem", detail: from ?? undefined };
    case "title":
      return { action: "preimenovao tiket", detail: to ?? undefined };
    case "description":
      return { action: to === "uklonjen" ? "obrisao opis" : "izmenio opis" };
    case "column":
      return { action: "prebacio u kolonu", detail: to ?? undefined };
    case "priority":
      return to
        ? { action: "postavio prioritet", detail: to }
        : { action: "sklonio prioritet", detail: from ?? undefined };
    case "due":
      return to ? { action: "postavio rok", detail: to } : { action: "sklonio rok" };
    case "estimate":
      return to ? { action: "postavio procenu", detail: to } : { action: "sklonio procenu" };
    case "assignee":
      return to
        ? { action: "dodao izvršioca", detail: to }
        : { action: "sklonio izvršioca", detail: from ?? undefined };
    case "tag":
      return to
        ? { action: "dodao tag", detail: to }
        : { action: "sklonio tag", detail: from ?? undefined };
    case "blocked":
      return to
        ? { action: "postavio zavisnost — čeka", detail: to }
        : { action: "sklonio zavisnost", detail: from ?? undefined };
    case "link": {
      const what = metaField ? (LINK_LABELS[metaField] ?? "vezu") : "vezu";
      return { action: to === "uklonjena" ? `sklonio ${what}` : `povezao ${what}` };
    }
    case "checklist":
      switch (metaAction) {
        case "added":
          return { action: "dodao stavku", detail: to ?? undefined };
        case "done":
          return { action: "štiklirao stavku", detail: to ?? undefined };
        case "undone":
          return { action: "odštiklirao stavku", detail: to ?? undefined };
        case "deleted":
          return { action: "obrisao stavku", detail: from ?? undefined };
        default:
          return { action: "izmenio checklist" };
      }
    case "comment":
      return { action: "dodao komentar" };
    case "comment_deleted":
      return { action: "obrisao komentar" };
    default:
      return { action: "izmenio tiket" };
  }
}
