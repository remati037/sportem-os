"use client";

import Link from "next/link";
import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ImageIcon, Package } from "lucide-react";

import type { Role } from "@/lib/auth";
import { isVariantLowStock, type ProductWithVariants } from "@/db/catalog-types";
import { catalogImageUrl } from "@/lib/image-url";
import { rsd } from "@/lib/format";
import { DataTable } from "@/components/patterns/data-table";
import { DataTableColumnHeader } from "@/components/patterns/data-table-column-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CatalogRow = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  categoryName: string | null;
  variantCount: number;
  totalStock: number;
  lowStock: boolean;
  archived: boolean;
  skus: string;
  mpMin: number | null;
  mpMax: number | null;
};

const ALL_CATEGORIES = "all";

function toRow(p: ProductWithVariants): CatalogRow {
  const active = p.variants.filter((v) => v.archived_at == null);
  const prices = active.map((v) => v.mp_price).filter((n): n is number => typeof n === "number");
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    image: p.image,
    categoryName: p.category?.name ?? null,
    variantCount: active.length,
    totalStock: active.reduce((s, v) => s + v.stock_quantity, 0),
    lowStock: active.some(isVariantLowStock),
    archived: p.archived_at != null,
    skus: p.variants.map((v) => v.sku).join(" "),
    mpMin: prices.length ? Math.min(...prices) : null,
    mpMax: prices.length ? Math.max(...prices) : null,
  };
}

function Thumb({ image, name }: { image: string | null; name: string }) {
  const url = catalogImageUrl(image);
  return (
    <div className="border-border bg-surface-2 relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="absolute inset-0 size-full object-cover" />
      ) : (
        <ImageIcon className="text-ink-faint size-4" />
      )}
    </div>
  );
}

export function CatalogTable({
  products,
  role,
  categories,
}: {
  products: ProductWithVariants[];
  role: Role;
  categories: { id: string; name: string }[];
}) {
  const canSeeFinance = role === "admin" || role === "manager";
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState(ALL_CATEGORIES);
  const [lowStockOnly, setLowStockOnly] = React.useState(false);

  const allRows = React.useMemo(() => products.map(toRow), [products]);

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.brand ?? ""} ${r.skus}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (categoryId !== ALL_CATEGORIES) {
        const match = products.find((p) => p.id === r.id)?.category_id === categoryId;
        if (!match) return false;
      }
      if (lowStockOnly && !r.lowStock) return false;
      return true;
    });
  }, [allRows, products, search, categoryId, lowStockOnly]);

  const columns = React.useMemo<ColumnDef<CatalogRow>[]>(() => {
    const cols: ColumnDef<CatalogRow>[] = [
      {
        id: "image",
        header: "",
        cell: ({ row }) => <Thumb image={row.original.image} name={row.original.name} />,
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Proizvod" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/katalog/${row.original.id}`}
              className="text-ink hover:text-green font-medium"
            >
              {row.original.name}
            </Link>
            <div className="text-ink-faint flex items-center gap-2 text-xs">
              {row.original.brand ? <span>{row.original.brand}</span> : null}
              {row.original.archived ? <Badge variant="warning">Arhiviran</Badge> : null}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "categoryName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Kategorija" />,
        cell: ({ row }) => row.original.categoryName ?? <span className="text-ink-faint">—</span>,
      },
      {
        accessorKey: "variantCount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Varijante" />,
        meta: { align: "right", numeric: true },
      },
    ];

    if (canSeeFinance) {
      cols.push({
        id: "mp",
        accessorFn: (r) => r.mpMin ?? 0,
        header: ({ column }) => <DataTableColumnHeader column={column} title="MP" />,
        cell: ({ row }) => {
          const { mpMin, mpMax } = row.original;
          if (mpMin == null || mpMax == null) return <span className="text-ink-faint">—</span>;
          return mpMin === mpMax ? rsd(mpMin) : `${rsd(mpMin)} – ${rsd(mpMax)}`;
        },
        meta: { align: "right", numeric: true },
      });
    }

    cols.push({
      accessorKey: "totalStock",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stanje" />,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {row.original.totalStock}
          {row.original.lowStock ? <Badge variant="warning">Nisko</Badge> : null}
        </span>
      ),
      meta: { align: "right", numeric: true },
    });

    return cols;
  }, [canSeeFinance]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraga po nazivu, brendu ili SKU…"
          className="max-w-xs"
        />
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-10 w-48">
            <SelectValue placeholder="Kategorija" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>Sve kategorije</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="text-ink-soft flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="accent-green size-4"
          />
          Samo nisko stanje
        </label>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        initialSorting={[{ id: "name", desc: false }]}
        empty={
          <EmptyState
            icon={<Package />}
            title="Nema proizvoda"
            description="Nijedan proizvod ne odgovara filterima."
            className="border-0 shadow-none"
          />
        }
      />
    </div>
  );
}
