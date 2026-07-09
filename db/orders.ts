import "server-only";

import { createClient } from "@/lib/supabase/server";

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
  status: { name: string; color: string | null } | null;
  customer: { name: string | null } | null;
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
  "id, woo_order_id, ordered_at, goods_total, needs_vp, needs_review, ship_name, status:order_statuses(name, color), customer:customers(name)";

export type OrderFilters = {
  statusId?: string;
  deliveryMethod?: string;
  paymentStatus?: string;
  needsVp?: boolean;
  /** Opseg `ordered_at` — YYYY-MM-DD stringovi (uključivi). */
  from?: string;
  to?: string;
  /** Pretraga: broj porudžbine / ime kupca / telefon. */
  search?: string;
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

export async function getOrders(filters: OrderFilters = {}): Promise<OrdersResult> {
  const supabase = await createClient();
  const { statusId, deliveryMethod, paymentStatus, needsVp, from, to, search } = filters;
  const page = Math.max(1, filters.page ?? 1);
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE;

  // `count: exact` → ukupan broj pogodaka (ignoriše range), za paginaciju.
  let query = supabase.from("orders").select(LIST_COLS, { count: "exact" });

  if (statusId) query = query.eq("status_id", statusId);
  if (deliveryMethod) query = query.eq("delivery_method", deliveryMethod);
  if (paymentStatus) query = query.eq("payment_status", paymentStatus);
  if (needsVp) query = query.eq("needs_vp", true);
  if (from) query = query.gte("ordered_at", from);
  if (to) query = query.lte("ordered_at", `${to}T23:59:59.999Z`);

  if (search && search.trim()) {
    const term = sanitizeTerm(search);
    const digits = term.replace(/\D/g, "");
    const orParts: string[] = [];

    // Broj porudžbine (numerički unos).
    if (/^\d+$/.test(term)) orParts.push(`woo_order_id.eq.${term}`);

    // Snapshot adrese na samoj porudžbini — hvata i porudžbine čiji vezani
    // `customers` red ima drugačije ime (npr. isti kupac, dva telefona).
    if (term) orParts.push(`ship_name.ilike.%${term}%`);
    if (digits.length >= 3) orParts.push(`ship_phone.ilike.%${digits}%`);

    // Dodatno: kupci po imenu / telefonu → filter porudžbina po customer_id.
    const custOr: string[] = [];
    if (term) custOr.push(`name.ilike.%${term}%`);
    if (digits.length >= 3) custOr.push(`phone.ilike.%${digits}%`);
    if (custOr.length > 0) {
      const { data: custs } = await supabase.from("customers").select("id").or(custOr.join(","));
      const ids = (custs ?? []).map((c) => c.id);
      if (ids.length > 0) orParts.push(`customer_id.in.(${ids.join(",")})`);
    }

    // Nijedan uslov ne odgovara → prazna lista (bez skupljanja svih redova).
    if (orParts.length === 0) return { rows: [], total: 0 };
    query = query.or(orParts.join(","));
  }

  const fromIdx = (page - 1) * perPage;
  const { data, count } = await query
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .range(fromIdx, fromIdx + perPage - 1);

  return { rows: (data as unknown as OrderListRow[]) ?? [], total: count ?? 0 };
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

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
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
    )
    .eq("id", id)
    .maybeSingle();
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
  delivery_method: string;
  payment_status: string;
  package_count: number | null;
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
       ship_note, cod_amount, delivery_method, payment_status, package_count,
       items:order_items(sku, product_name, quantity)`,
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
