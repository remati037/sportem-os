import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

/* Zaštićeni layout (Korak 0.8): app shell sa navigacijom po roli.
   Middleware već blokira neulogovane; ovde učitavamo profil za nav gejt.

   `modal` je paralelni slot (`@modal`) za presretnute rute — detalj tiketa se
   sa board-a otvara kao modal, a direktan link renderuje punu stranu. Na svim
   ostalim rutama slot pada na `@modal/default.tsx` (null). */
export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const session = await getProfile();
  if (!session) redirect("/prijava");

  return (
    <AppShell profile={session.profile}>
      {children}
      {modal}
    </AppShell>
  );
}
