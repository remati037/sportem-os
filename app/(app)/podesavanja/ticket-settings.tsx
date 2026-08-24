"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { TicketColumnRow, TicketPriorityRow, TicketTagRow } from "@/db/tickets-config";
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

import { StatusPill } from "../porudzbine/status-pill";
import {
  deleteTicketColumn,
  deleteTicketPriority,
  deleteTicketTag,
  setTicketTagArchived,
  upsertTicketColumn,
  upsertTicketPriority,
  upsertTicketTag,
  type SettingsActionState,
} from "./actions";

const initial: SettingsActionState = { error: null };

type Run = (fn: () => Promise<SettingsActionState>, onOk?: () => void) => void;

/*
 * Podešavanja modula Tiketi (Korak T1, Admin-only): kolone board-a, prioriteti
 * i tagovi. Obrazac iz `status-settings.tsx` — server akcije + toast + refresh.
 * Menadžer i Logistika ove sekcije ne vide (page ih ne renderuje, RLS blokira write).
 */
export function TicketSettings({
  columns,
  priorities,
  tags,
}: {
  columns: TicketColumnRow[];
  priorities: TicketPriorityRow[];
  tags: TicketTagRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run: Run = (fn, onOk) => {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      onOk?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-10">
      <ColumnsSection columns={columns} pending={pending} run={run} />
      <PrioritiesSection priorities={priorities} pending={pending} run={run} />
      <TagsSection tags={tags} pending={pending} run={run} />
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        <p className="text-ink-soft text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Rows({ empty, children }: { empty: string; children: ReactNode }) {
  return (
    <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
      {children ?? <p className="text-ink-soft px-4 py-6 text-sm">{empty}</p>}
    </div>
  );
}

/* ── Kolone board-a ─────────────────────────────────────────────────────── */

function ColumnsSection({
  columns,
  pending,
  run,
}: {
  columns: TicketColumnRow[];
  pending: boolean;
  run: Run;
}) {
  const nextSort = columns.reduce((max, c) => Math.max(max, c.sort_order), 0) + 1;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Kolone board-a"
        description={'Naziv, boja, redosled, „završna kolona" i soft WIP limit.'}
        action={
          <ColumnDialog
            mode="create"
            nextSort={nextSort}
            pending={pending}
            run={run}
            trigger={
              <Button>
                <Plus /> Dodaj kolonu
              </Button>
            }
          />
        }
      />
      <Rows empty="Još nema kolona.">
        {columns.length === 0
          ? null
          : columns.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <StatusPill name={c.name} color={c.color} />
                <span className="num text-ink-faint text-xs">redosled: {c.sort_order}</span>
                {c.is_done ? (
                  <span className="text-green text-xs font-semibold">završna</span>
                ) : null}
                <span className="num text-ink-faint text-xs">
                  WIP: {c.wip_limit ?? "bez limita"}
                </span>
                <span className="text-ink-faint ml-auto font-mono text-xs">{c.color ?? "—"}</span>
                <ColumnDialog
                  mode="edit"
                  column={c}
                  nextSort={c.sort_order}
                  pending={pending}
                  run={run}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="Izmeni kolonu">
                      <Pencil />
                    </Button>
                  }
                />
                <Button
                  variant="danger"
                  size="icon-sm"
                  disabled={pending}
                  aria-label="Obriši kolonu"
                  onClick={() => {
                    if (confirm(`Obrisati kolonu „${c.name}"?`))
                      run(() => deleteTicketColumn(c.id));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
      </Rows>
    </div>
  );
}

function ColumnDialog({
  mode,
  column,
  nextSort,
  pending,
  run,
  trigger,
}: {
  mode: "create" | "edit";
  column?: TicketColumnRow;
  nextSort: number;
  pending: boolean;
  run: Run;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(column?.color ?? "#6B7280");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("color", color);
    if (mode === "edit" && column) fd.set("id", column.id);
    run(
      () => upsertTicketColumn(initial, fd),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nova kolona" : "Izmena kolone"}</DialogTitle>
          <DialogDescription>Kolona kanban board-a — naziv, boja i pravila.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="column-name">Naziv</Label>
            <Input
              id="column-name"
              name="name"
              required
              defaultValue={column?.name ?? ""}
              autoFocus
            />
          </div>
          <ColorField color={color} setColor={setColor} id="column-color" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="column-sort">Redosled</Label>
              <Input
                id="column-sort"
                name="sort_order"
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                required
                defaultValue={column?.sort_order ?? nextSort}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="column-wip">WIP limit</Label>
              <Input
                id="column-wip"
                name="wip_limit"
                type="number"
                inputMode="numeric"
                step={1}
                min={1}
                placeholder="bez limita"
                defaultValue={column?.wip_limit ?? ""}
              />
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="is_done"
              defaultChecked={column?.is_done ?? false}
              className="mt-0.5 size-5 shrink-0 accent-[#1B7A45]"
            />
            <span>
              <span className="text-ink block text-sm font-medium">Završna kolona</span>
              <span className="text-ink-soft block text-sm">
                Tiket koji uđe ovde dobija datum završetka.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === "create" ? "Dodaj" : "Sačuvaj"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Prioriteti ─────────────────────────────────────────────────────────── */

function PrioritiesSection({
  priorities,
  pending,
  run,
}: {
  priorities: TicketPriorityRow[];
  pending: boolean;
  run: Run;
}) {
  const nextSort = priorities.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
  const nextLevel = priorities.reduce((max, p) => Math.max(max, p.level), 0) + 1;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Prioriteti"
        description="Naziv, boja, nivo i podrazumevani prioritet novog tiketa."
        action={
          <PriorityDialog
            mode="create"
            nextSort={nextSort}
            nextLevel={nextLevel}
            pending={pending}
            run={run}
            trigger={
              <Button>
                <Plus /> Dodaj prioritet
              </Button>
            }
          />
        }
      />
      <Rows empty="Još nema prioriteta.">
        {priorities.length === 0
          ? null
          : priorities.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <StatusPill name={p.name} color={p.color} />
                <span className="num text-ink-faint text-xs">nivo: {p.level}</span>
                {p.is_default ? (
                  <span className="text-green text-xs font-semibold">podrazumevani</span>
                ) : null}
                <span className="text-ink-faint ml-auto font-mono text-xs">{p.color ?? "—"}</span>
                <PriorityDialog
                  mode="edit"
                  priority={p}
                  nextSort={p.sort_order}
                  nextLevel={p.level}
                  pending={pending}
                  run={run}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="Izmeni prioritet">
                      <Pencil />
                    </Button>
                  }
                />
                <Button
                  variant="danger"
                  size="icon-sm"
                  disabled={pending}
                  aria-label="Obriši prioritet"
                  onClick={() => {
                    if (confirm(`Obrisati prioritet „${p.name}"? Tiketi ostaju bez prioriteta.`))
                      run(() => deleteTicketPriority(p.id));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
      </Rows>
    </div>
  );
}

function PriorityDialog({
  mode,
  priority,
  nextSort,
  nextLevel,
  pending,
  run,
  trigger,
}: {
  mode: "create" | "edit";
  priority?: TicketPriorityRow;
  nextSort: number;
  nextLevel: number;
  pending: boolean;
  run: Run;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(priority?.color ?? "#6B7280");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("color", color);
    if (mode === "edit" && priority) fd.set("id", priority.id);
    run(
      () => upsertTicketPriority(initial, fd),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novi prioritet" : "Izmena prioriteta"}</DialogTitle>
          <DialogDescription>Viši nivo = hitnije. Podrazumevani je samo jedan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="priority-name">Naziv</Label>
            <Input
              id="priority-name"
              name="name"
              required
              defaultValue={priority?.name ?? ""}
              autoFocus
            />
          </div>
          <ColorField color={color} setColor={setColor} id="priority-color" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="priority-level">Nivo</Label>
              <Input
                id="priority-level"
                name="level"
                type="number"
                inputMode="numeric"
                step={1}
                min={1}
                required
                defaultValue={priority?.level ?? nextLevel}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority-sort">Redosled</Label>
              <Input
                id="priority-sort"
                name="sort_order"
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                required
                defaultValue={priority?.sort_order ?? nextSort}
              />
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="is_default"
              defaultChecked={priority?.is_default ?? false}
              className="mt-0.5 size-5 shrink-0 accent-[#1B7A45]"
            />
            <span>
              <span className="text-ink block text-sm font-medium">Podrazumevani</span>
              <span className="text-ink-soft block text-sm">
                Nov tiket dobija ovaj prioritet; stari podrazumevani se skida.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === "create" ? "Dodaj" : "Sačuvaj"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Tagovi ─────────────────────────────────────────────────────────────── */

function TagsSection({ tags, pending, run }: { tags: TicketTagRow[]; pending: boolean; run: Run }) {
  const nextSort = tags.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Tagovi"
        description="Arhiviran tag se ne nudi na novim tiketima, ali ostaje na starim."
        action={
          <TagDialog
            mode="create"
            nextSort={nextSort}
            pending={pending}
            run={run}
            trigger={
              <Button>
                <Plus /> Dodaj tag
              </Button>
            }
          />
        }
      />
      <Rows empty="Još nema tagova.">
        {tags.length === 0
          ? null
          : tags.map((t) => {
              const archived = t.archived_at != null;
              return (
                <div
                  key={t.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${archived ? "opacity-60" : ""}`}
                >
                  <StatusPill name={t.name} color={t.color} />
                  <span className="num text-ink-faint text-xs">redosled: {t.sort_order}</span>
                  {archived ? <span className="text-ink-soft text-xs">arhiviran</span> : null}
                  <span className="text-ink-faint ml-auto font-mono text-xs">{t.color ?? "—"}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={archived ? "Vrati tag iz arhive" : "Arhiviraj tag"}
                    title={archived ? "Vrati iz arhive" : "Arhiviraj"}
                    onClick={() => run(() => setTicketTagArchived(t.id, !archived))}
                  >
                    {archived ? <ArchiveRestore /> : <Archive />}
                  </Button>
                  <TagDialog
                    mode="edit"
                    tag={t}
                    nextSort={t.sort_order}
                    pending={pending}
                    run={run}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label="Izmeni tag">
                        <Pencil />
                      </Button>
                    }
                  />
                  <Button
                    variant="danger"
                    size="icon-sm"
                    disabled={pending}
                    aria-label="Obriši tag"
                    onClick={() => {
                      if (
                        confirm(
                          `Obrisati tag „${t.name}"? Skinuće se sa svih tiketa — arhiviranje je bezbednije.`,
                        )
                      )
                        run(() => deleteTicketTag(t.id));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
      </Rows>
    </div>
  );
}

function TagDialog({
  mode,
  tag,
  nextSort,
  pending,
  run,
  trigger,
}: {
  mode: "create" | "edit";
  tag?: TicketTagRow;
  nextSort: number;
  pending: boolean;
  run: Run;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(tag?.color ?? "#6B7280");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("color", color);
    if (mode === "edit" && tag) fd.set("id", tag.id);
    run(
      () => upsertTicketTag(initial, fd),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novi tag" : "Izmena taga"}</DialogTitle>
          <DialogDescription>Naziv, boja i redosled u izboru.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Naziv</Label>
            <Input id="tag-name" name="name" required defaultValue={tag?.name ?? ""} autoFocus />
          </div>
          <ColorField color={color} setColor={setColor} id="tag-color" />
          <div className="space-y-1.5">
            <Label htmlFor="tag-sort">Redosled</Label>
            <Input
              id="tag-sort"
              name="sort_order"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              required
              defaultValue={tag?.sort_order ?? nextSort}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === "create" ? "Dodaj" : "Sačuvaj"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Zajedničko polje za boju (heks + color picker) — obrazac iz status-settings. */
function ColorField({
  id,
  color,
  setColor,
}: {
  id: string;
  color: string;
  setColor: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Boja</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="border-border h-9 w-12 cursor-pointer rounded-md border"
        />
        <Input
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-32 font-mono"
          aria-label="Heks boja"
        />
      </div>
    </div>
  );
}
