import "server-only";

import { createClient } from "@/lib/supabase/server";
import { chunked, mustRows, selectAll } from "@/lib/supabase/paginate";
import { belgradeDate, todayBelgrade } from "@/lib/date-belgrade";
import { DATA_START, rangeToUtcPrefilter } from "@/lib/period";
import { daysInclusive, PDV_WINDOW_DAYS, shiftDate } from "@/lib/pdv";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";

/*
 * Promet za PDV prag — klizno poslednjih 12 meseci (365 dana do danas, Beograd).
 *
 * Promet = vrednost robe (Σ zamrznuti `mp_at_sale × quantity`, nikad katalog)
 *        + naplaćena poštarina (`orders.shipping_charged`) — poštarina koju
 *          naplaćuješ kupcu je tvoj promet; kad je kupac plaća direktno kuriru,
 *          ne ulazi (tada je `shipping_charged` prazno).
 * Ista pravila kao `computePeriodMetrics`: porudžbine po `ordered_at`, Otkazano/
 * Vraćeno isključene PO IMENU, celi beogradski dani, paginacija kroz `paginate`.
 *
 * Istorija počinje `DATA_START` — dok prozor nema punih 365 dana podataka,
 * `annualized` preračunava na godinu (procena, ne zakonska cifra).
 */

export type PdvTurnover = {
  from: string; // početak prozora (YYYY-MM-DD)
  to: string; // danas
  goods: number; // Σ robe (RSD)
  shipping: number; // Σ naplaćene poštarine (RSD)
  total: number; // goods + shipping — cifra koja se poredi sa pragom
  daysCovered: number; // dana sa podacima u prozoru
  annualized: number | null; // total preračunat na 365 dana (null kad je prozor pun)
  pace90: number; // tempo poslednjih 90 dana preračunat na 12 meseci
};

const PACE_DAYS = 90;

export async function getPdvTurnover(): Promise<PdvTurnover> {
  const supabase = await createClient();
  const to = todayBelgrade();
  const windowStart = shiftDate(to, -(PDV_WINDOW_DAYS - 1));
  const from = windowStart < DATA_START ? DATA_START : windowStart;
  const paceFrom = shiftDate(to, -(PACE_DAYS - 1));

  const cancelStatuses = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  const excludedIds = new Set(
    mustRows<{ id: string }>(cancelStatuses, "pdv: statusi Otkazano/Vraćeno").map((s) => s.id),
  );

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);
  const orderRows = await selectAll<{
    id: string;
    ordered_at: string;
    status_id: string;
    shipping_charged: number | null;
  }>("pdv: orders", () =>
    supabase
      .from("orders")
      .select("id, ordered_at, status_id, shipping_charged")
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  // Realizovane u prozoru (tačno suženje po beogradskom danu) + datum za tempo.
  const dayOf = new Map<string, string>();
  let shipping = 0;
  let shippingPace = 0;
  for (const o of orderRows) {
    if (excludedIds.has(o.status_id)) continue;
    const d = belgradeDate(o.ordered_at);
    if (d < from || d > to) continue;
    dayOf.set(o.id, d);
    const s = o.shipping_charged ?? 0;
    shipping += s;
    if (d >= paceFrom) shippingPace += s;
  }

  let goods = 0;
  let goodsPace = 0;
  for (const chunk of chunked([...dayOf.keys()])) {
    const items = await selectAll<{ order_id: string; quantity: number; mp_at_sale: number }>(
      "pdv: order_items",
      () =>
        supabase
          .from("order_items")
          .select("order_id, quantity, mp_at_sale")
          .in("order_id", chunk)
          .order("id", { ascending: true }),
    );
    for (const it of items) {
      const v = it.mp_at_sale * it.quantity;
      goods += v;
      if ((dayOf.get(it.order_id) ?? "") >= paceFrom) goodsPace += v;
    }
  }

  const total = goods + shipping;
  const daysCovered = daysInclusive(from, to);
  const paceSpan = Math.min(PACE_DAYS, daysCovered);

  return {
    from,
    to,
    goods,
    shipping,
    total,
    daysCovered,
    annualized: daysCovered < PDV_WINDOW_DAYS ? Math.round((total * PDV_WINDOW_DAYS) / daysCovered) : null,
    pace90: Math.round(((goodsPace + shippingPace) * PDV_WINDOW_DAYS) / paceSpan),
  };
}
