"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_STATUS } from "@/lib/woo";
import {
  addItemSchema,
  changeOrderStatusSchema,
  markCashSaleSchema,
  setItemVpSchema,
  updateItemPriceSchema,
  updateItemQuantitySchema,
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
};

function revalidateOrder(orderId: string) {
  revalidatePath("/porudzbine");
  revalidatePath(`/porudzbine/${orderId}`);
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

  revalidateOrder(target.orderId);
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

  revalidateOrder(target.orderId);
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
  revalidateOrder(target.orderId);
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
  revalidateOrder(target.orderId);
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
  revalidateOrder(parsed.data.order_id);
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
  const { userId } = await requireRole("admin", "manager");

  const parsed = changeOrderStatusSchema.safeParse({
    order_id: formData.get("order_id"),
    status_id: formData.get("status_id"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status_id, payment_status, invoice_id, shipped_at, delivered_at, cancelled_at")
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
  if (target.name === APP_STATUS.cancelled) {
    const locked = order.invoice_id !== null || order.payment_status !== "neuplaceno";
    if (locked) {
      // Ne otkazuj automatski fakturisanu/uplaćenu — traži ručnu odluku (kao webhook).
      await supabase
        .from("orders")
        .update({
          needs_review: true,
          review_reason:
            "Otkazivanje zatraženo za fakturisanu/uplaćenu porudžbinu — potrebna ručna provera.",
        })
        .eq("id", order.id);
      revalidateOrder(order.id);
      return {
        error:
          "Porudžbina je fakturisana/uplaćena — označena je za ručnu proveru umesto otkazivanja.",
      };
    }
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

  revalidateOrder(order.id);
  return { error: null, success: `Status promenjen: ${target.name}.` };
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
    .select("id, status_id, invoice_id, payment_status")
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

  revalidateOrder(order.id);
  return { error: null, success: "Označeno kao keš/lična prodaja (isplaćeno)." };
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

  revalidateOrder(orderId);
  return { error: null, success: "Označeno kao razrešeno." };
}
