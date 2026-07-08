import { Package } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

export default async function KatalogPage() {
  await requireRole("admin", "manager", "logistics");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Inventar</div>
        <h1 className="text-ink text-xl font-bold">Katalog</h1>
      </div>
      <EmptyState
        icon={<Package />}
        title="Katalog je prazan"
        description="Proizvodi, varijante i stanje — uvoz iz Sheets-a stiže u Fazi 1."
      />
    </main>
  );
}
