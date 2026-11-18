import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatuses } from "@/db/orders";
import { listTaxMonths } from "@/db/tax";
import { todayBelgrade } from "@/lib/date-belgrade";
import type { TaxRate } from "@/lib/tax";
import { getTicketColumns, getTicketPriorities, getTicketTags } from "@/db/tickets-config";

import { ProfileSettings } from "./profile-settings";
import { StatusSettings } from "./status-settings";
import { TaxSettings } from "./tax-settings";
import { TicketSettings } from "./ticket-settings";

export const dynamic = "force-dynamic";

/*
 * Podešavanja — profil (sve role: ime + lozinka), statusi porudžbine i
 * podešavanja tiketa (Admin-only: kolone board-a, prioriteti, tagovi).
 * RLS i akcije štite write; UI je higijena.
 */
export default async function PodesavanjaPage() {
  const session = await requireRole("admin", "manager", "logistics");
  const isAdmin = session.profile.role === "admin";
  const isStaff = isAdmin || session.profile.role === "manager";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims.email as string | undefined) ?? null;

  const [statuses, ticketColumns, ticketPriorities, ticketTags] = isAdmin
    ? await Promise.all([
        getOrderStatuses(),
        getTicketColumns(),
        getTicketPriorities(),
        // Arhivirani se prikazuju u Podešavanjima (odatle se i vraćaju).
        getTicketTags({ includeArchived: true }),
      ])
    : [[], [], [], []];

  // Porez po mesecu — Admin piše, Menadžer čita. Neuspelo čitanje (npr. migracija
  // još nije primenjena) ne obara Podešavanja.
  let taxRates: TaxRate[] | null = [];
  if (isStaff) taxRates = await listTaxMonths().catch(() => null);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Sistem</div>
        <h1 className="text-ink text-xl font-bold">Podešavanja</h1>
        <p className="text-ink-soft text-sm">
          Profil naloga
          {isAdmin
            ? ", statusi porudžbine, porez po mesecu i podešavanja tiketa"
            : isStaff
              ? " i porez po mesecu"
              : ""}
          .
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-ink text-base font-semibold">Profil</h2>
        <ProfileSettings
          fullName={session.profile.full_name}
          email={email}
          role={session.profile.role}
        />
      </section>

      {isAdmin ? (
        <section className="mt-10 space-y-4">
          <div className="space-y-1">
            <h2 className="text-ink text-base font-semibold">Statusi porudžbine</h2>
            <p className="text-ink-soft text-sm">Naziv, boja i redosled u toku.</p>
          </div>
          <StatusSettings statuses={statuses} />
        </section>
      ) : null}

      {isStaff ? (
        <section className="mt-10 space-y-4">
          <div className="space-y-1">
            <h2 className="text-ink text-base font-semibold">Porez po mesecu</h2>
            <p className="text-ink-soft text-sm">
              Stopa poreza na zaradu (MP − VP) za porudžbine kreirane u mesecu. Dashboard je
              oduzima kad uključiš „Posle poreza“; keš porudžbine idu bez poreza.
              {isAdmin ? "" : " Menja samo Admin."}
            </p>
          </div>
          {taxRates ? (
            <TaxSettings
              rates={taxRates}
              canEdit={isAdmin}
              currentMonth={todayBelgrade().slice(0, 7)}
            />
          ) : (
            <p className="text-warning text-sm">Stope poreza trenutno nisu dostupne.</p>
          )}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="mt-10 space-y-4">
          <div className="space-y-1">
            <h2 className="text-ink text-base font-semibold">Tiketi</h2>
            <p className="text-ink-soft text-sm">
              Kolone board-a, prioriteti i tagovi. Tiketima pristupaju Admin i Menadžer.
            </p>
          </div>
          <TicketSettings columns={ticketColumns} priorities={ticketPriorities} tags={ticketTags} />
        </section>
      ) : null}
    </main>
  );
}
