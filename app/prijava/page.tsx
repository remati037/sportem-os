"use client";

import { Suspense, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { toast } from "sonner";

import { initialActionState } from "@/lib/actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { signIn } from "./actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Prijavljivanje…" : "Prijavi se"}
    </Button>
  );
}

/** Prikazuje grešku koju /auth/callback šalje kroz ?greska=link (istekao/nevažeći link). */
function CallbackErrorToast() {
  const searchParams = useSearchParams();
  const greska = searchParams.get("greska");

  useEffect(() => {
    if (greska === "link") {
      toast.error("Link je istekao ili nije važeći. Zatražite novi poziv.");
    }
  }, [greska]);

  return null;
}

export default function PrijavaPage() {
  const [state, formAction] = useActionState(signIn, initialActionState);
  useActionToast(state);

  return (
    <AuthShell
      eyebrow="Interni operativni sistem"
      title="Prijava"
      description="Pristup samo za tim. Nema javne registracije."
    >
      <Suspense fallback={null}>
        <CallbackErrorToast />
      </Suspense>

      <form action={formAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <div className="relative">
            <Mail className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="ime@sportem.rs"
              className="pl-10"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Lozinka</Label>
          <div className="relative">
            <Lock className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
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
