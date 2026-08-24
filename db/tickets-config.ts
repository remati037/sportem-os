import "server-only";

import { createClient } from "@/lib/supabase/server";

/*
 * Config upiti modula Tiketi (Korak T1): kolone, prioriteti, tagovi.
 * Čitaju kroz RLS klijent — vide ih Admin i Menadžer, Logistika ništa
 * (deny-by-default, nema politiku ni na jednoj ticket tabeli).
 *
 * `is_done` i podrazumevani prioritet se čitaju po zastavici, nikad po
 * hardkodovanom UUID-u (pravilo iz CLAUDE.md, obrazac `APP_STATUS`).
 */

export type TicketColumnRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_done: boolean;
  wip_limit: number | null;
};

export type TicketPriorityRow = {
  id: string;
  name: string;
  color: string | null;
  level: number;
  is_default: boolean;
  sort_order: number;
};

export type TicketTagRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  archived_at: string | null;
};

/** Kolone board-a po redosledu prikaza. */
export async function getTicketColumns(): Promise<TicketColumnRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ticket_columns")
    .select("id, name, color, sort_order, is_done, wip_limit")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data as unknown as TicketColumnRow[]) ?? [];
}

/** Prioriteti po redosledu prikaza. */
export async function getTicketPriorities(): Promise<TicketPriorityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ticket_priorities")
    .select("id, name, color, level, is_default, sort_order")
    .order("sort_order", { ascending: true })
    .order("level", { ascending: true });
  return (data as unknown as TicketPriorityRow[]) ?? [];
}

/**
 * Tagovi po redosledu prikaza. Podrazumevano samo aktivni — arhivirani se ne
 * nude u izboru, ali ostaju na starim tiketima (zato `includeArchived` za
 * Podešavanja i prikaz istorije).
 */
export async function getTicketTags({
  includeArchived = false,
}: { includeArchived?: boolean } = {}): Promise<TicketTagRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ticket_tags")
    .select("id, name, color, sort_order, archived_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!includeArchived) query = query.is("archived_at", null);

  const { data } = await query;
  return (data as unknown as TicketTagRow[]) ?? [];
}

/** Podrazumevani prioritet (po zastavici) — `null` ako nijedan nije označen. */
export function defaultPriority(priorities: TicketPriorityRow[]): TicketPriorityRow | null {
  return priorities.find((p) => p.is_default) ?? null;
}

/** Završna kolona (po zastavici) — `null` ako nijedna nije označena. */
export function doneColumn(columns: TicketColumnRow[]): TicketColumnRow | null {
  return columns.find((c) => c.is_done) ?? null;
}
