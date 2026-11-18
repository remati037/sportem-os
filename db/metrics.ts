import "server-only";

import { createClient } from "@/lib/supabase/server";
import { chunked, mustRows, selectAll } from "@/lib/supabase/paginate";
import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";
import { getTaxRateMap } from "@/db/tax";
import { isTaxExempt, monthOf, taxFromNumer, taxNumer, type TaxRate } from "@/lib/tax";

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
  /*
   * Porez po mesecu (`tax_months`, Dashboard „Posle poreza"): zarada × stopa
   * meseca KREIRANJA, osim keš porudžbina (`payment_status='kes'`). Pre-poreske
   * cifre iznad se NE menjaju.
   */
  porez: number;
  zaradaPosle: number; // zarada − porez
  netoPosle: number; // zarada − porez − troškovi
  marzaPosle: number; // (zarada − porez) / promet
  porezStope: TaxRate[]; // meseci perioda sa stopom > 0
  kesBezPoreza: number; // broj keš porudžbina u oporezovanim mesecima (bez poreza)
  porezOk: boolean; // false = stope nisu pročitane (porez je 0)
};

/*
 * Paginacija i parčad `.in(...)` idu kroz `lib/supabase/paginate` (Korak K2) —
 * `PAGE_SIZE` i `IN_CHUNK` postoje na JEDNOM mestu u projektu i ne prepisuju se
 * lokalno.
 */

export async function computePeriodMetrics({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<PeriodMetrics> {
  const supabase = await createClient();

  // Isključeni statusi (Otkazano/Vraćeno) — po imenu (za zaradu/maržu, NE za broj).
  const cancelStatuses = await supabase
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  const excludedIds = new Set(
    mustRows<{ id: string }>(cancelStatuses, "metrike: statusi Otkazano/Vraćeno").map((s) => s.id),
  );

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);

  // Sve porudžbine u opsegu (paginirano — inače cap na 1000 tiho podbaci na širokom periodu).
  const orderRows = await selectAll<{
    id: string;
    ordered_at: string;
    status_id: string;
    payment_status: string;
  }>("metrike: orders", () =>
    supabase
      .from("orders")
      .select("id, ordered_at, status_id, payment_status")
        .not("ordered_at", "is", null)
        .gte("ordered_at", gteUtc)
        .lt("ordered_at", ltUtc)
        .order("ordered_at", { ascending: true })
        .order("id", { ascending: true }),
  );

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
  const profitByOrder = new Map<string, number>();
  if (realized.length > 0) {
    const ids = realized.map((o) => o.id);
    // Parčad `.in(order_id, …)` po IN_CHUNK — 1000+ UUID-jeva u jednom URL-u padne.
    for (const chunk of chunked(ids)) {
      const items = await selectAll<{
        order_id: string;
        quantity: number;
        mp_at_sale: number;
        profit_at_sale: number | null;
      }>("metrike: order_items", () =>
        supabase
          .from("order_items")
          .select("order_id, quantity, mp_at_sale, profit_at_sale")
          .in("order_id", chunk)
          .order("id", { ascending: true }),
      );
      for (const it of items) {
        zarada += it.profit_at_sale ?? 0;
        revenue += it.mp_at_sale * it.quantity;
        profitByOrder.set(it.order_id, (profitByOrder.get(it.order_id) ?? 0) + (it.profit_at_sale ?? 0));
      }
    }
  }

  const expRows = await selectAll<{ amount: number }>("metrike: expenses", () =>
    supabase
      .from("expenses")
      .select("amount")
      .gte("date", from)
      .lte("date", to)
      .order("id", { ascending: true }),
  );
  const troskovi = expRows.reduce((s, e) => s + e.amount, 0);

  // Porez po mesecu kreiranja; keš porudžbine bez poreza (lib/tax.ts).
  const tax = await getTaxRateMap(supabase, from, to);
  let numer = 0;
  let kesBezPoreza = 0;
  for (const o of realized) {
    const bp = tax.rates.get(monthOf(belgradeDate(o.ordered_at))) ?? 0;
    if (bp <= 0) continue;
    if (isTaxExempt(o.payment_status)) {
      kesBezPoreza += 1;
      continue;
    }
    numer += taxNumer(profitByOrder.get(o.id) ?? 0, bp);
  }
  const porez = taxFromNumer(numer);
  const zaradaPosle = zarada - porez;

  return {
    zarada,
    troskovi,
    neto: zarada - troskovi,
    brojPorudzbina,
    marza: revenue > 0 ? zarada / revenue : 0,
    porez,
    zaradaPosle,
    netoPosle: zaradaPosle - troskovi,
    marzaPosle: revenue > 0 ? zaradaPosle / revenue : 0,
    porezStope: [...tax.rates.entries()]
      .filter(([, bp]) => bp > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rateBp]) => ({ month, rateBp })),
    kesBezPoreza,
    porezOk: tax.ok,
  };
}
