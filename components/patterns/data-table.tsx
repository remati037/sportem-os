"use client";

import * as React from "react";
import {
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/patterns/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";

/* Poravnanje/numeričke kolone se deklarišu kroz column meta:
   { meta: { align: "right", numeric: true } } → ćelija dobija text-right + .num.
   (docs/Sportem-Dizajn-Sistem.md, sekcija 4 — numeričke kolone desno, tnum.) */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    numeric?: boolean;
    /** Dozvoli prelamanje sadržaja ćelije (podrazumevano je nowrap). */
    wrap?: boolean;
  }
}

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Ako je zadato, prikazuje polje za pretragu koje filtrira tu kolonu. */
  searchKey?: string;
  searchPlaceholder?: string;
  initialSorting?: SortingState;
  /** Sadržaj praznog stanja kad nema (filtriranih) redova. */
  empty?: React.ReactNode;
  /** Max visina scroll kontejnera (sticky header). Default 24rem. */
  maxHeight?: string;
  /** Ako je zadat, na mobilnom (`md:hidden`) prikazuje kartice umesto horizontalnog skrola. */
  renderMobileCard?: (row: Row<TData>) => React.ReactNode;
  /** Klijentska paginacija (kao lista porudžbina). Isključuje interni vertikalni scroll. */
  pagination?: { pageSize?: number; itemsLabel?: string };
};

function cellAlign(align?: "left" | "right", numeric?: boolean) {
  return cn(align === "right" && "text-right", numeric && "num");
}

function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Pretraga…",
  initialSorting = [],
  empty,
  maxHeight = "24rem",
  renderMobileCard,
  pagination,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, ...(searchKey ? { globalFilter } : {}) },
    initialState: pagination
      ? { pagination: { pageIndex: 0, pageSize: pagination.pageSize ?? 25 } }
      : undefined,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel(), autoResetPageIndex: true } : {}),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      {searchKey ? (
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="max-w-xs"
        />
      ) : null}

      {renderMobileCard ? (
        <div className="space-y-2 md:hidden">
          {rows.length ? (
            rows.map((row) => <React.Fragment key={row.id}>{renderMobileCard(row)}</React.Fragment>)
          ) : (
            <div className="border-border bg-surface shadow-soft rounded-lg border">
              {empty ?? (
                <EmptyState
                  title="Nema rezultata"
                  description="Nema redova za prikaz."
                  className="border-0 shadow-none"
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      <div
        className={cn(
          "border-border bg-surface shadow-soft overflow-hidden rounded-lg border",
          renderMobileCard && "hidden md:block",
        )}
      >
        <div className="overflow-auto" style={pagination ? undefined : { maxHeight }}>
          <Table>
            <TableHeader className="[&_tr]:border-border">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "eyebrow bg-surface-2 sticky top-0 z-10 h-9 px-4",
                          cellAlign(meta?.align, false),
                        )}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((row) => (
                  <TableRow key={row.id} className="border-border hover:bg-green-soft">
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "text-ink px-4 py-2.5 text-[0.9375rem]",
                            meta?.wrap && "whitespace-normal",
                            cellAlign(meta?.align, meta?.numeric),
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="p-0">
                    {empty ?? (
                      <EmptyState
                        title="Nema rezultata"
                        description="Nema redova za prikaz."
                        className="border-0 shadow-none"
                      />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {pagination ? <DataTablePagination table={table} itemsLabel={pagination.itemsLabel} /> : null}
    </div>
  );
}

export { DataTable };
export type { DataTableProps };
