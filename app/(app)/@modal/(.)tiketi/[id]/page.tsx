import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { getTicketDetail } from "@/db/tickets";
import { formatTicketCode } from "@/lib/tickets";

import { TicketDetail } from "../../../tiketi/ticket-detail";
import { TicketModal } from "../../../tiketi/ticket-modal";

export const dynamic = "force-dynamic";

/*
 * Detalj tiketa kao MODAL nad board-om (presretnuta ruta). Klik na karticu je
 * soft navigacija → ovo se renderuje preko `/tiketi`, board ostaje ispod i ne
 * gubi se kontekst. Direktan link, refresh i „otvori u novom tabu" zaobilaze
 * presretanje i dobijaju punu stranu `/tiketi/[id]` — URL je isti u oba slučaja.
 */
export default async function TiketModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("admin", "manager");

  // Naslov i šifra idu u zaglavlje modala (DialogTitle), pa se čitaju ovde;
  // `TicketDetail` isti tiket dobija iz keša istog zahteva.
  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();

  return (
    <TicketModal code={formatTicketCode(ticket.code)} title={ticket.title}>
      <TicketDetail param={id} variant="modal" />
    </TicketModal>
  );
}
