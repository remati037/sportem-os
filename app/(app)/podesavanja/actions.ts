"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { orderStatusSchema } from "@/lib/validation/orders";

/*
 * Podešavanje statusa porudžbine (Korak 1.4, Admin-only). Write ide kroz RLS
 * klijent — `order_statuses_admin_write` politika dozvoljava Adminu. Statusi u
 * upotrebi se NE brišu (FK orders.status_id je ON DELETE RESTRICT).
 *
 * Profil (sve role): ime ide kroz service role klijent na SOPSTVENI red
 * (RLS write na `profiles` ima samo Admin — politika se ne širi da korisnik
 * ne bi mogao da menja svoju rolu); lozinka kroz Supabase Auth sesiju.
 */

export type SettingsActionState = {
  error: string | null;
  success?: string | null;
};

function revalidateStatuses() {
  revalidatePath("/podesavanja");
  revalidatePath("/porudzbine");
}

const ALL_ROLES = ["admin", "manager", "logistics"] as const;

const profileNameSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Ime ne sme biti prazno.")
    .max(120, "Ime je predugačko (max 120 znakova)."),
});

const passwordSchema = z
  .object({
    password: z.string().min(8, "Lozinka mora imati bar 8 znakova."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Lozinke se ne poklapaju.",
    path: ["confirm"],
  });

export async function updateProfileName(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireRole(...ALL_ROLES);

  const parsed = profileNameSchema.safeParse({ full_name: formData.get("full_name") });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: parsed.data.full_name })
    .eq("id", session.userId);
  if (error) return { error: "Čuvanje imena nije uspelo." };

  revalidatePath("/", "layout");
  return { error: null, success: "Ime sačuvano." };
}

export async function changePassword(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireRole(...ALL_ROLES);

  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password")
      return { error: "Nova lozinka mora biti različita od trenutne." };
    if (error.code === "weak_password") return { error: "Lozinka je preslaba — izaberi jaču." };
    return { error: "Promena lozinke nije uspela. Pokušaj ponovo." };
  }

  return { error: null, success: "Lozinka promenjena." };
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
