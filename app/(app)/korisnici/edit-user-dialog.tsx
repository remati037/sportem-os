"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateUser, type ActionState } from "./actions";
import type { Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: ActionState = { error: null, success: null };

type Props = {
  user: {
    id: string;
    full_name: string | null;
    email: string;
    role: Role | null;
  };
};

export function EditUserDialog({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>(user.role ?? "manager");
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateUser(initialState, formData);
      if (result.success) {
        toast.success(result.success);
        setOpen(false);
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  // Kad se dijalog otvori, vrati rolu na trenutnu (reset posle neuspešne izmene).
  function onOpenChange(next: boolean) {
    if (next) setRole(user.role ?? "manager");
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="subtle" size="sm">
          Izmeni
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Izmeni korisnika</DialogTitle>
          <DialogDescription>
            Promenite ime, e-mail, rolu ili lozinku. Lozinku ostavite praznu da je ne menjate.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-2">
            <Label htmlFor={`full_name-${user.id}`}>Ime i prezime</Label>
            <Input
              id={`full_name-${user.id}`}
              name="full_name"
              required
              defaultValue={user.full_name ?? ""}
              placeholder="Marko Marković"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`email-${user.id}`}>E-mail</Label>
            <Input
              id={`email-${user.id}`}
              name="email"
              type="email"
              required
              defaultValue={user.email}
              placeholder="ime@sportem.rs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`role-${user.id}`}>Rola</Label>
            <input type="hidden" name="role" value={role} />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id={`role-${user.id}`} className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Menadžer</SelectItem>
                <SelectItem value="logistics">Logistika</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`password-${user.id}`}>Nova lozinka</Label>
            <Input
              id={`password-${user.id}`}
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="Ostavite prazno da ne menjate"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Čuvanje…" : "Sačuvaj izmene"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
