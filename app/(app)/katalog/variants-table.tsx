"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive, ArchiveRestore, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { isVariantLowStock, type VariantRow } from "@/db/catalog-types";
import { catalogImageUrl } from "@/lib/image-url";
import { rsd } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function VariantsTable({
  productId,
  variants,
  canSeeFinance,
  isAdmin,
}: {
  productId: string;
  variants: VariantRow[];
  canSeeFinance: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
    <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="eyebrow bg-surface-2 h-9 px-4">Slika</TableHead>
            <TableHead className="eyebrow bg-surface-2 h-9 px-4">SKU</TableHead>
            <TableHead className="eyebrow bg-surface-2 h-9 px-4">Varijanta</TableHead>
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
            const url = catalogImageUrl(v.image);
            const archived = v.archived_at != null;
            return (
              <TableRow key={v.id} className="border-border hover:bg-green-soft">
                <TableCell className="px-4 py-2">
                  <div className="border-border bg-surface-2 relative flex size-9 items-center justify-center overflow-hidden rounded-md border">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <ImageIcon className="text-ink-faint size-4" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <span className="num text-ink font-medium">{v.sku}</span>
                  {archived ? (
                    <Badge variant="warning" className="ml-2">
                      Arhivirana
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-ink-soft px-4 py-2.5">{v.variant_name ?? "—"}</TableCell>
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
                    <div className="flex items-center justify-end gap-1">
                      <VariantFormDialog
                        mode="edit"
                        productId={productId}
                        variant={v}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Izmeni varijantu">
                            <Pencil />
                          </Button>
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label={archived ? "Vrati iz arhive" : "Arhiviraj"}
                        onClick={() =>
                          run(() => (archived ? unarchiveVariant(v.id) : archiveVariant(v.id)))
                        }
                      >
                        {archived ? <ArchiveRestore /> : <Archive />}
                      </Button>
                      <Button
                        variant="danger"
                        size="icon-sm"
                        disabled={pending}
                        aria-label="Obriši varijantu"
                        onClick={() => {
                          if (
                            confirm(
                              `Obrisati varijantu „${v.sku}"? Ako ima porudžbine, biće arhivirana.`,
                            )
                          )
                            run(() => deleteVariant(v.id));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
