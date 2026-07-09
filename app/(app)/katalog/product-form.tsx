"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { catalogImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createProduct, updateProduct, type CatalogActionState } from "./actions";
import { ImageInput } from "./image-input";

const initial: CatalogActionState = { error: null };
const NO_CATEGORY = "none";

type ProductData = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category_id: string | null;
  image: string | null;
};

export function ProductFormDialog({
  mode,
  product,
  categories,
  trigger,
}: {
  mode: "create" | "edit";
  product?: ProductData;
  categories: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(product?.category_id ?? NO_CATEGORY);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const action = mode === "create" ? createProduct : updateProduct;
      const result = await action(initial, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      setOpen(false);
      if (mode === "create" && result.id) router.push(`/katalog/${result.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novi proizvod" : "Izmena proizvoda"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Nakon čuvanja otvara se proizvod da dodate varijante."
              : "Izmenite podatke proizvoda."}
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          {mode === "edit" && product ? <input type="hidden" name="id" value={product.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="name">Naziv</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={product?.name ?? ""}
              placeholder="Nike Revolution 6"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand">Brend</Label>
            <Input id="brand" name="brand" defaultValue={product?.brand ?? ""} placeholder="Nike" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category_id">Kategorija</Label>
            <input type="hidden" name="category_id" value={category} />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category_id" className="h-10 w-full">
                <SelectValue placeholder="Izaberi kategoriju…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Bez kategorije</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Opis</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={product?.description ?? ""}
              placeholder="Kratak opis (opciono)"
              className={cn(
                "text-ink border-input bg-surface flex w-full rounded-md border px-3 py-2 text-[0.9375rem] outline-none",
                "placeholder:text-ink-faint focus-visible:border-green focus-visible:ring-green/20 focus-visible:ring-[3px]",
              )}
            />
          </div>

          <ImageInput currentUrl={catalogImageUrl(product?.image)} />

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Čuvanje…" : mode === "create" ? "Sačuvaj proizvod" : "Sačuvaj izmene"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
