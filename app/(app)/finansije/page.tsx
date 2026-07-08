import { Wallet } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

export default async function FinansijePage() {
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>
      <EmptyState
        icon={<Wallet />}
        title="Finansije uskoro"
        description="Isplate, fakture, poštarina i keš — stiže u Fazi 1."
      />
    </main>
  );
}
