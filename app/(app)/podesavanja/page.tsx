import { requireRole } from "@/lib/auth";
import { getOrderStatuses } from "@/db/orders";

import { StatusSettings } from "./status-settings";

export const dynamic = "force-dynamic";

/*
 * Podešavanja (Korak 1.4, Admin-only) — statusi porudžbine (naziv, boja,
 * redosled). Ostala podešavanja se dodaju kasnije po potrebi.
 */
export default async function PodesavanjaPage() {
  await requireRole("admin");

  const statuses = await getOrderStatuses();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Sistem</div>
        <h1 className="text-ink text-xl font-bold">Podešavanja</h1>
        <p className="text-ink-soft text-sm">Statusi porudžbine — naziv, boja i redosled u toku.</p>
      </div>

      <StatusSettings statuses={statuses} />
    </main>
  );
}
