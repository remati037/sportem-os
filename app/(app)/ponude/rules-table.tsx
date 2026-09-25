"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import { placementLabel, rate } from "@/lib/offers/labels";
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
 * Tabela pravila sa sortiranjem po koloni (podrazumevano prihod, opadajuće).
 * Klijentska je samo zbog sortiranja — podaci stižu gotovi sa servera.
 * Na telefonu (`md-`) prelazi u kartice, bez horizontalnog skrola.
 */

export type RuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  placements: string[];
  offerName: string | null;
  offerSku: string | null;
  impressions: number;
  adds: number;
  addRate: number;
  orders: number;
  revenue: number;
};

type SortKey = "name" | "priority" | "impressions" | "adds" | "addRate" | "orders" | "revenue";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Pravilo", numeric: false },
  { key: "priority", label: "Prioritet", numeric: true },
  { key: "impressions", label: "Prikazi", numeric: true },
  { key: "adds", label: "Dodato", numeric: true },
  { key: "addRate", label: "Stopa", numeric: true },
  { key: "orders", label: "Porudžbine", numeric: true },
  { key: "revenue", label: "Prihod", numeric: true },
];

export function RulesTable({ rows }: { rows: RuleRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "sr-RS")
        : Number(av) - Number(bv);
    return asc ? cmp : -cmp;
  });

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    // Brojevi se prvo gledaju odozgo, nazivi abecedno.
    setAsc(key === "name");
  }

  return (
    <>
      {/* desktop */}
      <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              {COLUMNS.map((col) => (
                <TableHead key={col.key} className={col.numeric ? "text-right" : undefined}>
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
              <TableHead>Mesta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant={r.active ? "success" : "warning"}>
                    {r.active ? "Aktivno" : "Pauzirano"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/ponude/${encodeURIComponent(r.id)}`}
                    className="text-ink hover:text-green font-medium break-words"
                  >
                    {r.name}
                  </Link>
                  {r.offerName ? (
                    <div className="text-ink-faint mt-0.5 text-xs break-words">
                      {r.offerName}
                      {r.offerSku ? ` · ${r.offerSku}` : ""}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="num text-right">{r.priority}</TableCell>
                <TableCell className="num text-right">{num(r.impressions)}</TableCell>
                <TableCell className="num text-right">{num(r.adds)}</TableCell>
                <TableCell className="num text-right">{rate(r.addRate)}</TableCell>
                <TableCell className="num text-right">{num(r.orders)}</TableCell>
                <TableCell className="num text-ink text-right font-semibold">
                  {rsd(Math.round(r.revenue))}
                </TableCell>
                <TableCell className="text-ink-soft text-xs">
                  {r.placements.length > 0 ? r.placements.map(placementLabel).join(" · ") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* telefon */}
      <MobileCardList>
        {sorted.map((r) => (
          <MobileCard key={r.id} href={`/ponude/${encodeURIComponent(r.id)}`} ariaLabel={r.name}>
            <MobileCardHeader
              title={<span className="break-words">{r.name}</span>}
              subtitle={
                r.placements.length > 0 ? r.placements.map(placementLabel).join(" · ") : undefined
              }
              trailing={
                <Badge variant={r.active ? "success" : "warning"}>
                  {r.active ? "Aktivno" : "Pauzirano"}
                </Badge>
              }
            />
            <div className="mt-3 space-y-1.5">
              <MobileCardField label="Prikazi">
                <span className="num">{num(r.impressions)}</span>
              </MobileCardField>
              <MobileCardField label="Dodato">
                <span className="num">
                  {num(r.adds)} <span className="text-ink-faint">({rate(r.addRate)})</span>
                </span>
              </MobileCardField>
              <MobileCardField label="Porudžbine">
                <span className="num">{num(r.orders)}</span>
              </MobileCardField>
              <MobileCardField label="Prihod">
                <span className="num font-semibold">{rsd(Math.round(r.revenue))}</span>
              </MobileCardField>
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
    </>
  );
}
