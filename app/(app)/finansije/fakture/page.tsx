import Link from "next/link";
import { FileText, AlertTriangle } from "lucide-react";

import { requireRole } from "@/lib/auth";
import {
  getInvoiceCandidates,
  getBlockedNeedsVpOrders,
  listInvoices,
} from "@/db/finance";
import { rsd, num, datum } from "@/lib/format";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
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
import { IssueInvoicePanel } from "./issue-invoice-panel";

export const dynamic = "force-dynamic";

/*
 * Fakture drugu (Korak 1.6b). „Drug mi duguje" = Σ nefakturisane realizovane
 * zarade (uplaćene, bez needs_vp). Izdavanjem fakture porudžbine dobijaju
 * invoice_id i zaključavaju stavke. Bez PDF-a (zaključana odluka).
 */
export default async function FakturePage() {
  const { profile } = await requireRole("admin", "manager");
  const isAdmin = profile.role === "admin";

  const [candidates, blocked, invoices] = await Promise.all([
    getInvoiceCandidates(),
    getBlockedNeedsVpOrders(),
    listInvoices(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Novac</div>
        <h1 className="text-ink text-xl font-bold">Finansije</h1>
      </div>

      <FinanceTabs />

      {/* „Drug mi duguje" */}
      <div className="border-green/30 bg-green-soft mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
        <div>
          <div className="eyebrow text-green">Za fakturisanje</div>
          {candidates.orders.length === 0 ? (
            <p className="text-ink-soft text-xs">
              Nema porudžbina za fakturisanje. Faktura se pravi od isporučenih porudžbina koje su
              označene kao plaćene —{" "}
              <Link
                href="/finansije/uplate"
                className="text-green font-medium underline-offset-2 hover:underline"
              >
                obeleži uplatu
              </Link>{" "}
              pa se pojave ovde.
            </p>
          ) : (
            <p className="text-ink-soft text-xs">
              {num(candidates.orders.length)} nefakturisanih porudžbina (uplaćeno, bez čekanja VP)
            </p>
          )}
        </div>
        <div className="text-green num text-xl font-bold">{rsd(candidates.total)}</div>
      </div>

      {/* Upozorenje: needs_vp */}
      {blocked.length > 0 ? (
        <div className="border-warning/30 bg-warning-soft text-warning mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-medium">Čeka VP ({num(blocked.length)})</span> — neće ući u
            fakturu dok se ne unese nabavna cena:{" "}
            {blocked.map((o, i) => (
              <span key={o.id} className="num">
                {i > 0 ? ", " : ""}
                {o.woo_order_id != null ? (
                  <Link
                    href={`/porudzbine/${o.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    #{o.woo_order_id}
                  </Link>
                ) : (
                  "—"
                )}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mb-6 flex justify-end">
          <IssueInvoicePanel candidates={candidates.orders} />
        </div>
      ) : null}

      {/* Izdate fakture */}
      <h2 className="text-ink mb-2 text-sm font-semibold">Izdate fakture</h2>
      {invoices.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Još nema izdatih faktura"
          description="Kad su porudžbine uplaćene, izdaj fakturu drugu — Σ zarade se sklapa automatski."
        />
      ) : (
        <>
          {/* Desktop tabela */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Broj</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Period</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                    Porudžbina
                  </TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Zarada</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="border-border hover:bg-green-soft relative">
                    <TableCell className="num text-ink px-4 py-2.5 font-medium">
                      <Link
                        href={`/finansije/fakture/${inv.id}`}
                        className="after:absolute after:inset-0"
                      >
                        {inv.invoice_number ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="num text-ink-soft px-4 py-2.5">
                      {inv.period_from ? datum(inv.period_from) : "—"} –{" "}
                      {inv.period_to ? datum(inv.period_to) : "—"}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">{num(inv.orderCount)}</TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">
                      {rsd(inv.total_amount ?? 0)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobilne kartice */}
          <MobileCardList>
            {invoices.map((inv) => (
              <MobileCard
                key={inv.id}
                href={`/finansije/fakture/${inv.id}`}
                ariaLabel={`Faktura ${inv.invoice_number ?? ""}`}
              >
                <MobileCardHeader
                  title={<span className="num">{inv.invoice_number ?? "—"}</span>}
                  subtitle={
                    <span>
                      {inv.period_from ? datum(inv.period_from) : "—"} –{" "}
                      {inv.period_to ? datum(inv.period_to) : "—"}
                    </span>
                  }
                  trailing={<span className="num font-medium">{rsd(inv.total_amount ?? 0)}</span>}
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Porudžbina">
                    <span className="num">{num(inv.orderCount)}</span>
                  </MobileCardField>
                  <MobileCardField label="Status">
                    <InvoiceStatusBadge status={inv.status} />
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

function InvoiceStatusBadge({ status }: { status: string }) {
  return status === "placeno" ? (
    <Badge variant="success">Plaćeno</Badge>
  ) : (
    <Badge variant="warning">Izdato</Badge>
  );
}
