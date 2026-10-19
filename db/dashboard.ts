import "server-only";

import { computePeriodMetrics, type PeriodMetrics } from "@/db/metrics";

/*
 * Agregati za Dashboard (Korak 1.8). Čitaju kroz RLS klijent (Admin/Menadžer);
 * Dashboard je STAFF-only. Sve cifre zarade su ZAMRZNUTE (order_items), nikad iz
 * kataloga; status se resolve-uje po IMENU (APP_STATUS), nikad UUID.
 */

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
