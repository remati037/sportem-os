"use client";

import Link from "next/link";
import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ImageIcon, Package } from "lucide-react";

import type { Role } from "@/lib/auth";
import {
  isVariantLowStock,
  isVariantUncounted,
  type ProductWithVariants,
  type VariantRow,
} from "@/db/catalog-types";
import { catalogImageUrl } from "@/lib/image-url";
import { rsd } from "@/lib/format";
import { DataTable } from "@/components/patterns/data-table";
import { DataTableColumnHeader } from "@/components/patterns/data-table-column-header";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
} from "@/components/patterns/mobile-card-list";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { StockCountControl } from "./stock-count-control";

type CatalogRow = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  categoryName: string | null;
  variantCount: number;
  totalStock: number;
  lowStock: boolean;
  /** Broj aktivnih varijanti kojima količina nikad nije uneta. */
  uncounted: number;
  /** Jedina aktivna varijanta (brz popis iz liste, bez ulaska u detalj). */
  soleVariant: VariantRow | null;
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
    uncounted: active.filter(isVariantUncounted).length,
    soleVariant: active.length === 1 ? active[0] : null,
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
  initialUncountedOnly = false,
}: {
  products: ProductWithVariants[];
  role: Role;
  categories: { id: string; name: string }[];
  /** `?popis=fali` (npr. link sa Dashboarda) → filter je odmah uključen. */
  initialUncountedOnly?: boolean;
}) {
  const canSeeFinance = role === "admin" || role === "manager";
  const canCount = role === "admin" || role === "logistics";
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState(ALL_CATEGORIES);
  const [lowStockOnly, setLowStockOnly] = React.useState(false);
  const [uncountedOnly, setUncountedOnly] = React.useState(initialUncountedOnly);

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
      if (uncountedOnly && r.uncounted === 0) return false;
      return true;
    });
  }, [allRows, products, search, categoryId, lowStockOnly, uncountedOnly]);

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
        meta: { wrap: true },
      },
      {
        accessorKey: "categoryName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Kategorija" />,
        cell: ({ row }) => row.original.categoryName ?? <span className="text-ink-faint">—</span>,
        meta: { wrap: true },
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
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col items-end gap-1">
            {/* Proizvod sa jednom varijantom se popisuje odmah iz liste;
                za više varijanti popis ide na detalju proizvoda. */}
            {canCount && r.soleVariant ? (
              <StockCountControl
                variantId={r.soleVariant.id}
                productId={r.id}
                stockQuantity={r.soleVariant.stock_quantity}
                countedAt={r.soleVariant.stock_counted_at}
              />
            ) : (
              <span>{r.totalStock}</span>
            )}
            {r.lowStock || r.uncounted > 0 ? (
              <span className="flex items-center gap-1">
                {r.lowStock ? <Badge variant="warning">Nisko</Badge> : null}
                {r.uncounted > 0 ? (
                  <Badge>
                    {r.soleVariant ? "Fali količina" : `Fali količina · ${r.uncounted}`}
                  </Badge>
                ) : null}
              </span>
            ) : null}
          </div>
        );
      },
      meta: { align: "right", numeric: true },
    });

    return cols;
  }, [canSeeFinance, canCount]);

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
        <label className="text-ink-soft flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={uncountedOnly}
            onChange={(e) => setUncountedOnly(e.target.checked)}
            className="accent-green size-4"
          />
          Fali količina
        </label>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        initialSorting={[{ id: "name", desc: false }]}
        pagination={{ pageSize: 25, itemsLabel: "proizvoda" }}
        empty={
          <EmptyState
            icon={<Package />}
            title="Nema proizvoda"
            description="Nijedan proizvod ne odgovara filterima."
            className="border-0 shadow-none"
          />
        }
        renderMobileCard={(row) => {
          const p = row.original;
          return (
            <MobileCard href={`/katalog/${p.id}`} ariaLabel={p.name}>
              <MobileCardHeader
                leading={<Thumb image={p.image} name={p.name} />}
                title={
                  <span className="flex items-center gap-2">
                    {p.name}
                    {p.archived ? <Badge variant="warning">Arhiviran</Badge> : null}
                  </span>
                }
                subtitle={p.brand ?? undefined}
              />
              <div className="mt-3 space-y-1.5">
                <MobileCardField label="Kategorija">
                  {p.categoryName ?? "—"}
                </MobileCardField>
                <MobileCardField label="Stanje">
                  <span className="num inline-flex flex-col items-end gap-1">
                    {canCount && p.soleVariant ? (
                      // Iznad overlay linka kartice (v. MobileCard) da bi bio klikabilan.
                      <span className="relative z-10">
                        <StockCountControl
                          variantId={p.soleVariant.id}
                          productId={p.id}
                          stockQuantity={p.soleVariant.stock_quantity}
                          countedAt={p.soleVariant.stock_counted_at}
                        />
                      </span>
                    ) : (
                      <span>{p.totalStock}</span>
                    )}
                    {p.lowStock || p.uncounted > 0 ? (
                      <span className="flex items-center gap-1">
                        {p.lowStock ? <Badge variant="warning">Nisko</Badge> : null}
                        {p.uncounted > 0 ? (
                          <Badge>
                            {p.soleVariant ? "Fali količina" : `Fali količina · ${p.uncounted}`}
                          </Badge>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </MobileCardField>
                {canSeeFinance ? (
                  <MobileCardField label="MP">
                    <span className="num">
                      {p.mpMin == null || p.mpMax == null
                        ? "—"
                        : p.mpMin === p.mpMax
                          ? rsd(p.mpMin)
                          : `${rsd(p.mpMin)} – ${rsd(p.mpMax)}`}
                    </span>
                  </MobileCardField>
                ) : null}
              </div>
            </MobileCard>
          );
        }}
      />
    </div>
  );
}
