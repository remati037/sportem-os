import "server-only";

import { createClient } from "@/lib/supabase/server";
import { belgradeDate } from "@/lib/date-belgrade";
import { rangeToUtcPrefilter } from "@/lib/period";
import { APP_STATUS, CANCELLED_STATUS_NAMES } from "@/lib/woo";
import { getUnpaidDeliveredXexpress } from "@/db/finance";

/*
 * Agregati za Dashboard (Korak 1.8). Čitaju kroz RLS klijent (Admin/Menadžer);
 * Dashboard je STAFF-only. Sve cifre zarade su ZAMRZNUTE (order_items), nikad iz
 * kataloga; status se resolve-uje po IMENU (APP_STATUS), nikad UUID.
 */

/** id statusa po imenu (lookup — seed UUID se ne hardkoduje). */
async function statusIdByName(name: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  return data?.id ?? null;
}

export type DashboardMetrics = {
  zarada: number; // Σ zamrznute profit_at_sale (realizovano u periodu)
  troskovi: number; // Σ expenses.amount u periodu
  neto: number; // zarada − troskovi
  brojPorudzbina: number; // broj realizovanih porudžbina u periodu
  marza: number; // Σprofit / Σ(mp_at_sale×kol), 0..1 (0 kad nema prihoda)
};

/**
 * Metrike za realizovane porudžbine u rasponu [from, to] (po Belgrade datumu na
 * delivered_at): status Isporučeno + uplaćeno/keš + bez needs_vp — ista osnova
 * kao getNetoProfit, ali po proizvoljnom rasponu. Zarada/marža iz zamrznutih
 * stavki; troškovi po `expenses.date` u istom rasponu.
 */
export async function getDashboardMetrics({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<DashboardMetrics> {
  const supabase = await createClient();

  // Porudžbine se broje po datumu KREIRANJA (`ordered_at`) i uključuju SVE
  // statuse osim Otkazano/Vraćeno — bez gledanja isporuke/plaćanja. Isključeni
  // statusi se razrešavaju po IMENU (nikad hardkodovan UUID).
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

export type WaitingOrders = {
  needsVp: number; // stavke bez VP (blokiraju fakturu)
  spremnoZaSlanje: number; // status Kreirano (čeka slanje)
  isporucenoNeuplaceno: number; // isporučeno XExpress, još neuplaćeno
  zaPregled: number; // needs_review (otkazano posle fakture i sl.)
  createdStatusId: string | null; // za link „spremno za slanje"
};

/**
 * „Porudžbine koje čekaju" — tekuće stanje (nezavisno od perioda). Brojevi za
 * kartice sa linkovima na filtrirane liste.
 */
export async function getWaitingOrders(): Promise<WaitingOrders> {
  const supabase = await createClient();
  const created = await statusIdByName(APP_STATUS.created);

  const [needsVpRes, readyRes, unpaid, reviewRes] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("needs_vp", true),
    created
      ? supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status_id", created)
      : Promise.resolve({ count: 0 } as { count: number | null }),
    getUnpaidDeliveredXexpress(),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("needs_review", true),
  ]);

  return {
    needsVp: needsVpRes.count ?? 0,
    spremnoZaSlanje: readyRes.count ?? 0,
    isporucenoNeuplaceno: unpaid.length,
    zaPregled: reviewRes.count ?? 0,
    createdStatusId: created,
  };
}
