import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "manager" | "logistics";

export type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
};

export type AppSession = {
  userId: string;
  profile: Profile;
};

/**
 * Sesija (userId + `profiles` red) ili null.
 *
 * Identitet čita iz verifikovanog JWT-a (`getClaims` — lokalna provera, bez
 * mrežnog poziva ka Auth serveru), pa jedan upit na `profiles`. `cache()`
 * deduplikuje pozive unutar istog zahteva (layout + stranica = 1 upit).
 * Higijena na nivou app-a; prava zaštita je RLS (CLAUDE.md 5).
 */
export const getProfile = cache(async (): Promise<AppSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .single();

  if (!profile) return null;
  return { userId, profile: profile as Profile };
});

/**
 * Vrati sesiju ili redirect na /prijava; ako rola nije dozvoljena → redirect na /.
 */
export async function requireRole(...roles: Role[]): Promise<AppSession> {
  const session = await getProfile();
  if (!session) redirect("/prijava");
  if (!roles.includes(session.profile.role)) redirect("/");
  return session;
}
