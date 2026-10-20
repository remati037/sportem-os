"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import { rate } from "@/lib/offers/labels";
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

import { statusBadge } from "./status-badge";

/*
 * Tabela paketa sa sortiranjem (podrazumevano redosled sa sajta: objavljeni
 * prvo). Klijentska je samo zbog sortiranja — podaci stižu gotovi sa servera.
 * Na telefonu prelazi u kartice.
 */

export type PackageRow = {
  id: number;
  title: string;
  status: string | null;
  fromPrice: number | null;
  views: number;
  addRate: number;
  orders: number;
  orderRate: number;
  revenue: number;
  aov: number;
};

type SortKey =
  "title" | "fromPrice" | "views" | "addRate" | "orders" | "orderRate" | "revenue" | "aov";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "title", label: "Paket", numeric: false },
  { key: "fromPrice", label: "Cena od", numeric: true },
  { key: "views", label: "Pregledi", numeric: true },
  { key: "addRate", label: "Dodaje", numeric: true },
  { key: "orders", label: "Porudžbine", numeric: true },
  { key: "orderRate", label: "Kupuje", numeric: true },
  { key: "revenue", label: "Prihod", numeric: true },
  { key: "aov", label: "Prosečna porudžbina", numeric: true },
];

export function PackagesTable({ rows, days }: { rows: PackageRow[]; days: number }) {
  // null = redosled kakav je stigao sa servera (objavljeni prvo, pa redosled sa sajta).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [asc, setAsc] = useState(false);

  const sorted =
    sortKey === null
      ? rows
      : [...rows].sort((a, b) => {
          const av = a[sortKey];
          const bv = b[sortKey];
          const cmp =
            typeof av === "string" && typeof bv === "string"
              ? av.localeCompare(bv, "sr-RS")
              : Number(av ?? 0) - Number(bv ?? 0);
          return asc ? cmp : -cmp;
        });

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    setAsc(key === "title");
  }

  const href = (id: number) => `/ponude/paketi/${id}?dana=${days}`;

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{statusBadge(r.status)}</TableCell>
                <TableCell>
                  <Link
                    href={href(r.id)}
                    className="text-ink hover:text-green font-medium break-words"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell className="num text-right">
                  {r.fromPrice === null ? "—" : rsd(r.fromPrice)}
                </TableCell>
                <TableCell className="num text-right">{num(r.views)}</TableCell>
                <TableCell className="num text-right">{rate(r.addRate)}</TableCell>
                <TableCell className="num text-right">{num(r.orders)}</TableCell>
                <TableCell className="num text-right">{rate(r.orderRate)}</TableCell>
                <TableCell className="num text-ink text-right font-semibold">
                  {rsd(Math.round(r.revenue))}
                </TableCell>
                <TableCell className="num text-right">
                  {r.orders === 0 ? "—" : rsd(Math.round(r.aov))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* telefon */}
      <MobileCardList>
        {sorted.map((r) => (
          <MobileCard key={r.id} href={href(r.id)} ariaLabel={r.title}>
            <MobileCardHeader
              title={<span className="break-words">{r.title}</span>}
              subtitle={r.fromPrice === null ? undefined : `od ${rsd(r.fromPrice)}`}
              trailing={statusBadge(r.status)}
            />
            <div className="mt-3 space-y-1.5">
              <MobileCardField label="Pregledi">
                <span className="num">{num(r.views)}</span>
              </MobileCardField>
              <MobileCardField label="Dodaje u korpu">
                <span className="num">{rate(r.addRate)}</span>
              </MobileCardField>
              <MobileCardField label="Porudžbine">
                <span className="num">
                  {num(r.orders)} <span className="text-ink-faint">({rate(r.orderRate)})</span>
                </span>
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
