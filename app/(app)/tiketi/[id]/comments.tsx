"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { TicketCommentRow } from "@/db/tickets";
import { datumVreme } from "@/lib/format";
import { initials } from "@/lib/tickets";
import { Linkify } from "@/components/patterns/linkify";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { addComment, deleteComment, editComment, type TicketActionState } from "../actions";

/*
 * Nit komentara na detalju tiketa (Korak T4).
 *
 * Komentar sme da menja i briše SAMO njegov autor — ovde se dugmad samo
 * skrivaju, prava provera je u server akciji (RLS pušta ceo tim na tabelu).
 * Telo je običan tekst; `Linkify` pretvara URL-ove, „SPT-42" i „#2419" u linkove.
 */

const initial: TicketActionState = { error: null };

export function Comments({
  ticketId,
  comments,
  currentUserId,
}: {
  ticketId: string;
  comments: TicketCommentRow[];
  /** Ulogovani korisnik — samo njegovi komentari dobijaju „Izmeni"/„Obriši". */
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  function run(fn: () => Promise<TicketActionState>, after?: () => void) {
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
      () => addComment(initial, fd),
      () => form.reset(),
    );
  }

  return (
    <section className="mb-6">
      <h2 className="text-ink mb-3 text-base font-semibold">
        Komentari{comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>

      {comments.length === 0 ? (
        <p className="text-ink-soft mb-3 text-sm">Još nema komentara.</p>
      ) : (
        <ol className="mb-3 space-y-2">
          {comments.map((comment) => {
            const mine = comment.author_id != null && comment.author_id === currentUserId;
            const edited = comment.updated_at !== comment.created_at;

            return (
              <li
                key={comment.id}
                className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-surface-2 text-ink-soft flex size-6 items-center justify-center rounded-full text-[0.625rem] font-semibold">
                    {initials(comment.authorName)}
                  </span>
                  <span className="text-ink text-sm font-medium">
                    {comment.authorName ?? "Nepoznat"}
                  </span>
                  <span className="num text-ink-faint text-xs">
                    {datumVreme(comment.created_at)}
                  </span>
                  {edited ? <span className="text-ink-faint text-xs">· izmenjen</span> : null}

                  {mine ? (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Izmeni komentar"
                        disabled={pending}
                        onClick={() => setEditingId(editingId === comment.id ? null : comment.id)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Obriši komentar"
                        disabled={pending}
                        onClick={() => {
                          if (confirm("Obrisati komentar?")) run(() => deleteComment(comment.id));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  ) : null}
                </div>

                {editingId === comment.id ? (
                  <EditForm
                    body={comment.body}
                    pending={pending}
                    onCancel={() => setEditingId(null)}
                    onSave={(body) =>
                      run(
                        () => editComment(comment.id, body),
                        () => setEditingId(null),
                      )
                    }
                  />
                ) : (
                  <p className="text-ink-soft mt-2 text-sm whitespace-pre-wrap">
                    <Linkify text={comment.body} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={onSubmit} className="space-y-2">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <Textarea
          name="body"
          rows={3}
          required
          maxLength={4000}
          placeholder="Napiši komentar… (možeš pomenuti SPT-12 ili #2419)"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            Pošalji
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
        maxLength={4000}
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
