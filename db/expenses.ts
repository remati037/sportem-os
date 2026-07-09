import "server-only";

import { createClient } from "@/lib/supabase/server";

/*
 * Upiti troškova (Korak 1.7). Čitaju kroz RLS klijent: Admin/Menadžer vide,
 * Logistika ništa. Troškovi ulaze u neto profit (v. getNetoProfit u finance.ts),
 * nikad u fakturu. Filter po mesecu ide direktno na `date` kolonu (bez TZ
 * konverzije — `date` je kalendarski dan, ne timestamp).
 */

export type ExpenseRow = {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  category_id: string | null;
  category_name: string | null;
  description: string | null;
  attachment_path: string | null;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  sort_order: number;
};

/** Prvi/poslednji kalendarski dan meseca „YYYY-MM" kao „YYYY-MM-DD". */
export function monthDateBounds(monthStr: string) {
  const [y, mo] = monthStr.split("-").map(Number);
  const lastDayNum = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { firstDay: `${monthStr}-01`, lastDay: `${monthStr}-${pad(lastDayNum)}` };
}

/** Troškovi za izabrani mesec (po `date`), najnoviji prvi. */
export async function listExpenses(monthStr: string): Promise<ExpenseRow[]> {
  const { firstDay, lastDay } = monthDateBounds(monthStr);
  const supabase = await createClient();

  const { data } = await supabase
    .from("expenses")
    .select("id, amount, date, category_id, description, attachment_path, expense_categories(name)")
    .gte("date", firstDay)
    .lte("date", lastDay)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  type Raw = Omit<ExpenseRow, "category_name"> & {
    // PostgREST tipizuje embed kao niz iako je veza to-one → normalizuj oba.
    expense_categories: { name: string } | { name: string }[] | null;
  };

  return ((data as unknown as Raw[]) ?? []).map((r) => {
    const cat = Array.isArray(r.expense_categories)
      ? r.expense_categories[0]
      : r.expense_categories;
    return {
      id: r.id,
      amount: r.amount,
      date: r.date,
      category_id: r.category_id,
      category_name: cat?.name ?? null,
      description: r.description,
      attachment_path: r.attachment_path,
    };
  });
}

/** Zbir troškova za izabrani mesec. */
export async function getExpensesTotal(monthStr: string): Promise<number> {
  const rows = await listExpenses(monthStr);
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

/** Sve kategorije troškova (sort_order, pa naziv). */
export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expense_categories")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data as ExpenseCategory[]) ?? [];
}
