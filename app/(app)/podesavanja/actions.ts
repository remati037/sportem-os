"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { firstZodError } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { orderStatusSchema } from "@/lib/validation/orders";
import {
  archiveTicketTagSchema,
  ticketColumnSchema,
  ticketPrioritySchema,
  ticketTagSchema,
} from "@/lib/validation/tickets";

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
  if (error)
    return { error: id ? "Izmena statusa nije uspela." : "Dodavanje statusa nije uspelo." };

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

/* ══════════════════════════════════════════════════════════════════════════
 * Tiketi — podešavanja kolona, prioriteta i tagova (Korak T1, Admin-only).
 *
 * Write ide kroz RLS klijent — politike `ticket_*_admin_write` puštaju samo
 * Admina (Menadžer čita, Logistika ne vidi ništa). Ne dira tikete ni njihov
 * sadržaj, a nikako porudžbine, finansije ni snapshot cene.
 * ═════════════════════════════════════════════════════════════════════════ */

function revalidateTicketConfig() {
  revalidatePath("/podesavanja");
  revalidatePath("/tiketi");
}

/** Najviše jedan podrazumevani prioritet — stari se skida pre postavljanja novog. */
async function clearDefaultPriority(
  supabase: Awaited<ReturnType<typeof createClient>>,
  exceptId?: string,
) {
  let query = supabase
    .from("ticket_priorities")
    .update({ is_default: false })
    .eq("is_default", true);
  if (exceptId) query = query.neq("id", exceptId);
  await query;
}

export async function upsertTicketColumn(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  const parsed = ticketColumnSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    sort_order: formData.get("sort_order") ?? undefined,
    is_done: formData.get("is_done") ?? undefined,
    wip_limit: formData.get("wip_limit") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("ticket_columns").update(parsed.data).eq("id", id)
    : await supabase.from("ticket_columns").insert(parsed.data);
  if (error) return { error: id ? "Izmena kolone nije uspela." : "Dodavanje kolone nije uspelo." };

  revalidateTicketConfig();
  return { error: null, success: id ? "Kolona izmenjena." : "Kolona dodata." };
}

export async function deleteTicketColumn(id: string): Promise<SettingsActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  const { error } = await supabase.from("ticket_columns").delete().eq("id", id);
  if (error) {
    // FK RESTRICT (23503) → u koloni ima tiketa.
    if ((error as { code?: string }).code === "23503") {
      return { error: "Kolona ima tikete — prvo ih premesti pa je obriši." };
    }
    return { error: "Brisanje kolone nije uspelo." };
  }

  revalidateTicketConfig();
  return { error: null, success: "Kolona obrisana." };
}

export async function upsertTicketPriority(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  const parsed = ticketPrioritySchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    level: formData.get("level") ?? undefined,
    is_default: formData.get("is_default") ?? undefined,
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  // Parcijalni unique index dozvoljava tačno jedan `is_default` — stari se
  // skida PRE upisa novog (inače 23505).
  if (parsed.data.is_default) await clearDefaultPriority(supabase, id || undefined);

  const { error } = id
    ? await supabase.from("ticket_priorities").update(parsed.data).eq("id", id)
    : await supabase.from("ticket_priorities").insert(parsed.data);
  if (error)
    return { error: id ? "Izmena prioriteta nije uspela." : "Dodavanje prioriteta nije uspelo." };

  revalidateTicketConfig();
  return { error: null, success: id ? "Prioritet izmenjen." : "Prioritet dodat." };
}

export async function deleteTicketPriority(id: string): Promise<SettingsActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  // FK je ON DELETE SET NULL → tiketi ostaju, samo bez prioriteta.
  const { error } = await supabase.from("ticket_priorities").delete().eq("id", id);
  if (error) return { error: "Brisanje prioriteta nije uspelo." };

  revalidateTicketConfig();
  return { error: null, success: "Prioritet obrisan." };
}

export async function upsertTicketTag(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  const parsed = ticketTagSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
    sort_order: formData.get("sort_order") ?? undefined,
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("ticket_tags").update(parsed.data).eq("id", id)
    : await supabase.from("ticket_tags").insert(parsed.data);
  if (error) {
    // Jedinstveno ime među aktivnim tagovima (parcijalni unique index).
    if ((error as { code?: string }).code === "23505") {
      return { error: "Tag sa tim nazivom već postoji." };
    }
    return { error: id ? "Izmena taga nije uspela." : "Dodavanje taga nije uspelo." };
  }

  revalidateTicketConfig();
  return { error: null, success: id ? "Tag izmenjen." : "Tag dodat." };
}

/** Arhiviranje/vraćanje taga — preporučeno umesto brisanja (istorija ostaje). */
export async function setTicketTagArchived(
  id: string,
  archived: boolean,
): Promise<SettingsActionState> {
  await requireRole("admin");

  const parsed = archiveTicketTagSchema.safeParse({ id, archived });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ticket_tags")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.id);
  if (error) {
    // Vraćanje iz arhive može da udari u aktivan tag sa istim imenom.
    if ((error as { code?: string }).code === "23505") {
      return { error: "Aktivan tag sa tim nazivom već postoji — prvo ga preimenuj." };
    }
    return { error: "Promena arhive nije uspela." };
  }

  revalidateTicketConfig();
  return { error: null, success: parsed.data.archived ? "Tag arhiviran." : "Tag vraćen." };
}

export async function deleteTicketTag(id: string): Promise<SettingsActionState> {
  await requireRole("admin");
  if (!id) return { error: "Neispravan unos." };

  const supabase = await createClient();
  // Link tabela je ON DELETE CASCADE → tag se samo skida sa tiketa.
  const { error } = await supabase.from("ticket_tags").delete().eq("id", id);
  if (error) return { error: "Brisanje taga nije uspelo." };

  revalidateTicketConfig();
  return { error: null, success: "Tag obrisan." };
}
