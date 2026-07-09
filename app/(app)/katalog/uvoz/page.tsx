import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";

import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function UvozPage() {
  await requireRole("admin");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <Link
        href="/katalog"
        className="text-ink-soft hover:text-ink mb-6 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Nazad na katalog
      </Link>

      <div className="mb-6 space-y-1">
        <div className="eyebrow">Katalog</div>
        <h1 className="text-ink text-xl font-bold">Uvoz iz Sheets-a (CSV)</h1>
        <p className="text-ink-soft text-sm">
          Učitaj CSV, mapiraj kolone i pregledaj pre upisa. Postojeći SKU se ažurira.
        </p>
      </div>

      <ImportWizard />
    </main>
  );
}
