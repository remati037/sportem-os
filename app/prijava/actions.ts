"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().trim().email("Unesite ispravan e-mail."),
  password: z.string().min(1, "Unesite lozinku."),
});

export type SignInState = { error: string | null };

/** Prijava e-mailom i lozinkom. Vraća grešku za toast; uspeh → redirect na /. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Pogrešan e-mail ili lozinka." };
  }

  redirect("/");
}

/** Odjava — briše sesiju i vraća na /prijava. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/prijava");
}
