import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getTicketColumns, type TicketColumnRow } from "@/db/tickets-config";
import { listStaffProfiles } from "@/db/profiles";
import { todayBelgrade } from "@/lib/date-belgrade";
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
 * `position ASC` (nov tiket ide na dno) — ručni redosled dolazi u T3.
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
