"use client";

import { useState } from "react";

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

/* Potvrdni modal („Da li si siguran?") — obavija okidač (dugme) i pri potvrdi
   poziva onConfirm. Koristi se za osetljive akcije (promena statusa, keš/isplata). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Potvrdi",
  cancelLabel = "Otkaži",
  variant = "primary",
  disabled,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger" | "subtle";
  /** Onemogući dugme potvrde (npr. ništa nije izabrano). */
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
