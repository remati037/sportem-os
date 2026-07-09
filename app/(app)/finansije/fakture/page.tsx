import { FileText } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

import { FinanceTabs } from "../finance-tabs";

/* Placeholder — pun ekran faktura stiže u Koraku 1.6b. */
export default async function FakturePage() {
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>
      <FinanceTabs />
      <EmptyState
        icon={<FileText />}
        title="Fakture uskoro"
        description={'Faktura drugu i „drug mi duguje" — stiže u Koraku 1.6b.'}
      />
    </main>
  );
}
