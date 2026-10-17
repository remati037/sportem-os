import "server-only";

import { getProfile, type AppSession, type Role } from "@/lib/auth";

/*
 * Kapija AI asistenta za API rute. Strane koriste `requireRole("admin",
 * "manager")` (redirect), a API ruta mora da vrati JSON grešku umesto
 * redirecta — zato zaseban helper sa ISTIM spiskom rola. Prava zaštita
 * podataka je i dalje RLS (`ai_*_own` politike).
 */
export const AI_ROLES: Role[] = ["admin", "manager"];

/** Sesija ako korisnik sme da koristi asistenta, inače null. */
export async function getAiSession(): Promise<AppSession | null> {
  const session = await getProfile();
  if (!session || !AI_ROLES.includes(session.profile.role)) return null;
  return session;
}
