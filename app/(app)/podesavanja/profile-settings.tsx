"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { changePassword, updateProfileName, type SettingsActionState } from "./actions";

const initial: SettingsActionState = { error: null };

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  manager: "Menadžer",
  logistics: "Logistika",
};

/*
 * Podešavanja profila (sve role): izmena imena + promena lozinke.
 * Email je fiksan (vezan za nalog/invite) — prikazuje se samo informativno.
 */
export function ProfileSettings({
  fullName,
  email,
  role,
}: {
  fullName: string | null;
  email: string | null;
  role: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const passwordFormRef = useRef<HTMLFormElement>(null);

  function run(fn: () => Promise<SettingsActionState>, onOk?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      onOk?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="border-border bg-surface shadow-soft rounded-lg border p-4">
        <h2 className="text-ink text-sm font-semibold">Osnovni podaci</h2>
        <p className="text-ink-soft mt-0.5 text-xs">
          Email: <span className="text-ink">{email ?? "—"}</span> · Uloga:{" "}
          <span className="text-ink">{ROLE_LABEL[role] ?? role}</span>
        </p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => updateProfileName(initial, fd));
          }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="full_name">Ime i prezime</Label>
            <Input
              id="full_name"
              name="full_name"
              defaultValue={fullName ?? ""}
              placeholder="npr. Marko Marković"
              maxLength={120}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            Sačuvaj ime
          </Button>
        </form>
      </div>

      <div className="border-border bg-surface shadow-soft rounded-lg border p-4">
        <h2 className="text-ink text-sm font-semibold">Promena lozinke</h2>
        <p className="text-ink-soft mt-0.5 text-xs">Najmanje 8 znakova.</p>
        <form
          ref={passwordFormRef}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(
              () => changePassword(initial, fd),
              () => passwordFormRef.current?.reset(),
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="password">Nova lozinka</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Ponovi lozinku</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            Promeni lozinku
          </Button>
        </form>
      </div>
    </div>
  );
}
