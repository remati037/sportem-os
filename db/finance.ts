import "server-only";

import { createClient } from "@/lib/supabase/server";
import { chunked, must, selectAll } from "@/lib/supabase/paginate";
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
  const res = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", APP_STATUS.delivered)
    .maybeSingle();
  return must<{ id: string } | null>(res, "status Isporučeno")?.id ?? null;
}

/* ── Uplate (payouts) — 1.6a ─────────────────────────────────────────────── */

export type PayoutCandidate = {
  id: string;
  woo_order_id: number | null;
  ship_name: string | null;
  goods_total: number | null;
  shipping_charged: number | null; // naplaćena poštarina (NULL = nije uneta)
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
  const rows = await selectAll<{
    id: string;
    woo_order_id: number | null;
    ship_name: string | null;
    goods_total: number | null;
    shipping_charged: number | null;
    delivered_at: string | null;
  }>("kandidati za uplatu", () =>
    supabase
      .from("orders")
      .select("id, woo_order_id, ship_name, goods_total, shipping_charged, delivered_at")
      .eq("delivery_method", "xexpress")
      .eq("payment_status", "neuplaceno")
      .eq("status_id", delivered)
      .is("payout_id", null)
      .order("delivered_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );

  return rows.map((o) => ({
    ...o,
    otkup: otkupOf(o.goods_total, o.shipping_charged),
  }));
}

export type PayoutRow = {
  id: string;
  amount: number;
  payout_date: string;
  delivery_date: string | null;
  notes: string | null;
  invoice_id: string | null; // faktura na kojoj je uplata (NULL = nefakturisana)
  settlement: PayoutSettlement;
  tax_rate_bp: number;
  cash_received_at: string | null;
  linkedCount: number;
  linkedOtkup: number; // Σ otkupnina vezanih porudžbina
  profit: number; // Σ zamrznuta zarada vezanih porudžbina (order_profit view)
};

/** Lista uplata (sa brojem vezanih porudžbina, Σ otkupnine i Σ zarade). */
export async function listPayouts(): Promise<PayoutRow[]> {
  const supabase = await createClient();
  const rows = await selectAll<
    Omit<PayoutRow, "linkedCount" | "linkedOtkup" | "profit"> & {
      orders: { id: string; goods_total: number | null; shipping_charged: number | null }[];
    }
  >("lista uplata", () =>
    supabase
      .from("payouts")
      .select(
        "id, amount, payout_date, delivery_date, notes, invoice_id, settlement, tax_rate_bp, cash_received_at, orders(id, goods_total, shipping_charged)",
      )
      .order("payout_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  );

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
  orders: (PayoutCandidate & { ordered_at: string | null })[];
  otkupTotal: number;
  postageTotal: number; // Σ shipping_charged (poštarina naplaćena kupcima; deo otkupa)
  difference: number; // amount − otkupTotal (0 = poklapa se)
};

/** Detalj uplate: vezane porudžbine + Σ otkupnina + razlika prema unetom iznosu. */
export async function getPayoutDetail(id: string): Promise<PayoutDetail | null> {
  const supabase = await createClient();
  const res = await supabase
    .from("payouts")
    .select(
      `id, amount, payout_date, delivery_date, notes, invoice_id, settlement, tax_rate_bp, cash_received_at,
       orders(id, woo_order_id, ship_name, goods_total, shipping_charged, delivered_at, ordered_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  const data = must(res, "detalj uplate");
  if (!data) return null;

  const row = data as unknown as Omit<PayoutRow, "linkedCount" | "linkedOtkup"> & {
    orders: {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      goods_total: number | null;
      shipping_charged: number | null;
      delivered_at: string | null;
      ordered_at: string | null;
    }[];
  };
  const postageTotal = row.orders.reduce((sum, o) => sum + (o.shipping_charged ?? 0), 0);
  const orders: PayoutDetail["orders"] = [...row.orders]
    .sort((a, b) => (a.woo_order_id ?? 0) - (b.woo_order_id ?? 0))
    .map((o) => ({
      ...o,
      otkup: otkupOf(o.goods_total, o.shipping_charged),
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
      settlement: row.settlement,
      tax_rate_bp: row.tax_rate_bp,
      cash_received_at: row.cash_received_at,
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
  const rows = await selectAll<{
    id: string;
    woo_order_id: number | null;
    ship_name: string | null;
    shipping_charged: number | null;
    order_items: (SpisakArticleRow & { mp_at_sale: number; vp_at_sale: number | null })[];
  }>("spisak uplate", () =>
    supabase
      .from("orders")
      .select(
        "id, woo_order_id, ship_name, shipping_charged, order_items(sku, product_name, quantity, mp_at_sale, vp_at_sale)",
      )
      .eq("payout_id", payoutId)
      .order("woo_order_id", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );

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
  // Parčad po IN_CHUNK + paginacija: dugačak `.in()` URL obori zahtev, a tihi
  // cap od 1000 redova bi zaradu uplate umanjio bez ijedne poruke.
  for (const chunk of chunked(orderIds)) {
    const rows = await selectAll<{ order_id: string; profit: number | null }>(
      "zarada po porudžbini (order_profit)",
      () =>
        supabase
          .from("order_profit")
          .select("order_id, profit")
          .in("order_id", chunk)
          .order("order_id", { ascending: true }),
    );
    for (const r of rows) map.set(r.order_id, r.profit ?? 0);
  }
  return map;
}

/**
 * Kandidat za fakturu = jedna UPLATA (payout) koja još nije ni na jednoj fakturi.
 * Faktura se sklapa od uplata (ne pojedinačnih porudžbina) — jednostavnije.
 */
export type PayoutSettlement = "faktura" | "kes";

/** Porez koji se ODUZIMA od zarade (bazni poeni: 1000 = 10 %). Ceo RSD, pola naviše. */
export function taxOf(profit: number, taxRateBp: number): number {
  if (taxRateBp <= 0 || profit <= 0) return 0;
  return Math.round((profit * taxRateBp) / 10000);
}

export type PayoutInvoiceCandidate = {
  id: string;
  payout_date: string;
  linkedCount: number; // broj vezanih porudžbina
  otkup: number; // Σ otkupnina vezanih porudžbina
  profit: number; // Σ zamrznuta zarada (order_profit) — osnova „za fakturisanje"
  settlement: PayoutSettlement;
  tax_rate_bp: number;
  tax: number; // porez koji se oduzima od zarade
  net: number; // profit − tax
  cash_received_at: string | null;
};

export type InvoiceCandidates = {
  payouts: PayoutInvoiceCandidate[]; // settlement = faktura
  total: number; // Σ zarade (bruto)
  tax: number;
  net: number;
};

/** Nefakturisane uplate (payout.invoice_id null) sa Σ zarade, poreza i otkupnine. */
export async function getInvoiceablePayouts(): Promise<PayoutInvoiceCandidate[]> {
  const supabase = await createClient();
  const rows = await selectAll<{
    id: string;
    payout_date: string;
    settlement: PayoutSettlement;
    tax_rate_bp: number;
    cash_received_at: string | null;
    orders: { id: string; goods_total: number | null; shipping_charged: number | null }[];
  }>("nefakturisane uplate", () =>
    supabase
      .from("payouts")
      .select(
        "id, payout_date, settlement, tax_rate_bp, cash_received_at, orders(id, goods_total, shipping_charged)",
      )
      .is("invoice_id", null)
      .order("payout_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  );

  const profitMap = await profitByOrder(rows.flatMap((p) => p.orders.map((o) => o.id)));

  return rows.map((p) => {
    const profit = p.orders.reduce((sum, o) => sum + (profitMap.get(o.id) ?? 0), 0);
    const tax = taxOf(profit, p.tax_rate_bp);
    return {
      id: p.id,
      payout_date: p.payout_date,
      linkedCount: p.orders.length,
      otkup: p.orders.reduce((sum, o) => sum + otkupOf(o.goods_total, o.shipping_charged), 0),
      profit,
      settlement: p.settlement,
      tax_rate_bp: p.tax_rate_bp,
      tax,
      net: profit - tax,
      cash_received_at: p.cash_received_at,
    };
  });
}

function sumCandidates(payouts: PayoutInvoiceCandidate[]) {
  return {
    total: payouts.reduce((s, p) => s + p.profit, 0),
    tax: payouts.reduce((s, p) => s + p.tax, 0),
    net: payouts.reduce((s, p) => s + p.net, 0),
  };
}

/**
 * Kandidati za fakturu = nefakturisane uplate sa načinom „faktura" (bez praznih).
 * „Za fakturisanje" = Σ zarade tih uplata (zamrznuti profit_at_sale kroz
 * order_profit view). Keš uplate su izdvojene (getCashPayouts).
 */
export async function getInvoiceCandidates(
  all?: PayoutInvoiceCandidate[],
): Promise<InvoiceCandidates> {
  const source = all ?? (await getInvoiceablePayouts());
  const payouts = source.filter((p) => p.linkedCount > 0 && p.settlement === "faktura");
  return { payouts, ...sumCandidates(payouts) };
}

/** Nefakturisane uplate označene kao KEŠ (otvorene = keš još nije primljen). */
export async function getCashPayouts(all?: PayoutInvoiceCandidate[]): Promise<{
  open: PayoutInvoiceCandidate[];
  received: PayoutInvoiceCandidate[];
  openTotal: number;
  openNet: number;
}> {
  const source = all ?? (await getInvoiceablePayouts());
  const cash = source.filter((p) => p.linkedCount > 0 && p.settlement === "kes");
  const open = cash.filter((p) => !p.cash_received_at);
  const received = cash.filter((p) => p.cash_received_at);
  const sums = sumCandidates(open);
  return { open, received, openTotal: sums.total, openNet: sums.net };
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
  const rows = await selectAll<BlockedOrder & { payouts: { invoice_id: string | null } }>(
    "porudžbine bez VP u nefakturisanoj uplati",
    () =>
      supabase
        .from("orders")
        .select("id, woo_order_id, ship_name, delivered_at, payouts!inner(invoice_id)")
        .eq("needs_vp", true)
        .is("payouts.invoice_id", null)
        .order("delivered_at", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true }),
  );

  return rows.map((o) => ({
    id: o.id,
    woo_order_id: o.woo_order_id,
    ship_name: o.ship_name,
    delivered_at: o.delivered_at,
  }));
}

/**
 * „Drug mi duguje" = Σ zarade nefakturisanih uplata „faktura" (za sledeću fakturu)
 * + Σ keša koji još nije primljen, POSLE poreza (toliko stvarno stiže u kešu).
 */
export async function getDrugMiDuguje(): Promise<{
  total: number;
  payoutCount: number;
  invoiceTotal: number;
  cashOpenTotal: number; // keš koji čeka — POSLE poreza (toliko stiže u kešu)
  cashOpenCount: number;
}> {
  const all = await getInvoiceablePayouts();
  const [inv, cash] = await Promise.all([getInvoiceCandidates(all), getCashPayouts(all)]);
  return {
    total: inv.total + cash.openNet,
    payoutCount: inv.payouts.length,
    invoiceTotal: inv.total,
    cashOpenTotal: cash.openNet,
    cashOpenCount: cash.open.length,
  };
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
  const rows = await selectAll<Omit<InvoiceRow, "orderCount"> & { orders: { count: number }[] }>(
    "lista faktura",
    () =>
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, period_from, period_to, total_amount, status, created_at, orders(count)",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
  );

  return rows.map(({ orders, ...inv }) => ({
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
  tax: number; // Σ poreza po uplatama fakture (stopa sa svake uplate)
  isBackfill: boolean;
};

/** Detalj fakture: vezane porudžbine + zarada po porudžbini + živi zbir. */
export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();
  const res = await supabase
    .from("invoices")
    .select(
      `id, invoice_number, period_from, period_to, total_amount, status, created_at,
       orders(id, woo_order_id, ship_name, delivered_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  const data = must(res, "detalj fakture");
  if (!data) return null;

  const row = data as unknown as Omit<InvoiceRow, "orderCount"> & {
    orders: {
      id: string;
      woo_order_id: number | null;
      ship_name: string | null;
      delivered_at: string | null;
    }[];
  };

  const sorted = [...row.orders].sort((a, b) => (a.woo_order_id ?? 0) - (b.woo_order_id ?? 0));
  const profits = await profitByOrder(sorted.map((o) => o.id));
  const orders: InvoiceDetailOrder[] = sorted.map((o) => ({
    ...o,
    profit: profits.get(o.id) ?? 0,
  }));
  const computedTotal = orders.reduce((sum, o) => sum + o.profit, 0);

  // Porez se vodi po uplati (payouts.tax_rate_bp) — sabira se po uplatama fakture.
  const payoutRows = must(
    await supabase
      .from("payouts")
      .select("id, tax_rate_bp, orders(id)")
      .eq("invoice_id", id)
      .order("id", { ascending: true }),
    "porez po uplatama fakture",
  ) as unknown as { id: string; tax_rate_bp: number; orders: { id: string }[] }[];
  const tax = (payoutRows ?? []).reduce((sum, p) => {
    const profit = p.orders.reduce((s2, o) => s2 + (profits.get(o.id) ?? 0), 0);
    return sum + taxOf(profit, p.tax_rate_bp);
  }, 0);

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
    tax,
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

  const shipRows = await selectAll<{ shipping_charged: number; shipping_actual: number }>(
    "saldo poštarine: orders",
    () =>
      supabase
        .from("orders")
        .select("shipping_charged, shipping_actual")
        .not("shipping_charged", "is", null)
        .not("shipping_actual", "is", null)
        .not("xexpress_invoice_id", "is", null)
        .order("id", { ascending: true }),
  );
  const gross = shipRows.reduce(
    (sum, o) => sum + (o.shipping_charged - withPdv(o.shipping_actual)),
    0,
  );

  const settleRows = await selectAll<{ amount: number }>(
    "saldo poštarine: postage_settlements",
    () => supabase.from("postage_settlements").select("amount").order("id", { ascending: true }),
  );
  const settled = settleRows.reduce((sum, r) => sum + r.amount, 0);

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
  return await selectAll<PostageSettlementRow>("istorija poravnanja poštarine", () =>
    supabase
      .from("postage_settlements")
      .select("id, amount, settled_at, balance_before, notes")
      .order("settled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  );
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
  const res = await supabase
    .from("orders")
    .select("ordered_at")
    .not("xexpress_invoice_id", "is", null)
    .not("ordered_at", "is", null)
    .order("ordered_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (
    must<{ ordered_at: string | null } | null>(res, "granica XExpress istorije")?.ordered_at ?? null
  );
}

/**
 * Kandidati za XExpress fakturu: SVE xexpress porudžbine (bilo koji status —
 * XExpress naplaćuje poštarinu i pre isporuke, i za vraćene/odbijene) koje još
 * nisu vezane za neku fakturu, novije od granice istorije (v.
 * `xexpressHistoryBoundary`). Ručna selekcija po specifikaciji. Najnovije prvo.
 */
export async function getEligibleXexpressOrders(): Promise<XexpressCandidate[]> {
  const boundary = await xexpressHistoryBoundary();

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("id, woo_order_id, ordered_at, ship_name, shipping_charged, shipping_actual")
    .eq("delivery_method", "xexpress")
    .is("xexpress_invoice_id", null);
  if (boundary) query = query.gte("ordered_at", boundary);
  const ordered = query.order("ordered_at", { ascending: false }).order("id", { ascending: true });
  return await selectAll<XexpressCandidate>("kandidati za XExpress fakturu", () => ordered);
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
  const list = await selectAll<{
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    period_from: string | null;
    period_to: string | null;
    vat_rate: number;
  }>("lista XExpress faktura", () =>
    supabase
      .from("xexpress_invoices")
      .select("id, invoice_number, invoice_date, period_from, period_to, vat_rate")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  );
  if (list.length === 0) return [];

  // Parčad po IN_CHUNK + paginacija — inače P&L po fakturi vidi samo deo redova.
  const byInvoice = new Map<string, ShipRow[]>();
  for (const chunk of chunked(list.map((i) => i.id))) {
    const orderRows = await selectAll<ShipRow & { xexpress_invoice_id: string }>(
      "XExpress fakture: orders",
      () =>
        supabase
          .from("orders")
          .select("xexpress_invoice_id, shipping_charged, shipping_actual")
          .in("xexpress_invoice_id", chunk)
          .order("id", { ascending: true }),
    );
    for (const r of orderRows) {
      const arr = byInvoice.get(r.xexpress_invoice_id) ?? [];
      arr.push(r);
      byInvoice.set(r.xexpress_invoice_id, arr);
    }
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
export async function getXexpressInvoiceDetail(id: string): Promise<XexpressInvoiceDetail | null> {
  const supabase = await createClient();
  const invRes = await supabase
    .from("xexpress_invoices")
    .select("id, invoice_number, invoice_date, period_from, period_to, vat_rate, notes")
    .eq("id", id)
    .maybeSingle();
  const inv = must(invRes, "detalj XExpress fakture");
  if (!inv) return null;
  const invoice = inv as XexpressInvoiceDetail["invoice"];

  const rows = await selectAll<{
    id: string;
    woo_order_id: number | null;
    ordered_at: string | null;
    ship_name: string | null;
    shipping_charged: number | null;
    shipping_actual: number | null;
  }>("XExpress faktura: vezane porudžbine", () =>
    supabase
      .from("orders")
      .select("id, woo_order_id, ordered_at, ship_name, shipping_charged, shipping_actual")
      .eq("xexpress_invoice_id", id)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

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
