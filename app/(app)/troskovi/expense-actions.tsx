"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RowActions } from "@/components/patterns/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import {
  deleteExpense,
  getExpenseAttachmentUrl,
  type ExpenseActionState,
} from "./actions";
import { ExpenseDialog } from "./expense-dialog";

type Category = { id: string; name: string };

type ExpenseData = {
  id: string;
  amount: number;
  date: string;
  category_id: string | null;
  description: string | null;
  attachment_path: string | null;
};

export function ExpenseActions({
  expense,
  categories,
}: {
  expense: ExpenseData;
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function run(fn: () => Promise<ExpenseActionState>) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      router.refresh();
    });
  }

  function openAttachment() {
    // Otvori prazan tab sinhrono (izbegni popup blocker), pa postavi signed URL.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      const { url, error } = await getExpenseAttachmentUrl(expense.attachment_path!);
      if (error || !url) {
        tab?.close();
        toast.error(error ?? "Prilog nije dostupan.");
        return;
      }
      if (tab) tab.location.href = url;
    });
  }

  return (
    <>
      <RowActions>
        <DropdownMenuItem onSelect={() => setEditOpen(true)}>
          <Pencil /> Izmeni
        </DropdownMenuItem>
        {expense.attachment_path ? (
          <DropdownMenuItem disabled={pending} onSelect={openAttachment}>
            <ExternalLink /> Prilog
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => {
            if (confirm("Obrisati ovaj trošak?")) run(() => deleteExpense(expense.id));
          }}
        >
          <Trash2 /> Obriši
        </DropdownMenuItem>
      </RowActions>

      <ExpenseDialog
        categories={categories}
        expense={expense}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
