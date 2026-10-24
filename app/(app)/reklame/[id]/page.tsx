import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { todayBelgrade } from "@/lib/date-belgrade";
import { resolveRange } from "@/lib/period";
import { getAdCampaignDetail } from "@/db/ads";

import { KampanjaView } from "./kampanja-view";

export const dynamic = "force-dynamic";

/* Jedna Meta kampanja po danima (plan Reklame, M2) — Admin i Menadžer. */
export default async function KampanjaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const { id } = await params;
  const period = resolveRange(await searchParams, "30d");

  const detail = await getAdCampaignDetail(decodeURIComponent(id), period.from, period.to);
  if (!detail) notFound();

  return <KampanjaView detail={detail} period={period} today={todayBelgrade()} />;
}
