import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { buildCancellationIndex, matchCancellations } from "@/db/customer-risk";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";

/*
 * Upiti porudžbina (Korak 1.2 — minimalna lista + detalj; pun UX u 1.4).
 * Čitaju kroz RLS klijent: Admin/Menadžer vide sve, Logistika ništa (RLS).
 * Sve cifre stavki su ZAMRZNUTE vrednosti — nikad iz kataloga.
 */

export type OrderListRow = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  goods_total: number | null;
  needs_vp: boolean;
  needs_review: boolean;
  /** Ime primaoca (snapshot na porudžbini) — prikaz „Kupac" u listi. */
  ship_name: string | null;
  ship_phone: string | null;
  status: { name: string; color: string | null } | null;
  customer: { name: string | null; phone: string | null; email: string | null } | null;
  /** Broj ranijih otkazanih/vraćenih porudžbina istog kupca (tel/e-mail). */
  risky_cancel_count: number;
};

export type OrderItemRow = {
  id: string;
  variant_id: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  mp_at_sale: number;
  vp_at_sale: number | null;
  profit_at_sale: number | null;
};

export type OrderDetail = {
  id: string;
  woo_order_id: number | null;
  delivery_method: string;
  payment_status: string;
  invoice_id: string | null;
  needs_vp: boolean;
  needs_review: boolean;
  review_reason: string | null;
  woo_status: string | null;
  ship_name: string | null;
  ship_phone: string | null;
  ship_address: string | null;
  ship_city: string | null;
  ship_postal_code: string | null;
  ship_note: string | null;
  goods_total: number | null;
  shipping_charged: number | null;
  shipping_actual: number | null;
  weight_grams: number | null;
  package_count: number | null;
  cod_amount: number | null;
  ordered_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  status: { name: string; color: string | null } | null;
  customer: { name: string | null; phone: string | null; email: string | null } | null;
  items: OrderItemRow[];
};

const LIST_COLS =
  "id, woo_order_id, ordered_at, goods_total, needs_vp, needs_review, ship_name, ship_phone, status:order_statuses(name, color), customer:customers(name, phone, email)";

export type OrderFilters = {
  statusId?: string;
  deliveryMethod?: string;
  paymentStatus?: string;
  needsVp?: boolean;
  /** Samo porudžbine označene za pregled (otkazano posle fakture i sl. — Korak 1.2). */
  needsReview?: boolean;
  /** Opseg `ordered_at` — YYYY-MM-DD stringovi (uključivi). */
  from?: string;
  to?: string;
  /** Pretraga: broj porudžbine / ime kupca / telefon. */
  search?: string;
  /** Polje pretrage: „all" (default) / „name" / „email" / „phone". */
  searchField?: "all" | "name" | "email" | "phone";
  /** Samo rizični kupci (istorija otkazivanja/vraćanja po tel/e-mailu). */
  onlyRisky?: boolean;
  /** Paginacija (1-based). */
  page?: number;
  perPage?: number;
};

export type OrdersResult = {
  rows: OrderListRow[];
  /** Ukupan broj porudžbina koje odgovaraju filterima (bez paginacije). */
  total: number;
};

export const ORDERS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PER_PAGE = 25;

/** Ukloni znakove koji lome PostgREST `or()` sintaksu. */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()%]/g, " ").trim();
}

/**
 * OR-uslovi PostgREST pretrage (broj / ime / telefon / e-mail). Deljeno između
 * liste i zbira da filteri ostanu identični. `null` = nijedan uslov ne odgovara
 * (pozivalac tretira kao prazan rezultat, bez skupljanja svih redova).
 */
async function buildSearchOrParts(
  supabase: SupabaseClient,
  search: string,
  searchField: "all" | "name" | "email" | "phone",
): Promise<string[] | null> {
  const term = sanitizeTerm(search);
  const digits = term.replace(/\D/g, "");
  const orParts: string[] = [];
  const custOr: string[] = [];

  const wantName = searchField === "all" || searchField === "name";
  const wantPhone = searchField === "all" || searchField === "phone";
  const wantEmail = searchField === "all" || searchField === "email";

  if (searchField === "all" && /^\d+$/.test(term)) orParts.push(`woo_order_id.eq.${term}`);
  if (wantName && term) {
    orParts.push(`ship_name.ilike.%${term}%`);
    custOr.push(`name.ilike.%${term}%`);
  }
  if (wantPhone && digits.length >= 3) {
    orParts.push(`ship_phone.ilike.%${digits}%`);
    custOr.push(`phone.ilike.%${digits}%`);
  }
  if (wantEmail && term) custOr.push(`email.ilike.%${term}%`);

  if (custOr.length > 0) {
    const { data: custs } = await supabase.from("customers").select("id").or(custOr.join(","));
    const ids = (custs ?? []).map((c) => c.id);
    if (ids.length > 0) orParts.push(`customer_id.in.(${ids.join(",")})`);
  }

  return orParts.length === 0 ? null : orParts;
}

export async function getOrders(filters: OrderFilters = {}): Promise<OrdersResult> {
  const supabase = await createClient();
  const { statusId, deliveryMethod, paymentStatus, needsVp, needsReview, from, to, search } =
    filters;
  const searchField = filters.searchField ?? "name";
  const page = Math.max(1, filters.page ?? 1);
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE;

  // `count: exact` → ukupan broj pogodaka (ignoriše range), za paginaciju.
  let query = supabase.from("orders").select(LIST_COLS, { count: "exact" });

  if (statusId) query = query.eq("status_id", statusId);
  if (deliveryMethod) query = query.eq("delivery_method", deliveryMethod);
  if (paymentStatus) query = query.eq("payment_status", paymentStatus);
  if (needsVp) query = query.eq("needs_vp", true);
  if (needsReview) query = query.eq("needs_review", true);
  if (from) query = query.gte("ordered_at", from);
  if (to) query = query.lte("ordered_at", `${to}T23:59:59.999Z`);

  if (search && search.trim()) {
    const orParts = await buildSearchOrParts(supabase, search, searchField);
    // Nijedan uslov ne odgovara → prazna lista (bez skupljanja svih redova).
    if (!orParts) return { rows: [], total: 0 };
    query = query.or(orParts.join(","));
  }

  const orderedQuery = query.order("ordered_at", { ascending: false, nullsFirst: false });

  // „Rizičan kupac" flag po redu (istorija otkazivanja/vraćanja po tel/e-mailu).
  const riskIndex = await buildCancellationIndex(supabase);
  const annotateRisk = (rows: OrderListRow[]): OrderListRow[] => {
    for (const row of rows) {
      row.risky_cancel_count = matchCancellations(riskIndex, {
        phone: row.ship_phone ?? row.customer?.phone,
        email: row.customer?.email,
        excludeId: row.id,
      }).length;
    }
    return rows;
  };

  const fromIdx = (page - 1) * perPage;

  if (filters.onlyRisky) {
    // Rizik nije SQL kolona — povuci sve redove koji prolaze ostale filtere (širok
    // cap), izračunaj rizik, zadrži rizične, pa paginiraj u JS-u. Dovoljno za obim
    // internog kataloga porudžbina; cap sprečava da PostgREST default limit tiho odseče.
    const RISK_SCAN_CAP = 5000;
    const { data } = await orderedQuery.range(0, RISK_SCAN_CAP - 1);
    const risky = annotateRisk((data as unknown as OrderListRow[]) ?? []).filter(
      (r) => r.risky_cancel_count > 0,
    );
    return { rows: risky.slice(fromIdx, fromIdx + perPage), total: risky.length };
  }

  const { data, count } = await orderedQuery.range(fromIdx, fromIdx + perPage - 1);
  const rows = annotateRisk((data as unknown as OrderListRow[]) ?? []);
  return { rows, total: count ?? 0 };
}

export type OrdersSummary = {
  zarada: number; // Σ zamrznute profit_at_sale (bez otkazanih/vraćenih)
  promet: number; // Σ mp_at_sale × quantity
  marza: number; // zarada / promet, 0..1 (0 kad nema prometa)
  broj: number; // broj porudžbina koje ulaze u zbir
};

/** Zbir order_items (zarada + promet) po chunk-ovima order_id-jeva (URL limit). */
async function sumOrderItems(
  supabase: SupabaseClient,
  ids: string[],
): Promise<{ zarada: number; promet: number }> {
  let zarada = 0;
  let promet = 0;
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await supabase
      .from("order_items")
      .select("quantity, mp_at_sale, profit_at_sale")
      .in("order_id", ids.slice(i, i + CHUNK));
    for (const it of (data as {
      quantity: number;
      mp_at_sale: number;
      profit_at_sale: number | null;
    }[]) ?? []) {
      zarada += it.profit_at_sale ?? 0;
      promet += it.mp_at_sale * it.quantity;
    }
  }
  return { zarada, promet };
}

/**
 * Zbir zarade/prometa/marže za ISTE filtere kao lista (bez paginacije), da se uz
 * listu prikaže „za ovaj filter". Zarada iz ZAMRZNUTIH `order_items`, bez
 * Otkazano/Vraćeno (isto kao Dashboard/Finansije — „zarada" = prihod, ne prodaja
 * koja je stornirana). `needs_vp` porudžbine ulaze sa profitom 0.
 */
export async function getOrdersSummary(filters: OrderFilters = {}): Promise<OrdersSummary> {
  const supabase = await createClient();
  const { statusId, deliveryMethod, paymentStatus, needsVp, needsReview, from, to, search } =
    filters;
  const searchField = filters.searchField ?? "name";
  const empty: OrdersSummary = { zarada: 0, promet: 0, marza: 0, broj: 0 };

  let query = supabase
    .from("orders")
    .select("id, status_id, ship_phone, customer:customers(phone, email)");

  if (statusId) query = query.eq("status_id", statusId);
  if (deliveryMethod) query = query.eq("delivery_method", deliveryMethod);
  if (paymentStatus) query = query.eq("payment_status", paymentStatus);
  if (needsVp) query = query.eq("needs_vp", true);
  if (needsReview) query = query.eq("needs_review", true);
  if (from) query = query.gte("ordered_at", from);
  if (to) query = query.lte("ordered_at", `${to}T23:59:59.999Z`);

  if (search && search.trim()) {
    const orParts = await buildSearchOrParts(supabase, search, searchField);
    if (!orParts) return empty;
    query = query.or(orParts.join(","));
  }

  const SUMMARY_SCAN_CAP = 20000;
  const { data } = await query.range(0, SUMMARY_SCAN_CAP - 1);
  let rows =
    (data as unknown as {
      id: string;
      status_id: string;
      ship_phone: string | null;
      customer: { phone: string | null; email: string | null } | null;
    }[]) ?? [];

  // Izbaci Otkazano/Vraćeno iz zarade (nisu prihod) — po imenu.
  const { data: cancelStatuses } = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  const excluded = new Set(((cancelStatuses as { id: string }[]) ?? []).map((s) => s.id));
  rows = rows.filter((r) => !excluded.has(r.status_id));

  if (filters.onlyRisky) {
    const riskIndex = await buildCancellationIndex(supabase);
    rows = rows.filter(
      (r) =>
        matchCancellations(riskIndex, {
          phone: r.ship_phone ?? r.customer?.phone,
          email: r.customer?.email,
          excludeId: r.id,
        }).length > 0,
    );
  }

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return empty;

  const { zarada, promet } = await sumOrderItems(supabase, ids);
  return { zarada, promet, marza: promet > 0 ? zarada / promet : 0, broj: ids.length };
}

export type OrderStatusRow = {
  id: string;
  name: string;
  sort_order: number;
  color: string | null;
};

/** Svi statusi (za filter, promenu statusa, podešavanja) — po sort_order. */
export async function getOrderStatuses(): Promise<OrderStatusRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_statuses")
    .select("id, name, sort_order, color")
    .order("sort_order", { ascending: true });
  return (data as unknown as OrderStatusRow[]) ?? [];
}

export type OrderStatusHistoryRow = {
  id: string;
  note: string | null;
  created_at: string;
  toStatus: { name: string; color: string | null } | null;
  changedByName: string | null;
};

/** Istorija promena statusa jedne porudžbine (ko i kada), hronološki. */
export async function getOrderStatusHistory(orderId: string): Promise<OrderStatusHistoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_status_history")
    .select(
      "id, note, created_at, to_status:order_statuses!to_status_id(name, color), changed_by:profiles(full_name)",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  return (
    (data as unknown as {
      id: string;
      note: string | null;
      created_at: string;
      to_status: { name: string; color: string | null } | null;
      changed_by: { full_name: string | null } | null;
    }[]) ?? []
  ).map((r) => ({
    id: r.id,
    note: r.note,
    created_at: r.created_at,
    toStatus: r.to_status,
    changedByName: r.changed_by?.full_name ?? null,
  }));
}

/**
 * Detalj porudžbine po URL parametru: numerički param = Woo broj
 * (`woo_order_id`), inače UUID (`id`, rezerva za stare linkove i retke
 * porudžbine bez Woo broja).
 */
export async function getOrderDetail(param: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const query = supabase
    .from("orders")
    .select(
      `id, woo_order_id, delivery_method, payment_status, invoice_id, needs_vp, needs_review,
       review_reason, woo_status, ship_name, ship_phone, ship_address, ship_city,
       ship_postal_code, ship_note, goods_total, shipping_charged, shipping_actual,
       weight_grams, package_count, cod_amount,
       ordered_at, shipped_at, delivered_at, paid_at, cancelled_at,
       status:order_statuses(name, color),
       customer:customers(name, phone, email),
       items:order_items(id, variant_id, sku, product_name, quantity, mp_at_sale, vp_at_sale, profit_at_sale)`,
    );
  const { data } = await (/^\d+$/.test(param)
    ? query.eq("woo_order_id", Number(param))
    : query.eq("id", param)
  ).maybeSingle();
  if (!data) return null;
  const detail = data as unknown as OrderDetail;
  detail.items.sort((a, b) => a.sku.localeCompare(b.sku));
  return detail;
}

export type ShippingOrderItem = {
  sku: string;
  product_name: string;
  quantity: number;
};

export type ShippingOrder = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  ship_phone: string | null;
  ship_address: string | null;
  ship_city: string | null;
  ship_postal_code: string | null;
  ship_note: string | null;
  cod_amount: number | null;
  goods_total: number | null;
  shipping_charged: number | null;
  delivery_method: string;
  payment_status: string;
  package_count: number | null;
  weight_grams: number | null;
  items: ShippingOrderItem[];
};

/**
 * Porudžbine za PDF „lista za slanje" (Korak 1.5) — samo polja za štampu.
 * Kroz RLS klijent: Logistika dobija prazno (dodatna zaštita uz gejt na ruti).
 * Sortirano po broju porudžbine radi predvidivog redosleda na papiru.
 */
export async function getOrdersForShipping(ids: string[]): Promise<ShippingOrder[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, woo_order_id, ship_name, ship_phone, ship_address, ship_city, ship_postal_code,
       ship_note, cod_amount, goods_total, shipping_charged, delivery_method, payment_status,
       package_count, weight_grams, items:order_items(sku, product_name, quantity)`,
    )
    .in("id", ids)
    .order("woo_order_id", { ascending: true, nullsFirst: false });

  return ((data as unknown as ShippingOrder[]) ?? []).map((o) => ({
    ...o,
    items: [...o.items].sort((a, b) => a.sku.localeCompare(b.sku)),
  }));
}

export type VariantOption = {
  id: string;
  sku: string;
  variant_name: string | null;
  product_name: string;
  mp_price: number;
  vp_price: number;
};

/** Aktivne varijante za „Dodaj stavku" (snapshot se pravi u server akciji). */
export async function getActiveVariantOptions(): Promise<VariantOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_variants")
    .select("id, sku, variant_name, mp_price, vp_price, product:products(name)")
    .is("archived_at", null)
    .order("sku", { ascending: true });
  return (
    (data as unknown as (Omit<VariantOption, "product_name"> & {
      product: { name: string } | null;
    })[]) ?? []
  ).map(({ product, ...v }) => ({ ...v, product_name: product?.name ?? "" }));
}
