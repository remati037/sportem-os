"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getTicketSnapshot,
  nextPositionInColumn,
  positionForMove,
  searchCustomerOptions,
  searchOrderOptions,
  searchTicketOptions,
  searchVariantOptions,
  wouldCreateCycle,
  type TicketLinkOption,
} from "@/db/tickets";
import { getTicketColumns, type TicketColumnRow } from "@/db/tickets-config";
import {
  assigneeChanges,
  logTicketChanges,
  logTicketEvent,
  logTicketUpdate,
  tagChanges,
} from "@/lib/ticket-events";
import {
  assignedFromChanges,
  notifyTicketAssigned,
  notifyTicketComment,
  notifyTicketCompleted,
} from "@/lib/ticket-notify";
import { formatTicketCode } from "@/lib/tickets";
import {
  addChecklistItemSchema,
  addCommentSchema,
  checklistItemIdSchema,
  commentIdSchema,
  editCommentSchema,
  moveTicketSchema,
  setAssigneesSchema,
  setBlockedBySchema,
  setTagsSchema,
  ticketIdSchema,
  ticketSchema,
  toggleChecklistItemSchema,
  updateTicketSchema,
} from "@/lib/validation/tickets";

/*
 * Server akcije modula Tiketi (Korak T2). Admin i Menadžer su RAVNOPRAVNI
 * (zaključana odluka) — jedina kapija je `requireRole("admin","manager")`,
 * a RLS `*_staff_all` politike pokrivaju obe role, pa sve ide kroz RLS
 * klijent (bez service-role).
 *
 * `completed_at` se NE dira iz app-a — postavlja ga trigger
 * `tickets_sync_completed_at` kad tiket uđe/izađe iz `is_done` kolone.
 * Modul ne dira porudžbine, `order_items` (zamrznute cene) ni finansije.
 *
 * Korak T4 dopunjuje: komentari, checklist, zavisnost i dupliranje, plus
 * ISTORIJU PROMENA — svaka mutirajuća akcija (i one iz T2/T3) upisuje audit
 * red kroz `lib/ticket-events.ts`. Upis je best-effort i nikad ne obara akciju.
 *
 * Korak T5 dopunjuje OBAVEŠTENJA (`lib/ticket-notify.ts`): dodela, komentar,
 * završetak i oslobođena blokada. I ona su best-effort — nijedna greška
 * obaveštenja ne sme da obori akciju, pa se nikad ne proverava povratna
 * vrednost i nikad se ne stavlja u `error`.
 */

export type TicketActionState = {
  error: string | null;
  success?: string | null;
};

function revalidateTickets() {
  revalidatePath("/tiketi");
}

/** Polja tiketa iz FormData (deljeno između kreiranja i izmene). */
function ticketFields(formData: FormData) {
  return {
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    column_id: formData.get("column_id"),
    priority_id: formData.get("priority_id") ?? undefined,
    due_date: formData.get("due_date") ?? undefined,
    estimate_minutes: formData.get("estimate_minutes") ?? undefined,
    blocked_by_ticket_id: formData.get("blocked_by_ticket_id") ?? undefined,
    order_id: formData.get("order_id") ?? undefined,
    variant_id: formData.get("variant_id") ?? undefined,
    customer_id: formData.get("customer_id") ?? undefined,
    assignee_ids: formData.getAll("assignee_ids").map(String),
    tag_ids: formData.getAll("tag_ids").map(String),
  };
}

/** Zameni kompletnu listu izvršilaca tiketa (obriši pa upiši). */
async function replaceAssignees(ticketId: string, userIds: string[]): Promise<string | null> {
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from("ticket_assignees")
    .delete()
    .eq("ticket_id", ticketId);
  if (delError) return "Izmena izvršilaca nije uspela.";
  if (userIds.length === 0) return null;

  const { error } = await supabase
    .from("ticket_assignees")
    .insert(userIds.map((user_id) => ({ ticket_id: ticketId, user_id })));
  return error ? "Izmena izvršilaca nije uspela." : null;
}

/** Zameni kompletnu listu tagova tiketa (obriši pa upiši). */
async function replaceTags(ticketId: string, tagIds: string[]): Promise<string | null> {
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from("ticket_tag_links")
    .delete()
    .eq("ticket_id", ticketId);
  if (delError) return "Izmena tagova nije uspela.";
  if (tagIds.length === 0) return null;

  const { error } = await supabase
    .from("ticket_tag_links")
    .insert(tagIds.map((tag_id) => ({ ticket_id: ticketId, tag_id })));
  return error ? "Izmena tagova nije uspela." : null;
}

/**
 * Da li je tiket upravo UŠAO u završnu kolonu (okidač za `ticket_done` i
 * `ticket_unblocked`). Zastavica `is_done`, nikad hardkodovan UUID — kolone su
 * podesive. Prelaz unutar živog toka ili izlazak iz „Završeno" ne javlja ništa.
 */
async function enteredDoneColumn(
  fromColumnId: string | null,
  toColumnId: string,
  known?: TicketColumnRow[],
) {
  if (!fromColumnId || fromColumnId === toColumnId) return false;
  const columns = known ?? (await getTicketColumns());
  const isDone = (id: string) => columns.find((c) => c.id === id)?.is_done === true;
  return isDone(toColumnId) && !isDone(fromColumnId);
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

export async function createTicket(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = ticketSchema.safeParse(ticketFields(formData));
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { assignee_ids, tag_ids, ...fields } = parsed.data;
  const supabase = await createClient();

  // Nov tiket ide na DNO kolone (position = max + 1000).
  const position = await nextPositionInColumn(supabase, fields.column_id);

  const { data, error } = await supabase
    .from("tickets")
    .insert({ ...fields, position, created_by: userId })
    .select("id, code")
    .single();
  if (error || !data) return { error: "Kreiranje tiketa nije uspelo." };

  const ticketId = (data as { id: string; code: number }).id;
  const linkError =
    (await replaceAssignees(ticketId, assignee_ids)) ?? (await replaceTags(ticketId, tag_ids));

  await logTicketEvent({ ticketId, actorId: userId, kind: "created", to: fields.title });

  // Dodela na kreiranju nema svoj audit red (istorija nosi samo „napravio
  // tiket"), pa obaveštenje ide bez `eventId` — dedup ključ tada nosi id tiketa
  // i korisnika (v. `reference()` u `lib/ticket-notify.ts`).
  await notifyTicketAssigned(
    ticketId,
    userId,
    assignee_ids.map((id) => ({ userId: id, eventId: null })),
  );

  revalidateTickets();
  if (linkError) return { error: null, success: `Tiket kreiran. (${linkError})` };
  return { error: null, success: "Tiket kreiran." };
}

export async function updateTicket(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = updateTicketSchema.safeParse({
    id: formData.get("id"),
    ...ticketFields(formData),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { id, assignee_ids, tag_ids, ...fields } = parsed.data;
  if (fields.blocked_by_ticket_id === id) {
    return { error: "Tiket ne može da čeka sam sebe." };
  }

  const supabase = await createClient();
  // Stanje pre izmene: ulaz u diff za istoriju (i provera da tiket postoji).
  const before = await getTicketSnapshot(supabase, id);
  if (!before) return { error: "Tiket nije pronađen." };

  // Zavisnost ne sme da pravi ciklus (A čeka B, B čeka A) — upozorenje ne
  // blokira rad, ali krug bi zauvek ostavio oba tiketa „blokirana".
  if (
    fields.blocked_by_ticket_id &&
    fields.blocked_by_ticket_id !== before.blocked_by_ticket_id &&
    (await wouldCreateCycle(supabase, id, fields.blocked_by_ticket_id))
  ) {
    return { error: "Ta veza bi napravila krug zavisnosti (tiketi bi čekali jedan drugog)." };
  }

  // Promenjena kolona iz dijaloga → tiket ide na dno nove (DnD ima svoj put).
  const movedColumn = before.column_id !== fields.column_id;
  const position = movedColumn ? await nextPositionInColumn(supabase, fields.column_id) : undefined;

  const { error } = await supabase
    .from("tickets")
    .update(position != null ? { ...fields, position } : fields)
    .eq("id", id);
  if (error) return { error: "Izmena tiketa nije uspela." };

  const linkError = (await replaceAssignees(id, assignee_ids)) ?? (await replaceTags(id, tag_ids));

  const logged = await logTicketUpdate(id, userId, before, {
    ...before,
    ...fields,
    assignee_ids,
    tag_ids,
  });

  await notifyTicketAssigned(id, userId, assignedFromChanges(logged));
  if (movedColumn && (await enteredDoneColumn(before.column_id, fields.column_id))) {
    const columnEvent = logged.find((c) => c.kind === "column");
    await notifyTicketCompleted(id, userId, columnEvent?.eventId ?? null);
  }

  revalidateTickets();
  if (linkError) return { error: null, success: `Tiket izmenjen. (${linkError})` };
  return { error: null, success: "Tiket izmenjen." };
}

export async function deleteTicket(id: string): Promise<TicketActionState> {
  await requireRole("admin", "manager");

  const parsed = ticketIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  // Izvršioci, tagovi, checklist, komentari i istorija idu `on delete cascade`.
  const { error } = await supabase.from("tickets").delete().eq("id", parsed.data.id);
  if (error) return { error: "Brisanje tiketa nije uspelo." };

  revalidateTickets();
  return { error: null, success: "Tiket obrisan." };
}

/**
 * Premeštanje tiketa — drag & drop (T3) i meni „⋮" (T2) idu kroz istu akciju.
 *
 * `neighbors` su id-jevi kartica iznad (`beforeId`) i ispod (`afterId`) mesta
 * ispuštanja; server iz NJIH računa `position` (fractional indexing) — klijent
 * ne šalje broj, pa zastareo board ne može da upiše pogrešnu poziciju. Bez
 * suseda (meni ili prazna kolona) tiket ide na dno.
 *
 * `completed_at` postavlja trigger `tickets_sync_completed_at`, ne app.
 */
export async function moveTicket(
  id: string,
  columnId: string,
  neighbors?: { beforeId?: string | null; afterId?: string | null },
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = moveTicketSchema.safeParse({
    id,
    column_id: columnId,
    before_id: neighbors?.beforeId ?? null,
    after_id: neighbors?.afterId ?? null,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { id: ticketId, column_id, before_id, after_id } = parsed.data;
  const supabase = await createClient();

  // Kolona pre premeštanja — samo za istoriju (pomeranje UNUTAR kolone se ne
  // beleži, to je redosled, ne promena stanja).
  const { data: previous } = await supabase
    .from("tickets")
    .select("column_id")
    .eq("id", ticketId)
    .maybeSingle();
  const fromColumnId = (previous as { column_id: string } | null)?.column_id ?? null;

  let position: number;
  try {
    position =
      before_id || after_id
        ? await positionForMove(supabase, column_id, ticketId, before_id, after_id)
        : await nextPositionInColumn(supabase, column_id);
  } catch {
    return { error: "Premeštanje tiketa nije uspelo." };
  }

  const { error } = await supabase
    .from("tickets")
    .update({ column_id, position })
    .eq("id", ticketId);
  if (error) return { error: "Premeštanje tiketa nije uspelo." };

  if (fromColumnId && fromColumnId !== column_id) {
    const columns = await getTicketColumns();
    const name = (id: string) => columns.find((c) => c.id === id)?.name ?? null;
    const eventId = await logTicketEvent({
      ticketId,
      actorId: userId,
      kind: "column",
      from: name(fromColumnId),
      to: name(column_id),
    });

    if (await enteredDoneColumn(fromColumnId, column_id, columns)) {
      await notifyTicketCompleted(ticketId, userId, eventId);
    }
  }

  revalidateTickets();
  return { error: null, success: "Tiket premešten." };
}

/** Dodela izvršilaca (zamena kompletne liste). */
export async function setAssignees(id: string, userIds: string[]): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = setAssigneesSchema.safeParse({ id, assignee_ids: userIds });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("ticket_assignees")
    .select("user_id")
    .eq("ticket_id", parsed.data.id);
  const before = ((current as { user_id: string }[]) ?? []).map((a) => a.user_id);

  const linkError = await replaceAssignees(parsed.data.id, parsed.data.assignee_ids);
  if (linkError) return { error: linkError };

  const logged = await logTicketChanges(
    parsed.data.id,
    userId,
    await assigneeChanges(before, parsed.data.assignee_ids),
  );

  await notifyTicketAssigned(parsed.data.id, userId, assignedFromChanges(logged));

  revalidateTickets();
  return { error: null, success: "Izvršioci sačuvani." };
}

/** Tagovi tiketa (zamena kompletne liste). */
export async function setTags(id: string, tagIds: string[]): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = setTagsSchema.safeParse({ id, tag_ids: tagIds });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("ticket_tag_links")
    .select("tag_id")
    .eq("ticket_id", parsed.data.id);
  const before = ((current as { tag_id: string }[]) ?? []).map((t) => t.tag_id);

  const linkError = await replaceTags(parsed.data.id, parsed.data.tag_ids);
  if (linkError) return { error: linkError };

  await logTicketChanges(parsed.data.id, userId, await tagChanges(before, parsed.data.tag_ids));

  revalidateTickets();
  return { error: null, success: "Tagovi sačuvani." };
}

/* ── Pretraga veza za dijalog ────────────────────────────────────────────── */

/**
 * Pretraga entiteta za opcione veze tiketa (porudžbina / artikal / kupac /
 * blokirajući tiket). Samo čitanje, kroz RLS klijent.
 */
export async function searchTicketLinks(
  kind: "order" | "variant" | "customer" | "ticket",
  term: string,
  excludeId?: string,
): Promise<TicketLinkOption[]> {
  await requireRole("admin", "manager");

  switch (kind) {
    case "order":
      return searchOrderOptions(term);
    case "variant":
      return searchVariantOptions(term);
    case "customer":
      return searchCustomerOptions(term);
    case "ticket":
      return searchTicketOptions(term, excludeId);
  }
}

/* ── Komentari (Korak T4) ────────────────────────────────────────────────── */

/**
 * Autor komentara je jedini koji sme da ga menja/briše (odluka iz plana).
 * RLS pušta ceo tim na `ticket_comments` (Menadžer je ravnopravan), pa je OVO
 * kapija — provera je server-side, ne samo skrivanje dugmeta u UI-ju.
 */
async function requireCommentAuthor(
  commentId: string,
  userId: string,
): Promise<{ ticketId: string } | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ticket_comments")
    .select("ticket_id, author_id")
    .eq("id", commentId)
    .maybeSingle();

  const row = data as { ticket_id: string; author_id: string | null } | null;
  if (!row) return { error: "Komentar nije pronađen." };
  if (row.author_id !== userId) return { error: "Možeš da menjaš samo svoje komentare." };
  return { ticketId: row.ticket_id };
}

export async function addComment(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = addCommentSchema.safeParse({
    ticket_id: formData.get("ticket_id"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("ticket_comments")
    .insert({
      ticket_id: parsed.data.ticket_id,
      author_id: userId,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error || !created) return { error: "Slanje komentara nije uspelo." };

  await logTicketEvent({ ticketId: parsed.data.ticket_id, actorId: userId, kind: "comment" });

  // Izvršiocima i autoru tiketa — bez onoga ko je komentarisao.
  // `reference_id = comment.id` → svaki komentar javlja tačno jednom.
  await notifyTicketComment(parsed.data.ticket_id, (created as { id: string }).id, userId);

  revalidateTickets();
  return { error: null, success: "Komentar dodat." };
}

export async function editComment(id: string, body: string): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = editCommentSchema.safeParse({ id, body });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const owner = await requireCommentAuthor(parsed.data.id, userId);
  if ("error" in owner) return { error: owner.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ticket_comments")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.id);
  if (error) return { error: "Izmena komentara nije uspela." };

  revalidateTickets();
  return { error: null, success: "Komentar izmenjen." };
}

export async function deleteComment(id: string): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = commentIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const owner = await requireCommentAuthor(parsed.data.id, userId);
  if ("error" in owner) return { error: owner.error };

  const supabase = await createClient();
  const { error } = await supabase.from("ticket_comments").delete().eq("id", parsed.data.id);
  if (error) return { error: "Brisanje komentara nije uspelo." };

  // Brisanje komentara ostavlja trag u istoriji (sadržaj se ne čuva).
  await logTicketEvent({ ticketId: owner.ticketId, actorId: userId, kind: "comment_deleted" });

  revalidateTickets();
  return { error: null, success: "Komentar obrisan." };
}

/* ── Checklist (Korak T4) ────────────────────────────────────────────────── */

export async function addChecklistItem(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = addChecklistItemSchema.safeParse({
    ticket_id: formData.get("ticket_id"),
    label: formData.get("label"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("ticket_checklist_items")
    .select("sort_order")
    .eq("ticket_id", parsed.data.ticket_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("ticket_checklist_items").insert({
    ticket_id: parsed.data.ticket_id,
    label: parsed.data.label,
    sort_order: sortOrder,
  });
  if (error) return { error: "Dodavanje stavke nije uspelo." };

  await logTicketEvent({
    ticketId: parsed.data.ticket_id,
    actorId: userId,
    kind: "checklist",
    to: parsed.data.label,
    meta: { action: "added" },
  });

  revalidateTickets();
  return { error: null, success: "Stavka dodata." };
}

/** Štikliranje stavke — `done_at`/`done_by` prate zastavicu. */
export async function toggleChecklistItem(id: string, done: boolean): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = toggleChecklistItemSchema.safeParse({ id, done });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("ticket_checklist_items")
    .select("ticket_id, label")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const row = item as { ticket_id: string; label: string } | null;
  if (!row) return { error: "Stavka nije pronađena." };

  const { error } = await supabase
    .from("ticket_checklist_items")
    .update({
      done: parsed.data.done,
      done_at: parsed.data.done ? new Date().toISOString() : null,
      done_by: parsed.data.done ? userId : null,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: "Izmena stavke nije uspela." };

  await logTicketEvent({
    ticketId: row.ticket_id,
    actorId: userId,
    kind: "checklist",
    to: row.label,
    meta: { action: parsed.data.done ? "done" : "undone" },
  });

  revalidateTickets();
  return { error: null, success: parsed.data.done ? "Stavka štiklirana." : "Stavka vraćena." };
}

export async function deleteChecklistItem(id: string): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = checklistItemIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("ticket_checklist_items")
    .select("ticket_id, label")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const row = item as { ticket_id: string; label: string } | null;
  if (!row) return { error: "Stavka nije pronađena." };

  const { error } = await supabase.from("ticket_checklist_items").delete().eq("id", parsed.data.id);
  if (error) return { error: "Brisanje stavke nije uspelo." };

  await logTicketEvent({
    ticketId: row.ticket_id,
    actorId: userId,
    kind: "checklist",
    from: row.label,
    meta: { action: "deleted" },
  });

  revalidateTickets();
  return { error: null, success: "Stavka obrisana." };
}

/* ── Zavisnost „čeka drugi tiket" (Korak T4) ─────────────────────────────── */

/**
 * Postavi/skini tiket koji blokira ovaj. Zavisnost je SAMO UPOZORENJE — ne
 * blokira nijednu akciju (zaključana odluka). Ciklus (A čeka B, B čeka A)
 * server odbija, jer bi oba tiketa zauvek stajala „blokirana".
 */
export async function setBlockedBy(
  id: string,
  blockedByTicketId: string | null,
): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = setBlockedBySchema.safeParse({
    id,
    blocked_by_ticket_id: blockedByTicketId ?? "none",
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const target = parsed.data.blocked_by_ticket_id;
  if (target === parsed.data.id) return { error: "Tiket ne može da čeka sam sebe." };

  const supabase = await createClient();

  const before = await getTicketSnapshot(supabase, parsed.data.id);
  if (!before) return { error: "Tiket nije pronađen." };
  if (before.blocked_by_ticket_id === target)
    return { error: null, success: "Zavisnost sačuvana." };

  if (target && (await wouldCreateCycle(supabase, parsed.data.id, target))) {
    return { error: "Ta veza bi napravila krug zavisnosti (tiketi bi čekali jedan drugog)." };
  }

  const { error } = await supabase
    .from("tickets")
    .update({ blocked_by_ticket_id: target })
    .eq("id", parsed.data.id);
  if (error) return { error: "Čuvanje zavisnosti nije uspelo." };

  await logTicketUpdate(parsed.data.id, userId, before, {
    ...before,
    blocked_by_ticket_id: target,
  });

  revalidateTickets();
  return { error: null, success: target ? "Zavisnost postavljena." : "Zavisnost sklonjena." };
}

/* ── Dupliranje (Korak T4) ───────────────────────────────────────────────── */

/**
 * Kopija tiketa po pravilima iz plana.
 *
 * KOPIRA: naslov + „ (kopija)", opis, prioritet, tagove, izvršioce, procenu i
 * checklist (sve stavke NEŠTIKLIRANE).
 * NE KOPIRA: komentare, istoriju, rok, veze (porudžbina/artikal/kupac),
 * zavisnost i `completed_at`.
 *
 * Kopija ostaje u koloni originala; ako je original u završnoj koloni, ide u
 * prvu (inače bi kopija odmah bila „završena" preko trigera `is_done`).
 */
export async function duplicateTicket(id: string): Promise<TicketActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = ticketIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("tickets")
    .select("id, code, title, description, column_id, priority_id, estimate_minutes")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const original = source as {
    id: string;
    code: number;
    title: string;
    description: string | null;
    column_id: string;
    priority_id: string | null;
    estimate_minutes: number | null;
  } | null;
  if (!original) return { error: "Tiket nije pronađen." };

  const columns = await getTicketColumns();
  const sourceColumn = columns.find((c) => c.id === original.column_id);
  const columnId = sourceColumn && !sourceColumn.is_done ? original.column_id : columns[0]?.id;
  if (!columnId) return { error: "Nema nijedne kolone — dodaj je u Podešavanjima." };

  const position = await nextPositionInColumn(supabase, columnId);
  const { data: created, error } = await supabase
    .from("tickets")
    .insert({
      title: `${original.title} (kopija)`.slice(0, 160),
      description: original.description,
      column_id: columnId,
      priority_id: original.priority_id,
      estimate_minutes: original.estimate_minutes,
      position,
      created_by: userId,
    })
    .select("id, code")
    .single();
  if (error || !created) return { error: "Dupliranje tiketa nije uspelo." };

  const copy = created as { id: string; code: number };

  // Izvršioci, tagovi i checklist se prenose; checklist ide NEŠTIKLIRAN.
  const [{ data: assignees }, { data: tags }, { data: checklist }] = await Promise.all([
    supabase.from("ticket_assignees").select("user_id").eq("ticket_id", original.id),
    supabase.from("ticket_tag_links").select("tag_id").eq("ticket_id", original.id),
    supabase
      .from("ticket_checklist_items")
      .select("label, sort_order")
      .eq("ticket_id", original.id)
      .order("sort_order", { ascending: true }),
  ]);

  const assigneeIds = ((assignees as { user_id: string }[]) ?? []).map((a) => a.user_id);
  const tagIds = ((tags as { tag_id: string }[]) ?? []).map((t) => t.tag_id);
  const items = (checklist as { label: string; sort_order: number }[]) ?? [];

  const linkError =
    (await replaceAssignees(copy.id, assigneeIds)) ?? (await replaceTags(copy.id, tagIds));

  if (items.length > 0) {
    await supabase.from("ticket_checklist_items").insert(
      items.map((i) => ({
        ticket_id: copy.id,
        label: i.label,
        sort_order: i.sort_order,
        done: false,
      })),
    );
  }

  const originalCode = formatTicketCode(original.code);
  const copyCode = formatTicketCode(copy.code);
  await logTicketEvent({
    ticketId: original.id,
    actorId: userId,
    kind: "duplicated",
    to: copyCode,
  });
  await logTicketEvent({
    ticketId: copy.id,
    actorId: userId,
    kind: "duplicated",
    from: originalCode,
  });

  revalidateTickets();
  const suffix = linkError ? ` (${linkError})` : "";
  return { error: null, success: `Kopija napravljena — ${copyCode}.${suffix}` };
}
