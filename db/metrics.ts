import "server-only";

import { createClient } from "@/lib/supabase/server";
import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";

/*
 * Deljena osnova metrika perioda (Dashboard i Finansije neto — ista računica,
 * da se cifre poklapaju). Porudžbine se broje po datumu KREIRANJA (`ordered_at`).
 * `brojPorudzbina` uključuje SVE statuse (uklj. Otkazano/Vraćeno) — ukupan broj
 * kreiranih u periodu. Zarada/promet/marža računaju se SAMO nad realizovanim
 * skupom (bez Otkazano/Vraćeno) iz ZAMRZNUTIH `order_items` (nikad iz kataloga);
 * troškovi po `expenses.date`. Status se razrešava po IMENU (nikad UUID).
 */

export type PeriodMetrics = {
  zarada: number; // Σ zamrznute profit_at_sale (bez otkazanih/vraćenih)
  troskovi: number; // Σ expenses.amount u periodu
  neto: number; // zarada − troskovi
  brojPorudzbina: number; // ukupan broj porudžbina kreiranih u periodu (SVI statusi)
  marza: number; // Σprofit / Σ(mp_at_sale×kol), 0..1 (0 kad nema prihoda)
};

/** Veličina strane pri paginaciji Supabase upita (default cap je 1000). */
const PAGE = 1000;
/** Bezbedna veličina parčeta za `.in(order_id, …)` (kratak URL). */
const IN_CHUNK = 200;

export async function computePeriodMetrics({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<PeriodMetrics> {
  const supabase = await createClient();

  // Isključeni statusi (Otkazano/Vraćeno) — po imenu (za zaradu/maržu, NE za broj).
  const { data: cancelStatuses } = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  const excludedIds = new Set(((cancelStatuses as { id: string }[]) ?? []).map((s) => s.id));

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);

  // Sve porudžbine u opsegu (paginirano — inače cap na 1000 tiho podbaci na širokom periodu).
  const orderRows: { id: string; ordered_at: string; status_id: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, ordered_at, status_id")
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`computePeriodMetrics orders: ${error.message}`);
    const rows = (data as { id: string; ordered_at: string; status_id: string }[]) ?? [];
    orderRows.push(...rows);
    if (rows.length < PAGE) break;
  }

  // Tačno suženje po Belgrade kalendarskom danu (pred-filter je širok).
  const inRange = orderRows.filter((o) => {
    const d = belgradeDate(o.ordered_at);
    return d >= from && d <= to;
  });
  // Broj porudžbina = SVE kreirane u periodu (uklj. otkazane/vraćene).
  const brojPorudzbina = inRange.length;
  // Realizovan skup za zaradu/maržu = bez otkazanih/vraćenih.
  const realized = inRange.filter((o) => !excludedIds.has(o.status_id));

  let zarada = 0;
  let revenue = 0;
  if (realized.length > 0) {
    const ids = realized.map((o) => o.id);
    // Batchuj `.in(order_id, …)` — 1000+ UUID-jeva u jednom URL-u tiho padne.
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data: items, error } = await supabase
        .from("order_items")
        .select("order_id, quantity, mp_at_sale, profit_at_sale")
        .in("order_id", chunk);
      if (error) throw new Error(`computePeriodMetrics order_items: ${error.message}`);
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
    brojPorudzbina,
    marza: revenue > 0 ? zarada / revenue : 0,
  };
}
