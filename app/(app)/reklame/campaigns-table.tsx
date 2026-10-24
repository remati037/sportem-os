"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

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
 */

export type CampaignRowView = {
  id: string;
  name: string;
  status: string | null;
  spendRsd: number;
  impressions: number;
  linkClicks: number;
  ctr: number | null;
  cpc: number | null;
  purchases: number;
  costPerPurchase: number | null;
  roas: number | null;
};

type SortKey =
  | "name"
  | "spendRsd"
  | "impressions"
  | "linkClicks"
  | "ctr"
  | "cpc"
  | "purchases"
  | "costPerPurchase"
  | "roas";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Kampanja", numeric: false },
  { key: "spendRsd", label: "Potrošnja", numeric: true },
  { key: "impressions", label: "Prikazi", numeric: true },
  { key: "linkClicks", label: "Klikovi", numeric: true },
  { key: "ctr", label: "CTR", numeric: true },
  { key: "cpc", label: "Cena klika", numeric: true },
  { key: "purchases", label: "Kupovine*", numeric: true },
  { key: "costPerPurchase", label: "Po kupovini*", numeric: true },
  { key: "roas", label: "ROAS*", numeric: true },
];

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
    // nazivi abecedno; cene (manje je bolje) odozdo; ostali brojevi odozgo
    setAsc(key === "name" || key === "cpc" || key === "costPerPurchase");
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
                  className={cn("bg-surface-2 h-9 px-4", col.numeric && "text-right")}
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
                  <TableCell className="px-4 py-2.5">
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
                  <TableCell className="num text-ink px-4 py-2.5 text-right font-semibold">
                    {rsd(r.spendRsd)}
                  </TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{num(r.impressions)}</TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{num(r.linkClicks)}</TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{pct(r.ctr)}</TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">
                    {r.cpc == null ? "—" : rsd(r.cpc)}
                  </TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{num(r.purchases)}</TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">
                    {r.costPerPurchase == null ? "—" : rsd(r.costPerPurchase)}
                  </TableCell>
                  <TableCell className="num px-4 py-2.5 text-right">{roas(r.roas)}</TableCell>
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
                <MobileCardField label="Klikovi">
                  <span className="num">
                    {num(r.linkClicks)} <span className="text-ink-faint">({pct(r.ctr)})</span>
                  </span>
                </MobileCardField>
                <MobileCardField label="Kupovine*">
                  <span className="num">
                    {num(r.purchases)}
                    {r.costPerPurchase != null ? (
                      <span className="text-ink-faint">
                        {" "}
                        · {rsd(r.costPerPurchase)} po kupovini
                      </span>
                    ) : null}
                  </span>
                </MobileCardField>
                <MobileCardField label="ROAS*">
                  <span className="num">{roas(r.roas)}</span>
                </MobileCardField>
              </div>
            </MobileCard>
          );
        })}
      </MobileCardList>
    </>
  );
}
