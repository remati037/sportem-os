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

const updateSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().min(1, "Unesite ime i prezime."),
  email: z.string().trim().email("Unesite ispravan e-mail."),
  role: roleEnum,
  // Prazno = ne menjaj lozinku; ako je uneta, min 6 (Supabase default).
  password: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined))
    .refine((v) => v === undefined || v.length >= 6, "Lozinka mora imati bar 6 znakova."),
});

/**
 * Admin menja postojećeg korisnika: ime i prezime, e-mail, rolu i (opciono)
 * lozinku. Ime → `auth.user_metadata` + `profiles`; e-mail/lozinka → Supabase
 * Auth (`updateUserById`, `email_confirm: true` da izmena e-maila ne traži
 * ponovnu potvrdu); rola → `profiles`. Sve kroz service-role (zaobilazi RLS).
 */
export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole("admin");

  const parsed = updateSchema.safeParse({
    userId: formData.get("userId"),
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error), success: null };
  }

  const { userId, full_name, email, role, password } = parsed.data;
  const admin = createAdminClient();

  // Trenutni auth korisnik (za poređenje e-maila) i rola (za zaštitu admina).
  const [{ data: authUser }, { data: target }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("role").eq("id", userId).single(),
  ]);
  const currentRole = (target?.role ?? null) as Role | null;
  const emailChanged =
    (authUser?.user?.email ?? "").toLowerCase() !== email.toLowerCase();

  // Ne dozvoli sebi da skineš admin rolu (samo-zaključavanje).
  if (userId === session.userId && role !== "admin") {
    return { error: "Ne možete sebi ukloniti admin rolu.", success: null };
  }

  // Ne dozvoli da nestane poslednji admin.
  if (currentRole === "admin" && role !== "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return { error: "Mora postojati bar jedan admin.", success: null };
    }
  }

  // Auth: ime u metapodacima uvek; e-mail samo ako se promenio
  // (`email_confirm: true` da izmena ne traži ponovnu potvrdu); lozinka ako je uneta.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { full_name },
    ...(emailChanged ? { email, email_confirm: true } : {}),
    ...(password ? { password } : {}),
  });

  if (authError) {
    const alreadyExists = authError.message?.toLowerCase().includes("already");
    return {
      error: alreadyExists
        ? "Korisnik sa tim e-mailom već postoji."
        : "Izmena korisnika nije uspela.",
      success: null,
    };
  }

  // Profil: ime i rola.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name, role })
    .eq("id", userId);

  if (profileError) {
    return { error: "Izmena profila nije uspela.", success: null };
  }

  revalidatePath("/korisnici");
  return { error: null, success: "Korisnik izmenjen." };
}
