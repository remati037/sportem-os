import { ShoppingCart } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { EmptyState } from "@/components/patterns/empty-state";

export default async function PorudzbinePage() {
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Operativa</div>
        <h1 className="text-ink text-xl font-bold">Porudžbine</h1>
      </div>
      <EmptyState
        icon={<ShoppingCart />}
        title="Nema porudžbina"
        description="Porudžbine ulaze automatski kroz WooCommerce webhook — stiže u Fazi 1."
      />
    </main>
  );
}
