"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { CustomerNote } from "@/db/customers";
import { CUSTOMER_NOTE_MAX } from "@/lib/customers";
import { datumVreme } from "@/lib/format";
import { initials } from "@/lib/tickets";
import { Linkify } from "@/components/patterns/linkify";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import {
  addCustomerNote,
  deleteCustomerNote,
  editCustomerNote,
  type CustomerActionState,
} from "../actions";

/*
 * Beleške o kupcu (Korak C3) — obrazac komentara tiketa. Belešku menja i briše
 * SAMO autor: ovde se dugmad skrivaju, a proveru rade akcija i RLS.
 * Običan tekst kroz `Linkify` (URL, SPT-42, #2419 postaju linkovi).
 */

const initialState: CustomerActionState = { error: null };

export function CustomerNotes({
  customerId,
  notes,
  currentUserId,
}: {
  customerId: string;
  notes: CustomerNote[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  function run(fn: () => Promise<CustomerActionState>, after?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      after?.();
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(
      () => addCustomerNote(initialState, fd),
      () => form.reset(),
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-ink mb-3 text-base font-semibold">
        Beleške{notes.length > 0 ? ` (${notes.length})` : ""}
      </h2>

      {notes.length === 0 ? (
        <p className="text-ink-soft mb-3 text-sm">Još nema beležaka.</p>
      ) : (
        <ol className="mb-3 space-y-2">
          {notes.map((note) => {
            const mine = note.created_by != null && note.created_by === currentUserId;
            const edited = note.updated_at !== note.created_at;
            return (
              <li
                key={note.id}
                className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-surface-2 text-ink-soft flex size-6 items-center justify-center rounded-full text-[0.625rem] font-semibold">
                    {initials(note.authorName)}
                  </span>
                  <span className="text-ink text-sm font-medium">
                    {note.authorName ?? "Nepoznat"}
                  </span>
                  <span className="num text-ink-faint text-xs">{datumVreme(note.created_at)}</span>
                  {edited ? <span className="text-ink-faint text-xs">· izmenjena</span> : null}
                  {mine ? (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Izmeni belešku"
                        disabled={pending}
                        onClick={() => setEditingId(editingId === note.id ? null : note.id)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Obriši belešku"
                        disabled={pending}
                        onClick={() => {
                          if (confirm("Obrisati belešku?")) run(() => deleteCustomerNote(note.id));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  ) : null}
                </div>

                {editingId === note.id ? (
                  <EditForm
                    body={note.body}
                    pending={pending}
                    onCancel={() => setEditingId(null)}
                    onSave={(body) =>
                      run(
                        () => editCustomerNote(note.id, body),
                        () => setEditingId(null),
                      )
                    }
                  />
                ) : (
                  <p className="text-ink-soft mt-2 text-sm break-words whitespace-pre-wrap">
                    <Linkify text={note.body} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={onSubmit} className="space-y-2">
        <input type="hidden" name="customer_id" value={customerId} />
        <Textarea
          name="body"
          rows={2}
          required
          maxLength={CUSTOMER_NOTE_MAX}
          placeholder="Npr. „uvek traži da se javi pre slanja“ ili „kupuje za teretanu“…"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            Sačuvaj belešku
          </Button>
        </div>
      </form>
    </section>
  );
}

function EditForm({
  body,
  pending,
  onCancel,
  onSave,
}: {
  body: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [value, setValue] = useState(body);
  const trimmed = value.trim();
  return (
    <div className="mt-2 space-y-2">
      <Textarea
        rows={3}
        maxLength={CUSTOMER_NOTE_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Otkaži
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || !trimmed || trimmed === body}
          onClick={() => onSave(trimmed)}
        >
          Sačuvaj
        </Button>
      </div>
    </div>
  );
}
