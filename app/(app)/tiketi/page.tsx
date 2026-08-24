import Link from "next/link";
import { Plus, Ticket } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { listStaffProfiles } from "@/db/profiles";
import { listTickets } from "@/db/tickets";
import { getTicketPriorities, getTicketTags } from "@/db/tickets-config";
import { todayBelgrade } from "@/lib/date-belgrade";
import { TICKET_ARCHIVE_DAYS } from "@/lib/tickets";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";

import { Board } from "./board";
import { TicketFilters } from "./filters";
import { MobileBoard } from "./mobile-board";
import { TicketDialog, type TicketOptions } from "./ticket-dialog";

export const dynamic = "force-dynamic";

/*
 * Board tiketa (Korak T2). Pristup: Admin i Menadžer (ravnopravni) —
 * Logistika dobija redirect kroz `requireRole`, a RLS je pravi izvor
 * sigurnosti (nema politiku ni na jednoj ticket tabeli).
 *
 * Filteri su URL-driven (`?kolona=&osoba=&tag=&prioritet=&q=&moji=1
 * &rok=probijen|danas&arhiva=1`) — deljiv link = deljiv pogled.
 * Bez drag & drop-a (T3), bez komentara/checkliste/istorije (T4).
 */
export default async function TiketiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireRole("admin", "manager");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const rokRaw = one(sp.rok);
  const due = (["probijen", "danas"] as const).find((v) => v === rokRaw);

  const filters = {
    columnId: one(sp.kolona),
    assigneeId: one(sp.osoba),
    tagId: one(sp.tag),
    priorityId: one(sp.prioritet),
    search: one(sp.q),
    onlyMine: one(sp.moji) === "1",
    currentUserId: userId,
    due,
    includeArchived: one(sp.arhiva) === "1",
  };

  const [board, priorities, tags, staff] = await Promise.all([
    listTickets(filters),
    getTicketPriorities(),
    getTicketTags(),
    listStaffProfiles(),
  ]);

  const options: TicketOptions = { columns: board.columns, priorities, tags, staff };
  const today = todayBelgrade();
  const hasColumns = board.columns.length > 0;
  const hasFilters = Boolean(
    filters.columnId ||
    filters.assigneeId ||
    filters.tagId ||
    filters.priorityId ||
    filters.search ||
    filters.onlyMine ||
    filters.due,
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Tim</div>
          <h1 className="text-ink text-xl font-bold">Tiketi</h1>
        </div>
        {hasColumns ? (
          <TicketDialog
            options={options}
            trigger={
              <Button>
                <Plus /> Novi tiket
              </Button>
            }
          />
        ) : null}
      </div>

      {!hasColumns ? (
        <EmptyState
          icon={<Ticket />}
          title="Nema kolona board-a"
          description="Kolone se podešavaju u Podešavanjima (Admin). Bez njih tiketi nemaju gde da stanu."
          action={
            <Button variant="subtle" asChild>
              <Link href="/podesavanja">Otvori Podešavanja</Link>
            </Button>
          }
        />
      ) : (
        <>
          <TicketFilters
            columns={board.columns}
            priorities={priorities}
            tags={tags}
            staff={staff}
          />

          {board.total === 0 ? (
            <EmptyState
              icon={<Ticket />}
              title={hasFilters ? "Nema tiketa za ove filtere" : "Još nema tiketa"}
              description={
                hasFilters
                  ? "Promeni ili resetuj filtere da vidiš ostale tikete."
                  : "Napravi prvi tiket — zadatak, poziv kupcu ili reklamacija."
              }
            />
          ) : (
            <>
              <Board board={board} options={options} today={today} />
              <MobileBoard board={board} options={options} today={today} />
            </>
          )}

          {board.archivedHidden > 0 ? (
            <p className="text-ink-faint mt-4 text-xs">
              Sakriveno {board.archivedHidden} završenih starijih od {TICKET_ARCHIVE_DAYS} dana.{" "}
              <Link href="/tiketi?arhiva=1" className="text-green-deep font-medium underline">
                Prikaži arhivu
              </Link>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
