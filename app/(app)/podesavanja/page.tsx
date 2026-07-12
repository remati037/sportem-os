import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrderStatuses } from "@/db/orders";

import { ProfileSettings } from "./profile-settings";
import { StatusSettings } from "./status-settings";

export const dynamic = "force-dynamic";

/*
 * Podešavanja — profil (sve role: ime + lozinka) + statusi porudžbine
 * (Admin-only: naziv, boja, redosled). RLS i akcije štite write; UI je higijena.
 */
export default async function PodesavanjaPage() {
  const session = await requireRole("admin", "manager", "logistics");
  const isAdmin = session.profile.role === "admin";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims.email as string | undefined) ?? null;

  const statuses = isAdmin ? await getOrderStatuses() : [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Sistem</div>
        <h1 className="text-ink text-xl font-bold">Podešavanja</h1>
        <p className="text-ink-soft text-sm">Profil naloga{isAdmin ? " i statusi porudžbine" : ""}.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-ink text-base font-semibold">Profil</h2>
        <ProfileSettings
          fullName={session.profile.full_name}
          email={email}
          role={session.profile.role}
        />
      </section>

      {isAdmin ? (
        <section className="mt-10 space-y-4">
          <div className="space-y-1">
            <h2 className="text-ink text-base font-semibold">Statusi porudžbine</h2>
            <p className="text-ink-soft text-sm">Naziv, boja i redosled u toku.</p>
          </div>
          <StatusSettings statuses={statuses} />
        </section>
      ) : null}
    </main>
  );
}
