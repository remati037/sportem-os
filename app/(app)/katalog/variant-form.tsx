"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { catalogImageUrl } from "@/lib/image-url";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createVariant, updateVariant, type CatalogActionState } from "./actions";
import { ImageInput } from "./image-input";

const initial: CatalogActionState = { error: null };

type VariantData = {
  id: string;
  sku: string;
  variant_name: string | null;
  mp_price?: number;
  vp_price?: number;
  stock_quantity: number;
  low_stock_threshold: number;
  supplier_sku: string | null;
  weight_grams: number | null;
  image: string | null;
};

export function VariantFormDialog({
  mode,
  productId,
  variant,
  trigger,
}: {
  mode: "create" | "edit";
  productId: string;
  variant?: VariantData;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const action = mode === "create" ? createVariant : updateVariant;
      const result = await action(initial, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nova varijanta" : "Izmena varijante"}</DialogTitle>
          <DialogDescription>
            SKU je jedinstven. Cene su u RSD (bez decimala). Zarada se računa automatski.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <input type="hidden" name="product_id" value={productId} />
          {mode === "edit" && variant ? <input type="hidden" name="id" value={variant.id} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                name="sku"
                required
                defaultValue={variant?.sku ?? ""}
                placeholder="SM021-42"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variant_name">Naziv varijante</Label>
              <Input
                id="variant_name"
                name="variant_name"
                defaultValue={variant?.variant_name ?? ""}
                placeholder="Broj 42"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mp_price">MP cena (RSD)</Label>
              <Input
                id="mp_price"
                name="mp_price"
                required
                inputMode="numeric"
                className="num text-right"
                defaultValue={variant?.mp_price ?? ""}
                placeholder="9990"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp_price">VP cena (RSD)</Label>
              <Input
                id="vp_price"
                name="vp_price"
                required
                inputMode="numeric"
                className="num text-right"
                defaultValue={variant?.vp_price ?? ""}
                placeholder="6500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stanje</Label>
              <Input
                id="stock_quantity"
                name="stock_quantity"
                inputMode="numeric"
                className="num text-right"
                defaultValue={variant?.stock_quantity ?? 0}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="low_stock_threshold">Prag niskog stanja</Label>
              <Input
                id="low_stock_threshold"
                name="low_stock_threshold"
                inputMode="numeric"
                className="num text-right"
                defaultValue={variant?.low_stock_threshold ?? 5}
                placeholder="5"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="supplier_sku">Šifra dobavljača</Label>
              <Input
                id="supplier_sku"
                name="supplier_sku"
                defaultValue={variant?.supplier_sku ?? ""}
                placeholder="opciono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight_grams">Težina (g)</Label>
              <Input
                id="weight_grams"
                name="weight_grams"
                inputMode="numeric"
                className="num text-right"
                defaultValue={variant?.weight_grams ?? ""}
                placeholder="800"
              />
            </div>
          </div>

          <ImageInput currentUrl={catalogImageUrl(variant?.image)} />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Čuvanje…" : mode === "create" ? "Dodaj varijantu" : "Sačuvaj izmene"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
