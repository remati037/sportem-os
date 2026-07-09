import { requireRole, type Role } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MobileCard,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { InviteUserDialog } from "./invite-user-dialog";

export const dynamic = "force-dynamic";

type ProfileRow = { id: string; full_name: string | null; role: Role };

export default async function KorisniciPage() {
  await requireRole("admin");

  const admin = createAdminClient();
  const [{ data: authList }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin.from("profiles").select("id, full_name, role"),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileRow]));

  const users = (authList?.users ?? []).map((u) => {
    const profile = profileById.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "—",
      full_name: profile?.full_name ?? null,
      role: profile?.role ?? null,
      confirmed: Boolean(u.email_confirmed_at ?? u.confirmed_at),
    };
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="eyebrow">Podešavanja</div>
          <h1 className="text-ink text-xl font-bold">Korisnici</h1>
          <p className="text-ink-soft text-sm">
            Pozovite člana tima i dodelite mu rolu. Pozivnica stiže na e-mail.
          </p>
        </div>
        <InviteUserDialog />
      </div>

      {/* Desktop tabela */}
      <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Ime</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">E-mail</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Rola</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className="border-border hover:bg-green-soft">
                <TableCell className="text-ink px-4 py-2.5 text-[0.9375rem]">
                  {u.full_name ?? "—"}
                </TableCell>
                <TableCell className="text-ink-soft px-4 py-2.5 text-[0.9375rem]">
                  {u.email}
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  {u.role ? (
                    <Badge variant="info">{ROLE_LABEL[u.role]}</Badge>
                  ) : (
                    <span className="text-ink-faint text-sm">bez role</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  {u.confirmed ? (
                    <Badge variant="success">Aktivan</Badge>
                  ) : (
                    <Badge variant="warning">Pozvan — čeka</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobilne kartice */}
      <MobileCardList>
        {users.map((u) => (
          <MobileCard key={u.id}>
            <MobileCardHeader
              title={u.full_name ?? "—"}
              subtitle={u.email}
              trailing={
                u.confirmed ? (
                  <Badge variant="success">Aktivan</Badge>
                ) : (
                  <Badge variant="warning">Pozvan — čeka</Badge>
                )
              }
            />
            <div className="mt-3">
              {u.role ? (
                <Badge variant="info">{ROLE_LABEL[u.role]}</Badge>
              ) : (
                <span className="text-ink-faint text-sm">bez role</span>
              )}
            </div>
          </MobileCard>
        ))}
      </MobileCardList>
    </main>
  );
}
