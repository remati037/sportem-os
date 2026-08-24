import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";

import { TicketDetail } from "../ticket-detail";

export const dynamic = "force-dynamic";

/*
 * Detalj tiketa kao PUNA STRANA (Korak T2). Sa board-a se tiket otvara u
 * modalu (presretnuta ruta `@modal/(.)tiketi/[id]`); ovde se stiže direktnim
 * linkom, refresh-om ili iz novog taba — URL je u oba slučaja isti.
 *
 * URL prima šifru („/tiketi/SPT-42" i „/tiketi/42"); UUID ostaje rezerva za
 * stare linkove (isti obrazac kao `/porudzbine/[id]`).
 */
export default async function TiketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <Link
        href="/tiketi"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na tikete
      </Link>

      <TicketDetail param={id} />
    </main>
  );
}
