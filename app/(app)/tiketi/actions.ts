"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  nextPositionInColumn,
  positionForMove,
  searchCustomerOptions,
  searchOrderOptions,
  searchTicketOptions,
  searchVariantOptions,
  type TicketLinkOption,
} from "@/db/tickets";
import {
  moveTicketSchema,
  setAssigneesSchema,
  setTagsSchema,
  ticketIdSchema,
  ticketSchema,
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

  revalidateTickets();
  if (linkError) return { error: null, success: `Tiket kreiran. (${linkError})` };
  return { error: null, success: "Tiket kreiran." };
}

export async function updateTicket(
  _prev: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  await requireRole("admin", "manager");

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
  const { data: existing } = await supabase
    .from("tickets")
    .select("column_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "Tiket nije pronađen." };

  // Promenjena kolona iz dijaloga → tiket ide na dno nove (DnD ima svoj put).
  const movedColumn = (existing as { column_id: string }).column_id !== fields.column_id;
  const position = movedColumn ? await nextPositionInColumn(supabase, fields.column_id) : undefined;

  const { error } = await supabase
    .from("tickets")
    .update(position != null ? { ...fields, position } : fields)
    .eq("id", id);
  if (error) return { error: "Izmena tiketa nije uspela." };

  const linkError = (await replaceAssignees(id, assignee_ids)) ?? (await replaceTags(id, tag_ids));

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
  await requireRole("admin", "manager");

  const parsed = moveTicketSchema.safeParse({
    id,
    column_id: columnId,
    before_id: neighbors?.beforeId ?? null,
    after_id: neighbors?.afterId ?? null,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { id: ticketId, column_id, before_id, after_id } = parsed.data;
  const supabase = await createClient();

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

  revalidateTickets();
  return { error: null, success: "Tiket premešten." };
}

/** Dodela izvršilaca (zamena kompletne liste). */
export async function setAssignees(id: string, userIds: string[]): Promise<TicketActionState> {
  await requireRole("admin", "manager");

  const parsed = setAssigneesSchema.safeParse({ id, assignee_ids: userIds });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const linkError = await replaceAssignees(parsed.data.id, parsed.data.assignee_ids);
  if (linkError) return { error: linkError };

  revalidateTickets();
  return { error: null, success: "Izvršioci sačuvani." };
}

/** Tagovi tiketa (zamena kompletne liste). */
export async function setTags(id: string, tagIds: string[]): Promise<TicketActionState> {
  await requireRole("admin", "manager");

  const parsed = setTagsSchema.safeParse({ id, tag_ids: tagIds });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const linkError = await replaceTags(parsed.data.id, parsed.data.tag_ids);
  if (linkError) return { error: linkError };

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
