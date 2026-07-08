import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

import { getProfile } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

export default async function DashboardPage() {
  const session = await getProfile();
  if (!session) redirect("/prijava");
  // Logistika nema Dashboard — sleće na Katalog (izbegava redirect petlju kroz requireRole).
  if (session.profile.role === "logistics") redirect("/katalog");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Pregled</div>
        <h1 className="text-ink text-xl font-bold">Dashboard</h1>
      </div>
      <EmptyState
        icon={<LayoutDashboard />}
        title="Dashboard uskoro"
        description="Zarada, neto profit, broj porudžbina i marža — stiže u Fazi 1."
      />
    </main>
  );
}
