import Link from "next/link";
import { ChevronLeft, ChevronRight, Paperclip, Plus, Receipt, Tags } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { listExpenseCategories, listExpenses } from "@/db/expenses";
import { rsd, datum } from "@/lib/format";
import { todayBelgrade } from "@/lib/date-belgrade";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CategoryManager } from "./category-manager";
import { ExpenseActions } from "./expense-actions";
import { ExpenseDialog } from "./expense-dialog";

export const dynamic = "force-dynamic";

/*
 * Troškovi (Korak 1.7). Admin unosi/uređuje/briše; Menadžer čita; Logistika
 * nema pristup (RLS). Troškovi ulaze u neto profit (/finansije), nikad u
 * fakturu. Filter po mesecu (?mesec=YYYY-MM), kao overview finansija.
 */

/** „YYYY-MM" → naredni/prethodni mesec. */
function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** „YYYY-MM" → „jul 2026". */
function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Intl.DateTimeFormat("sr-RS", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export default async function TroskoviPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const sp = await searchParams;
  const rawMonth = typeof sp.mesec === "string" ? sp.mesec : "";
  const mesec = MONTH_RE.test(rawMonth) ? rawMonth : todayBelgrade().slice(0, 7);

  const [expenses, categories] = await Promise.all([
    listExpenses(mesec),
    listExpenseCategories(),
  ]);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Novac</div>
          <h1 className="text-ink text-xl font-bold">Troškovi</h1>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <CategoryManager
              categories={categories}
              trigger={
                <Button variant="subtle">
                  <Tags /> Kategorije
                </Button>
              }
            />
            <ExpenseDialog
              categories={categories}
              trigger={
                <Button>
                  <Plus /> Novi trošak
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      {/* Zbir + izbor meseca */}
      <div className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow">Ukupno troškova</div>
            <div className="num text-ink mt-1 text-2xl font-bold">{rsd(total)}</div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/troskovi?mesec=${shiftMonth(mesec, -1)}`}
              aria-label="Prethodni mesec"
              className="text-ink-faint hover:text-ink hover:bg-surface-2 rounded p-1"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="text-ink-soft text-sm capitalize">{monthLabel(mesec)}</span>
            <Link
              href={`/troskovi?mesec=${shiftMonth(mesec, 1)}`}
              aria-label="Sledeći mesec"
              className="text-ink-faint hover:text-ink hover:bg-surface-2 rounded p-1"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="Nema troškova za ovaj period"
          description="Reklame, pakovanje i ostali troškovi za izabrani mesec pojaviće se ovde."
        />
      ) : (
        <>
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Kategorija</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Opis</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Iznos</TableHead>
                  {isAdmin ? <TableHead className="bg-surface-2 h-9 w-10 px-4" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id} className="border-border">
                    <TableCell className="num text-ink px-4 py-2.5 font-medium">
                      {datum(e.date)}
                    </TableCell>
                    <TableCell className="text-ink-soft px-4 py-2.5">
                      {e.category_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-ink-soft px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        {e.description ?? "—"}
                        {e.attachment_path ? (
                          <Paperclip className="text-ink-faint size-3.5 shrink-0" />
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right font-semibold">
                      {rsd(e.amount)}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="px-4 py-2.5 text-right">
                        <ExpenseActions expense={e} categories={categories} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {expenses.map((e) => (
              <MobileCard key={e.id} ariaLabel={`Trošak ${datum(e.date)}`}>
                <MobileCardHeader
                  title={<span className="num">{datum(e.date)}</span>}
                  subtitle={e.category_name ?? undefined}
                  trailing={
                    <>
                      <span className="num font-semibold">{rsd(e.amount)}</span>
                      {isAdmin ? <ExpenseActions expense={e} categories={categories} /> : null}
                    </>
                  }
                />
                {e.description || e.attachment_path ? (
                  <div className="mt-3 space-y-1.5">
                    {e.description ? (
                      <MobileCardField label="Opis">
                        <span>{e.description}</span>
                      </MobileCardField>
                    ) : null}
                    {e.attachment_path ? (
                      <MobileCardField label="Prilog">
                        <span className="text-ink-soft flex items-center gap-1">
                          <Paperclip className="size-3.5" /> Priložen
                        </span>
                      </MobileCardField>
                    ) : null}
                  </div>
                ) : null}
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}
    </main>
  );
}
