"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_STATUS, CANCELLED_STATUS_NAMES, isCancelStatusName, wooStatusForApp } from "@/lib/woo";
import { updateWooOrderStatus } from "@/lib/woo-client";
import {
  addItemSchema,
  changeOrderStatusSchema,
  changeOrdersStatusSchema,
  markCashSaleSchema,
  markOrdersShippedSchema,
  setItemVpSchema,
  updateItemPriceSchema,
  updateItemQuantitySchema,
  updateShippingSchema,
} from "@/lib/validation/orders";

/*
 * Edit stavki porudžbine (Korak 1.2, samo Admin). Sve izmene diraju SAMO
 * zamrznute vrednosti te porudžbine — katalog se NIKAD ne menja odavde.
 * Fakturisana porudžbina je zaključana. Write ide kroz RLS klijent (admin
 * ima write politike) — RLS ostaje izvor sigurnosti.
 */

export type OrderActionState = {
  error: string | null;
  success?: string | null;
  // Signal klijentu: porudžbina je plaćena/fakturisana — traži se izričita
  // Admin potvrda („ipak vrati/otkaži") koja ponovo šalje akciju sa force=true.
  requiresForce?: boolean;
};

function revalidateOrder() {
  // Detalj porudžbine je `force-dynamic` (+ `router.refresh()` na klijentu), pa
  // je revalidacija po URL-u nepotrebna — dovoljno je osvežiti listu. (URL sada
  // koristi Woo broj, a akcije rade po UUID-u, pa se putanja ne poklapa.)
  revalidatePath("/porudzbine");
}

/**
 * Gurni novi status u WooCommerce (app → Woo). Best-effort: app je izvor istine,
 * pa svaka Woo greška ide u Sentry i vraća `false` (pozivalac blago upozori) —
 * nikad ne obara promenu statusa. Vraća `true` i kad nema šta da se gura
 * (custom status bez mapiranja ili porudžbina bez `woo_order_id`).
 */
async function pushWooStatus(
  wooOrderId: number | null,
  appStatusName: string,
): Promise<boolean> {
  const wooStatus = wooStatusForApp(appStatusName);
  if (!wooOrderId || !wooStatus) return true;
  try {
    await updateWooOrderStatus(wooOrderId, wooStatus);
    return true;
  } catch (e) {
    Sentry.captureException(e);
    return false;
  }
}

/** Porudžbina sme da se menja samo dok nije fakturisana. */
async function assertEditable(orderId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("invoice_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return "Porudžbina nije pronađena.";
  if (data.invoice_id) return "Porudžbina je fakturisana — izmene stavki nisu dozvoljene.";
  return null;
}

/** order_id stavke + guard fakturisanosti. */
async function getEditableOrderIdForItem(
  itemId: string,
): Promise<{ orderId: string } | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_items")
    .select("order_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!data) return { error: "Stavka nije pronađena." };
  const blocked = await assertEditable(data.order_id);
  if (blocked) return { error: blocked };
  return { orderId: data.order_id };
}

/** `needs_vp` = postoji li i dalje stavka bez VP (posle svake mutacije). */
async function syncNeedsVp(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .is("vp_at_sale", null);
  await supabase
    .from("orders")
    .update({ needs_vp: (count ?? 0) > 0 })
    .eq("id", orderId);
}

/**
 * Preračunaj `orders.goods_total` iz trenutnih stavki (Σ mp_at_sale × quantity) —
 * ista formula kao webhook. Poziva se posle svake izmene stavki (cena/količina/
 * brisanje/dodavanje) da vrednost robe ostane usklađena. Otkup u uplatama čita
 * baš `goods_total`, pa nesklad kvari i finansije.
 */
async function recomputeGoodsTotal(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_items")
    .select("mp_at_sale, quantity")
    .eq("order_id", orderId);
  const goodsTotal = (data ?? []).reduce(
    (sum, i) => sum + (i.mp_at_sale ?? 0) * (i.quantity ?? 0),
    0,
  );
  await supabase.from("orders").update({ goods_total: goodsTotal }).eq("id", orderId);
}

/** Izmena zamrznute MP (popust) — menja SAMO ovu stavku, katalog netaknut. */
export async function updateItemPrice(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole("admin");

  const parsed = updateItemPriceSchema.safeParse({
    item_id: formData.get("item_id"),
    mp_at_sale: formData.get("mp_at_sale"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const target = await getEditableOrderIdForItem(parsed.data.item_id);
  if ("error" in target) return { error: target.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_items")
    .update({ mp_at_sale: parsed.data.mp_at_sale })
    .eq("id", parsed.data.item_id);
  if (error) return { error: "Izmena cene nije uspela." };

  await recomputeGoodsTotal(target.orderId);
  revalidateOrder();
  return { error: null, success: "Cena stavke izmenjena." };
}

export async function updateItemQuantity(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole("admin");

  const parsed = updateItemQuantitySchema.safeParse({
    item_id: formData.get("item_id"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const target = await getEditableOrderIdForItem(parsed.data.item_id);
  if ("error" in target) return { error: target.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_items")
    .update({ quantity: parsed.data.quantity })
    .eq("id", parsed.data.item_id);
  if (error) return { error: "Izmena količine nije uspela." };

  await recomputeGoodsTotal(target.orderId);
  revalidateOrder();
  return { error: null, success: "Količina izmenjena." };
}

/** Unos VP na stavci bez varijante — skida `needs_vp` kad su sve pokrivene. */
export async function setItemVp(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole("admin");

  const parsed = setItemVpSchema.safeParse({
    item_id: formData.get("item_id"),
    vp_at_sale: formData.get("vp_at_sale"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const target = await getEditableOrderIdForItem(parsed.data.item_id);
  if ("error" in target) return { error: target.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_items")
    .update({ vp_at_sale: parsed.data.vp_at_sale })
    .eq("id", parsed.data.item_id);
  if (error) return { error: "Unos VP cene nije uspeo." };

  await syncNeedsVp(target.orderId);
  revalidateOrder();
  return { error: null, success: "VP cena upisana." };
}

export async function deleteItem(itemId: string): Promise<OrderActionState> {
  await requireRole("admin");
  if (!itemId) return { error: "Neispravan unos." };

  const target = await getEditableOrderIdForItem(itemId);
  if ("error" in target) return { error: target.error };

  const supabase = await createClient();
  const { error } = await supabase.from("order_items").delete().eq("id", itemId);
  if (error) return { error: "Brisanje stavke nije uspelo." };

  await syncNeedsVp(target.orderId);
  await recomputeGoodsTotal(target.orderId);
  revalidateOrder();
  return { error: null, success: "Stavka obrisana." };
}

/** Dodavanje stavke iz kataloga — snapshot MP/VP u trenutku dodavanja. */
export async function addItemFromCatalog(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole("admin");

  const parsed = addItemSchema.safeParse({
    order_id: formData.get("order_id"),
    variant_id: formData.get("variant_id"),
    quantity: formData.get("quantity") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const blocked = await assertEditable(parsed.data.order_id);
  if (blocked) return { error: blocked };

  const supabase = await createClient();
  const { data: variant } = await supabase
    .from("product_variants")
    .select("id, sku, variant_name, mp_price, vp_price, product:products(name)")
    .eq("id", parsed.data.variant_id)
    .maybeSingle();
  if (!variant) return { error: "Artikal nije pronađen u katalogu." };

  const productName = (variant.product as unknown as { name: string } | null)?.name ?? "";
  const { error } = await supabase.from("order_items").insert({
    order_id: parsed.data.order_id,
    variant_id: variant.id,
    sku: variant.sku,
    product_name: variant.variant_name ? `${productName} — ${variant.variant_name}` : productName,
    quantity: parsed.data.quantity,
    mp_at_sale: variant.mp_price, // snapshot: trenutna MP
    vp_at_sale: variant.vp_price, // snapshot: trenutna VP
  });
  if (error) return { error: "Dodavanje stavke nije uspelo." };

  await syncNeedsVp(parsed.data.order_id);
  await recomputeGoodsTotal(parsed.data.order_id);
  revalidateOrder();
  return { error: null, success: "Stavka dodata." };
}

/*
 * Order-level akcije (Korak 1.4): promena statusa kroz tok, keš/lična prodaja,
 * razrešavanje needs_review. Idu kroz SERVICE-ROLE klijent jer RLS na `orders`
 * dozvoljava write samo Adminu — a status menja i Menadžer. `requireRole` je
 * jedina kapija; keš/plaćanje ostaje Admin-only (dira novac). Zamrznute cene
 * (`order_items`) se ne diraju.
 */

/** Promena statusa + upis u istoriju (ko i kada). Admin + Menadžer. */
export async function changeOrderStatus(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const { userId, profile } = await requireRole("admin", "manager");

  const parsed = changeOrderStatusSchema.safeParse({
    order_id: formData.get("order_id"),
    status_id: formData.get("status_id"),
    note: formData.get("note") ?? undefined,
    force: formData.get("force") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, status_id, payment_status, invoice_id, shipped_at, delivered_at, cancelled_at, woo_order_id",
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!order) return { error: "Porudžbina nije pronađena." };

  const { data: target } = await supabase
    .from("order_statuses")
    .select("id, name")
    .eq("id", parsed.data.status_id)
    .maybeSingle();
  if (!target) return { error: "Status nije pronađen." };
  if (order.status_id === target.id) return { error: "Porudžbina je već u tom statusu." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status_id: target.id };

  // Lifecycle timestamp-ovi se mapiraju SAMO na poznate (seed) statuse; custom
  // status menja samo status_id. Prelaz unazad čisti „buduće" timestamp-ove.
  if (isCancelStatusName(target.name)) {
    // Razlog otkazivanja/vraćanja je OBAVEZAN (server je izvor istine).
    if (!parsed.data.note) {
      return { error: "Unesite razlog otkazivanja/vraćanja." };
    }
    const locked = order.invoice_id !== null || order.payment_status !== "neuplaceno";
    if (locked && !parsed.data.force) {
      // Plaćena/fakturisana porudžbina se NE otkazuje jednim klikom (zaštita
      // finansija). Traži se izričita Admin potvrda — klijent ponavlja sa force.
      return {
        error:
          "Porudžbina je plaćena/fakturisana. Potrebna je izričita potvrda Admina za vraćanje/otkazivanje.",
        requiresForce: true,
      };
    }
    if (locked && profile.role !== "admin") {
      // „Ipak vrati/otkaži" plaćene/fakturisane dira novac → samo Admin.
      return { error: "Samo Admin može da vrati/otkaže plaćenu ili fakturisanu porudžbinu." };
    }
    // Snapshot/„plaćeno" se NE dira (odluka korisnika): menja se samo status +
    // cancelled_at. Porudžbina automatski ispada iz neto profita (status ≠ Isporučeno).
    patch.cancelled_at = order.cancelled_at ?? now;
  } else if (target.name === APP_STATUS.sent) {
    patch.shipped_at = order.shipped_at ?? now;
    patch.delivered_at = null;
    patch.cancelled_at = null;
  } else if (target.name === APP_STATUS.delivered) {
    patch.shipped_at = order.shipped_at ?? now;
    patch.delivered_at = order.delivered_at ?? now;
    patch.cancelled_at = null;
  } else if (target.name === APP_STATUS.created) {
    patch.shipped_at = null;
    patch.delivered_at = null;
    patch.cancelled_at = null;
  }

  // Ručna promena statusa razrešava svaku raniju „za proveru" oznaku.
  patch.needs_review = false;
  patch.review_reason = null;

  const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
  if (error) return { error: "Promena statusa nije uspela." };

  await supabase.from("order_status_history").insert({
    order_id: order.id,
    from_status_id: order.status_id,
    to_status_id: target.id,
    changed_by: userId,
    note: parsed.data.note,
  });

  const wooOk = await pushWooStatus(order.woo_order_id, target.name);

  revalidateOrder();
  return {
    error: null,
    success: `Status promenjen: ${target.name}.${
      wooOk ? "" : " (WooCommerce nije ažuriran — proveri kasnije.)"
    }`,
  };
}

/**
 * Keš/lična prodaja (Admin-only, dira novac). Odjednom: `licno` + `kes` +
 * `delivered_at` + `paid_at` + status „Isporučeno". Ne ulazi u fakturu.
 */
export async function markCashSale(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const { userId } = await requireRole("admin");

  const parsed = markCashSaleSchema.safeParse({ order_id: formData.get("order_id") });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status_id, invoice_id, payment_status, woo_order_id")
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!order) return { error: "Porudžbina nije pronađena." };
  if (order.invoice_id) return { error: "Porudžbina je fakturisana — keš prodaja nije moguća." };
  if (order.payment_status !== "neuplaceno")
    return { error: "Porudžbina je već označena kao plaćena." };

  const { data: delivered } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", APP_STATUS.delivered)
    .maybeSingle();
  if (!delivered) return { error: "Status „Isporučeno“ nije pronađen." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("orders")
    .update({
      delivery_method: "licno",
      payment_status: "kes",
      status_id: delivered.id,
      delivered_at: now,
      paid_at: now,
      cancelled_at: null,
      needs_review: false,
      review_reason: null,
    })
    .eq("id", order.id);
  if (error) return { error: "Označavanje keš prodaje nije uspelo." };

  await supabase.from("order_status_history").insert({
    order_id: order.id,
    from_status_id: order.status_id,
    to_status_id: delivered.id,
    changed_by: userId,
    note: "Keš/lična prodaja — isplaćeno.",
  });

  const wooOk = await pushWooStatus(order.woo_order_id, APP_STATUS.delivered);

  revalidateOrder();
  return {
    error: null,
    success: `Označeno kao keš/lična prodaja (isplaćeno).${
      wooOk ? "" : " (WooCommerce nije ažuriran — proveri kasnije.)"
    }`,
  };
}

/** Ručno razrešavanje „za proveru" (Admin + Menadžer). */
export async function resolveReview(orderId: string): Promise<OrderActionState> {
  await requireRole("admin", "manager");
  if (!orderId) return { error: "Neispravan unos." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({ needs_review: false, review_reason: null })
    .eq("id", orderId);
  if (error) return { error: "Razrešavanje nije uspelo." };

  revalidateOrder();
  return { error: null, success: "Označeno kao razrešeno." };
}

/*
 * Logistika i slanje (Korak 1.5). Idu kroz SERVICE-ROLE klijent — status menja i
 * Menadžer (RLS na `orders` je Admin-write). `requireRole` je kapija. Slanje ne
 * dira snapshot cene ni iznose stavki.
 */

/**
 * Bulk „Označi poslato" (Admin + Menadžer). Selektovane porudžbine → status
 * „Poslato" + `shipped_at`. Preskaču se već poslate/isporučene/otkazane i one
 * „za proveru". Poštarina/težina/broj paketa se unose zasebno (updateShipping).
 */
export async function markOrdersShipped(orderIds: string[]): Promise<OrderActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = markOrdersShippedSchema.safeParse({ order_ids: orderIds });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();

  const { data: sent } = await supabase
    .from("order_statuses")
    .select("id, name")
    .eq("name", APP_STATUS.sent)
    .maybeSingle();
  if (!sent) return { error: "Status „Poslato“ nije pronađen." };

  // Statusi koji se NE prebacuju u „Poslato" (imena, ne UUID).
  const { data: blockedStatuses } = await supabase
    .from("order_statuses")
    .select("id, name")
    .in("name", [APP_STATUS.sent, APP_STATUS.delivered, ...CANCELLED_STATUS_NAMES]);
  const blockedIds = new Set((blockedStatuses ?? []).map((s) => s.id));

  const { data: orders } = await supabase
    .from("orders")
    .select("id, status_id, shipped_at, needs_review, woo_order_id")
    .in("id", parsed.data.order_ids);
  if (!orders || orders.length === 0) return { error: "Nijedna porudžbina nije pronađena." };

  const now = new Date().toISOString();
  let shipped = 0;
  let skipped = 0;
  let wooFailed = 0;

  for (const order of orders) {
    if (order.needs_review || blockedIds.has(order.status_id)) {
      skipped += 1;
      continue;
    }

    const { error } = await supabase
      .from("orders")
      .update({
        status_id: sent.id,
        shipped_at: order.shipped_at ?? now,
        delivered_at: null,
        cancelled_at: null,
        needs_review: false,
        review_reason: null,
      })
      .eq("id", order.id);
    if (error) {
      skipped += 1;
      continue;
    }

    await supabase.from("order_status_history").insert({
      order_id: order.id,
      from_status_id: order.status_id,
      to_status_id: sent.id,
      changed_by: userId,
      note: "Bulk slanje (Poslato).",
    });
    shipped += 1;

    if (!(await pushWooStatus(order.woo_order_id, APP_STATUS.sent))) wooFailed += 1;
  }

  // Porudžbine koje uopšte nisu pronađene (npr. loš id) računamo u preskočene.
  skipped += parsed.data.order_ids.length - orders.length;

  revalidatePath("/porudzbine");
  if (shipped === 0) return { error: "Nijedna porudžbina nije označena poslato (sve preskočene)." };
  const wooNote = wooFailed > 0 ? ` (WooCommerce nije ažuriran za ${wooFailed}.)` : "";
  return {
    error: null,
    success:
      skipped > 0
        ? `Označeno poslato: ${shipped} (preskočeno: ${skipped}).${wooNote}`
        : `Označeno poslato: ${shipped}.${wooNote}`,
  };
}

/**
 * Bulk promena statusa (Admin + Menadžer) — selektovane porudžbine → izabrani
 * status. Ogledalo pojedinačne `changeOrderStatus` u petlji: isti lifecycle
 * timestamp-ovi (po imenu), obavezan razlog za Otkazano/Vraćeno, app→Woo push.
 * Plaćene/fakturisane porudžbine se pri otkazivanju/vraćanju PRESKAČU (force za
 * njih ide pojedinačno na detalju). Zamrznute cene (`order_items`) se ne diraju.
 */
export async function changeOrdersStatus(
  orderIds: string[],
  statusId: string,
  note?: string,
): Promise<OrderActionState> {
  const { userId } = await requireRole("admin", "manager");

  const parsed = changeOrdersStatusSchema.safeParse({
    order_ids: orderIds,
    status_id: statusId,
    note: note ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();

  const { data: target } = await supabase
    .from("order_statuses")
    .select("id, name")
    .eq("id", parsed.data.status_id)
    .maybeSingle();
  if (!target) return { error: "Status nije pronađen." };

  const cancelTarget = isCancelStatusName(target.name);
  // Razlog otkazivanja/vraćanja je OBAVEZAN (server je izvor istine).
  if (cancelTarget && !parsed.data.note) {
    return { error: "Unesite razlog otkazivanja/vraćanja." };
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, status_id, payment_status, invoice_id, shipped_at, delivered_at, cancelled_at, woo_order_id",
    )
    .in("id", parsed.data.order_ids);
  if (!orders || orders.length === 0) return { error: "Nijedna porudžbina nije pronađena." };

  const now = new Date().toISOString();
  let changed = 0;
  let skipped = 0;
  let wooFailed = 0;

  for (const order of orders) {
    if (order.status_id === target.id) {
      skipped += 1;
      continue;
    }

    // Plaćena/fakturisana se pri otkazivanju/vraćanju NE dira u bulk-u (force ide
    // pojedinačno na detalju — zaštita finansija).
    if (cancelTarget) {
      const locked = order.invoice_id !== null || order.payment_status !== "neuplaceno";
      if (locked) {
        skipped += 1;
        continue;
      }
    }

    const patch: Record<string, unknown> = {
      status_id: target.id,
      needs_review: false,
      review_reason: null,
    };
    // Lifecycle timestamp-ovi po imenu (isti obrazac kao changeOrderStatus);
    // prelaz unazad čisti „buduće" timestamp-ove, custom status samo status_id.
    if (cancelTarget) {
      patch.cancelled_at = order.cancelled_at ?? now;
    } else if (target.name === APP_STATUS.sent) {
      patch.shipped_at = order.shipped_at ?? now;
      patch.delivered_at = null;
      patch.cancelled_at = null;
    } else if (target.name === APP_STATUS.delivered) {
      patch.shipped_at = order.shipped_at ?? now;
      patch.delivered_at = order.delivered_at ?? now;
      patch.cancelled_at = null;
    } else if (target.name === APP_STATUS.created) {
      patch.shipped_at = null;
      patch.delivered_at = null;
      patch.cancelled_at = null;
    }

    const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (error) {
      skipped += 1;
      continue;
    }

    await supabase.from("order_status_history").insert({
      order_id: order.id,
      from_status_id: order.status_id,
      to_status_id: target.id,
      changed_by: userId,
      note: parsed.data.note ?? `Bulk promena statusa: ${target.name}.`,
    });
    changed += 1;

    if (!(await pushWooStatus(order.woo_order_id, target.name))) wooFailed += 1;
  }

  // Porudžbine koje uopšte nisu pronađene (npr. loš id) računamo u preskočene.
  skipped += parsed.data.order_ids.length - orders.length;

  revalidatePath("/porudzbine");
  if (changed === 0)
    return { error: "Nijedna porudžbina nije promenjena (sve preskočene)." };
  const wooNote = wooFailed > 0 ? ` (WooCommerce nije ažuriran za ${wooFailed}.)` : "";
  return {
    error: null,
    success:
      skipped > 0
        ? `Status promenjen: ${changed} (preskočeno: ${skipped}).${wooNote}`
        : `Status promenjen: ${changed}.${wooNote}`,
  };
}

/**
 * Paket i poštarina (Admin + Menadžer) — popunjava se na koraku „Poslato".
 * Prolazne stavke (naplaćena/stvarna poštarina, težina, broj paketa); ne dira
 * status, istoriju ni zamrznute cene. Nije zaključano fakturom (poštarina je
 * van fakture — CLAUDE.md, saldo poštarine u 1.6).
 */
export async function updateShipping(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireRole("admin", "manager");

  const parsed = updateShippingSchema.safeParse({
    order_id: formData.get("order_id"),
    shipping_charged: formData.get("shipping_charged") ?? "",
    shipping_actual: formData.get("shipping_actual") ?? "",
    weight_grams: formData.get("weight_grams") ?? "",
    package_count: formData.get("package_count") ?? "",
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();
  const { order_id, ...patch } = parsed.data;
  const { error } = await supabase.from("orders").update(patch).eq("id", order_id);
  if (error) return { error: "Čuvanje podataka o paketu nije uspelo." };

  revalidateOrder();
  return { error: null, success: "Podaci o paketu sačuvani." };
}
