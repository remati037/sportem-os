import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { datumVreme, rsd } from "@/lib/format";
import type { BrevoCampaignStatus } from "@/lib/email/brevo";
import { campaignStatusLabel, contentLabel } from "@/lib/email/labels";
import type { EmailOrder } from "@/lib/email/overview";
import { rate } from "@/lib/offers/labels";
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

import { StatusPill } from "../../porudzbine/status-pill";

/* Zajednički delovi za Ponude → Mejlovi (pregled i detalj kampanje). Server komponente. */

export const ratio = (a: number, b: number) => (b > 0 ? rate(a / b) : "—");

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-xl font-bold break-words">{value}</div>
      {hint ? <div className="text-ink-faint mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

export function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div className="border-danger bg-danger-soft text-danger mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 break-words">{message}</p>
      </div>
    </div>
  );
}

export function CampaignStatus({ status }: { status: BrevoCampaignStatus }) {
  const variant =
    status === "sent"
      ? "success"
      : status === "suspended"
        ? "warning"
        : status === "archive"
          ? "info"
          : "sent";
  return <Badge variant={variant}>{campaignStatusLabel(status)}</Badge>;
}

/** Datum slanja: poslato → kad je poslato, zakazano → kad kreće. */
export function campaignWhen(c: { sentDate: string | null; scheduledAt: string | null }): string {
  const at = c.sentDate ?? c.scheduledAt;
  return at ? datumVreme(at) : "—";
}

export function EmailOrders({
  orders,
  showCampaign,
}: {
  orders: EmailOrder[];
  showCampaign: boolean;
}) {
  const href = (r: EmailOrder) => `/porudzbine/${r.wooOrderId ?? r.id}`;
  return (
    <>
      <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Porudžbina</TableHead>
              <TableHead>Kupac</TableHead>
              <TableHead>Vreme</TableHead>
              {showCampaign ? <TableHead>Kampanja</TableHead> : null}
              <TableHead>Dugme</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Roba</TableHead>
              <TableHead className="text-right">Zarada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={href(r)} className="text-ink hover:text-green num font-medium">
                    #{r.wooOrderId ?? "—"}
                  </Link>
                </TableCell>
                <TableCell className="break-words">{r.name ?? "—"}</TableCell>
                <TableCell className="num">{datumVreme(r.orderedAt)}</TableCell>
                {showCampaign ? <TableCell>{r.campaign ?? "—"}</TableCell> : null}
                <TableCell>{contentLabel(r.content)}</TableCell>
                <TableCell>
                  {r.statusName ? <StatusPill name={r.statusName} color={r.statusColor} /> : "—"}
                </TableCell>
                <TableCell
                  className={`num text-right ${r.cancelled ? "text-ink-faint line-through" : "text-ink font-semibold"}`}
                >
                  {rsd(r.goodsTotal)}
                </TableCell>
                <TableCell
                  className={`num text-right ${r.cancelled ? "text-ink-faint line-through" : ""}`}
                >
                  {rsd(r.profit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MobileCardList>
        {orders.map((r) => (
          <MobileCard key={r.id} href={href(r)} ariaLabel={`Porudžbina ${r.wooOrderId ?? ""}`}>
            <MobileCardHeader
              title={<span className="num">#{r.wooOrderId ?? "—"}</span>}
              subtitle={r.name ?? undefined}
              trailing={
                r.statusName ? <StatusPill name={r.statusName} color={r.statusColor} /> : null
              }
            />
            <div className="mt-3 space-y-1.5">
              <MobileCardField label="Vreme">
                <span className="num">{datumVreme(r.orderedAt)}</span>
              </MobileCardField>
              {showCampaign ? (
                <MobileCardField label="Kampanja">{r.campaign ?? "—"}</MobileCardField>
              ) : null}
              <MobileCardField label="Dugme">{contentLabel(r.content)}</MobileCardField>
              <MobileCardField label="Roba">
                <span className={`num ${r.cancelled ? "line-through" : "font-semibold"}`}>
                  {rsd(r.goodsTotal)}
                </span>
              </MobileCardField>
              <MobileCardField label="Zarada">
                <span className={`num ${r.cancelled ? "line-through" : ""}`}>{rsd(r.profit)}</span>
              </MobileCardField>
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
    </>
  );
}
