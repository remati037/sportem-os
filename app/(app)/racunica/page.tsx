import { requireRole } from "@/lib/auth";
import { todayBelgrade } from "@/lib/date-belgrade";
import { resolveRange } from "@/lib/period";
import { getRacunica } from "@/db/racunica";

import { RangeFilter } from "./range-filter";
import { RacunicaView } from "./racunica-view";

export const dynamic = "force-dynamic";

/*
 * Računica — isplativost artikala (P1, docs/Sportem-Plan-Racunica.md).
 * Pristup: Admin i Menadžer (zarada). Period je na serveru (?od&do, podrazumevano
 * 90 dana); filteri, sortiranje i otvorene varijante su na klijentu i u URL-u
 * (history.replaceState — bez ponovnog učitavanja podataka).
 */

type Sp = Record<string, string | string[] | undefined>;

export default async function RacunicaPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireRole("admin", "manager");

  const sp = await searchParams;
  const period = resolveRange(sp, "90d");
  const data = await getRacunica(period);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Računica</h1>
        <p className="text-ink-soft text-sm">
          Koliko se koji artikal isplati: marža po trenutnom katalogu i po stvarnoj prodaji u
          periodu. Stvarne cifre su bez otkazanih i vraćenih porudžbina.
        </p>
      </div>

      <RangeFilter period={period} today={todayBelgrade()} />

      <RacunicaView data={data} periodLabel={period.label} />
    </main>
  );
}
