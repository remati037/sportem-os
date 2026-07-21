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
 * Saldo poštarine (Korak 1.6c). Prolazna stavka, NIJE profit: zbir rezultata
 * svih XExpress faktura (naplaćeno kupcima − plaćeno kuriru sa PDV) umanjen za
 * već izvršene uplate. Uplate se beleže u append-only ledger sa snapshotom salda.
 * Iznos ide sa predznakom (saldo može u minus).
 */
const DRUG = "Simić"; // logistika/dobavljač — druga strana u uplatama poštarine

function signed(n: number) {
  return n === 0 ? "0" : `${n > 0 ? "+" : ""}${rsd(n)}`;
}

/**
 * Smer uplate iz predznaka iznosa: plus = Simić uplatio Sportem-u (bili u plusu);
 * minus = Sportem uplatio Simiću (bili u minusu).
 */
function settlementDirection(amount: number): {
  label: string;
  stateLabel: string;
  tone: "success" | "warning" | "muted";
} {
  if (amount > 0)
    return { label: `${DRUG} → Sportem`, stateLabel: "Bili u plusu", tone: "success" };
  if (amount < 0)
    return { label: `Sportem → ${DRUG}`, stateLabel: "Bili u minusu", tone: "warning" };
  return { label: "—", stateLabel: "—", tone: "muted" };
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

      {/* Saldo kartica — jedan trenutni saldo (zbir svih XExpress faktura − uplate) */}
      <div className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow">Trenutni saldo poštarine</div>
            <div
              className={
                "num mt-1 text-2xl font-bold " +
                (saldo.balance < 0 ? "text-warning" : "text-success")
              }
            >
              {signed(saldo.balance)}
            </div>
            <p className="text-ink-faint mt-1 max-w-md text-xs">
              Zbir svih XExpress faktura (naplaćeno kupcima − plaćeno kuriru sa PDV), umanjen za
              uplate. Plus = {DRUG} uplaćuje Sportem-u; minus = Sportem uplaćuje {DRUG}u.
            </p>
          </div>
          {isAdmin ? <SettlementDialog balance={saldo.balance} /> : null}
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

      {/* Istorija uplata poštarine */}
      <h2 className="text-ink mb-2 text-sm font-semibold">Istorija uplata poštarine</h2>
      {settlements.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title="Još nema uplata poštarine"
          description="Kad se saldo poštarine izmiri u kešu (Simić uplati Sportem-u ili obrnuto), evidentiraj uplatu da se saldo svede na nulu."
        />
      ) : (
        <>
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Ko → kome</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Iznos</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Stanje</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Napomena</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => {
                  const dir = settlementDirection(s.amount);
                  return (
                    <TableRow key={s.id} className="border-border">
                      <TableCell className="num text-ink px-4 py-2.5 font-medium">
                        {datum(s.settled_at)}
                      </TableCell>
                      <TableCell className="text-ink px-4 py-2.5">{dir.label}</TableCell>
                      <TableCell className="num text-ink px-4 py-2.5 text-right font-medium">
                        {rsd(Math.abs(s.amount))}
                      </TableCell>
                      <TableCell
                        className={
                          "px-4 py-2.5 text-sm " +
                          (dir.tone === "success"
                            ? "text-success"
                            : dir.tone === "warning"
                              ? "text-warning"
                              : "text-ink-soft")
                        }
                      >
                        {dir.stateLabel}
                      </TableCell>
                      <TableCell className="text-ink-soft px-4 py-2.5">{s.notes ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {settlements.map((s) => {
              const dir = settlementDirection(s.amount);
              return (
                <MobileCard key={s.id} ariaLabel={`Uplata ${datum(s.settled_at)}`}>
                  <MobileCardHeader
                    title={<span className="num">{datum(s.settled_at)}</span>}
                    trailing={<span className="num font-medium">{rsd(Math.abs(s.amount))}</span>}
                  />
                  <div className="mt-3 space-y-1.5">
                    <MobileCardField label="Ko → kome">
                      <span>{dir.label}</span>
                    </MobileCardField>
                    <MobileCardField label="Stanje">
                      <span
                        className={
                          dir.tone === "success"
                            ? "text-success"
                            : dir.tone === "warning"
                              ? "text-warning"
                              : "text-ink-soft"
                        }
                      >
                        {dir.stateLabel}
                      </span>
                    </MobileCardField>
                    {s.notes ? (
                      <MobileCardField label="Napomena">
                        <span>{s.notes}</span>
                      </MobileCardField>
                    ) : null}
                  </div>
                </MobileCard>
              );
            })}
          </MobileCardList>
        </>
      )}
    </main>
  );
}
