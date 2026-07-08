"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { type ActionState, firstZodError } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    password: z.string().min(8, "Lozinka mora imati bar 8 karaktera."),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Lozinke se ne poklapaju.",
    path: ["confirm"],
  });

export type SetPasswordState = ActionState;

/** Invited korisnik postavlja lozinku (sesija je uspostavljena kroz /auth/callback). */
export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sesija je istekla. Otvorite pozivnicu iz e-maila ponovo." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: "Postavljanje lozinke nije uspelo." };
  }

  redirect("/");
}
