import Link from "next/link";
import { Plus, Truck } from "lucide-react";

import { requireRole } from "@/lib/auth";
import {
  getSaldoPostarine,
  listPostageSettlements,
  listXexpressInvoices,
} from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
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

import { FinanceTabs } from "../finance-tabs";
import { SettlementDialog } from "./settlement-dialog";

export const dynamic = "force-dynamic";

/*
 * Saldo poštarine (Korak 1.6c). Prolazna stavka, NIJE profit: Σ(naplaćeno −
 * stvarno) umanjeno za već poravnate iznose. Poravnanje se beleži u append-only
 * ledger sa snapshotom salda. Iznos ide sa predznakom (saldo može u minus).
 */
function signed(n: number) {
  return n === 0 ? "0" : `${n > 0 ? "+" : ""}${rsd(n)}`;
}

export default async function PostarinaPage() {
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const [saldo, settlements, xInvoices] = await Promise.all([
    getSaldoPostarine(),
    listPostageSettlements(),
    listXexpressInvoices(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>

      <FinanceTabs />

      {/* Saldo kartica */}
      <div className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Saldo poštarine</div>
            <p className="text-ink-faint text-xs">
              Prolazna stavka — nije profit. Naplaćeno kupcima minus plaćeno kuriru.
            </p>
          </div>
          {isAdmin ? <SettlementDialog balance={saldo.balance} /> : null}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="border-border bg-surface-2 rounded-lg border px-3 py-2.5">
            <div className="text-ink-faint text-xs">Naplaćeno − stvarno</div>
            <div className="num text-ink mt-0.5 text-base font-semibold">{signed(saldo.gross)}</div>
          </div>
          <div className="border-border bg-surface-2 rounded-lg border px-3 py-2.5">
            <div className="text-ink-faint text-xs">Već poravnato</div>
            <div className="num text-ink mt-0.5 text-base font-semibold">{signed(saldo.settled)}</div>
          </div>
          <div className="border-border bg-surface-2 rounded-lg border px-3 py-2.5">
            <div className="text-ink-faint text-xs">Trenutni saldo</div>
            <div
              className={
                "num mt-0.5 text-base font-bold " +
                (saldo.balance === 0 ? "text-success" : "text-warning")
              }
            >
              {signed(saldo.balance)}
            </div>
          </div>
        </div>
      </div>

      {/* XExpress fakture */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-ink text-sm font-semibold">XExpress fakture</h2>
          <p className="text-ink-faint text-xs">
            Stvarna poštarina po specifikaciji (osnovica) + 20% PDV vs naplaćeno kupcima.
          </p>
        </div>
        {isAdmin ? (
          <Button asChild size="sm">
            <Link href="/finansije/postarina/fakture/nova">
              <Plus /> Nova XExpress faktura
            </Link>
          </Button>
        ) : null}
      </div>

      {xInvoices.length === 0 ? (
        <div className="mb-8">
          <EmptyState
            icon={<Truck />}
            title="Još nema XExpress faktura"
            description="Kad XExpress pošalje fakturu sa specifikacijom, dodaj je i odaberi porudžbine da vidiš zaradu/gubitak na poštarini."
          />
        </div>
      ) : (
        <div className="mb-8">
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Broj</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Porudžbina</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Naplaćeno</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Plaćeno (sa PDV)</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Rezultat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {xInvoices.map((inv) => (
                  <TableRow key={inv.id} className="border-border">
                    <TableCell className="text-ink px-4 py-2.5 font-medium">
                      <Link
                        href={`/finansije/postarina/fakture/${inv.id}`}
                        className="hover:text-green underline-offset-2 hover:underline"
                      >
                        {inv.invoice_number ?? "(bez broja)"}
                      </Link>
                    </TableCell>
                    <TableCell className="num text-ink-soft px-4 py-2.5">
                      {datum(inv.invoice_date)}
                    </TableCell>
                    <TableCell className="num text-ink-soft px-4 py-2.5 text-right">
                      {num(inv.order_count)}
                    </TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right">
                      {rsd(inv.naplaceno)}
                    </TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right">
                      {rsd(inv.ukupno)}
                    </TableCell>
                    <TableCell
                      className={
                        "num px-4 py-2.5 text-right font-semibold " +
                        (inv.rezultat >= 0 ? "text-success" : "text-warning")
                      }
                    >
                      {signed(inv.rezultat)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {xInvoices.map((inv) => (
              <MobileCard key={inv.id} ariaLabel={`Faktura ${inv.invoice_number ?? ""}`}>
                <Link href={`/finansije/postarina/fakture/${inv.id}`} className="block">
                  <MobileCardHeader
                    title={<span>{inv.invoice_number ?? "(bez broja)"}</span>}
                    trailing={
                      <span
                        className={
                          "num font-semibold " +
                          (inv.rezultat >= 0 ? "text-success" : "text-warning")
                        }
                      >
                        {signed(inv.rezultat)}
                      </span>
                    }
                  />
                  <div className="mt-3 space-y-1.5">
                    <MobileCardField label="Datum">
                      <span className="num">{datum(inv.invoice_date)}</span>
                    </MobileCardField>
                    <MobileCardField label="Porudžbina">
                      <span className="num">{num(inv.order_count)}</span>
                    </MobileCardField>
                    <MobileCardField label="Naplaćeno">
                      <span className="num">{rsd(inv.naplaceno)}</span>
                    </MobileCardField>
                    <MobileCardField label="Plaćeno (sa PDV)">
                      <span className="num">{rsd(inv.ukupno)}</span>
                    </MobileCardField>
                  </div>
                </Link>
              </MobileCard>
            ))}
          </MobileCardList>
        </div>
      )}

      {/* Istorija poravnanja */}
      <h2 className="text-ink mb-2 text-sm font-semibold">Istorija poravnanja</h2>
      {settlements.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title="Još nema poravnanja"
          description="Kad se saldo poštarine isplati u kešu, evidentiraj poravnanje da se saldo svede na nulu."
        />
      ) : (
        <>
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Iznos</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Saldo pre</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Napomena</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow key={s.id} className="border-border">
                    <TableCell className="num text-ink px-4 py-2.5 font-medium">
                      {datum(s.settled_at)}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">{signed(s.amount)}</TableCell>
                    <TableCell className="num text-ink-soft px-4 py-2.5 text-right">
                      {s.balance_before != null ? signed(s.balance_before) : "—"}
                    </TableCell>
                    <TableCell className="text-ink-soft px-4 py-2.5">{s.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {settlements.map((s) => (
              <MobileCard key={s.id} ariaLabel={`Poravnanje ${datum(s.settled_at)}`}>
                <MobileCardHeader
                  title={<span className="num">{datum(s.settled_at)}</span>}
                  trailing={<span className="num font-medium">{signed(s.amount)}</span>}
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Saldo pre">
                    <span className="num">
                      {s.balance_before != null ? signed(s.balance_before) : "—"}
                    </span>
                  </MobileCardField>
                  {s.notes ? (
                    <MobileCardField label="Napomena">
                      <span>{s.notes}</span>
                    </MobileCardField>
                  ) : null}
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}
    </main>
  );
}
