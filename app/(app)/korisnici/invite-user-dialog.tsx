"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { inviteUser, type ActionState } from "./actions";
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

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("manager");
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await inviteUser(initialState, formData);
      if (result.success) {
        toast.success(result.success);
        setOpen(false);
        setRole("manager");
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Pozovi korisnika</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pozovi korisnika</DialogTitle>
          <DialogDescription>
            Pozivnica se šalje na e-mail; korisnik kroz link postavlja lozinku.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Ime i prezime</Label>
            <Input id="full_name" name="full_name" required placeholder="Marko Marković" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required placeholder="ime@sportem.rs" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Rola</Label>
            <input type="hidden" name="role" value={role} />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="role" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Menadžer</SelectItem>
                <SelectItem value="logistics">Logistika</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Slanje…" : "Pošalji pozivnicu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
