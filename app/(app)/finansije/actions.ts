"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { previousWorkingDay } from "@/lib/date-belgrade";
import { APP_STATUS } from "@/lib/woo";
import { getSaldoPostarine } from "@/db/finance";
import {
  createPayoutSchema,
  updatePayoutSchema,
  issueInvoiceSchema,
  markInvoicePaidSchema,
  settlePostageSchema,
} from "@/lib/validation/finance";

/*
 * Server akcije finansija (Korak 1.6, Admin-only — dira novac). Pišu kroz RLS
 * klijent (Admin ima *_admin_write politiku). Snapshot cene (order_items) se
 * NIKAD ne diraju. Eligibility se rekompjutuje u akciji (ne veruje se klijentu).
 */

export type FinanceActionState = {
  error: string | null;
  success?: string | null;
};

function revalidatePayouts(id?: string) {
  revalidatePath("/finansije");
  revalidatePath("/finansije/uplate");
  if (id) revalidatePath(`/finansije/uplate/${id}`);
}

/** id statusa „Isporučeno" (lookup po imenu, nikad hardkodovan UUID). */
async function deliveredStatusId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", APP_STATUS.delivered)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Provera da su SVE porudžbine i dalje eligible za vezivanje uz uplatu:
 * xexpress + isporučeno + neuplaceno + payout_id null. Guard protiv stale
 * klijent liste / konkurentnog vezivanja. Vraća poruku greške ili null.
 */
async function assertLinkable(orderIds: string[]): Promise<string | null> {
  if (orderIds.length === 0) return null;
  const delivered = await deliveredStatusId();
  if (!delivered) return "Status „Isporučeno“ nije pronađen.";

  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id")
    .in("id", orderIds)
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "neuplaceno")
    .eq("status_id", delivered)
    .is("payout_id", null);

  if ((data?.length ?? 0) !== orderIds.length) {
    return "Neke porudžbine više nisu dostupne za vezivanje (isporučene + neuplaćene). Osveži i pokušaj ponovo.";
  }
  return null;
}

export type CreatePayoutInput = z.input<typeof createPayoutSchema>;

/** Nova uplata druga (T+1). Vezane porudžbine → „uplaćeno" + paid_at + payout_id. */
export async function createPayout(input: CreatePayoutInput): Promise<FinanceActionState> {
  await requireRole("admin");

  const parsed = createPayoutSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };
  const { amount, payout_date, delivery_date, notes, order_ids } = parsed.data;

  const blocked = await assertLinkable(order_ids);
  if (blocked) return { error: blocked };

  const supabase = await createClient();

  const { data: payout, error: insErr } = await supabase
    .from("payouts")
    .insert({
      amount,
      payout_date,
      delivery_date: delivery_date ?? previousWorkingDay(payout_date),
      notes,
    })
    .select("id")
    .single();
  if (insErr || !payout) return { error: "Čuvanje uplate nije uspelo." };

  if (order_ids.length > 0) {
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        payout_id: payout.id,
        payment_status: "uplaceno",
        paid_at: new Date().toISOString(),
      })
      .in("id", order_ids);
    if (updErr) {
      // Rollback uplate da ne ostane „prazan" red bez porudžbina.
      await supabase.from("payouts").delete().eq("id", payout.id);
      return { error: "Vezivanje porudžbina nije uspelo." };
    }
  }

  revalidatePayouts(payout.id);
  return {
    error: null,
    success:
      order_ids.length > 0
        ? `Uplata sačuvana, vezano porudžbina: ${order_ids.length}.`
        : "Uplata sačuvana.",
  };
}

export type UpdatePayoutInput = z.input<typeof updatePayoutSchema>;

/**
 * Izmena uplate: iznos/datumi/napomena + rekonfiguracija vezanih porudžbina.
 * Uklonjene se vraćaju na „neuplaćeno"; dodate se vezuju. Fakturisane vezane
 * porudžbine se ne smeju od-vezati (poremetile bi izdatu fakturu).
 */
export async function updatePayout(input: UpdatePayoutInput): Promise<FinanceActionState> {
  await requireRole("admin");

  const parsed = updatePayoutSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };
  const { id, amount, payout_date, delivery_date, notes, order_ids } = parsed.data;

  const supabase = await createClient();

  // Trenutno vezane porudžbine.
  const { data: current } = await supabase
    .from("orders")
    .select("id, invoice_id")
    .eq("payout_id", id);
  const currentIds = new Set((current ?? []).map((o) => o.id));
  const nextIds = new Set(order_ids);

  const toUnlink = [...currentIds].filter((oid) => !nextIds.has(oid));
  const toLink = order_ids.filter((oid) => !currentIds.has(oid));

  // Fakturisane porudžbine se ne diraju.
  const invoicedUnlink = (current ?? []).filter(
    (o) => toUnlink.includes(o.id) && o.invoice_id !== null,
  );
  if (invoicedUnlink.length > 0) {
    return { error: "Vezana porudžbina je fakturisana — ne može se ukloniti sa uplate." };
  }

  const blocked = await assertLinkable(toLink);
  if (blocked) return { error: blocked };

  const { error: payErr } = await supabase
    .from("payouts")
    .update({
      amount,
      payout_date,
      delivery_date: delivery_date ?? previousWorkingDay(payout_date),
      notes,
    })
    .eq("id", id);
  if (payErr) return { error: "Izmena uplate nije uspela." };

  if (toUnlink.length > 0) {
    await supabase
      .from("orders")
      .update({ payout_id: null, payment_status: "neuplaceno", paid_at: null })
      .in("id", toUnlink);
  }
  if (toLink.length > 0) {
    await supabase
      .from("orders")
      .update({ payout_id: id, payment_status: "uplaceno", paid_at: new Date().toISOString() })
      .in("id", toLink);
  }

  revalidatePayouts(id);
  return { error: null, success: "Uplata izmenjena." };
}

/**
 * Brisanje uplate. FK je ON DELETE SET NULL → nulira samo payout_id, pa akcija
 * EKSPLICITNO vraća payment_status/paid_at. Odbija se ako je neka vezana
 * porudžbina fakturisana (uplata je preduslov fakture).
 */
export async function deletePayout(id: string): Promise<FinanceActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();

  const { data: linked } = await supabase
    .from("orders")
    .select("id, invoice_id")
    .eq("payout_id", id);

  if ((linked ?? []).some((o) => o.invoice_id !== null)) {
    return { error: "Uplata ima fakturisanu porudžbinu — ne može se obrisati." };
  }

  if ((linked ?? []).length > 0) {
    await supabase
      .from("orders")
      .update({ payout_id: null, payment_status: "neuplaceno", paid_at: null })
      .eq("payout_id", id);
  }

  const { error } = await supabase.from("payouts").delete().eq("id", id);
  if (error) return { error: "Brisanje uplate nije uspelo." };

  revalidatePayouts();
  return { error: null, success: "Uplata obrisana." };
}

/* ── Fakture (invoices) — 1.6b, Admin-only ───────────────────────────────── */

function revalidateInvoices(id?: string) {
  revalidatePath("/finansije");
  revalidatePath("/finansije/fakture");
  if (id) revalidatePath(`/finansije/fakture/${id}`);
}

/**
 * Provera da su SVE porudžbine i dalje eligible za fakturu: xexpress +
 * isporučeno + uplaćeno + nefakturisano + bez needs_vp. Guard protiv stale
 * klijent liste / konkurentnog izdavanja. Vraća poruku greške ili null.
 */
async function assertInvoiceable(orderIds: string[]): Promise<string | null> {
  if (orderIds.length === 0) return "Izaberite bar jednu porudžbinu.";
  const delivered = await deliveredStatusId();
  if (!delivered) return "Status „Isporučeno“ nije pronađen.";

  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id")
    .in("id", orderIds)
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "uplaceno")
    .eq("status_id", delivered)
    .is("invoice_id", null)
    .eq("needs_vp", false);

  if ((data?.length ?? 0) !== orderIds.length) {
    return "Neke porudžbine više nisu dostupne za fakturu (uplaćene + bez čekanja VP). Osveži i pokušaj ponovo.";
  }
  return null;
}

export type IssueInvoiceInput = z.input<typeof issueInvoiceSchema>;

/**
 * Izdavanje fakture drugu. total_amount = Σ zamrznute zarade (order_profit)
 * rekompjutovana server-side. Vezane porudžbine dobijaju invoice_id (stavke se
 * time zaključavaju). Broj fakture je ručni — duplikat pada na 23505.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<FinanceActionState> {
  await requireRole("admin");

  const parsed = issueInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };
  const { invoice_number, period_from, period_to, order_ids } = parsed.data;

  const blocked = await assertInvoiceable(order_ids);
  if (blocked) return { error: blocked };

  const supabase = await createClient();

  // Rekompjutuj total iz zamrznutih stavki (ne veruj klijentskoj cifri).
  const { data: profitRows } = await supabase
    .from("order_profit")
    .select("profit")
    .in("order_id", order_ids);
  const total = ((profitRows as { profit: number | null }[]) ?? []).reduce(
    (sum, r) => sum + (r.profit ?? 0),
    0,
  );

  const { data: invoice, error: insErr } = await supabase
    .from("invoices")
    .insert({
      invoice_number,
      period_from,
      period_to,
      total_amount: total,
      status: "izdato",
    })
    .select("id")
    .single();
  if (insErr || !invoice) {
    if ((insErr as { code?: string } | null)?.code === "23505") {
      return { error: "Faktura sa tim brojem već postoji." };
    }
    return { error: "Izdavanje fakture nije uspelo." };
  }

  const { error: updErr } = await supabase
    .from("orders")
    .update({ invoice_id: invoice.id })
    .in("id", order_ids);
  if (updErr) {
    // Rollback fakture da ne ostane bez vezanih porudžbina.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return { error: "Vezivanje porudžbina za fakturu nije uspelo." };
  }

  revalidateInvoices(invoice.id);
  return {
    error: null,
    success: `Faktura ${invoice_number} izdata (${order_ids.length} porudžbina).`,
  };
}

export type MarkInvoicePaidInput = z.input<typeof markInvoicePaidSchema>;

/** Označi fakturu kao plaćenu (Sportem platio drugu). Samo iz stanja „izdato". */
export async function markInvoicePaid(input: MarkInvoicePaidInput): Promise<FinanceActionState> {
  await requireRole("admin");

  const parsed = markInvoicePaidSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "placeno" })
    .eq("id", parsed.data.id)
    .eq("status", "izdato")
    .select("id")
    .maybeSingle();
  if (error) return { error: "Izmena fakture nije uspela." };
  if (!data) return { error: "Faktura nije u stanju „izdato“." };

  revalidateInvoices(parsed.data.id);
  return { error: null, success: "Faktura označena kao plaćena." };
}

/**
 * Brisanje fakture. Re-otvara vezane porudžbine (invoice_id=null → nazad u
 * kandidate). Zaštićeni: „placeno" faktura i sintetička „ISTORIJA-BACKFILL".
 */
export async function deleteInvoice(id: string): Promise<FinanceActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, status, invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { error: "Faktura nije pronađena." };
  if (inv.status === "placeno") {
    return { error: "Plaćena faktura se ne može obrisati." };
  }
  if (inv.invoice_number === "ISTORIJA-BACKFILL") {
    return { error: "Istorijska faktura (backfill) se ne može obrisati." };
  }

  // Re-otvori porudžbine pre brisanja (FK je SET NULL, ali eksplicitno radi jasnoće).
  await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", id);

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: "Brisanje fakture nije uspelo." };

  revalidateInvoices();
  return { error: null, success: "Faktura obrisana." };
}

/* ── Poštarina (settlements) — 1.6c, Admin-only ──────────────────────────── */

export type SettlePostageInput = z.input<typeof settlePostageSchema>;

/**
 * Poravnanje salda poštarine (append-only ledger). Trenutni saldo se računa
 * server-side i upisuje u balance_before (istorija). „Poravnato keš" = amount
 * jednak trenutnom saldu → novi saldo 0. Iznos ide sa predznakom.
 */
export async function settlePostage(input: SettlePostageInput): Promise<FinanceActionState> {
  const { userId } = await requireRole("admin");

  const parsed = settlePostageSchema.safeParse(input);
  if (!parsed.success) return { error: firstZodError(parsed.error) };
  const { amount, notes } = parsed.data;

  const { balance } = await getSaldoPostarine();

  const supabase = await createClient();
  const { error } = await supabase.from("postage_settlements").insert({
    amount,
    balance_before: balance,
    notes,
    created_by: userId,
  });
  if (error) return { error: "Čuvanje poravnanja nije uspelo." };

  revalidatePath("/finansije");
  revalidatePath("/finansije/postarina");
  return { error: null, success: "Poravnanje poštarine sačuvano." };
}
