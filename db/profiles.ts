import "server-only";

import type { Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Lista internih korisnika (Korak T2) — izbor izvršilaca na tiketu i filter
 * „Osoba".
 *
 * Čita kroz SERVICE-ROLE klijent jer RLS politika `profiles_select` pušta
 * korisniku samo NJEGOV red (sve ostale vidi jedino Admin) — Menadžer bi
 * inače dobio praznu listu i imena izvršilaca bez teksta. Kapija je
 * `requireRole` u pozivaocu (stranica/akcija), kao kod `/korisnici`.
 * Vraća samo ime i rolu — nikakav osetljiv podatak (bez e-maila).
 */

export type StaffProfile = {
  id: string;
  full_name: string | null;
  role: Role;
};

/** Sportem tim (Admin + Menadžer) — jedini kojima se tiket sme dodeliti. */
export async function listStaffProfiles(): Promise<StaffProfile[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["admin", "manager"])
    .order("full_name", { ascending: true, nullsFirst: false });
  return (data as StaffProfile[]) ?? [];
}
