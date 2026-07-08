"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, ShieldCheck } from "lucide-react";

import { initialActionState } from "@/lib/actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { setPassword } from "./actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Čuvanje…" : "Sačuvaj lozinku"}
    </Button>
  );
}

export default function PostaviLozinkuPage() {
  const [state, formAction] = useActionState(setPassword, initialActionState);
  useActionToast(state);

  return (
    <AuthShell
      eyebrow="Dobrodošli u tim"
      title="Postavite lozinku"
      description="Izaberite lozinku za svoj nalog da završite pristup."
    >
      <form action={formAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="password">Nova lozinka</Label>
          <div className="relative">
            <KeyRound className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="pl-10"
            />
          </div>
          <p className="text-ink-faint text-xs">Najmanje 8 karaktera.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Potvrdi lozinku</Label>
          <div className="relative">
            <ShieldCheck className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="pl-10"
            />
          </div>
        </div>
        <SubmitButton />
      </form>
    </AuthShell>
  );
}
