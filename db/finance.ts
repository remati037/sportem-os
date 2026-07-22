import "server-only";

import { createClient } from "@/lib/supabase/server";
import { APP_STATUS } from "@/lib/woo";
import { computePeriodMetrics } from "@/db/metrics";

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
  otkup: number; // vrednost robe + naplaćena poštarina (otkupnina koju kurir vraća)
  delivered_at: string | null;
};

/**
 * Otkupnina = vrednost robe (`goods_total`) + naplaćena poštarina
 * (`shipping_charged`). `cod_amount` se NE koristi — NULL je na backfill i
 * ne-COD porudžbinama; `goods_total` je pouzdano popunjen svuda.
 */
export function otkupOf(goods_total: number | null, shipping_charged: number | null): number {
  return (goods_total ?? 0) + (shipping_charged ?? 0);
}

/**
 * Stvarna poštarina koju Sportem plaća XExpress-u = osnovica + PDV. Osnovica
 * (shipping_actual) se unosi iz specifikacije bez PDV-a; XExpress dodaje 20%.
 * Round po porudžbini da global saldo i P&L fakture tačno rekonsiluju.
 */
export function withPdv(base: number, rate = 20): number {
  return base + Math.round((base * rate) / 100);
}

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
    .select("id, woo_order_id, ship_name, goods_total, shipping_charged, delivered_at")
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "neuplaceno")
    .eq("status_id", delivered)
    .is("payout_id", null)
    .order("delivered_at", { ascending: true, nullsFirst: false });

  return (
    (data as unknown as {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      goods_total: number | null;
      shipping_charged: number | null;
      delivered_at: string | null;
    }[]) ?? []
  ).map(({ goods_total, shipping_charged, ...o }) => ({
    ...o,
    otkup: otkupOf(goods_total, shipping_charged),
  }));
}

export type PayoutRow = {
  id: string;
  amount: number;
  payout_date: string;
  delivery_date: string | null;
  notes: string | null;
  invoice_id: string | null; // faktura na kojoj je uplata (NULL = nefakturisana)
  linkedCount: number;
  linkedOtkup: number; // Σ otkupnina vezanih porudžbina
  profit: number; // Σ zamrznuta zarada vezanih porudžbina (order_profit view)
};

/** Lista uplata (sa brojem vezanih porudžbina, Σ otkupnine i Σ zarade). */
export async function listPayouts(): Promise<PayoutRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select(
      "id, amount, payout_date, delivery_date, notes, invoice_id, orders(id, goods_total, shipping_charged)",
    )
    .order("payout_date", { ascending: false })
    .order("created_at", { ascending: false });

  const rows =
    (data as unknown as (Omit<PayoutRow, "linkedCount" | "linkedOtkup" | "profit"> & {
      orders: { id: string; goods_total: number | null; shipping_charged: number | null }[];
    })[]) ?? [];

  // Zarada iz order_profit view-a (zamrznuti profit_at_sale) — jedan upit za sve.
  const profitMap = await profitByOrder(rows.flatMap((p) => p.orders.map((o) => o.id)));

  return rows.map(({ orders, ...p }) => ({
    ...p,
    linkedCount: orders.length,
    linkedOtkup: orders.reduce((sum, o) => sum + otkupOf(o.goods_total, o.shipping_charged), 0),
    profit: orders.reduce((sum, o) => sum + (profitMap.get(o.id) ?? 0), 0),
  }));
}

export type PayoutDetail = {
  payout: PayoutRow;
  orders: PayoutCandidate[];
  otkupTotal: number;
  postageTotal: number; // Σ shipping_charged (poštarina naplaćena kupcima; deo otkupa)
  difference: number; // amount − otkupTotal (0 = poklapa se)
};

/** Detalj uplate: vezane porudžbine + Σ otkupnina + razlika prema unetom iznosu. */
export async function getPayoutDetail(id: string): Promise<PayoutDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select(
      `id, amount, payout_date, delivery_date, notes, invoice_id,
       orders(id, woo_order_id, ship_name, goods_total, shipping_charged, delivered_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as Omit<PayoutRow, "linkedCount" | "linkedOtkup"> & {
    orders: {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      goods_total: number | null;
      shipping_charged: number | null;
      delivered_at: string | null;
    }[];
  };
  const postageTotal = row.orders.reduce((sum, o) => sum + (o.shipping_charged ?? 0), 0);
  const orders: PayoutCandidate[] = [...row.orders]
    .sort((a, b) => (a.woo_order_id ?? 0) - (b.woo_order_id ?? 0))
    .map(({ goods_total, shipping_charged, ...o }) => ({
      ...o,
      otkup: otkupOf(goods_total, shipping_charged),
    }));
  const otkupTotal = orders.reduce((sum, o) => sum + o.otkup, 0);
  const profitMap = await profitByOrder(orders.map((o) => o.id));
  const profitTotal = orders.reduce((sum, o) => sum + (profitMap.get(o.id) ?? 0), 0);

  return {
    payout: {
      id: row.id,
      amount: row.amount,
      payout_date: row.payout_date,
      delivery_date: row.delivery_date,
      notes: row.notes,
      invoice_id: row.invoice_id,
      linkedCount: orders.length,
      linkedOtkup: otkupTotal,
      profit: profitTotal,
    },
    orders,
    otkupTotal,
    postageTotal,
    difference: row.amount - otkupTotal,
  };
}

/* ── Spisak uplate (po uplati) — 1.6a ────────────────────────────────────── */

export type SpisakArticleRow = { sku: string; product_name: string; quantity: number };
export type SpisakOrderRow = {
  woo_order_id: number | null;
  ship_name: string | null;
  items: SpisakArticleRow[];
};
/**
 * Zbirovi za celu uplatu. Zarada (`profit`) je ZAMRZNUTA (order_profit view),
 * nikad iz kataloga; `mp`/`vp` iz frozen order_items; `shipping` = Σ poštarina.
 */
export type PayoutTotals = { mp: number; vp: number; shipping: number; profit: number };
export type PayoutSpisak = {
  byOrder: SpisakOrderRow[];
  byArticle: SpisakArticleRow[];
  totals: PayoutTotals;
};

/**
 * Spisak porudžbina + artikala za jednu uplatu (drug ga kuca u kasi):
 * `byOrder` = po porudžbini, `byArticle` = zbirno po SKU-u. Uz zbirove
 * MP/VP/Dostava/Zarada za celu uplatu (za kopiranje/štampu).
 */
export async function getPayoutSpisak(payoutId: string): Promise<PayoutSpisak> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, woo_order_id, ship_name, shipping_charged, order_items(sku, product_name, quantity, mp_at_sale, vp_at_sale)",
    )
    .eq("payout_id", payoutId)
    .order("woo_order_id", { ascending: true, nullsFirst: false });

  const rows =
    (data as unknown as {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      shipping_charged: number | null;
      order_items: (SpisakArticleRow & { mp_at_sale: number; vp_at_sale: number | null })[];
    }[]) ?? [];

  const byOrder: SpisakOrderRow[] = rows.map((o) => ({
    woo_order_id: o.woo_order_id,
    ship_name: o.ship_name,
    items: [...o.order_items]
      .map(({ sku, product_name, quantity }) => ({ sku, product_name, quantity }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
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

  // Zbirovi za celu uplatu — MP/VP iz zamrznutih stavki, Dostava iz porudžbina,
  // Zarada iz order_profit view-a (frozen profit_at_sale, ne mp−vp zbog needs_vp).
  let mp = 0;
  let vp = 0;
  let shipping = 0;
  for (const o of rows) {
    shipping += o.shipping_charged ?? 0;
    for (const it of o.order_items) {
      mp += it.mp_at_sale * it.quantity;
      vp += (it.vp_at_sale ?? 0) * it.quantity;
    }
  }
  const profitMap = await profitByOrder(rows.map((o) => o.id));
  let profit = 0;
  for (const o of rows) profit += profitMap.get(o.id) ?? 0;

  return { byOrder, byArticle, totals: { mp, vp, shipping, profit } };
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

/**
 * Kandidat za fakturu = jedna UPLATA (payout) koja još nije ni na jednoj fakturi.
 * Faktura se sklapa od uplata (ne pojedinačnih porudžbina) — jednostavnije.
 */
export type PayoutInvoiceCandidate = {
  id: string;
  payout_date: string;
  linkedCount: number; // broj vezanih porudžbina
  otkup: number; // Σ otkupnina vezanih porudžbina
  profit: number; // Σ zamrznuta zarada (order_profit) — osnova „za fakturisanje"
};

export type InvoiceCandidates = { payouts: PayoutInvoiceCandidate[]; total: number };

/** Nefakturisane uplate (payout.invoice_id null) sa Σ zarade i otkupnine. */
export async function getInvoiceablePayouts(): Promise<PayoutInvoiceCandidate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select("id, payout_date, orders(id, goods_total, shipping_charged)")
    .is("invoice_id", null)
    .order("payout_date", { ascending: false })
    .order("created_at", { ascending: false });

  const rows =
    (data as unknown as {
      id: string;
      payout_date: string;
      orders: { id: string; goods_total: number | null; shipping_charged: number | null }[];
    }[]) ?? [];

  const profitMap = await profitByOrder(rows.flatMap((p) => p.orders.map((o) => o.id)));

  return rows.map((p) => ({
    id: p.id,
    payout_date: p.payout_date,
    linkedCount: p.orders.length,
    otkup: p.orders.reduce((sum, o) => sum + otkupOf(o.goods_total, o.shipping_charged), 0),
    profit: p.orders.reduce((sum, o) => sum + (profitMap.get(o.id) ?? 0), 0),
  }));
}

/**
 * Kandidati za fakturu = nefakturisane uplate (bez praznih). „Za fakturisanje" =
 * Σ zarade tih uplata (zamrznuti profit_at_sale kroz order_profit view).
 */
export async function getInvoiceCandidates(): Promise<InvoiceCandidates> {
  const payouts = (await getInvoiceablePayouts()).filter((p) => p.linkedCount > 0);
  const total = payouts.reduce((sum, p) => sum + p.profit, 0);
  return { payouts, total };
}

export type BlockedOrder = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  delivered_at: string | null;
};

/**
 * Porudžbine koje čekaju VP (needs_vp=true) unutar NEfakturisane uplate — njihova
 * zarada je 0/podcenjena dok se VP ne unese, pa bi podcenile fakturu te uplate.
 * Prikazuju se kao upozorenje (ne blokiraju izdavanje).
 */
export async function getBlockedNeedsVpOrders(): Promise<BlockedOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, woo_order_id, ship_name, delivered_at, payouts!inner(invoice_id)")
    .eq("needs_vp", true)
    .is("payouts.invoice_id", null)
    .order("delivered_at", { ascending: true, nullsFirst: false });

  return (
    (data as unknown as (BlockedOrder & { payouts: { invoice_id: string | null } })[]) ?? []
  ).map((o) => ({
    id: o.id,
    woo_order_id: o.woo_order_id,
    ship_name: o.ship_name,
    delivered_at: o.delivered_at,
  }));
}

/** „Drug mi duguje" = Σ zarade nefakturisanih uplata (isti skup kao kandidati). */
export async function getDrugMiDuguje(): Promise<{ total: number; payoutCount: number }> {
  const { payouts, total } = await getInvoiceCandidates();
  return { total, payoutCount: payouts.length };
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

/* ── Saldo poštarine — 1.6c ──────────────────────────────────────────────── */

export type PostageBalance = {
  gross: number; // Σ(shipping_charged − withPdv(shipping_actual)) SAMO za porudžbine na XExpress fakturi
  settled: number; // Σ postage_settlements.amount (sa predznakom)
  balance: number; // gross − settled (pozitivno = Simić duguje Sportem-u)
};

/**
 * Saldo poštarine (prolazna stavka, NIJE profit) = zbir rezultata svih XExpress
 * faktura: koliko je naplaćeno kupcima za dostavu vs koliko je stvarno plaćeno
 * kuriru (osnovica + 20% PDV), umanjeno za već izvršene uplate. Broje se ISKLJUČIVO
 * porudžbine vezane za neku XExpress fakturu (`xexpress_invoice_id` NOT NULL) —
 * `shipping_actual` van fakture (ručni unos na detalju porudžbine) se ne računa.
 */
export async function getSaldoPostarine(): Promise<PostageBalance> {
  const supabase = await createClient();

  const { data: shipRows } = await supabase
    .from("orders")
    .select("shipping_charged, shipping_actual")
    .not("shipping_charged", "is", null)
    .not("shipping_actual", "is", null)
    .not("xexpress_invoice_id", "is", null);
  const gross = (
    (shipRows as { shipping_charged: number; shipping_actual: number }[]) ?? []
  ).reduce((sum, o) => sum + (o.shipping_charged - withPdv(o.shipping_actual)), 0);

  const { data: settleRows } = await supabase
    .from("postage_settlements")
    .select("amount");
  const settled = ((settleRows as { amount: number }[]) ?? []).reduce(
    (sum, r) => sum + r.amount,
    0,
  );

  return { gross, settled, balance: gross - settled };
}

export type PostageSettlementRow = {
  id: string;
  amount: number;
  settled_at: string;
  balance_before: number | null;
  notes: string | null;
};

/** Istorija poravnanja poštarine (append-only ledger), najnovije prvo. */
export async function listPostageSettlements(): Promise<PostageSettlementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("postage_settlements")
    .select("id, amount, settled_at, balance_before, notes")
    .order("settled_at", { ascending: false })
    .order("created_at", { ascending: false });
  return (data as PostageSettlementRow[]) ?? [];
}

/* ── XExpress fakture poštarine ──────────────────────────────────────────── */

const XEXPRESS_VAT_RATE = 20;

/** P&L jedne XExpress fakture: naplaćeno kupcima vs (osnovica + PDV). */
export type XexpressPnl = {
  naplaceno: number; // Σ shipping_charged (naplaćeno kupcima)
  osnovica: number; // Σ shipping_actual (stvarna poštarina, bez PDV-a)
  pdv: number; // Σ round(shipping_actual * rate/100)
  ukupno: number; // osnovica + pdv (plaćeno XExpress-u)
  rezultat: number; // naplaceno − ukupno (+ zarada / − gubitak na poštarini)
};

type ShipRow = { shipping_charged: number | null; shipping_actual: number | null };

/** Sabere P&L iz redova porudžbina (round PDV-a po porudžbini — kao global saldo). */
function pnlFrom(rows: ShipRow[], rate = XEXPRESS_VAT_RATE): XexpressPnl {
  let naplaceno = 0;
  let osnovica = 0;
  let pdv = 0;
  for (const r of rows) {
    naplaceno += r.shipping_charged ?? 0;
    const base = r.shipping_actual ?? 0;
    osnovica += base;
    pdv += Math.round((base * rate) / 100);
  }
  const ukupno = osnovica + pdv;
  return { naplaceno, osnovica, pdv, ukupno, rezultat: naplaceno - ukupno };
}

export type XexpressCandidate = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  ship_name: string | null;
  shipping_charged: number | null;
  shipping_actual: number | null;
};

/**
 * Granica istorije: `ordered_at` najstarije porudžbine koja je već na nekoj
 * XExpress fakturi. Sve pre nje = pred-app istorija (stare specifikacije koje
 * se ne unose ponovo) i ne prikazuje se kao kandidat. Prva faktura postavlja
 * granicu; dok nema nijedne, granice nema (null).
 */
async function xexpressHistoryBoundary(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("ordered_at")
    .not("xexpress_invoice_id", "is", null)
    .not("ordered_at", "is", null)
    .order("ordered_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { ordered_at: string | null } | null)?.ordered_at ?? null;
}

/**
 * id-jevi statusa čije porudžbine ulaze u XExpress fakturu poštarine:
 * „Isporučeno" i „Vraćeno" (vraćene su takođe slate → plaća se poštarina).
 * „Otkazano" NE (nije poslato). Lookup po imenu, nikad hardkodovan UUID.
 */
async function eligibleXexpressStatusIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", [APP_STATUS.delivered, APP_STATUS.returned]);
  return ((data as { id: string }[]) ?? []).map((r) => r.id);
}

/**
 * Kandidati za XExpress fakturu: xexpress + Isporučeno/Vraćeno + još nevezani za
 * neku fakturu, novije od granice istorije (v. `xexpressHistoryBoundary`). Ručna
 * selekcija po specifikaciji koju XExpress šalje. Najnovije prvo.
 */
export async function getEligibleXexpressOrders(): Promise<XexpressCandidate[]> {
  const statusIds = await eligibleXexpressStatusIds();
  if (statusIds.length === 0) return [];
  const boundary = await xexpressHistoryBoundary();

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("id, woo_order_id, ordered_at, ship_name, shipping_charged, shipping_actual")
    .eq("delivery_method", "xexpress")
    .in("status_id", statusIds)
    .is("xexpress_invoice_id", null);
  if (boundary) query = query.gte("ordered_at", boundary);
  const { data } = await query.order("ordered_at", { ascending: false });
  return (data as XexpressCandidate[]) ?? [];
}

export type XexpressInvoiceRow = XexpressPnl & {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  period_from: string | null;
  period_to: string | null;
  order_count: number;
};

/** Sve XExpress fakture + agregati (P&L po fakturi), najnovije prvo. */
export async function listXexpressInvoices(): Promise<XexpressInvoiceRow[]> {
  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("xexpress_invoices")
    .select("id, invoice_number, invoice_date, period_from, period_to, vat_rate")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false });
  const list =
    (invoices as {
      id: string;
      invoice_number: string | null;
      invoice_date: string;
      period_from: string | null;
      period_to: string | null;
      vat_rate: number;
    }[]) ?? [];
  if (list.length === 0) return [];

  const { data: orderRows } = await supabase
    .from("orders")
    .select("xexpress_invoice_id, shipping_charged, shipping_actual")
    .in(
      "xexpress_invoice_id",
      list.map((i) => i.id),
    );
  const byInvoice = new Map<string, ShipRow[]>();
  for (const r of (orderRows as (ShipRow & { xexpress_invoice_id: string })[]) ?? []) {
    const arr = byInvoice.get(r.xexpress_invoice_id) ?? [];
    arr.push(r);
    byInvoice.set(r.xexpress_invoice_id, arr);
  }

  return list.map((inv) => {
    const rows = byInvoice.get(inv.id) ?? [];
    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      period_from: inv.period_from,
      period_to: inv.period_to,
      order_count: rows.length,
      ...pnlFrom(rows, inv.vat_rate),
    };
  });
}

export type XexpressOrderLine = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  ship_name: string | null;
  shipping_charged: number | null;
  shipping_actual: number | null;
  pdv: number; // PDV te porudžbine
  ukupno: number; // osnovica + pdv te porudžbine
  rezultat: number; // shipping_charged − ukupno
};

export type XexpressInvoiceDetail = XexpressPnl & {
  invoice: {
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    period_from: string | null;
    period_to: string | null;
    vat_rate: number;
    notes: string | null;
  };
  orders: XexpressOrderLine[];
  candidates: XexpressCandidate[]; // nevezane porudžbine (za izmenu — dodavanje)
};

/** Detalj XExpress fakture: header, vezane porudžbine sa P&L, + kandidati za edit. */
export async function getXexpressInvoiceDetail(
  id: string,
): Promise<XexpressInvoiceDetail | null> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("xexpress_invoices")
    .select("id, invoice_number, invoice_date, period_from, period_to, vat_rate, notes")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return null;
  const invoice = inv as XexpressInvoiceDetail["invoice"];

  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, woo_order_id, ordered_at, ship_name, shipping_charged, shipping_actual")
    .eq("xexpress_invoice_id", id)
    .order("ordered_at", { ascending: true });
  const rows =
    (orderRows as {
      id: string;
      woo_order_id: number | null;
      ordered_at: string | null;
      ship_name: string | null;
      shipping_charged: number | null;
      shipping_actual: number | null;
    }[]) ?? [];

  const orders: XexpressOrderLine[] = rows.map((r) => {
    const base = r.shipping_actual ?? 0;
    const pdv = Math.round((base * invoice.vat_rate) / 100);
    const ukupno = base + pdv;
    return { ...r, pdv, ukupno, rezultat: (r.shipping_charged ?? 0) - ukupno };
  });

  const candidates = await getEligibleXexpressOrders();

  return { invoice, orders, candidates, ...pnlFrom(rows, invoice.vat_rate) };
}

/* ── Neto profit — 1.6c ──────────────────────────────────────────────────── */

export type NetoProfit = {
  zarada: number; // Σ realizovane zamrznute zarade u periodu
  troskovi: number; // Σ expenses.amount u periodu (0 do 1.7)
  neto: number; // zarada − troskovi
};

/**
 * Granice meseca „YYYY-MM": prvi/poslednji kalendarski dan + širok UTC pred-filter
 * (Belgrade je UTC+1/+2, pa Belgrade-dan može pasti u prethodni UTC dan).
 */
function monthBounds(monthStr: string) {
  const [y, mo] = monthStr.split("-").map(Number);
  const lastDayNum = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    firstDay: `${monthStr}-01`,
    lastDay: `${monthStr}-${pad(lastDayNum)}`,
    // UTC pred-filter: dan pre prvog do dva dana posle poslednjeg (bezbedno oko DST-a).
    gteUtc: new Date(Date.UTC(y, mo - 1, 1) - 86_400_000).toISOString(),
    ltUtc: new Date(Date.UTC(y, mo - 1, lastDayNum) + 2 * 86_400_000).toISOString(),
  };
}

/**
 * Neto profit za izabrani mesec — ISTA osnova kao Dashboard
 * (`computePeriodMetrics`): sve porudžbine kreirane u mesecu (`ordered_at`),
 * OSIM Otkazano/Vraćeno, bez gledanja isporuke/plaćanja. Zarada iz zamrznutih
 * stavki; troškovi po `expenses.date`. (Ranije: realizovano po `delivered_at` +
 * plaćeno — promenjeno na zahtev korisnika radi poklapanja sa Dashboardom.)
 */
export async function getNetoProfit(monthStr: string): Promise<NetoProfit> {
  const { firstDay, lastDay } = monthBounds(monthStr);
  const { zarada, troskovi, neto } = await computePeriodMetrics({ from: firstDay, to: lastDay });
  return { zarada, troskovi, neto };
}
