"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { ImageIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/*
 * Polje za sliku (Korak 1.1a). Native file input (naziv `image`) — ulazi u
 * FormData server akcije. Prikazuje trenutnu sliku (edit) sa opcijom „Ukloni"
 * (postavlja hidden `remove_image=1`) i preview novoizabranog fajla.
 */
export function ImageInput({
  currentUrl,
  label = "Slika",
}: {
  currentUrl?: string | null;
  label?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
    if (file) setRemoved(false);
  }

  const shownUrl = preview ?? (removed ? null : (currentUrl ?? null));

  return (
    <div className="space-y-2">
      <Label htmlFor="image">{label}</Label>
      <div className="flex min-w-0 items-center gap-3">
        <div className="border-border bg-surface-2 relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <ImageIcon className="text-ink-faint size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            id="image"
            name="image"
            type="file"
            accept="image/webp,image/jpeg,image/png"
            onChange={onFileChange}
            className={cn(
              "text-ink-soft w-full min-w-0 text-sm",
              "file:bg-surface-2 file:text-ink hover:file:bg-surface-2/70 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium",
            )}
          />
          {currentUrl && !preview ? (
            <label className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                name="remove_image"
                value="1"
                checked={removed}
                onChange={(e) => setRemoved(e.target.checked)}
                className="accent-green size-3.5"
              />
              <X className="size-3" /> Ukloni postojeću sliku
            </label>
          ) : null}
          <p className="text-ink-faint text-xs">JPG, PNG ili WEBP · do 5 MB</p>
        </div>
      </div>
    </div>
  );
}
