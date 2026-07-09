import { Truck } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

import { FinanceTabs } from "../finance-tabs";

/* Placeholder — pun ekran salda poštarine stiže u Koraku 1.6c. */
export default async function PostarinaPage() {
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>
      <FinanceTabs />
      <EmptyState
        icon={<Truck />}
        title="Saldo poštarine uskoro"
        description="Saldo poštarine i neto profit — stiže u Koraku 1.6c."
      />
    </main>
  );
}
