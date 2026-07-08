import Link from "next/link";

import { requireUser, getProfile, type Role } from "@/lib/auth";
import { signOut } from "@/app/prijava/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Menadžer",
  logistics: "Logistika",
};

export default async function Home() {
  await requireUser();
  const session = await getProfile();
  const profile = session?.profile;

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <div className="eyebrow">Interni operativni sistem</div>
        <h1 className="text-ink text-[1.75rem] font-bold">Sportem</h1>
        {profile ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-ink-soft text-[0.9375rem]">
              Prijavljen: <span className="text-ink font-medium">{profile.full_name ?? "—"}</span>
            </p>
            <Badge variant="info">{ROLE_LABEL[profile.role]}</Badge>
          </div>
        ) : (
          <p className="text-ink-soft text-[0.9375rem]">Nalog bez dodeljene role.</p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {profile?.role === "admin" ? (
          <Button asChild>
            <Link href="/korisnici">Korisnici</Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link href="/stil">Dizajn sistem</Link>
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="ghost">
            Odjava
          </Button>
        </form>
      </div>
    </main>
  );
}
