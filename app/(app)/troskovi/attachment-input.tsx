"use client";

import { type ChangeEvent, useState } from "react";
import { Paperclip, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/*
 * Polje za prilog troška (Korak 1.7). Native file input (naziv `attachment`) —
 * ulazi u FormData server akcije. Prihvata slike i PDF. Bucket je privatan pa
 * nema inline preview; kod izmene se postojeći prilog zna po `hasCurrent` i
 * može se ukloniti (hidden `remove_attachment=1`).
 */
export function AttachmentInput({ hasCurrent = false }: { hasCurrent?: boolean }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileName(file ? file.name : null);
    if (file) setRemoved(false);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="attachment" className="flex items-center gap-1.5">
        <Paperclip className="size-3.5" /> Prilog (račun, opciono)
      </Label>
      <input
        id="attachment"
        name="attachment"
        type="file"
        accept="image/webp,image/jpeg,image/png,application/pdf"
        onChange={onFileChange}
        className={cn(
          "text-ink-soft w-full min-w-0 text-sm",
          "file:bg-surface-2 file:text-ink hover:file:bg-surface-2/70 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium",
        )}
      />
      {hasCurrent && !fileName ? (
        <label className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            name="remove_attachment"
            value="1"
            checked={removed}
            onChange={(e) => setRemoved(e.target.checked)}
            className="accent-green size-3.5"
          />
          <X className="size-3" /> Ukloni postojeći prilog
        </label>
      ) : null}
      <p className="text-ink-faint text-xs">JPG, PNG, WEBP ili PDF · do 5 MB</p>
    </div>
  );
}
