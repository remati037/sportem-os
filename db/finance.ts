import "server-only";

import { createClient } from "@/lib/supabase/server";
import { APP_STATUS } from "@/lib/woo";

/*
 * Upiti finansija (Korak 1.6). Čitaju kroz RLS klijent: Admin/Menadžer vide sve,
 * Logistika ništa. Sve cifre zarade su ZAMRZNUTE (order_items.profit_at_sale),
 * nikad iz kataloga. Status se resolve-uje po IMENU (APP_STATUS), nikad UUID.
 */

/** id statusa „Isporučeno" (lookup po imenu — seed UUID se ne hardkoduje). */
async function deliveredStatusId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", APP_STATUS.delivered)
    .maybeSingle();
  return data?.id ?? null;
}

/* ── Uplate (payouts) — 1.6a ─────────────────────────────────────────────── */

export type PayoutCandidate = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  cod_amount: number | null;
  delivered_at: string | null;
};

/**
 * Sve XExpress porudžbine isporučene ali NEuplaćene i nevezane za uplatu —
 * kandidati za novu uplatu. UI pred-čekira one isporučene na T−1 radni dan.
 */
export async function getUnpaidDeliveredXexpress(): Promise<PayoutCandidate[]> {
  const delivered = await deliveredStatusId();
  if (!delivered) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, woo_order_id, ship_name, cod_amount, delivered_at")
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "neuplaceno")
    .eq("status_id", delivered)
    .is("payout_id", null)
    .order("delivered_at", { ascending: true, nullsFirst: false });
  return (data as unknown as PayoutCandidate[]) ?? [];
}

export type PayoutRow = {
  id: string;
  amount: number;
  payout_date: string;
  delivery_date: string | null;
  notes: string | null;
  linkedCount: number;
  linkedCod: number;
};

/** Lista uplata (sa brojem vezanih porudžbina i Σ COD-a). */
export async function listPayouts(): Promise<PayoutRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select("id, amount, payout_date, delivery_date, notes, orders(cod_amount)")
    .order("payout_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    (data as unknown as (Omit<PayoutRow, "linkedCount" | "linkedCod"> & {
      orders: { cod_amount: number | null }[];
    })[]) ?? []
  ).map(({ orders, ...p }) => ({
    ...p,
    linkedCount: orders.length,
    linkedCod: orders.reduce((sum, o) => sum + (o.cod_amount ?? 0), 0),
  }));
}

export type PayoutDetail = {
  payout: PayoutRow;
  orders: PayoutCandidate[];
  codTotal: number;
  difference: number; // amount − codTotal (0 = poklapa se)
};

/** Detalj uplate: vezane porudžbine + Σ COD + razlika prema unetom iznosu. */
export async function getPayoutDetail(id: string): Promise<PayoutDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select(
      `id, amount, payout_date, delivery_date, notes,
       orders(id, woo_order_id, ship_name, cod_amount, delivered_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as Omit<PayoutRow, "linkedCount" | "linkedCod"> & {
    orders: PayoutCandidate[];
  };
  const orders = [...row.orders].sort(
    (a, b) => (a.woo_order_id ?? 0) - (b.woo_order_id ?? 0),
  );
  const codTotal = orders.reduce((sum, o) => sum + (o.cod_amount ?? 0), 0);

  return {
    payout: {
      id: row.id,
      amount: row.amount,
      payout_date: row.payout_date,
      delivery_date: row.delivery_date,
      notes: row.notes,
      linkedCount: orders.length,
      linkedCod: codTotal,
    },
    orders,
    codTotal,
    difference: row.amount - codTotal,
  };
}

/* ── Spisak za druga (po uplati) — 1.6a ──────────────────────────────────── */

export type SpisakArticleRow = { sku: string; product_name: string; quantity: number };
export type SpisakOrderRow = {
  woo_order_id: number | null;
  ship_name: string | null;
  items: SpisakArticleRow[];
};
export type PayoutSpisak = { byOrder: SpisakOrderRow[]; byArticle: SpisakArticleRow[] };

/**
 * Spisak porudžbina + artikala za jednu uplatu (drug ga kuca u kasi):
 * `byOrder` = po porudžbini, `byArticle` = zbirno po SKU-u.
 */
export async function getPayoutSpisak(payoutId: string): Promise<PayoutSpisak> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("woo_order_id, ship_name, order_items(sku, product_name, quantity)")
    .eq("payout_id", payoutId)
    .order("woo_order_id", { ascending: true, nullsFirst: false });

  const rows =
    (data as unknown as {
      woo_order_id: number | null;
      ship_name: string | null;
      order_items: SpisakArticleRow[];
    }[]) ?? [];

  const byOrder: SpisakOrderRow[] = rows.map((o) => ({
    woo_order_id: o.woo_order_id,
    ship_name: o.ship_name,
    items: [...o.order_items].sort((a, b) => a.sku.localeCompare(b.sku)),
  }));

  // Zbir po SKU-u (isti artikal iz više porudžbina se sabira).
  const map = new Map<string, SpisakArticleRow>();
  for (const o of rows) {
    for (const it of o.order_items) {
      const prev = map.get(it.sku);
      if (prev) prev.quantity += it.quantity;
      else map.set(it.sku, { sku: it.sku, product_name: it.product_name, quantity: it.quantity });
    }
  }
  const byArticle = [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));

  return { byOrder, byArticle };
}

/* ── Fakture (invoices) — 1.6b ───────────────────────────────────────────── */

/**
 * Zarada po porudžbini iz view-a `order_profit` (Σ zamrznute profit_at_sale).
 * Zaseban upit umesto PostgREST embed-a nad view-om (pouzdanije). Vraća Map
 * order_id → profit. Porudžbina bez reda u view-u (nema stavki) → 0.
 */
async function profitByOrder(orderIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (orderIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_profit")
    .select("order_id, profit")
    .in("order_id", orderIds);
  for (const r of (data as { order_id: string; profit: number | null }[]) ?? []) {
    map.set(r.order_id, r.profit ?? 0);
  }
  return map;
}

export type InvoiceCandidate = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  delivered_at: string | null;
  profit: number;
};

export type InvoiceCandidates = { orders: InvoiceCandidate[]; total: number };

/**
 * Kandidati za fakturu = „drug mi duguje" baza: XExpress + isporučeno + uplaćeno
 * + nefakturisano + bez needs_vp. Zarada iz zamrznutih stavki (order_profit).
 */
export async function getInvoiceCandidates(): Promise<InvoiceCandidates> {
  const delivered = await deliveredStatusId();
  if (!delivered) return { orders: [], total: 0 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, woo_order_id, ship_name, delivered_at")
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "uplaceno")
    .eq("status_id", delivered)
    .is("invoice_id", null)
    .eq("needs_vp", false)
    .order("delivered_at", { ascending: true, nullsFirst: false });

  const rows =
    (data as {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      delivered_at: string | null;
    }[]) ?? [];

  const profits = await profitByOrder(rows.map((o) => o.id));
  const orders: InvoiceCandidate[] = rows.map((o) => ({
    ...o,
    profit: profits.get(o.id) ?? 0,
  }));
  const total = orders.reduce((sum, o) => sum + o.profit, 0);
  return { orders, total };
}

export type BlockedOrder = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  delivered_at: string | null;
};

/**
 * Porudžbine koje BI bile kandidati ali čekaju VP (needs_vp=true) — neće ući u
 * fakturu dok se VP ne unese. Prikazuju se kao upozorenje.
 */
export async function getBlockedNeedsVpOrders(): Promise<BlockedOrder[]> {
  const delivered = await deliveredStatusId();
  if (!delivered) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, woo_order_id, ship_name, delivered_at")
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "uplaceno")
    .eq("status_id", delivered)
    .is("invoice_id", null)
    .eq("needs_vp", true)
    .order("delivered_at", { ascending: true, nullsFirst: false });
  return (data as BlockedOrder[]) ?? [];
}

/** „Drug mi duguje" = Σ nefakturisane realizovane zarade (isti skup kao kandidati). */
export async function getDrugMiDuguje(): Promise<{ total: number; orderCount: number }> {
  const { orders, total } = await getInvoiceCandidates();
  return { total, orderCount: orders.length };
}

export type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  period_from: string | null;
  period_to: string | null;
  total_amount: number | null;
  status: string;
  created_at: string;
  orderCount: number;
};

/** Lista izdatih faktura (sa brojem vezanih porudžbina). */
export async function listInvoices(): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, period_from, period_to, total_amount, status, created_at, orders(count)",
    )
    .order("created_at", { ascending: false });

  return (
    (data as unknown as (Omit<InvoiceRow, "orderCount"> & {
      orders: { count: number }[];
    })[]) ?? []
  ).map(({ orders, ...inv }) => ({
    ...inv,
    orderCount: orders[0]?.count ?? 0,
  }));
}

export type InvoiceDetailOrder = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  delivered_at: string | null;
  profit: number;
};

export type InvoiceDetail = {
  invoice: InvoiceRow;
  orders: InvoiceDetailOrder[];
  computedTotal: number; // živi Σ profit (kontrola prema zamrznutom total_amount)
  isBackfill: boolean;
};

/** Detalj fakture: vezane porudžbine + zarada po porudžbini + živi zbir. */
export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      `id, invoice_number, period_from, period_to, total_amount, status, created_at,
       orders(id, woo_order_id, ship_name, delivered_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as Omit<InvoiceRow, "orderCount"> & {
    orders: {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      delivered_at: string | null;
    }[];
  };

  const sorted = [...row.orders].sort(
    (a, b) => (a.woo_order_id ?? 0) - (b.woo_order_id ?? 0),
  );
  const profits = await profitByOrder(sorted.map((o) => o.id));
  const orders: InvoiceDetailOrder[] = sorted.map((o) => ({
    ...o,
    profit: profits.get(o.id) ?? 0,
  }));
  const computedTotal = orders.reduce((sum, o) => sum + o.profit, 0);

  return {
    invoice: {
      id: row.id,
      invoice_number: row.invoice_number,
      period_from: row.period_from,
      period_to: row.period_to,
      total_amount: row.total_amount,
      status: row.status,
      created_at: row.created_at,
      orderCount: orders.length,
    },
    orders,
    computedTotal,
    isBackfill: row.invoice_number === "ISTORIJA-BACKFILL",
  };
}
