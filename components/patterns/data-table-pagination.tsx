"use client";

import { type Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

/*
 * Klijentska paginacija za DataTable — isti izgled kao OrdersPagination
 * (URL-driven, lista porudžbina), ali radi nad tanstack table state-om
 * (podaci su već svi na klijentu).
 */
export function DataTablePagination<TData>({
  table,
  itemsLabel = "redova",
}: {
  table: Table<TData>;
  itemsLabel?: string;
}) {
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalPages = Math.max(1, table.getPageCount());
  const current = Math.min(pageIndex + 1, totalPages);

  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="text-ink-soft flex items-center gap-2 text-sm">
        <span>Redova po strani:</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => table.setPageSize(Number(v))}
        >
          <SelectTrigger className="h-8 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-ink-soft text-sm">
        <span className="num">{num(firstRow)}</span>–<span className="num">{num(lastRow)}</span> od{" "}
        <span className="num text-ink font-medium">{num(total)}</span> {itemsLabel}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-ink-soft mr-1 text-sm">
          Strana <span className="num text-ink font-medium">{num(current)}</span> /{" "}
          <span className="num">{num(totalPages)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!table.getCanPreviousPage()}
          aria-label="Prva strana"
          onClick={() => table.setPageIndex(0)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!table.getCanPreviousPage()}
          aria-label="Prethodna strana"
          onClick={() => table.previousPage()}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!table.getCanNextPage()}
          aria-label="Sledeća strana"
          onClick={() => table.nextPage()}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!table.getCanNextPage()}
          aria-label="Poslednja strana"
          onClick={() => table.setPageIndex(totalPages - 1)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}
