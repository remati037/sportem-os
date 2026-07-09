"use server";

import { revalidatePath } from "next/cache";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { orderStatusSchema } from "@/lib/validation/orders";

/*
 * Podešavanje statusa porudžbine (Korak 1.4, Admin-only). Write ide kroz RLS
 * klijent — `order_statuses_admin_write` politika dozvoljava Adminu. Statusi u
 * upotrebi se NE brišu (FK orders.status_id je ON DELETE RESTRICT).
 */

export type SettingsActionState = {
  error: string | null;
  success?: string | null;
};

function revalidateStatuses() {
  revalidatePath("/podesavanja");
  revalidatePath("/porudzbine");
}

export async function upsertOrderStatus(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  const parsed = orderStatusSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("order_statuses").update(parsed.data).eq("id", id)
    : await supabase.from("order_statuses").insert(parsed.data);
  if (error) return { error: id ? "Izmena statusa nije uspela." : "Dodavanje statusa nije uspelo." };

  revalidateStatuses();
  return { error: null, success: id ? "Status izmenjen." : "Status dodat." };
}

export async function deleteOrderStatus(id: string): Promise<SettingsActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase.from("order_statuses").delete().eq("id", id);
  if (error) {
    // FK RESTRICT (23503) → status je u upotrebi na porudžbinama.
    if ((error as { code?: string }).code === "23503") {
      return { error: "Status je u upotrebi na porudžbinama — ne može se obrisati." };
    }
    return { error: "Brisanje statusa nije uspelo." };
  }

  revalidateStatuses();
  return { error: null, success: "Status obrisan." };
}
