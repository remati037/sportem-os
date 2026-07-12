import "server-only";

import { createClient } from "@/lib/supabase/server";
import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";

/*
 * Deljena osnova metrika perioda (Dashboard i Finansije neto — ista računica,
 * da se cifre poklapaju). Porudžbine se broje po datumu KREIRANJA (`ordered_at`)
 * i uključuju SVE statuse OSIM Otkazano/Vraćeno — bez gledanja isporuke/plaćanja.
 * Zarada/marža iz ZAMRZNUTIH `order_items` (nikad iz kataloga); troškovi po
 * `expenses.date`. Status se razrešava po IMENU (nikad hardkodovan UUID).
 */

export type PeriodMetrics = {
  zarada: number; // Σ zamrznute profit_at_sale u periodu
  troskovi: number; // Σ expenses.amount u periodu
  neto: number; // zarada − troskovi
  brojPorudzbina: number; // broj porudžbina (osim otkazano/vraćeno) u periodu
  marza: number; // Σprofit / Σ(mp_at_sale×kol), 0..1 (0 kad nema prihoda)
};

export async function computePeriodMetrics({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<PeriodMetrics> {
  const supabase = await createClient();

  // Isključeni statusi (Otkazano/Vraćeno) — po imenu.
  const { data: cancelStatuses } = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  const excludedIds = new Set(((cancelStatuses as { id: string }[]) ?? []).map((s) => s.id));

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);

  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, ordered_at, status_id")
    .not("ordered_at", "is", null)
    .gte("ordered_at", gteUtc)
    .lt("ordered_at", ltUtc);

  const inRange = (
    (orderRows as { id: string; ordered_at: string; status_id: string }[]) ?? []
  ).filter((o) => {
    if (excludedIds.has(o.status_id)) return false;
    const d = belgradeDate(o.ordered_at);
    return d >= from && d <= to;
  });

  let zarada = 0;
  let revenue = 0;
  if (inRange.length > 0) {
    const { data: items } = await supabase
      .from("order_items")
      .select("order_id, quantity, mp_at_sale, profit_at_sale")
      .in(
        "order_id",
        inRange.map((o) => o.id),
      );
    for (const it of (items as {
      order_id: string;
      quantity: number;
      mp_at_sale: number;
      profit_at_sale: number | null;
    }[]) ?? []) {
      zarada += it.profit_at_sale ?? 0;
      revenue += it.mp_at_sale * it.quantity;
    }
  }

  const { data: expRows } = await supabase
    .from("expenses")
    .select("amount")
    .gte("date", from)
    .lte("date", to);
  const troskovi = ((expRows as { amount: number }[]) ?? []).reduce((s, e) => s + e.amount, 0);

  return {
    zarada,
    troskovi,
    neto: zarada - troskovi,
    brojPorudzbina: inRange.length,
    marza: revenue > 0 ? zarada / revenue : 0,
  };
}
