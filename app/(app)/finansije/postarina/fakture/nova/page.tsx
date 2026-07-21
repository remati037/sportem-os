import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getEligibleXexpressOrders } from "@/db/finance";
import { todayBelgrade } from "@/lib/date-belgrade";

import { XexpressInvoiceForm } from "../xexpress-invoice-form";

export const dynamic = "force-dynamic";

/*
 * Nova XExpress faktura poštarine (Admin). Odabir porudžbina sa specifikacije +
 * unos osnovice stvarne poštarine. Rezultat je prolazna stavka (nije profit).
 */
export default async function NovaXexpressFakturaPage() {
  await requireRole("admin");
  const candidates = await getEligibleXexpressOrders();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/finansije/postarina"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na poštarinu
      </Link>

      <div className="mb-6 space-y-1">
        <div className="eyebrow">Poštarina</div>
        <h1 className="text-ink text-xl font-bold">Nova XExpress faktura</h1>
        <p className="text-ink-soft text-sm">
          Odaberi porudžbine sa XExpress specifikacije i unesi stvarnu poštarinu (osnovicu, bez
          PDV-a) po porudžbini.
        </p>
      </div>

      <XexpressInvoiceForm today={todayBelgrade()} candidates={candidates} />
    </main>
  );
}
