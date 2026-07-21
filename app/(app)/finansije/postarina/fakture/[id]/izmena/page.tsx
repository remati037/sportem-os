import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getXexpressInvoiceDetail } from "@/db/finance";
import { todayBelgrade } from "@/lib/date-belgrade";

import { XexpressInvoiceForm } from "../../xexpress-invoice-form";

export const dynamic = "force-dynamic";

/*
 * Izmena XExpress fakture (Admin). Pred-čekira već vezane porudžbine sa njihovom
 * osnovicom; može se dodati/ukloniti porudžbina i izmeniti osnovica.
 */
export default async function IzmenaXexpressFakturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("admin");

  const detail = await getXexpressInvoiceDetail(id);
  if (!detail) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href={`/finansije/postarina/fakture/${id}`}
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na fakturu
      </Link>

      <div className="mb-6 space-y-1">
        <div className="eyebrow">Poštarina</div>
        <h1 className="text-ink text-xl font-bold">Izmena XExpress fakture</h1>
      </div>

      <XexpressInvoiceForm
        today={todayBelgrade()}
        candidates={detail.candidates}
        invoice={detail.invoice}
        linked={detail.orders}
      />
    </main>
  );
}
