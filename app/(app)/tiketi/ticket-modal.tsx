"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/*
 * Okvir modala nad board-om (presretnuta ruta `@modal/(.)tiketi/[id]`).
 * Zatvaranje = `router.back()` → URL se vraća na board, a modal slot pada na
 * `@modal/default.tsx` (null). Direktan link / refresh / novi tab ne prolaze
 * kroz presretanje i renderuju punu stranu `/tiketi/[id]`.
 *
 * Zatvaranje ide kroz lokalni `open` (pa tek onda `back()`) da se animacija
 * odigra do kraja i fokus vrati na karticu.
 */
export function TicketModal({
  code,
  title,
  children,
}: {
  /** Prikaz šifre („SPT-42") u naslovu modala. */
  code: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) router.back();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogDescription className="eyebrow num text-left">{code}</DialogDescription>
          <DialogTitle className="text-left text-lg">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
