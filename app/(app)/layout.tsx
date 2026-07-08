import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

/* Zaštićeni layout (Korak 0.8): app shell sa navigacijom po roli.
   Middleware već blokira neulogovane; ovde učitavamo profil za nav gejt. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getProfile();
  if (!session) redirect("/prijava");

  return <AppShell profile={session.profile}>{children}</AppShell>;
}
