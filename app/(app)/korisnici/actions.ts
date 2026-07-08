"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { firstZodError } from "@/lib/actions";
import { requireRole, type Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const roleEnum = z.enum(["admin", "manager", "logistics"]);

const inviteSchema = z.object({
  email: z.string().trim().email("Unesite ispravan e-mail."),
  full_name: z.string().trim().min(1, "Unesite ime i prezime."),
  role: roleEnum,
});

export type ActionState = { error: string | null; success: string | null };

/**
 * Admin poziva novog korisnika: Supabase šalje invite e-mail (kreira auth
 * korisnika, unconfirmed), a mi odmah upisujemo `profiles` red sa rolom.
 * Pozvani kroz link postavlja lozinku (/auth/callback → /postavi-lozinku).
 */
export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error), success: null };
  }

  const admin = createAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;

  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo,
    data: { full_name: parsed.data.full_name },
  });

  if (error || !data.user) {
    const alreadyExists = error?.message?.toLowerCase().includes("already");
    return {
      error: alreadyExists
        ? "Korisnik sa tim e-mailom već postoji."
        : "Slanje pozivnice nije uspelo.",
      success: null,
    };
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: data.user.id,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    return {
      error: "Pozivnica poslata, ali upis role nije uspeo. Pokušajte ponovo.",
      success: null,
    };
  }

  revalidatePath("/korisnici");
  return { error: null, success: `Pozivnica poslata na ${parsed.data.email}.` };
}

/** Admin menja rolu postojećem korisniku. */
export async function changeRole(userId: string, role: Role): Promise<ActionState> {
  await requireRole("admin");

  const parsed = z
    .object({ userId: z.string().uuid(), role: roleEnum })
    .safeParse({ userId, role });
  if (!parsed.success) return { error: "Neispravan unos.", success: null };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId);

  if (error) return { error: "Izmena role nije uspela.", success: null };

  revalidatePath("/korisnici");
  return { error: null, success: "Rola izmenjena." };
}
