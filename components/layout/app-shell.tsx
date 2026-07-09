import type { Profile } from "@/lib/auth";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

/* App shell (Korak 0.8): sidebar (desktop) + sadržaj + bottom nav (mobilni).
   Filtriranje po roli je u nav komponentama; padding-bottom čuva sadržaj iznad
   fiksiranog bottom nav-a na mobilnom. */
export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar profile={profile} />
      <div className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">{children}</div>
      <BottomNav role={profile.role} />
    </div>
  );
}
