import "server-only";

import * as Sentry from "@sentry/nextjs";

import { notifyUsers } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTicketCode } from "@/lib/tickets";
import type { LoggedTicketChange } from "@/lib/ticket-events";

/*
 * Obaveštenja modula Tiketi (Korak T5) — jedino mesto koje zna KADA tiket javlja
 * i KOME. Akcije (`app/(app)/tiketi/actions.ts`) i cron zovu ove funkcije.
 *
 * SVE je best-effort: nijedna funkcija ne baca (Sentry + tišina), pa greška
 * obaveštenja nikad ne obara akciju iz koje je pozvana — isti obrazac kao
 * `pushWooStatus` i `logTicketEvent`.
 *
 * Čita kroz SERVICE-ROLE klijent (kao `notifyRoles`): izvršioci i autor tiketa
 * su sistemski podatak fan-out-a, a cron nema sesiju. Kapija ostaje `requireRole`
 * u pozivaocu. Piše se ISKLJUČIVO u `notification_log` (kroz `notifyUsers`) —
 * nikakav tiket, porudžbina, `order_items` ni finansije se ne diraju.
 *
 * `reference_id` je uvek vezan za DOGAĐAJ (`ticket_events.id`, `comment.id`,
 * dan za cron), nikad samo za tiket — inače bi ponovna dodela iste osobe zauvek
 * bila „već poslato".
 */

type Admin = ReturnType<typeof createAdminClient>;

type TicketInfo = {
  id: string;
  code: number;
  title: string;
  created_by: string | null;
};

/** Osnovni podaci tiketa za tekst obaveštenja. */
async function ticketInfo(supabase: Admin, ticketId: string): Promise<TicketInfo | null> {
  const { data } = await supabase
    .from("tickets")
    .select("id, code, title, created_by")
    .eq("id", ticketId)
    .maybeSingle();
  return (data as TicketInfo | null) ?? null;
}

/** Izvršioci više tiketa odjednom → mapa `ticket_id → user_id[]`. */
async function assigneesByTicket(
  supabase: Admin,
  ticketIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ticketIds.length === 0) return map;

  const { data } = await supabase
    .from("ticket_assignees")
    .select("ticket_id, user_id")
    .in("ticket_id", ticketIds);

  for (const row of (data as { ticket_id: string; user_id: string }[]) ?? []) {
    const list = map.get(row.ticket_id) ?? [];
    list.push(row.user_id);
    map.set(row.ticket_id, list);
  }
  return map;
}

/** Link i naslov kartice u obaveštenju („SPT-42 · Pozovi kupca"). */
function ticketLabel(ticket: { code: number; title: string }): {
  code: string;
  body: string;
  url: string;
  tag: string;
} {
  const code = formatTicketCode(ticket.code);
  return {
    code,
    body: `${code} · ${ticket.title}`,
    url: `/tiketi/${code}`,
    tag: `ticket-${ticket.code}`,
  };
}

/**
 * Dedup ključ. Audit red je izvor („događaj"); ako upis audit-a nije uspeo
 * (best-effort), pada se na vremenski ključ da obaveštenje ipak ode — bolje
 * jedno moguće duplo nego tiho progutano javljanje.
 */
function reference(eventId: string | null, fallback: string): string {
  return eventId ?? `${fallback}:${Date.now()}`;
}

/* ── Dodela izvršioca ────────────────────────────────────────────────────── */

/** Kome je tiket dodeljen + id događaja koji je to zabeležio. */
export type AssignedEntry = { userId: string; eventId: string | null };

/**
 * Iz upisanih promena izvuci NOVO dodate izvršioce. Dodavanje je `kind
 * "assignee"` sa popunjenim `to`; korisnika nosi `meta.user_id` (`to_text` je
 * čitljivo ime, pa nije upotrebljivo kao id).
 */
export function assignedFromChanges(changes: LoggedTicketChange[]): AssignedEntry[] {
  return changes
    .filter((c) => c.kind === "assignee" && c.to)
    .map((c) => ({
      userId: typeof c.meta?.user_id === "string" ? c.meta.user_id : null,
      eventId: c.eventId,
    }))
    .filter((a): a is AssignedEntry => !!a.userId);
}

/**
 * „Dodeljen ti je tiket" — svakom NOVO dodatom izvršiocu, osim onome ko je
 * dodelu uradio (sebi ne javljamo).
 */
export async function notifyTicketAssigned(
  ticketId: string,
  actorId: string | null,
  added: AssignedEntry[],
): Promise<void> {
  try {
    const targets = added.filter((a) => a.userId !== actorId);
    if (targets.length === 0) return;

    const supabase = createAdminClient();
    const ticket = await ticketInfo(supabase, ticketId);
    if (!ticket) return;

    const label = ticketLabel(ticket);
    await Promise.all(
      targets.map((a) =>
        notifyUsers(
          "ticket_assigned",
          reference(a.eventId, `ticket_assigned:${ticketId}:${a.userId}`),
          [a.userId],
          {
            title: "Dodeljen ti je tiket",
            body: label.body,
            url: label.url,
            tag: label.tag,
          },
        ),
      ),
    );
  } catch (err) {
    Sentry.captureException(err);
  }
}

/* ── Nov komentar ────────────────────────────────────────────────────────── */

/**
 * „Nov komentar" — izvršiocima tiketa i autoru tiketa, BEZ onoga ko je
 * komentarisao. `reference_id = comment.id` (svaki komentar javlja jednom).
 */
export async function notifyTicketComment(
  ticketId: string,
  commentId: string,
  actorId: string | null,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const ticket = await ticketInfo(supabase, ticketId);
    if (!ticket) return;

    const assignees = (await assigneesByTicket(supabase, [ticketId])).get(ticketId) ?? [];
    const recipients = [...assignees, ticket.created_by ?? ""].filter((id) => id && id !== actorId);
    if (recipients.length === 0) return;

    const label = ticketLabel(ticket);
    await notifyUsers("ticket_comment", commentId, recipients, {
      title: "Nov komentar na tiketu",
      body: label.body,
      url: label.url,
      tag: label.tag,
    });
  } catch (err) {
    Sentry.captureException(err);
  }
}

/* ── Završen tiket (+ oslobođena blokada) ────────────────────────────────── */

/**
 * Tiket je ušao u završnu kolonu (`is_done`). Šalje dva obaveštenja:
 *  - `ticket_done` autoru tiketa (osim ako ga je on sam pomerio);
 *  - `ticket_unblocked` izvršiocima svakog tiketa koji je ČEKAO ovaj.
 *
 * Oba su vezana za isti audit događaj (`kind "column"`); tip je deo dedup
 * ključa, pa se ne sudaraju. Kod odblokiranih se dopisuje id tiketa jer jedan
 * događaj može da oslobodi više njih.
 */
export async function notifyTicketCompleted(
  ticketId: string,
  actorId: string | null,
  eventId: string | null,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const ticket = await ticketInfo(supabase, ticketId);
    if (!ticket) return;

    const label = ticketLabel(ticket);
    const tasks: Promise<unknown>[] = [];

    // 1) Autoru tiketa — ali ne ako je on sam prebacio kolonu.
    if (ticket.created_by && ticket.created_by !== actorId) {
      tasks.push(
        notifyUsers(
          "ticket_done",
          reference(eventId, `ticket_done:${ticketId}`),
          [ticket.created_by],
          {
            title: "Tiket završen",
            body: label.body,
            url: label.url,
            tag: label.tag,
          },
        ),
      );
    }

    // 2) Tiketi koji su čekali ovaj — javi njihovim izvršiocima da su slobodni.
    const { data: dependents } = await supabase
      .from("tickets")
      .select("id, code, title")
      .eq("blocked_by_ticket_id", ticketId)
      .is("completed_at", null);
    const blocked = (dependents as { id: string; code: number; title: string }[]) ?? [];

    if (blocked.length > 0) {
      const byTicket = await assigneesByTicket(
        supabase,
        blocked.map((t) => t.id),
      );
      for (const dep of blocked) {
        const recipients = (byTicket.get(dep.id) ?? []).filter((id) => id !== actorId);
        if (recipients.length === 0) continue;
        const depLabel = ticketLabel(dep);
        tasks.push(
          notifyUsers(
            "ticket_unblocked",
            `${reference(eventId, `ticket_unblocked:${ticketId}`)}:${dep.id}`,
            recipients,
            {
              title: "Oslobođena blokada",
              body: `${depLabel.code} više ne čeka ${label.code} — može da se radi.`,
              url: depLabel.url,
              tag: depLabel.tag,
            },
          ),
        );
      }
    }

    await Promise.all(tasks);
  } catch (err) {
    Sentry.captureException(err);
  }
}

/* ── Dnevni podsetnik za rok (cron) ──────────────────────────────────────── */

/** Srpska množina (1 / 2–4 / 5+). */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Dnevni sažetak rokova — JEDNO obaveštenje po korisniku („2 tiketa kasne, 1 ima
 * rok danas"), ne po tiketu. Broje se samo NEZAVRŠENI tiketi: `completed_at is
 * null` i kolona koja nije `is_done` (zastavica, nikad hardkodovan UUID).
 *
 * `reference_id = ticket_due:{userId}:{YYYY-MM-DD}` → ponovni poziv crona istog
 * dana ne šalje duplo. Vraća broj obaveštenih korisnika (za odgovor rute).
 */
export async function notifyTicketDue(today: string): Promise<number> {
  try {
    const supabase = createAdminClient();

    // Završne kolone se izuzimaju (tiket u „Završeno" nema probijen rok).
    const { data: doneColumns } = await supabase
      .from("ticket_columns")
      .select("id")
      .eq("is_done", true);
    const doneIds = ((doneColumns as { id: string }[]) ?? []).map((c) => c.id);

    const { data, error } = await supabase
      .from("tickets")
      .select("id, due_date, column_id")
      .not("due_date", "is", null)
      .lte("due_date", today)
      .is("completed_at", null);
    if (error) throw new Error(error.message);

    // Kolona se odbija u JS-u (a ne kroz `not(... "in" ...)`) — `completed_at`
    // je već sito, ovo hvata samo tikete u koloni kojoj je `is_done` naknadno
    // podignut (trigger ne prepravlja stare redove retroaktivno).
    const rows = ((data as { id: string; due_date: string; column_id: string }[]) ?? []).filter(
      (t) => !doneIds.includes(t.column_id),
    );
    if (rows.length === 0) return 0;

    const byTicket = await assigneesByTicket(
      supabase,
      rows.map((t) => t.id),
    );

    // Sabiranje po korisniku — nedodeljen tiket nema kome da javi.
    const perUser = new Map<string, { overdue: number; dueToday: number }>();
    for (const ticket of rows) {
      const overdue = ticket.due_date < today;
      for (const userId of byTicket.get(ticket.id) ?? []) {
        const acc = perUser.get(userId) ?? { overdue: 0, dueToday: 0 };
        if (overdue) acc.overdue += 1;
        else acc.dueToday += 1;
        perUser.set(userId, acc);
      }
    }
    if (perUser.size === 0) return 0;

    await Promise.all(
      [...perUser.entries()].map(([userId, { overdue, dueToday }]) => {
        const parts: string[] = [];
        if (overdue > 0) {
          parts.push(
            `${overdue} ${plural(overdue, "tiket kasni", "tiketa kasne", "tiketa kasni")}`,
          );
        }
        if (dueToday > 0) {
          parts.push(
            `${dueToday} ${plural(dueToday, "tiket ima", "tiketa imaju", "tiketa ima")} rok danas`,
          );
        }
        return notifyUsers("ticket_due", `ticket_due:${userId}:${today}`, [userId], {
          title: "Rokovi tiketa",
          body: `${parts.join(", ")}.`,
          url: "/tiketi?moji=1",
          tag: "ticket-due",
        });
      }),
    );

    return perUser.size;
  } catch (err) {
    Sentry.captureException(err);
    return 0;
  }
}
