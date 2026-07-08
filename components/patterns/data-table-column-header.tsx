import type { Column } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/* Sortabilni header za DataTable (shadcn recept, prilagođen brendu).
   Ako kolona nije sortabilna, renderuje običan naslov. */
function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  align = "left",
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
  align?: "left" | "right";
}) {
  if (!column.getCanSort()) {
    return <span className={cn(align === "right" && "block text-right", className)}>{title}</span>;
  }

  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn(
        "text-ink-faint hover:text-ink focus-visible:ring-green/20 inline-flex items-center gap-1.5 rounded-sm transition-colors outline-none focus-visible:ring-[3px]",
        align === "right" && "flex-row-reverse",
        className,
      )}
    >
      <span>{title}</span>
      {sorted === "asc" ? (
        <ArrowUpIcon className="size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon className="size-3.5" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 opacity-60" />
      )}
    </button>
  );
}

export { DataTableColumnHeader };
