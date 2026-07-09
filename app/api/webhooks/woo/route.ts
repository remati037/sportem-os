import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  APP_STATUS,
  isWooCancelled,
  isWooPing,
  normalizePhone,
  parseRsd,
  verifyWooSignature,
  wooOrderSchema,
  type WooOrder,
} from "@/lib/woo";

/*
 * WooCommerce webhook (Korak 1.2) — `order.created` i `order.updated` gađaju
 * OVU istu rutu. Sigurnost: HMAC potpis nad sirovim telom; odgovori nikad ne
 * otkrivaju detalje. Idempotentnost: grana po postojanju `woo_order_id`.
 *
 * Princip zamrznutih cena: stavke (`order_items`) se upisuju ISKLJUČIVO pri
 * prvom prijemu porudžbine — `order.updated` nikad ne dira stavke, iznose,
 * adresu ni kupca (da ne pregazi admin izmene/popuste). Update sinhronizuje
 * samo `woo_status` i otkazivanje.
 */

const empty = (status: number) => new Response(null, { status });

export async function POST(request: Request) {
  // Sirovo telo PRE JSON parse-a — HMAC se računa nad bajt-identičnim stringom.
  const raw = await request.text();

  // Woo šalje NEPOTPISAN „ping" pri kreiranju/aktivaciji webhooka — ACK 200 PRE
  // provere potpisa (inače ping padne na 401 i Woo ne dozvoli snimanje).
  if (isWooPing(raw)) return empty(200);

  if (!verifyWooSignature(raw, request.headers.get("x-wc-webhook-signature"))) {
    return empty(401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return empty(400);
  }

  const parsed = wooOrderSchema.safeParse(payload);
  if (!parsed.success) {
    // 200 da Woo ne retry-uje beskonačno; nevalidan oblik logujemo za sebe.
    Sentry.captureMessage("Woo webhook: nevalidan payload", {
      level: "warning",
      extra: { issues: parsed.error.issues.slice(0, 5) },
    });
    return empty(200);
  }

  try {
    const supabase = createAdminClient();
    const order = parsed.data;

    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("id, status_id, invoice_id, payment_status, cancelled_at")
      .eq("woo_order_id", order.id)
      .maybeSingle();
    if (findError) throw findError;

    if (existing) {
      await syncExistingOrder(supabase, order, existing);
    } else {
      const inserted = await insertOrder(supabase, order);
      // Race created/updated: UNIQUE 23505 → tretiraj kao update granu.
      if (!inserted.ok) {
        const { data: raced } = await supabase
          .from("orders")
          .select("id, status_id, invoice_id, payment_status, cancelled_at")
          .eq("woo_order_id", order.id)
          .maybeSingle();
        if (raced) await syncExistingOrder(supabase, order, raced);
        else throw inserted.error;
      }
    }

    return empty(200);
  } catch (error) {
    Sentry.captureException(error);
    // 500 → Woo retry ponavlja isporuku (idempotentno je).
    return empty(500);
  }
}

type ExistingOrder = {
  id: string;
  status_id: string;
  invoice_id: string | null;
  payment_status: string;
  cancelled_at: string | null;
};

/** ID statusa iz lookup tabele po imenu (nikad hardkodovan UUID). */
async function getStatusId(supabase: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", name)
    .single();
  if (error || !data) throw new Error(`Nepoznat status porudžbine: ${name}`);
  return data.id;
}

/** Upsert kupca po normalizovanom telefonu; bez telefona → uvek nov red. */
async function upsertCustomer(supabase: SupabaseClient, order: WooOrder): Promise<string | null> {
  const billing = order.billing;
  const shipping = order.shipping;
  const name =
    `${billing?.first_name ?? ""} ${billing?.last_name ?? ""}`.trim() ||
    `${shipping?.first_name ?? ""} ${shipping?.last_name ?? ""}`.trim() ||
    null;
  const phone = normalizePhone(billing?.phone || shipping?.phone);

  const row = {
    name,
    phone,
    email: billing?.email?.trim() || null,
    address: (shipping?.address_1 || billing?.address_1 || "").trim() || null,
    city: (shipping?.city || billing?.city || "").trim() || null,
    postal_code: (shipping?.postcode || billing?.postcode || "").trim() || null,
  };

  if (phone) {
    const { data, error } = await supabase
      .from("customers")
      .upsert(row, { onConflict: "phone" })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  const { data, error } = await supabase.from("customers").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/**
 * Prvi prijem porudžbine: order + kupac + STAVKE SA ZAMRZNUTIM CENAMA.
 * mp_at_sale = stvarno naplaćeno iz Woo-a; vp_at_sale = trenutni vp_price
 * varijante (lookup po SKU). Nepoznat SKU → vp_at_sale null + needs_vp flag.
 */
async function insertOrder(
  supabase: SupabaseClient,
  order: WooOrder,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const customerId = await upsertCustomer(supabase, order);
  const statusId = await getStatusId(supabase, APP_STATUS.created);

  // Snapshot stavki: batch lookup varijanti po SKU (jedan upit).
  const skus = order.line_items.map((li) => (li.sku ?? "").trim()).filter(Boolean);
  const variantsBySku = new Map<string, { id: string; vp_price: number }>();
  if (skus.length > 0) {
    const { data: variants, error } = await supabase
      .from("product_variants")
      .select("id, sku, vp_price")
      .in("sku", skus);
    if (error) throw error;
    for (const v of variants ?? []) variantsBySku.set(v.sku, v);
  }

  const items = order.line_items.map((li) => {
    const sku = (li.sku ?? "").trim();
    const variant = sku ? variantsBySku.get(sku) : undefined;
    const quantity = li.quantity;
    const lineTotal = parseRsd(li.total);
    const unitPrice = parseRsd(li.price);
    // Stvarno naplaćeno po komadu (posle popusta); fallback jedinična cena.
    const mpAtSale = lineTotal != null ? Math.round(lineTotal / quantity) : (unitPrice ?? 0);

    return {
      sku: sku || "NEPOZNAT",
      product_name: (li.name ?? "").trim() || "Nepoznat artikal",
      quantity,
      mp_at_sale: mpAtSale,
      vp_at_sale: variant?.vp_price ?? null,
      variant_id: variant?.id ?? null,
    };
  });

  const needsVp = items.some((i) => i.vp_at_sale == null);

  const shipping = order.shipping;
  const billing = order.billing;
  const shipName =
    `${shipping?.first_name ?? ""} ${shipping?.last_name ?? ""}`.trim() ||
    `${billing?.first_name ?? ""} ${billing?.last_name ?? ""}`.trim() ||
    null;

  const goodsTotal = items.reduce((sum, i) => sum + i.mp_at_sale * i.quantity, 0);
  const total = parseRsd(order.total);
  const isCod = (order.payment_method ?? "").toLowerCase() === "cod";

  const { data: created, error: orderError } = await supabase
    .from("orders")
    .insert({
      woo_order_id: order.id,
      customer_id: customerId,
      status_id: statusId,
      delivery_method: "xexpress", // lične/keš prodaje se ručno označe kasnije
      ship_name: shipName,
      ship_phone: normalizePhone(shipping?.phone || billing?.phone),
      ship_address: (shipping?.address_1 || billing?.address_1 || "").trim() || null,
      ship_city: (shipping?.city || billing?.city || "").trim() || null,
      ship_postal_code: (shipping?.postcode || billing?.postcode || "").trim() || null,
      ship_note: order.customer_note?.trim() || null,
      goods_total: goodsTotal,
      shipping_charged: parseRsd(order.shipping_total),
      cod_amount: isCod ? total : null,
      needs_vp: needsVp,
      ordered_at: order.date_created_gmt ? `${order.date_created_gmt}Z` : null,
      woo_status: order.status,
    })
    .select("id")
    .single();

  if (orderError) {
    if ((orderError as { code?: string }).code === "23505") {
      return { ok: false, error: orderError };
    }
    throw orderError;
  }

  if (items.length > 0) {
    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(items.map((i) => ({ ...i, order_id: created.id })));
    if (itemsError) {
      // Nema DB transakcije kroz supabase-js — ručni rollback + 500 → Woo retry.
      await supabase.from("orders").delete().eq("id", created.id);
      throw itemsError;
    }
  }

  // Ako je porudžbina u Woo-u već otkazana (updated stigao prvi) — sinhronizuj.
  if (isWooCancelled(order.status)) {
    const { data: fresh } = await supabase
      .from("orders")
      .select("id, status_id, invoice_id, payment_status, cancelled_at")
      .eq("id", created.id)
      .single();
    if (fresh) await syncExistingOrder(supabase, order, fresh);
  }

  return { ok: true };
}

/**
 * `order.updated` nad postojećom porudžbinom: samo `woo_status` + otkazivanje.
 * Guard: fakturisana/uplaćena porudžbina se NE otkazuje automatski — dobija
 * `needs_review` za ručnu odluku admina.
 */
async function syncExistingOrder(
  supabase: SupabaseClient,
  order: WooOrder,
  existing: ExistingOrder,
): Promise<void> {
  const patch: Record<string, unknown> = { woo_status: order.status };

  if (isWooCancelled(order.status) && !existing.cancelled_at) {
    const isLocked = existing.invoice_id !== null || existing.payment_status !== "neuplaceno";
    if (isLocked) {
      patch.needs_review = true;
      patch.review_reason = `WooCommerce status „${order.status}" stigao posle fakturisanja/uplate — potrebna ručna odluka.`;
    } else {
      patch.status_id = await getStatusId(supabase, APP_STATUS.cancelled);
      patch.cancelled_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from("orders").update(patch).eq("id", existing.id);
  if (error) throw error;
}
