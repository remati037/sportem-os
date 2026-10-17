"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquarePlus, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AI_TITLE_MAX } from "@/lib/validation/ai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { deleteConversation, renameConversation } from "./actions";

export type ConversationItem = { id: string; title: string; updated_at: string };

/*
 * Lista razgovora (leva kolona na desktopu, Sheet na telefonu). Lista je
 * lokalno stanje u `AsistentShell`-u — nov razgovor i auto-naslov se pojave
 * odmah, bez čekanja na osvežavanje strane.
 */
export function ConversationList({
  items,
  activeId,
  onNew,
  onRenamed,
  onDeleted,
  onNavigate,
}: {
  items: ConversationItem[];
  activeId: string | null;
  onNew: () => void;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ConversationItem | null>(null);
  const [deleting, setDeleting] = useState<ConversationItem | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const visible = q ? items.filter((c) => c.title.toLowerCase().includes(q)) : items;

  function submitRename() {
    if (!renaming) return;
    const id = renaming.id;
    const title = draft.trim();
    startTransition(async () => {
      const res = await renameConversation(id, title);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      onRenamed(id, title);
      setRenaming(null);
    });
  }

  function submitDelete() {
    if (!deleting) return;
    const id = deleting.id;
    startTransition(async () => {
      const res = await deleteConversation(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      onDeleted(id);
      setDeleting(null);
      toast.success("Razgovor je obrisan.");
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Button type="button" onClick={onNew} className="w-full">
        <MessageSquarePlus /> Nov razgovor
      </Button>

      <div className="relative">
        <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pretraži razgovore"
          className="pl-9"
          aria-label="Pretraži razgovore"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-ink-faint px-2 py-4 text-sm">
            {items.length === 0 ? "Još nema razgovora." : "Nema razgovora za ovu pretragu."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((c) => (
              <li key={c.id} className="group relative">
                <Link
                  href={`/asistent/${c.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "block truncate rounded-md py-2 pr-9 pl-3 text-sm",
                    c.id === activeId
                      ? "bg-green-soft text-green-deep font-medium"
                      : "text-ink hover:bg-surface-2",
                  )}
                >
                  {c.title}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Akcije razgovora"
                      className="absolute top-1/2 right-1 size-7 -translate-y-1/2 border-0 bg-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(c.title);
                        setRenaming(c);
                      }}
                    >
                      <Pencil /> Preimenuj
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setDeleting(c)}
                      className="text-danger focus:text-danger"
                    >
                      <Trash2 /> Obriši
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Preimenuj razgovor</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
            className="space-y-4"
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={AI_TITLE_MAX}
              autoFocus
              aria-label="Naslov"
            />
            <DialogFooter>
              <Button type="button" variant="subtle" onClick={() => setRenaming(null)}>
                Otkaži
              </Button>
              <Button type="submit" disabled={pending || !draft.trim()}>
                Sačuvaj
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Obriši razgovor?</DialogTitle>
          </DialogHeader>
          <p className="text-ink-soft text-sm">
            „{deleting?.title}“ i sve poruke u njemu biće trajno obrisani.
          </p>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setDeleting(null)}>
              Otkaži
            </Button>
            <Button type="button" variant="danger" disabled={pending} onClick={submitDelete}>
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
