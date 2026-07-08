"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { type ActionState, firstZodError } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().trim().email("Unesite ispravan e-mail."),
  password: z.string().min(1, "Unesite lozinku."),
});

export type SignInState = ActionState;

/** Prijava e-mailom i lozinkom. Vraća grešku za toast; uspeh → redirect (logistika na /katalog). */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { error: "Pogrešan e-mail ili lozinka." };
  }

  // Logistika nema Dashboard — sleće na Katalog. Rola iz profila ulogovanog korisnika.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  redirect(profile?.role === "logistics" ? "/katalog" : "/");
}

/** Odjava — briše sesiju i vraća na /prijava. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/prijava");
}
