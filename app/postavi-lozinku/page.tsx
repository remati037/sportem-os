"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { initialActionState } from "@/lib/actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { setPassword } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Čuvanje…" : "Sačuvaj lozinku"}
    </Button>
  );
}

export default function PostaviLozinkuPage() {
  const [state, formAction] = useActionState(setPassword, initialActionState);
  useActionToast(state);

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <div className="mb-6 space-y-1 text-center">
        <div className="eyebrow">Dobrodošli u tim</div>
        <h1 className="text-ink text-2xl font-bold">Sportem</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Postavite lozinku</CardTitle>
          <CardDescription>Izaberite lozinku za svoj nalog da završite pristup.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova lozinka</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Potvrdi lozinku</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
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
