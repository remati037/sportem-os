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
