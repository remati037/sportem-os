import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "manager" | "logistics";

export type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
};

/** Trenutni auth korisnik ili null (ne redirektuje). */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Korisnik + njegov `profiles` red (rola, ime) ili null. */
export async function getProfile(): Promise<{ user: User; profile: Profile } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return { user, profile: profile as Profile };
}

/** Vrati korisnika ili redirect na /prijava. Za zaštićene stranice. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/prijava");
  return user;
}

/**
 * Vrati profil ili redirect na /prijava; ako rola nije dozvoljena → redirect na /.
 * Higijena na nivou app-a; prava zaštita finansija je RLS (CLAUDE.md 5).
 */
export async function requireRole(...roles: Role[]): Promise<{ user: User; profile: Profile }> {
  const session = await getProfile();
  if (!session) redirect("/prijava");
  if (!roles.includes(session.profile.role)) redirect("/");
  return session;
}
