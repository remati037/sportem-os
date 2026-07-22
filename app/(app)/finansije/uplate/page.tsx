import Link from "next/link";
import { Wallet } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { getUnpaidDeliveredXexpress, listPayouts } from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { todayBelgrade } from "@/lib/date-belgrade";
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
import { NewPayoutDialog } from "./new-payout-dialog";

export const dynamic = "force-dynamic";

/*
 * Uplate druga (Korak 1.6a, T+1). Lista uplata + „Nova uplata" (Admin) —
 * predloži isporučene+neuplaćene XExpress porudžbine, pred-čekira T−1 radni dan.
 * Vezivanje uplate označava porudžbine kao „uplaćeno" (preduslov fakture).
 */
export default async function UplatePage() {
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const [payouts, candidates] = await Promise.all([
    listPayouts(),
    isAdmin ? getUnpaidDeliveredXexpress() : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>

      <FinanceTabs />

      {isAdmin ? (
        <div className="mb-4 flex justify-end">
          <NewPayoutDialog candidates={candidates} defaultDate={todayBelgrade()} />
        </div>
      ) : null}

      {payouts.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title="Još nema uplata"
          description="Kad XExpress uplati otkupninu, evidentiraj uplatu i veži isporučene porudžbine."
        />
      ) : (
        <>
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum uplate</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Isporuka (T−1)</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Porudžbina</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Uplata</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Zarada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id} className="border-border hover:bg-green-soft relative">
                    <TableCell className="num text-ink px-4 py-2.5 font-medium">
                      <Link
                        href={`/finansije/uplate/${p.id}`}
                        className="after:absolute after:inset-0"
                      >
                        {datum(p.payout_date)}
                      </Link>
                    </TableCell>
                    <TableCell className="num text-ink-soft px-4 py-2.5">
                      {p.delivery_date ? datum(p.delivery_date) : "—"}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">{num(p.linkedCount)}</TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right font-medium">
                      {rsd(p.amount)}
                    </TableCell>
                    <TableCell className="num text-success px-4 py-2.5 text-right font-semibold">
                      {rsd(p.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {payouts.map((p) => (
              <MobileCard
                key={p.id}
                href={`/finansije/uplate/${p.id}`}
                ariaLabel={`Uplata ${datum(p.payout_date)}`}
              >
                <MobileCardHeader
                  title={<span className="num">{datum(p.payout_date)}</span>}
                  subtitle={<span>{num(p.linkedCount)} porudžbina · isporuka {p.delivery_date ? datum(p.delivery_date) : "—"}</span>}
                  trailing={<span className="num font-medium">{rsd(p.amount)}</span>}
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Uplata">
                    <span className="num">{rsd(p.amount)}</span>
                  </MobileCardField>
                  <MobileCardField label="Zarada">
                    <span className="num text-success font-semibold">{rsd(p.profit)}</span>
                  </MobileCardField>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}
    </main>
  );
}
