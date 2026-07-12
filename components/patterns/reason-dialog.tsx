"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/*
 * Dijalog koji traži OBAVEZAN razlog (napomenu) pre potvrde akcije — npr.
 * otkazivanje/vraćanje porudžbine. Dugme potvrde je onemogućeno dok je polje
 * prazno; na potvrdu prosleđuje uneti tekst kroz `onConfirm(reason)`.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  label = "Razlog",
  placeholder = "Unesite razlog…",
  confirmLabel = "Potvrdi",
  cancelLabel = "Otkaži",
  variant = "danger",
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger" | "subtle";
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason" className="text-ink-faint text-xs">
            {label}
          </Label>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            disabled={!trimmed}
            onClick={() => {
              setOpen(false);
              onConfirm(trimmed);
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
