"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

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
    <div className="flex flex-wrap items-center gap-2">
      <ProductFormDialog
        mode="edit"
        product={product}
        categories={categories}
        trigger={
          <Button variant="ghost" size="sm">
            <Pencil /> Izmeni
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(() => (product.archived ? unarchiveProduct(product.id) : archiveProduct(product.id)))
        }
      >
        {product.archived ? (
          <>
            <ArchiveRestore /> Vrati iz arhive
          </>
        ) : (
          <>
            <Archive /> Arhiviraj
          </>
        )}
      </Button>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm(`Obrisati proizvod „${product.name}"? Ako ima varijante, biće arhiviran.`))
            run(() => deleteProduct(product.id), true);
        }}
      >
        <Trash2 /> Obriši
      </Button>
    </div>
  );
}
