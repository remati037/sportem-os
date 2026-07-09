"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  createExpenseCategory,
  deleteExpenseCategory,
  updateExpenseCategory,
  type ExpenseActionState,
} from "./actions";

const initial: ExpenseActionState = { error: null };

type Category = { id: string; name: string };

export function CategoryManager({
  categories,
  trigger,
}: {
  categories: Category[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const addRef = useRef<HTMLInputElement>(null);

  function run(fn: () => Promise<ExpenseActionState>, onOk?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      onOk?.();
      router.refresh();
    });
  }

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = addRef.current?.value.trim() ?? "";
    if (!name) return;
    const fd = new FormData();
    fd.set("name", name);
    run(
      () => createExpenseCategory(initial, fd),
      () => {
        if (addRef.current) addRef.current.value = "";
      },
    );
  }

  function onRename(id: string, name: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", name);
    run(() => updateExpenseCategory(initial, fd));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kategorije troškova</DialogTitle>
          <DialogDescription>
            Dodajte, preimenujte ili obrišite kategorije. Brisanje ne briše troškove — oni ostaju bez
            kategorije.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onAdd} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Input ref={addRef} placeholder="Nova kategorija" disabled={pending} />
          </div>
          <Button type="submit" disabled={pending}>
            Dodaj
          </Button>
        </form>

        <div className="divide-border border-border divide-y rounded-md border">
          {categories.length === 0 ? (
            <p className="text-ink-soft px-3 py-4 text-sm">Još nema kategorija.</p>
          ) : (
            categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                pending={pending}
                onRename={onRename}
                onDelete={(id) => run(() => deleteExpenseCategory(id))}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  category,
  pending,
  onRename,
  onDelete,
}: {
  category: Category;
  pending: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const dirty = name.trim() !== category.name && name.trim() !== "";

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={pending}
        className="h-9 flex-1"
      />
      {dirty ? (
        <Button
          variant="subtle"
          size="sm"
          disabled={pending}
          onClick={() => onRename(category.id, name.trim())}
        >
          Sačuvaj
        </Button>
      ) : null}
      <Button
        variant="danger"
        size="icon-sm"
        disabled={pending}
        onClick={() => {
          if (confirm(`Obrisati kategoriju „${category.name}"?`)) onDelete(category.id);
        }}
        aria-label="Obriši kategoriju"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
