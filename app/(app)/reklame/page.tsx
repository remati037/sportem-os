import { requireRole } from "@/lib/auth";
import { todayBelgrade } from "@/lib/date-belgrade";
import { resolveRange } from "@/lib/period";
import {
  getAdAttribution,
  getAdExpenseComparison,
  getAdsOverview,
  getMetaSyncState,
} from "@/db/ads";

import { ReklameView } from "./reklame-view";

export const dynamic = "force-dynamic";
// „Sinhronizuj Meta“ (server akcija ove strane) prvi put povlači celu istoriju.
export const maxDuration = 60;

/*
 * Reklame (Meta Ads) — plan Reklame, M2. Admin i Menadžer; Logistika nema ni
 * RLS politiku na ad_*. Prikaz je u `reklame-view.tsx`.
 */
export default async function ReklamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireRole("admin", "manager");

  const sp = await searchParams;
  const period = resolveRange(sp, "30d");

  const [overview, attribution, months, syncState] = await Promise.all([
    getAdsOverview(period.from, period.to),
    getAdAttribution(period.from, period.to),
    getAdExpenseComparison(),
    getMetaSyncState(),
  ]);

  return (
    <ReklameView
      overview={overview}
      attribution={attribution}
      months={months}
      syncState={syncState}
      period={period}
      today={todayBelgrade()}
      isAdmin={profile.role === "admin"}
    />
  );
}
