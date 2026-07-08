"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { signIn, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Prijavljivanje…" : "Prijavi se"}
    </Button>
  );
}

export default function PrijavaPage() {
  const [state, formAction] = useActionState(signIn, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <div className="mb-6 space-y-1 text-center">
        <div className="eyebrow">Interni operativni sistem</div>
        <h1 className="text-ink text-2xl font-bold">Sportem</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prijava</CardTitle>
          <CardDescription>Pristup samo za tim. Nema javne registracije.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="ime@sportem.rs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Lozinka</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <SubmitButton />
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
