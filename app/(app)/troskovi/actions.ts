"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteExpenseAttachment, uploadExpenseAttachment } from "@/lib/storage";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  expenseCategorySchema,
  expenseSchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
} from "@/lib/validation/expenses";

export type ExpenseActionState = {
  error: string | null;
  success?: string | null;
};

/* ── helperi ─────────────────────────────────────────────────────────────── */

function revalidateExpenses() {
  revalidatePath("/troskovi");
  revalidatePath("/finansije"); // neto profit čita expenses.amount
}

type AttachmentResult = { path: string | null; uploaded: boolean; error?: string };

/**
 * Pročita `attachment` iz FormData; ako je zadat fajl — validira (tip + veličina)
 * i uploaduje u privatni bucket. Prazan unos → nema promene.
 */
async function handleAttachmentUpload(formData: FormData): Promise<AttachmentResult> {
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) {
    return { path: null, uploaded: false };
  }
  if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
    return { path: null, uploaded: false, error: "Prilog mora biti JPG, PNG, WEBP ili PDF." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { path: null, uploaded: false, error: "Prilog je veći od 5 MB." };
  }
  const path = await uploadExpenseAttachment(file);
  return { path, uploaded: true };
}

/* ── troškovi ────────────────────────────────────────────────────────────── */

export async function createExpense(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  await requireRole("admin");

  const parsed = expenseSchema.safeParse({
    amount: formData.get("amount"),
    date: formData.get("date"),
    category_id: formData.get("category_id"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const attachment = await handleAttachmentUpload(formData);
  if (attachment.error) return { error: attachment.error };

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    ...parsed.data,
    attachment_path: attachment.path,
  });
  if (error) {
    // Ako upis reda padne, ne ostavljaj upload-ovani blob u bucketu.
    if (attachment.uploaded) await deleteExpenseAttachment(attachment.path);
    return { error: "Dodavanje troška nije uspelo." };
  }

  revalidateExpenses();
  return { error: null, success: "Trošak dodat." };
}

export async function updateExpense(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  await requireRole("admin");

  const parsed = updateExpenseSchema.safeParse({
    id: formData.get("id"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    category_id: formData.get("category_id"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { id, ...fields } = parsed.data;
  const removeAttachment = formData.get("remove_attachment") === "1";

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("expenses")
    .select("attachment_path")
    .eq("id", id)
    .maybeSingle();
  const oldPath = (existing as { attachment_path: string | null } | null)?.attachment_path ?? null;

  const attachment = await handleAttachmentUpload(formData);
  if (attachment.error) return { error: attachment.error };

  // Novi prilog menja stari; „ukloni" bez novog priloga briše postojeći.
  let nextPath = oldPath;
  if (attachment.uploaded) nextPath = attachment.path;
  else if (removeAttachment) nextPath = null;

  const { error } = await supabase
    .from("expenses")
    .update({ ...fields, attachment_path: nextPath })
    .eq("id", id);
  if (error) {
    if (attachment.uploaded) await deleteExpenseAttachment(attachment.path);
    return { error: "Izmena troška nije uspela." };
  }

  // Obriši stari blob ako je zamenjen ili uklonjen.
  if (oldPath && oldPath !== nextPath) await deleteExpenseAttachment(oldPath);

  revalidateExpenses();
  return { error: null, success: "Trošak izmenjen." };
}

export async function deleteExpense(id: string): Promise<ExpenseActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("expenses")
    .select("attachment_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: "Brisanje troška nije uspelo." };

  await deleteExpenseAttachment(
    (existing as { attachment_path: string | null } | null)?.attachment_path,
  );

  revalidateExpenses();
  return { error: null, success: "Trošak obrisan." };
}

/* ── kategorije troškova ─────────────────────────────────────────────────── */

export async function createExpenseCategory(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  await requireRole("admin");

  const parsed = expenseCategorySchema.safeParse({
    name: formData.get("name"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").insert(parsed.data);
  if (error) return { error: "Dodavanje kategorije nije uspelo." };

  revalidateExpenses();
  return { error: null, success: "Kategorija dodata." };
}

export async function updateExpenseCategory(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  await requireRole("admin");

  const parsed = updateExpenseCategorySchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").update(fields).eq("id", id);
  if (error) return { error: "Izmena kategorije nije uspela." };

  revalidateExpenses();
  return { error: null, success: "Kategorija izmenjena." };
}

export async function deleteExpenseCategory(id: string): Promise<ExpenseActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  // FK expenses.category_id je ON DELETE SET NULL → troškovi ostaju bez kategorije.
  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").delete().eq("id", id);
  if (error) return { error: "Brisanje kategorije nije uspelo." };

  revalidateExpenses();
  return { error: null, success: "Kategorija obrisana." };
}

/* ── prilog (signed URL) ─────────────────────────────────────────────────── */

export async function getExpenseAttachmentUrl(
  path: string,
): Promise<{ url: string | null; error: string | null }> {
  await requireRole("admin", "manager");
  const { expenseAttachmentUrl } = await import("@/lib/storage");
  const url = await expenseAttachmentUrl(path);
  if (!url) return { url: null, error: "Prilog nije dostupan." };
  return { url, error: null };
}
