import * as Sentry from "@sentry/nextjs";

import { requireRole } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { usd } from "@/lib/ai/models";
import { getAiBudget } from "@/lib/ai/usage";
import { todayBelgrade } from "@/lib/date-belgrade";
import { resolveRange } from "@/lib/period";
import { RangeFilter } from "@/components/patterns/range-filter";
import { getRacunica } from "@/db/racunica";

import { RacunicaView } from "./racunica-view";
import type { AiState } from "./analiza";

export const dynamic = "force-dynamic";

/*
 * Računica — isplativost artikala (P1, docs/arhiva/2026-10-22-Plan-Racunica.md).
 * Pristup: Admin i Menadžer (zarada). Period je na serveru (?od&do, podrazumevano
 * 90 dana); filteri, sortiranje i otvorene varijante su na klijentu i u URL-u
 * (history.replaceState — bez ponovnog učitavanja podataka).
 */

type Sp = Record<string, string | string[] | undefined>;

export default async function RacunicaPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const session = await requireRole("admin", "manager");

  const sp = await searchParams;
  const period = resolveRange(sp, "90d");
  const [data, ai] = await Promise.all([getRacunica(period), aiState(session.userId)]);

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

      <RangeFilter period={period} today={todayBelgrade()} basePath="/racunica" />

      <RacunicaView data={data} periodLabel={period.label} ai={ai} />
    </main>
  );
}

/** Da li „Analiziraj" sme da se ponudi (ključ + mesečni limit; ruta proverava ponovo). */
async function aiState(userId: string): Promise<AiState> {
  if (!aiConfigured()) return { ready: false, reason: "AI asistent nije podešen (nedostaje ključ na serveru)." };
  try {
    const b = await getAiBudget(userId);
    if (b.blocked && b.limitMicro != null) {
      return {
        ready: false,
        reason: `Mesečni AI limit je potrošen (${usd(b.totalMicro)} od ${usd(b.limitMicro)}).`,
      };
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "ai-budget" } });
  }
  return { ready: true };
}
