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
  "id, woo_order_id, ordered_at, goods_total, needs_vp, needs_review, status:order_statuses(name, color), customer:customers(name)";

export async function getOrders(limit = 100): Promise<OrderListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(LIST_COLS)
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data as unknown as OrderListRow[]) ?? [];
}

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, woo_order_id, delivery_method, payment_status, invoice_id, needs_vp, needs_review,
       review_reason, woo_status, ship_name, ship_phone, ship_address, ship_city,
       ship_postal_code, ship_note, goods_total, shipping_charged, cod_amount,
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
