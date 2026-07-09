"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RowActions } from "@/components/patterns/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import {
  archiveProduct,
  deleteProduct,
  unarchiveProduct,
  type CatalogActionState,
} from "./actions";
import { ProductFormDialog } from "./product-form";

type ProductData = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category_id: string | null;
  attribute_names: string[];
  image: string | null;
  archived: boolean;
};

export function ProductActions({
  product,
  categories,
}: {
  product: ProductData;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function run(fn: () => Promise<CatalogActionState>, redirectToList = false) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      if (redirectToList) router.push("/katalog");
      else router.refresh();
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
          onSelect={() =>
            run(() => (product.archived ? unarchiveProduct(product.id) : archiveProduct(product.id)))
          }
        >
          {product.archived ? <ArchiveRestore /> : <Archive />}
          {product.archived ? "Vrati iz arhive" : "Arhiviraj"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => {
            if (confirm(`Obrisati proizvod „${product.name}"? Ako ima varijante, biće arhiviran.`))
              run(() => deleteProduct(product.id), true);
          }}
        >
          <Trash2 /> Obriši
        </DropdownMenuItem>
      </RowActions>

      <ProductFormDialog
        mode="edit"
        product={product}
        categories={categories}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
