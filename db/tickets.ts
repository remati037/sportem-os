import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getTicketColumns, type TicketColumnRow } from "@/db/tickets-config";
import { listStaffProfiles } from "@/db/profiles";
import { todayBelgrade } from "@/lib/date-belgrade";
import type { TicketEventRow, TicketFieldSnapshot } from "@/lib/ticket-events";
import { TICKET_ARCHIVE_DAYS, TICKET_POSITION_STEP, parseTicketParam } from "@/lib/tickets";

/*
 * Upiti modula Tiketi (Korak T2). Čitaju kroz RLS klijent — vide ih samo
 * Admin i Menadžer, Logistika ništa (deny-by-default, bez politike).
 *
 * Bez N+1: board se sklapa iz nekoliko upita (tiketi, izvršioci, tagovi,
 * vezani entiteti) i spaja u JS-u po id-u. Imena izvršilaca dolaze iz
 * `listStaffProfiles()` (service-role) jer RLS na `profiles` Menadžeru
 * pokazuje samo njegov red.
 *
 * NE dira porudžbine, `order_items` (zamrznute cene) ni finansije — veze na
 * porudžbinu/varijantu/kupca su samo čitanje za prikaz.
 */

export type TicketAssignee = { user_id: string; full_name: string | null };
export type TicketTagRef = { id: string; name: string; color: string | null };
export type TicketPriorityRef = { id: string; name: string; color: string | null; level: number };

/** Vezana porudžbina — link ide na Woo broj (kao svuda u app-u). */
export type TicketOrderRef = { id: string; woo_order_id: number | null; ship_name: string | null };
export type TicketVariantRef = { id: string; sku: string; label: string };
export type TicketCustomerRef = { id: string; name: string | null; phone: string | null };
export type TicketRef = { id: string; code: number; title: string; done: boolean };

export type TicketListRow = {
  id: string;
  code: number;
  title: string;
  description: string | null;
  column_id: string;
  priority_id: string | null;
  position: number;
  due_date: string | null;
  estimate_minutes: number | null;
  completed_at: string | null;
  source: string;
  created_at: string;
  blocked_by_ticket_id: string | null;
  /** Tiket koji blokira ovaj („čeka drugi tiket") — vizuelno, ne blokira. */
  blocked_by: TicketRef | null;
  order_id: string | null;
  variant_id: string | null;
  customer_id: string | null;
  priority: TicketPriorityRef | null;
  assignees: TicketAssignee[];
  tags: TicketTagRef[];
  order: TicketOrderRef | null;
  variant: TicketVariantRef | null;
  customer: TicketCustomerRef | null;
};

export type TicketDetail = TicketListRow & {
  created_by_name: string | null;
};

export type TicketBoardColumn = TicketColumnRow & { tickets: TicketListRow[] };

export type TicketBoard = {
  columns: TicketBoardColumn[];
  /** Ukupan broj tiketa u prikazu (posle filtera). */
  total: number;
  /** Završeni stariji od 14 dana koji su sakriveni (dugme „Prikaži arhivu"). */
  archivedHidden: number;
};

export type TicketFilters = {
  columnId?: string;
  /** `user_id` izvršioca. */
  assigneeId?: string;
  tagId?: string;
  priorityId?: string;
  /** Pretraga po naslovu ili šifri („SPT-42" / „42"). */
  search?: string;
  /** Samo tiketi dodeljeni ulogovanom korisniku. */
  onlyMine?: boolean;
  currentUserId?: string;
  /** Traka roka: probijen / danas. */
  due?: "probijen" | "danas";
  /** Prikaži i završene starije od `TICKET_ARCHIVE_DAYS`. */
  includeArchived?: boolean;
};

const TICKET_COLS = `id, code, title, description, column_id, priority_id, position, due_date,
  estimate_minutes, completed_at, source, created_at, blocked_by_ticket_id,
  order_id, variant_id, customer_id, created_by,
  priority:ticket_priorities(id, name, color, level)`;

/** Gornja granica skeniranja — interni board, ne dozvoljava tihi PostgREST rez. */
const SCAN_CAP = 2000;

type TicketRaw = Omit<
  TicketListRow,
  "assignees" | "tags" | "order" | "variant" | "customer" | "blocked_by"
> & {
  created_by: string | null;
  priority: TicketPriorityRef | null;
};

/** Ukloni znakove koji lome PostgREST `or()` sintaksu (kao u db/orders.ts). */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()%]/g, " ").trim();
}

/** ISO granica arhive: završeni pre ovog trenutka se sakrivaju. */
function archiveCutoffIso(): string {
  return new Date(Date.now() - TICKET_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Id-jevi tiketa koji prolaze M:N filtere (izvršilac / tag). `null` = filter
 * nije zadat; prazan niz = nijedan tiket ne prolazi.
 */
async function filterIdsByLinks(
  supabase: SupabaseClient,
  filters: TicketFilters,
): Promise<string[] | null> {
  const sets: string[][] = [];

  const assignee = filters.onlyMine ? filters.currentUserId : filters.assigneeId;
  if (assignee) {
    const { data } = await supabase
      .from("ticket_assignees")
      .select("ticket_id")
      .eq("user_id", assignee);
    sets.push(((data as { ticket_id: string }[]) ?? []).map((r) => r.ticket_id));
  }

  if (filters.tagId) {
    const { data } = await supabase
      .from("ticket_tag_links")
      .select("ticket_id")
      .eq("tag_id", filters.tagId);
    sets.push(((data as { ticket_id: string }[]) ?? []).map((r) => r.ticket_id));
  }

  if (sets.length === 0) return null;
  // Presek svih zadatih filtera (npr. „moji" + tag).
  return sets.reduce((acc, set) => acc.filter((id) => set.includes(id)));
}

/** Dopuni tikete izvršiocima, tagovima i vezanim entitetima (batch, bez N+1). */
async function hydrateTickets(
  supabase: SupabaseClient,
  raw: TicketRaw[],
): Promise<{ rows: TicketListRow[]; nameById: Map<string, string | null> }> {
  const ids = raw.map((t) => t.id);
  const orderIds = [...new Set(raw.map((t) => t.order_id).filter(Boolean) as string[])];
  const variantIds = [...new Set(raw.map((t) => t.variant_id).filter(Boolean) as string[])];
  const customerIds = [...new Set(raw.map((t) => t.customer_id).filter(Boolean) as string[])];
  const blockerIds = [
    ...new Set(raw.map((t) => t.blocked_by_ticket_id).filter(Boolean) as string[]),
  ];

  const [assigneeRows, tagRows, staff, orders, variants, customers, blockers] = await Promise.all([
    ids.length
      ? supabase.from("ticket_assignees").select("ticket_id, user_id").in("ticket_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("ticket_tag_links")
          .select("ticket_id, tag:ticket_tags(id, name, color, sort_order)")
          .in("ticket_id", ids)
      : Promise.resolve({ data: [] }),
    listStaffProfiles(),
    orderIds.length
      ? supabase.from("orders").select("id, woo_order_id, ship_name").in("id", orderIds)
      : Promise.resolve({ data: [] }),
    variantIds.length
      ? supabase
          .from("product_variants")
          .select("id, sku, variant_name, product:products(name)")
          .in("id", variantIds)
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? supabase.from("customers").select("id, name, phone").in("id", customerIds)
      : Promise.resolve({ data: [] }),
    blockerIds.length
      ? supabase.from("tickets").select("id, code, title, completed_at").in("id", blockerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const nameById = new Map(staff.map((p) => [p.id, p.full_name]));

  const assigneesByTicket = new Map<string, TicketAssignee[]>();
  for (const row of (assigneeRows.data as { ticket_id: string; user_id: string }[]) ?? []) {
    const list = assigneesByTicket.get(row.ticket_id) ?? [];
    list.push({ user_id: row.user_id, full_name: nameById.get(row.user_id) ?? null });
    assigneesByTicket.set(row.ticket_id, list);
  }

  const tagsByTicket = new Map<string, (TicketTagRef & { sort_order: number })[]>();
  for (const row of (tagRows.data as unknown as {
    ticket_id: string;
    tag: (TicketTagRef & { sort_order: number }) | null;
  }[]) ?? []) {
    if (!row.tag) continue;
    const list = tagsByTicket.get(row.ticket_id) ?? [];
    list.push(row.tag);
    tagsByTicket.set(row.ticket_id, list);
  }

  const orderById = new Map(
    ((orders.data as TicketOrderRef[]) ?? []).map((o) => [o.id, o] as const),
  );
  const variantById = new Map(
    (
      (variants.data as unknown as {
        id: string;
        sku: string;
        variant_name: string | null;
        product: { name: string } | null;
      }[]) ?? []
    ).map((v) => {
      const productName = v.product?.name ?? "";
      const label = v.variant_name ? `${productName} — ${v.variant_name}` : productName;
      return [v.id, { id: v.id, sku: v.sku, label: label || v.sku } satisfies TicketVariantRef];
    }),
  );
  const customerById = new Map(
    ((customers.data as TicketCustomerRef[]) ?? []).map((c) => [c.id, c] as const),
  );
  const blockerById = new Map(
    (
      (blockers.data as {
        id: string;
        code: number;
        title: string;
        completed_at: string | null;
      }[]) ?? []
    ).map((b) => [
      b.id,
      { id: b.id, code: b.code, title: b.title, done: b.completed_at != null } satisfies TicketRef,
    ]),
  );

  // Polja se prepisuju eksplicitno da `created_by` (interni user id) NE ode na
  // klijent — kartice i dijalog dobijaju samo ono što prikazuju.
  const rows: TicketListRow[] = raw.map((t) => ({
    id: t.id,
    code: t.code,
    title: t.title,
    description: t.description,
    column_id: t.column_id,
    priority_id: t.priority_id,
    position: t.position,
    due_date: t.due_date,
    estimate_minutes: t.estimate_minutes,
    completed_at: t.completed_at,
    source: t.source,
    created_at: t.created_at,
    blocked_by_ticket_id: t.blocked_by_ticket_id,
    order_id: t.order_id,
    variant_id: t.variant_id,
    customer_id: t.customer_id,
    priority: t.priority,
    assignees: (assigneesByTicket.get(t.id) ?? []).sort((a, b) =>
      (a.full_name ?? "").localeCompare(b.full_name ?? "", "sr"),
    ),
    tags: (tagsByTicket.get(t.id) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "sr"))
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    blocked_by: t.blocked_by_ticket_id ? (blockerById.get(t.blocked_by_ticket_id) ?? null) : null,
    order: t.order_id ? (orderById.get(t.order_id) ?? null) : null,
    variant: t.variant_id ? (variantById.get(t.variant_id) ?? null) : null,
    customer: t.customer_id ? (customerById.get(t.customer_id) ?? null) : null,
  }));

  return { rows, nameById };
}

/**
 * Board: kolone + tiketi u njima, filtrirano. Sortiranje unutar kolone je
 * `position ASC` — ručni redosled sa board-a (T3) piše upravo u `position`.
 */
export async function listTickets(filters: TicketFilters = {}): Promise<TicketBoard> {
  const supabase = await createClient();
  const columns = await getTicketColumns();
  const emptyBoard = (): TicketBoard => ({
    columns: columns.map((c) => ({ ...c, tickets: [] })),
    total: 0,
    archivedHidden: 0,
  });

  const linkIds = await filterIdsByLinks(supabase, filters);
  if (linkIds !== null && linkIds.length === 0) return emptyBoard();

  let query = supabase.from("tickets").select(TICKET_COLS);
  if (linkIds) query = query.in("id", linkIds);
  if (filters.columnId) query = query.eq("column_id", filters.columnId);
  if (filters.priorityId) query = query.eq("priority_id", filters.priorityId);

  const today = todayBelgrade();
  if (filters.due === "probijen") query = query.lt("due_date", today).is("completed_at", null);
  if (filters.due === "danas") query = query.eq("due_date", today);

  const term = sanitizeTerm(filters.search ?? "");
  if (term) {
    const code = parseTicketParam(term);
    const orParts = [`title.ilike.%${term}%`];
    if (code != null) orParts.push(`code.eq.${code}`);
    query = query.or(orParts.join(","));
  }

  const { data } = await query
    .order("position", { ascending: true })
    .order("code", { ascending: true })
    .range(0, SCAN_CAP - 1);

  let raw = (data as unknown as TicketRaw[]) ?? [];

  // Auto-sakrivanje završenih starijih od 14 dana (ništa se ne briše).
  let archivedHidden = 0;
  if (!filters.includeArchived) {
    const cutoff = archiveCutoffIso();
    const before = raw.length;
    raw = raw.filter((t) => !(t.completed_at && t.completed_at < cutoff));
    archivedHidden = before - raw.length;
  }

  const { rows } = await hydrateTickets(supabase, raw);

  const byColumn = new Map<string, TicketListRow[]>();
  for (const row of rows) {
    const list = byColumn.get(row.column_id) ?? [];
    list.push(row);
    byColumn.set(row.column_id, list);
  }

  return {
    columns: columns.map((c) => ({ ...c, tickets: byColumn.get(c.id) ?? [] })),
    total: rows.length,
    archivedHidden,
  };
}

/**
 * Detalj tiketa po URL parametru („SPT-42" / „42" = šifra, inače UUID —
 * rezerva za direktne linkove). `null` → 404.
 *
 * `cache()` deduplikuje pozive unutar istog zahteva (obrazac iz `lib/auth.ts`):
 * modal čita naslov za zaglavlje, a `TicketDetail` isti tiket za sadržaj — jedan
 * upit, ne dva.
 */
export const getTicketDetail = cache(async (param: string): Promise<TicketDetail | null> => {
  const supabase = await createClient();
  const code = parseTicketParam(param);

  let query = supabase.from("tickets").select(TICKET_COLS);
  query = code != null ? query.eq("code", code) : query.eq("id", param);

  const { data } = await query.maybeSingle();
  if (!data) return null;

  const raw = data as unknown as TicketRaw;
  const { rows, nameById } = await hydrateTickets(supabase, [raw]);
  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    created_by_name: raw.created_by ? (nameById.get(raw.created_by) ?? null) : null,
  };
});

/**
 * Sledeća `position` na dnu kolone: `max(position) + 1000`. Fractional
 * indexing (T3) kasnije ubacuje sredinu između suseda; ovde je dovoljno dno.
 */
export async function nextPositionInColumn(
  supabase: SupabaseClient,
  columnId: string,
): Promise<number> {
  const { data } = await supabase
    .from("tickets")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = (data as { position: number } | null)?.position ?? 0;
  return Number(max) + TICKET_POSITION_STEP;
}

/* ── Pretraga za veze u dijalogu (porudžbina / artikal / kupac) ──────────── */

export type TicketLinkOption = { id: string; label: string; hint?: string };

const LINK_LIMIT = 15;

/** Porudžbine po Woo broju ili imenu primaoca. */
export async function searchOrderOptions(term: string): Promise<TicketLinkOption[]> {
  const supabase = await createClient();
  const q = sanitizeTerm(term);
  let query = supabase.from("orders").select("id, woo_order_id, ship_name, ordered_at");

  if (q) {
    const orParts = [`ship_name.ilike.%${q}%`];
    if (/^\d+$/.test(q)) orParts.push(`woo_order_id.eq.${q}`);
    query = query.or(orParts.join(","));
  }

  const { data } = await query
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(LINK_LIMIT);

  return (
    (data as { id: string; woo_order_id: number | null; ship_name: string | null }[]) ?? []
  ).map((o) => ({
    id: o.id,
    label: o.woo_order_id != null ? `#${o.woo_order_id}` : "Bez Woo broja",
    hint: o.ship_name ?? undefined,
  }));
}

/** Aktivne varijante po SKU ili nazivu proizvoda. */
export async function searchVariantOptions(term: string): Promise<TicketLinkOption[]> {
  const supabase = await createClient();
  const q = sanitizeTerm(term);
  let query = supabase
    .from("product_variants")
    .select("id, sku, variant_name, product:products(name)")
    .is("archived_at", null);

  if (q) query = query.ilike("sku", `%${q}%`);

  const { data } = await query.order("sku", { ascending: true }).limit(LINK_LIMIT);
  const rows =
    (data as unknown as {
      id: string;
      sku: string;
      variant_name: string | null;
      product: { name: string } | null;
    }[]) ?? [];

  // Pretraga po nazivu proizvoda ide zasebno (embed se ne filtrira kroz ilike).
  if (q && rows.length < LINK_LIMIT) {
    const { data: products } = await supabase
      .from("products")
      .select("id")
      .ilike("name", `%${q}%`)
      .limit(LINK_LIMIT);
    const productIds = ((products as { id: string }[]) ?? []).map((p) => p.id);
    if (productIds.length > 0) {
      const { data: more } = await supabase
        .from("product_variants")
        .select("id, sku, variant_name, product:products(name)")
        .is("archived_at", null)
        .in("product_id", productIds)
        .order("sku", { ascending: true })
        .limit(LINK_LIMIT);
      for (const v of (more as unknown as typeof rows) ?? []) {
        if (!rows.some((r) => r.id === v.id)) rows.push(v);
      }
    }
  }

  return rows.slice(0, LINK_LIMIT).map((v) => ({
    id: v.id,
    label: v.sku,
    hint: [v.product?.name, v.variant_name].filter(Boolean).join(" — ") || undefined,
  }));
}

/** Kupci po imenu ili telefonu. */
export async function searchCustomerOptions(term: string): Promise<TicketLinkOption[]> {
  const supabase = await createClient();
  const q = sanitizeTerm(term);
  let query = supabase.from("customers").select("id, name, phone");

  if (q) {
    const digits = q.replace(/\D/g, "");
    const orParts = [`name.ilike.%${q}%`];
    if (digits.length >= 3) orParts.push(`phone.ilike.%${digits}%`);
    query = query.or(orParts.join(","));
  }

  const { data } = await query.order("name", { ascending: true }).limit(LINK_LIMIT);
  return ((data as { id: string; name: string | null; phone: string | null }[]) ?? []).map((c) => ({
    id: c.id,
    label: c.name ?? "Bez imena",
    hint: c.phone ?? undefined,
  }));
}

/** Tiketi za izbor „čeka drugi tiket" (bez samog sebe). */
export async function searchTicketOptions(
  term: string,
  excludeId?: string,
): Promise<TicketLinkOption[]> {
  const supabase = await createClient();
  const q = sanitizeTerm(term);
  let query = supabase.from("tickets").select("id, code, title");

  if (q) {
    const code = parseTicketParam(q);
    const orParts = [`title.ilike.%${q}%`];
    if (code != null) orParts.push(`code.eq.${code}`);
    query = query.or(orParts.join(","));
  }
  if (excludeId) query = query.neq("id", excludeId);

  const { data } = await query.order("code", { ascending: false }).limit(LINK_LIMIT);
  return ((data as { id: string; code: number; title: string }[]) ?? []).map((t) => ({
    id: t.id,
    label: `SPT-${t.code}`,
    hint: t.title,
  }));
}

/* ── Ručni redosled: fractional indexing (Korak T3) ─────────────────────── */

/**
 * Najmanji dozvoljen razmak između dve susedne `position` vrednosti. Kad
 * polovljenje padne ispod ovoga, kolona se prenumeriše na `1000, 2000, 3000…`
 * (numeric je egzaktan, ali beskonačno polovljenje ne želimo ni u bazi ni u
 * JSON-u koji putuje na klijent).
 */
const MIN_POSITION_GAP = 0.0001;

type PositionRow = { id: string; position: number };

/** Tiketi jedne kolone u redosledu prikaza (`position ASC`, pa `code ASC`). */
async function columnOrder(supabase: SupabaseClient, columnId: string): Promise<PositionRow[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id, position")
    .eq("column_id", columnId)
    .order("position", { ascending: true })
    .order("code", { ascending: true })
    .range(0, SCAN_CAP - 1);
  if (error) throw new Error(error.message);
  return ((data as PositionRow[]) ?? []).map((r) => ({ id: r.id, position: Number(r.position) }));
}

/**
 * Prenumeracija kolone na `1000, 2000, 3000…` sa premeštenim tiketom već na
 * svom mestu; vraća poziciju premeštenog (nju upisuje sama akcija, zajedno sa
 * `column_id`).
 *
 * Bez DB transakcije (PostgREST nema `begin`; RPC bi tražio migraciju, a T3 ne
 * dira šemu) — upisi idu redom. Najgori ishod ukrštanja dva korisnika je
 * kozmetički redosled u koloni, nikad gubitak tiketa.
 */
async function renumberColumn(
  supabase: SupabaseClient,
  rows: PositionRow[],
  movingId: string,
  index: number,
): Promise<number> {
  const ordered = rows.map((r) => r.id);
  ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, movingId);

  let movedPosition = TICKET_POSITION_STEP;
  for (let i = 0; i < ordered.length; i += 1) {
    const id = ordered[i]!;
    const position = (i + 1) * TICKET_POSITION_STEP;
    if (id === movingId) {
      movedPosition = position;
      continue;
    }
    const { error } = await supabase.from("tickets").update({ position }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  return movedPosition;
}

/**
 * Pozicija tiketa na osnovu SUSEDA, ne klijentskog broja — klijent šalje samo
 * „ko je iznad" (`beforeId`) i „ko je ispod" (`afterId`), a server čita njihove
 * stvarne pozicije iz baze. Guard za istovremeni rad dvoje ljudi: zastarela
 * klijentska pozicija ne može da upiše pogrešan broj.
 *
 * Bez suseda → dno kolone (obrazac „premesti" iz menija i prazna kolona).
 */
export async function positionForMove(
  supabase: SupabaseClient,
  columnId: string,
  movingId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<number> {
  // Tiket koji se premešta ne sme da bude sam sebi sused (pomeranje u koloni).
  const rows = (await columnOrder(supabase, columnId)).filter((r) => r.id !== movingId);

  const beforeIdx = beforeId ? rows.findIndex((r) => r.id === beforeId) : -1;
  const afterIdx = afterId ? rows.findIndex((r) => r.id === afterId) : -1;

  // Sused sa druge strane se dopunjuje iz BAZE kad ga klijent nema: filter na
  // board-u može da sakrije tiket koji stvarno stoji između — tako sakriveni
  // ostaje sa svoje strane umesto da ga premešteni preskoči.
  let prev: number | null = null;
  let next: number | null = null;
  if (beforeIdx >= 0) {
    prev = rows[beforeIdx]!.position;
    next = afterIdx >= 0 ? rows[afterIdx]!.position : (rows[beforeIdx + 1]?.position ?? null);
  } else if (afterIdx >= 0) {
    next = rows[afterIdx]!.position;
    prev = rows[afterIdx - 1]?.position ?? null;
  }

  // Nijedan sused nije pronađen (dno kolone ili zastarela klijentska lista).
  if (prev == null && next == null) {
    const max = rows.length > 0 ? rows[rows.length - 1]!.position : 0;
    return max + TICKET_POSITION_STEP;
  }
  if (prev == null) return next! - TICKET_POSITION_STEP; // vrh kolone
  if (next == null) return prev + TICKET_POSITION_STEP; // dno kolone

  if (next - prev >= MIN_POSITION_GAP) return (prev + next) / 2;

  // Razmak potrošen → prenumeracija cele kolone; tiket ulazi na svoje mesto.
  const insertIndex = beforeIdx >= 0 ? beforeIdx + 1 : afterIdx;
  return renumberColumn(supabase, rows, movingId, insertIndex);
}

/* ── Detalj tiketa: komentari, checklist, istorija, veze (Korak T4) ──────── */

export type TicketCommentRow = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** Autor sme da menja/briše svoj komentar — klijent poredi sa svojim id-jem. */
  author_id: string | null;
  authorName: string | null;
};

export type TicketChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  sort_order: number;
  done_at: string | null;
  doneByName: string | null;
};

/** Nit komentara (najstariji prvo, kao istorija statusa porudžbine). */
export async function getTicketComments(ticketId: string): Promise<TicketCommentRow[]> {
  const supabase = await createClient();
  const [{ data }, staff] = await Promise.all([
    supabase
      .from("ticket_comments")
      .select("id, body, created_at, updated_at, author_id")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    listStaffProfiles(),
  ]);

  // Imena idu iz `listStaffProfiles()` (service-role): RLS na `profiles`
  // Menadžeru pokazuje samo njegov red, pa embed ne bi vratio tuđa imena.
  const nameById = new Map(staff.map((p) => [p.id, p.full_name]));
  return (
    (data as {
      id: string;
      body: string;
      created_at: string;
      updated_at: string;
      author_id: string | null;
    }[]) ?? []
  ).map((c) => ({
    ...c,
    authorName: c.author_id ? (nameById.get(c.author_id) ?? null) : null,
  }));
}

/** Checklist tiketa u redosledu unosa (progres „2/3" računa prikaz). */
export async function getTicketChecklist(ticketId: string): Promise<TicketChecklistItem[]> {
  const supabase = await createClient();
  const [{ data }, staff] = await Promise.all([
    supabase
      .from("ticket_checklist_items")
      .select("id, label, done, sort_order, done_at, done_by")
      .eq("ticket_id", ticketId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    listStaffProfiles(),
  ]);

  const nameById = new Map(staff.map((p) => [p.id, p.full_name]));
  return (
    (data as {
      id: string;
      label: string;
      done: boolean;
      sort_order: number;
      done_at: string | null;
      done_by: string | null;
    }[]) ?? []
  ).map((i) => ({
    id: i.id,
    label: i.label,
    done: i.done,
    sort_order: i.sort_order,
    done_at: i.done_at,
    doneByName: i.done_by ? (nameById.get(i.done_by) ?? null) : null,
  }));
}

/** Hronologija promena (najnovije prvo). Piše je `lib/ticket-events.ts`. */
export async function getTicketEvents(ticketId: string): Promise<TicketEventRow[]> {
  const supabase = await createClient();
  const [{ data }, staff] = await Promise.all([
    supabase
      .from("ticket_events")
      .select("id, kind, from_text, to_text, meta, created_at, actor_id")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(200),
    listStaffProfiles(),
  ]);

  const nameById = new Map(staff.map((p) => [p.id, p.full_name]));
  return (
    (data as {
      id: string;
      kind: string;
      from_text: string | null;
      to_text: string | null;
      meta: Record<string, unknown> | null;
      created_at: string;
      actor_id: string | null;
    }[]) ?? []
  ).map((e) => ({
    id: e.id,
    kind: e.kind,
    from_text: e.from_text,
    to_text: e.to_text,
    meta: e.meta,
    created_at: e.created_at,
    actorName: e.actor_id ? (nameById.get(e.actor_id) ?? null) : null,
  }));
}

/** Tiketi koji ČEKAJU ovaj (obrnuta strana zavisnosti) — samo upozorenje. */
export async function getDependentTickets(ticketId: string): Promise<TicketRef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tickets")
    .select("id, code, title, completed_at")
    .eq("blocked_by_ticket_id", ticketId)
    .order("code", { ascending: true });

  return (
    (data as { id: string; code: number; title: string; completed_at: string | null }[]) ?? []
  ).map((t) => ({ id: t.id, code: t.code, title: t.title, done: t.completed_at != null }));
}

/* ── Panel vezanih zapisa ────────────────────────────────────────────────── */

/**
 * Panel NIKAD ne prikazuje finansije — samo broj/naziv/status/kontakt. Iznosi,
 * MP/VP i profit se ne čitaju ovde (zamrznute cene se ne diraju).
 */
export type TicketLinkedOrder = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  ship_city: string | null;
  ordered_at: string | null;
  delivery_method: string;
  statusName: string | null;
  statusColor: string | null;
};

export type TicketLinkedVariant = {
  id: string;
  sku: string;
  productId: string | null;
  productName: string | null;
  variantName: string | null;
  stockQuantity: number;
  archived: boolean;
};

export type TicketLinkedCustomer = {
  id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
};

export type TicketLinkedContext = {
  order: TicketLinkedOrder | null;
  variant: TicketLinkedVariant | null;
  customer: TicketLinkedCustomer | null;
};

/** Vezani zapisi tiketa (porudžbina / artikal / kupac) u jednom pozivu. */
export async function getLinkedContext(ticket: {
  order_id: string | null;
  variant_id: string | null;
  customer_id: string | null;
}): Promise<TicketLinkedContext> {
  const supabase = await createClient();

  const [order, variant, customer] = await Promise.all([
    ticket.order_id
      ? supabase
          .from("orders")
          .select(
            "id, woo_order_id, ship_name, ship_city, ordered_at, delivery_method, status:order_statuses(name, color)",
          )
          .eq("id", ticket.order_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ticket.variant_id
      ? supabase
          .from("product_variants")
          .select(
            "id, sku, variant_name, stock_quantity, archived_at, product_id, product:products(name)",
          )
          .eq("id", ticket.variant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ticket.customer_id
      ? supabase
          .from("customers")
          .select("id, name, phone, city")
          .eq("id", ticket.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const orderRow = order.data as unknown as {
    id: string;
    woo_order_id: number | null;
    ship_name: string | null;
    ship_city: string | null;
    ordered_at: string | null;
    delivery_method: string;
    status: { name: string; color: string | null } | null;
  } | null;

  const variantRow = variant.data as unknown as {
    id: string;
    sku: string;
    variant_name: string | null;
    stock_quantity: number;
    archived_at: string | null;
    product_id: string | null;
    product: { name: string } | null;
  } | null;

  return {
    order: orderRow
      ? {
          id: orderRow.id,
          woo_order_id: orderRow.woo_order_id,
          ship_name: orderRow.ship_name,
          ship_city: orderRow.ship_city,
          ordered_at: orderRow.ordered_at,
          delivery_method: orderRow.delivery_method,
          statusName: orderRow.status?.name ?? null,
          statusColor: orderRow.status?.color ?? null,
        }
      : null,
    variant: variantRow
      ? {
          id: variantRow.id,
          sku: variantRow.sku,
          productId: variantRow.product_id,
          productName: variantRow.product?.name ?? null,
          variantName: variantRow.variant_name,
          stockQuantity: variantRow.stock_quantity,
          archived: variantRow.archived_at != null,
        }
      : null,
    customer: (customer.data as TicketLinkedCustomer | null) ?? null,
  };
}

/* ── Zavisnost („čeka drugi tiket") ──────────────────────────────────────── */

/** Koliko koraka lanca zavisnosti se prati pre nego što se odustane. */
const CYCLE_SCAN_LIMIT = 50;

/**
 * Da li bi `ticketId` koji čeka `blockedById` napravio CIKLUS (A čeka B, B čeka
 * A). Ide uzvodno lancem `blocked_by_ticket_id` od kandidata; ako naiđe na sam
 * tiket → ciklus. Server odbija takvu vezu srpskom porukom.
 */
export async function wouldCreateCycle(
  supabase: SupabaseClient,
  ticketId: string,
  blockedById: string,
): Promise<boolean> {
  if (ticketId === blockedById) return true;

  const seen = new Set<string>([ticketId]);
  let current: string | null = blockedById;

  for (let step = 0; step < CYCLE_SCAN_LIMIT && current; step += 1) {
    if (seen.has(current)) return true;
    seen.add(current);

    // Eksplicitna anotacija: bez nje TS vidi kružnu zavisnost `current` ↔ `data`.
    const { data }: { data: { blocked_by_ticket_id: string | null } | null } = await supabase
      .from("tickets")
      .select("blocked_by_ticket_id")
      .eq("id", current)
      .maybeSingle();
    current = data?.blocked_by_ticket_id ?? null;
  }

  return false;
}

/* ── Snapshot polja (diff za istoriju + dupliranje) ──────────────────────── */

/**
 * Stanje tiketa pre izmene — ulaz u `logTicketUpdate` (istorija) i osnova za
 * `duplicateTicket`. Vraća id-jeve; nazive razrešava `lib/ticket-events.ts`.
 */
export async function getTicketSnapshot(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<TicketFieldSnapshot | null> {
  const [{ data }, { data: assignees }, { data: tags }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `id, title, description, column_id, priority_id, due_date, estimate_minutes,
         blocked_by_ticket_id, order_id, variant_id, customer_id`,
      )
      .eq("id", ticketId)
      .maybeSingle(),
    supabase.from("ticket_assignees").select("user_id").eq("ticket_id", ticketId),
    supabase.from("ticket_tag_links").select("tag_id").eq("ticket_id", ticketId),
  ]);

  if (!data) return null;
  const row = data as Omit<TicketFieldSnapshot, "assignee_ids" | "tag_ids">;

  return {
    ...row,
    assignee_ids: ((assignees as { user_id: string }[]) ?? []).map((a) => a.user_id),
    tag_ids: ((tags as { tag_id: string }[]) ?? []).map((t) => t.tag_id),
  };
}
