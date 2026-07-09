"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { todayBelgrade } from "@/lib/date-belgrade";
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

import { createExpense, updateExpense, type ExpenseActionState } from "./actions";
import { AttachmentInput } from "./attachment-input";

const initial: ExpenseActionState = { error: null };
const NO_CATEGORY = "none";

type Category = { id: string; name: string };

type ExpenseData = {
  id: string;
  amount: number;
  date: string;
  category_id: string | null;
  description: string | null;
  attachment_path: string | null;
};

export function ExpenseDialog({
  categories,
  expense,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  categories: Category[];
  expense?: ExpenseData;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange?.(o) : setUncontrolledOpen(o));

  const isEdit = Boolean(expense);
  const [category, setCategory] = useState(expense?.category_id ?? NO_CATEGORY);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = isEdit
        ? await updateExpense(initial, fd)
        : await createExpense(initial, fd);
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
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Izmeni trošak" : "Novi trošak"}</DialogTitle>
          <DialogDescription>
            Troškovi ulaze u neto profit, nikad u fakturu. Iznos u RSD (bez decimala).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={expense!.id} /> : null}
          <input type="hidden" name="category_id" value={category} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Iznos (RSD)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="1"
                min="0"
                required
                defaultValue={expense ? String(expense.amount) : ""}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Datum</Label>
              <Input
                id="date"
                name="date"
                type="date"
                required
                defaultValue={expense?.date ?? todayBelgrade()}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category_select">Kategorija</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category_select" className="h-10 w-full">
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

          <div className="space-y-1.5">
            <Label htmlFor="description">Opis (opciono)</Label>
            <Input
              id="description"
              name="description"
              defaultValue={expense?.description ?? ""}
              placeholder="npr. Facebook reklame, avgust"
            />
          </div>

          <AttachmentInput hasCurrent={Boolean(expense?.attachment_path)} />

          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              {isEdit ? "Sačuvaj izmene" : "Dodaj trošak"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
