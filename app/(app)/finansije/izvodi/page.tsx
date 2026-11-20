import { requireRole } from "@/lib/auth";

import { FinanceTabs } from "../finance-tabs";
import { IzvodiViewer } from "./izvodi-viewer";

export const dynamic = "force-dynamic";

/*
 * Izvodi XExpress uplata (otkupnine po danu). Fajlovi (CSV ili JSON) se čitaju i
 * sabiraju SAMO u pregledaču — ništa se ne upisuje u bazu i ne dira uplate/fakture.
 */
export default async function IzvodiPage() {
  await requireRole("admin", "manager");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>

      <FinanceTabs />

      <IzvodiViewer />
    </main>
  );
}
