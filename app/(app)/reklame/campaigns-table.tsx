"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import type { AdCampaignRow } from "@/db/ads";
import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import { campaignStatus, pct, roas } from "@/lib/meta/labels";
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

/*
 * Tabela kampanja sa sortiranjem (podrazumevano potrošnja, opadajuće) —
 * obrazac `ponude/rules-table.tsx`. Klijentska je samo zbog sortiranja; cifre
 * stižu gotove sa servera. Na telefonu kartice, bez horizontalnog skrola.
 *
 * Dve vrste cifara: „sajt" (porudžbine i zarada iz app-a, po UTM-u) i „po
 * Meta-i" (*, piksel). Odlučuje sajt — Meta obično precenjuje.
 */

export type CampaignRowView = AdCampaignRow;

type SortKey =
  | "name"
  | "spendRsd"
  | "linkClicks"
  | "siteOrders"
  | "siteProfit"
  | "net"
  | "costPerOrder"
  | "purchases"
  | "roas";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Kampanja", numeric: false },
  { key: "spendRsd", label: "Potrošnja", numeric: true },
  { key: "linkClicks", label: "Klikovi", numeric: true },
  { key: "siteOrders", label: "Porudžbine", numeric: true },
  { key: "siteProfit", label: "Zarada", numeric: true },
  { key: "net", label: "Zarada − potrošnja", numeric: true },
  { key: "costPerOrder", label: "Po porudžbini", numeric: true },
  { key: "purchases", label: "Kupovine*", numeric: true },
  { key: "roas", label: "ROAS*", numeric: true },
];

function Net({ value }: { value: number }) {
  return (
    <span className={value < 0 ? "text-danger" : value > 0 ? "text-success" : undefined}>
      {value > 0 ? "+" : ""}
      {rsd(value)}
    </span>
  );
}

export function CampaignsTable({
  rows,
  query,
}: {
  rows: CampaignRowView[];
  /** ?od&do — detalj kampanje otvara isti period. */
  query: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spendRsd");
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      const cmp = av.localeCompare(bv, "sr-RS");
      return asc ? cmp : -cmp;
    }
    // null (nema podatka) uvek na kraj, bez obzira na smer
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    const cmp = Number(av) - Number(bv);
    return asc ? cmp : -cmp;
  });

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    // nazivi abecedno; cena po porudžbini (manje je bolje) odozdo; ostali brojevi odozgo
    setAsc(key === "name" || key === "costPerOrder");
  }

  const href = (id: string) => `/reklame/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;

  return (
    <>
      {/* desktop */}
      <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn("bg-surface-2 h-9 px-3", col.numeric && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    aria-label={`Sortiraj po: ${col.label}`}
                    className={cn(
                      "hover:text-ink inline-flex items-center gap-1 transition-colors",
                      col.numeric && "flex-row-reverse",
                      sortKey === col.key && "text-ink font-semibold",
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      asc ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : null}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const st = campaignStatus(r.status);
              return (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="px-3 py-2.5">
                    <Link
                      href={href(r.id)}
                      className="text-ink hover:text-green font-medium break-words"
                    >
                      {r.name}
                    </Link>
                    <div className="mt-1">
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="num text-ink px-3 py-2.5 text-right font-semibold">
                    {rsd(r.spendRsd)}
                  </TableCell>
                  <TableCell className="num px-3 py-2.5 text-right">
                    {num(r.linkClicks)}
                    <div className="text-ink-faint text-xs">{pct(r.ctr)}</div>
                  </TableCell>
                  <TableCell className="num px-3 py-2.5 text-right">{num(r.siteOrders)}</TableCell>
                  <TableCell className="num px-3 py-2.5 text-right">
                    {rsd(r.siteProfit)}
                    {r.needsVp ? <span title="Neke porudžbine nemaju VP">*</span> : null}
                  </TableCell>
                  <TableCell className="num px-3 py-2.5 text-right font-semibold">
                    <Net value={r.net} />
                  </TableCell>
                  <TableCell className="num px-3 py-2.5 text-right">
                    {r.costPerOrder == null ? "—" : rsd(r.costPerOrder)}
                  </TableCell>
                  <TableCell className="num text-ink-soft px-3 py-2.5 text-right">
                    {num(r.purchases)}
                  </TableCell>
                  <TableCell className="num text-ink-soft px-3 py-2.5 text-right">
                    {roas(r.roas)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* telefon */}
      <MobileCardList>
        {sorted.map((r) => {
          const st = campaignStatus(r.status);
          return (
            <MobileCard key={r.id} href={href(r.id)} ariaLabel={r.name}>
              <MobileCardHeader
                title={<span className="break-words">{r.name}</span>}
                trailing={<Badge variant={st.variant}>{st.label}</Badge>}
              />
              <div className="mt-3 space-y-1.5">
                <MobileCardField label="Potrošnja">
                  <span className="num font-semibold">{rsd(r.spendRsd)}</span>
                </MobileCardField>
                <MobileCardField label="Porudžbine (sajt)">
                  <span className="num">
                    {num(r.siteOrders)}
                    {r.costPerOrder != null ? (
                      <span className="text-ink-faint"> · {rsd(r.costPerOrder)} po porudžbini</span>
                    ) : null}
                  </span>
                </MobileCardField>
                <MobileCardField label="Zarada − potrošnja">
                  <span className="num font-semibold">
                    <Net value={r.net} />
                  </span>
                </MobileCardField>
                <MobileCardField label="Kupovine* · ROAS*">
                  <span className="num">
                    {num(r.purchases)} · {roas(r.roas)}
                  </span>
                </MobileCardField>
              </div>
            </MobileCard>
          );
        })}
      </MobileCardList>
    </>
  );
}
