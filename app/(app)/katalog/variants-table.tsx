"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { isVariantLowStock, type VariantRow } from "@/db/catalog-types";
import { catalogImageUrl } from "@/lib/image-url";
import { rsd } from "@/lib/format";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import { RowActions } from "@/components/patterns/row-actions";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  archiveVariant,
  deleteVariant,
  unarchiveVariant,
  type CatalogActionState,
} from "./actions";
import { VariantFormDialog } from "./variant-form";

function VariantThumb({ image }: { image: string | null }) {
  const url = catalogImageUrl(image);
  return (
    <div className="border-border bg-surface-2 relative flex size-9 items-center justify-center overflow-hidden rounded-md border">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <ImageIcon className="text-ink-faint size-4" />
      )}
    </div>
  );
}

/** „⋮" akcije za varijantu (Izmeni / Arhiviraj / Obriši) — deljeno između tabele i kartice. */
function VariantActions({
  productId,
  attributeNames,
  variant,
}: {
  productId: string;
  attributeNames: string[];
  variant: VariantRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const archived = variant.archived_at != null;

  function run(fn: () => Promise<CatalogActionState>) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Sačuvano.");
        router.refresh();
      }
    });
  }

  return (
    <>
      <RowActions>
        <DropdownMenuItem onSelect={() => setEditOpen(true)}>
          <Pencil /> Izmeni
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={() => run(() => (archived ? unarchiveVariant(variant.id) : archiveVariant(variant.id)))}
        >
          {archived ? <ArchiveRestore /> : <Archive />}
          {archived ? "Vrati iz arhive" : "Arhiviraj"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => {
            if (confirm(`Obrisati varijantu „${variant.sku}"? Ako ima porudžbine, biće arhivirana.`))
              run(() => deleteVariant(variant.id));
          }}
        >
          <Trash2 /> Obriši
        </DropdownMenuItem>
      </RowActions>

      <VariantFormDialog
        mode="edit"
        productId={productId}
        attributeNames={attributeNames}
        variant={variant}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}

export function VariantsTable({
  productId,
  attributeNames,
  variants,
  canSeeFinance,
  isAdmin,
}: {
  productId: string;
  attributeNames: string[];
  variants: VariantRow[];
  canSeeFinance: boolean;
  isAdmin: boolean;
}) {
  return (
    <>
      {/* Desktop tabela */}
      <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Slika</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">SKU</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Varijanta</TableHead>
              {attributeNames.map((a) => (
                <TableHead key={a} className="eyebrow bg-surface-2 h-9 px-4">
                  {a}
                </TableHead>
              ))}
              {canSeeFinance ? (
                <>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">MP</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">VP</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Zarada</TableHead>
                </>
              ) : null}
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Stanje</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Težina</TableHead>
              {isAdmin ? <TableHead className="eyebrow bg-surface-2 h-9 px-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) => {
              const archived = v.archived_at != null;
              return (
                <TableRow key={v.id} className="border-border hover:bg-green-soft">
                  <TableCell className="px-4 py-2">
                    <VariantThumb image={v.image} />
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span className="num text-ink font-medium">{v.sku}</span>
                    {archived ? (
                      <Badge variant="warning" className="ml-2">
                        Arhivirana
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-ink-soft px-4 py-2.5">
                    {v.variant_name ?? "—"}
                  </TableCell>
                  {attributeNames.map((a) => (
                    <TableCell key={a} className="text-ink px-4 py-2.5">
                      {v.attributes?.[a] || "—"}
                    </TableCell>
                  ))}
                  {canSeeFinance ? (
                    <>
                      <TableCell className="num px-4 py-2.5 text-right">
                        {typeof v.mp_price === "number" ? rsd(v.mp_price) : "—"}
                      </TableCell>
                      <TableCell className="num px-4 py-2.5 text-right">
                        {typeof v.vp_price === "number" ? rsd(v.vp_price) : "—"}
                      </TableCell>
                      <TableCell className="num text-green-deep px-4 py-2.5 text-right font-medium">
                        {typeof v.profit === "number" ? rsd(v.profit) : "—"}
                      </TableCell>
                    </>
                  ) : null}
                  <TableCell className="num px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      {v.stock_quantity}
                      {isVariantLowStock(v) ? <Badge variant="warning">Nisko</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="num text-ink-soft px-4 py-2.5 text-right">
                    {v.weight_grams ? `${v.weight_grams} g` : "—"}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell className="px-4 py-2">
                      <div className="flex items-center justify-end">
                        <VariantActions
                          productId={productId}
                          attributeNames={attributeNames}
                          variant={v}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobilne kartice */}
      <MobileCardList>
        {variants.map((v) => {
          const archived = v.archived_at != null;
          return (
            <MobileCard key={v.id}>
              <MobileCardHeader
                leading={<VariantThumb image={v.image} />}
                title={
                  <span className="flex items-center gap-2">
                    <span className="num">{v.sku}</span>
                    {archived ? <Badge variant="warning">Arhivirana</Badge> : null}
                  </span>
                }
                subtitle={v.variant_name ?? undefined}
                trailing={
                  isAdmin ? (
                    <VariantActions
                      productId={productId}
                      attributeNames={attributeNames}
                      variant={v}
                    />
                  ) : undefined
                }
              />
              <div className="mt-3 space-y-1.5">
                <MobileCardField label="Stanje">
                  <span className="num inline-flex items-center gap-2">
                    {v.stock_quantity}
                    {isVariantLowStock(v) ? <Badge variant="warning">Nisko</Badge> : null}
                  </span>
                </MobileCardField>
                {canSeeFinance ? (
                  <>
                    <MobileCardField label="MP">
                      <span className="num">
                        {typeof v.mp_price === "number" ? rsd(v.mp_price) : "—"}
                      </span>
                    </MobileCardField>
                    <MobileCardField label="Zarada">
                      <span className="num text-green-deep font-medium">
                        {typeof v.profit === "number" ? rsd(v.profit) : "—"}
                      </span>
                    </MobileCardField>
                  </>
                ) : null}
                {v.weight_grams ? (
                  <MobileCardField label="Težina">
                    <span className="num">{v.weight_grams} g</span>
                  </MobileCardField>
                ) : null}
              </div>
            </MobileCard>
          );
        })}
      </MobileCardList>
    </>
  );
}
