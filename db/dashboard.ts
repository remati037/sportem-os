import "server-only";

import { createClient } from "@/lib/supabase/server";
import { APP_STATUS } from "@/lib/woo";
import { computePeriodMetrics, type PeriodMetrics } from "@/db/metrics";
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

export type DashboardMetrics = PeriodMetrics;

/**
 * Metrike perioda [from, to] — deljena osnova sa Finansije neto profitom
 * (`computePeriodMetrics`): sve porudžbine kreirane u periodu (`ordered_at`),
 * OSIM Otkazano/Vraćeno, bez gledanja isporuke/plaćanja. Zarada/marža iz
 * zamrznutih stavki; troškovi po `expenses.date`.
 */
export async function getDashboardMetrics(range: {
  from: string;
  to: string;
}): Promise<DashboardMetrics> {
  return computePeriodMetrics(range);
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
