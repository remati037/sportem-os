import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Automatsko skidanje robe sa stanja (migracija 20260731140000).
 *
 * Pravilo: roba je skinuta sa stanja dok je porudžbina „živa" (Kreirano /
 * Poslato / Isporučeno) i vraćena čim ode u Otkazano ili Vraćeno.
 *
 * Idempotentnost: `orders.stock_applied` je prekidač koji se preuzima
 * uslovnim UPDATE-om (`.eq("stock_applied", !next)`) — jedan Postgres statement,
 * pa dva paralelna webhook prijema ili dvostruko otkazivanje ne mogu duplo da
 * skinu/vrate količinu.
 *
 * Sve funkcije su BEST-EFFORT (nikad ne bacaju): porudžbina/status su važniji od
 * stanja, a greška ide u Sentry i vraća `false` da pozivalac blago upozori —
 * isti obrazac kao `pushWooStatus` (app → Woo).
 *
 * Zamrznute cene (`order_items`) i popis (`stock_counted_at`) se NE diraju.
 */

type StockDelta = { variant_id: string; delta: number };

/** Jedan atomični UPDATE nad katalogom (RPC; service role). */
async function applyDeltas(
  supabase: ReturnType<typeof createAdminClient>,
  deltas: StockDelta[],
): Promise<void> {
  const clean = deltas.filter((d) => d.variant_id && d.delta !== 0);
  if (clean.length === 0) return;
  const { error } = await supabase.rpc("apply_stock_delta", { p_items: clean });
  if (error) throw error;
}

/** Razlike po varijanti iz trenutnih stavki. Stavke bez varijante (nepoznat SKU) se preskaču. */
async function orderDeltas(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  sign: 1 | -1,
): Promise<StockDelta[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select("variant_id, quantity")
    .eq("order_id", orderId);
  if (error) throw error;
  return (data ?? [])
    .filter((i): i is { variant_id: string; quantity: number } => i.variant_id != null)
    .map((i) => ({ variant_id: i.variant_id, delta: sign * (i.quantity ?? 0) }));
}

/** Preuzmi prekidač; `false` = neko drugi je već u tom stanju (nema šta da se radi). */
async function claimFlag(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  next: boolean,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("orders")
    .update({ stock_applied: next })
    .eq("id", orderId)
    .eq("stock_applied", !next)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type StockMode =
  /** Nova/ponovo aktivna porudžbina → skini količine sa stanja. */
  | "reserve"
  /** Otkazano/Vraćeno → vrati količine na stanje. */
  | "release";

/**
 * Skini ili vrati robu porudžbine na stanje. Best-effort — vraća `false` samo
 * ako je promena pokušana i pukla (greška u Sentry). Nema šta da se radi
 * (već rezervisano / već vraćeno) je uspeh.
 */
export async function syncOrderStock(orderId: string, mode: StockMode): Promise<boolean> {
  const next = mode === "reserve";
  const supabase = createAdminClient();
  try {
    if (!(await claimFlag(supabase, orderId, next))) return true;
    try {
      await applyDeltas(supabase, await orderDeltas(supabase, orderId, next ? -1 : 1));
    } catch (e) {
      // Katalog nije promenjen (RPC je jedan statement) → vrati prekidač nazad,
      // da sledeći pokušaj (npr. ponovno otkazivanje) ne bude tiho preskočen.
      await claimFlag(supabase, orderId, !next).catch(() => {});
      throw e;
    }
    return true;
  } catch (e) {
    Sentry.captureException(e);
    return false;
  }
}

/**
 * Izmena stavke na porudžbini kojoj je roba već skinuta sa stanja — primeni samo
 * razliku. `delta` je promena STANJA: dodata stavka/veća količina → negativna,
 * obrisana stavka/manja količina → pozitivna. Porudžbina koja nije rezervisana
 * (istorijska ili otkazana) se ne dira.
 */
export async function syncItemStock(
  orderId: string,
  variantId: string | null,
  delta: number,
): Promise<boolean> {
  if (!variantId || delta === 0) return true;
  const supabase = createAdminClient();
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("stock_applied")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.stock_applied) return true;
    await applyDeltas(supabase, [{ variant_id: variantId, delta }]);
    return true;
  } catch (e) {
    Sentry.captureException(e);
    return false;
  }
}
