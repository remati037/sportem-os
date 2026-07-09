"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { OrderStatusRow } from "@/db/orders";
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
import { deleteOrderStatus, upsertOrderStatus, type SettingsActionState } from "./actions";

const initial: SettingsActionState = { error: null };

/*
 * CRUD nad statusima porudžbine (Korak 1.4, Admin). Naziv, boja (heks) i
 * redosled. Statusi u upotrebi se ne mogu obrisati (server vraća poruku).
 */
export function StatusSettings({ statuses }: { statuses: OrderStatusRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<SettingsActionState>, onOk?: () => void) {
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
  }

  const nextSort = statuses.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <StatusFormDialog
          mode="create"
          nextSort={nextSort}
          pending={pending}
          run={run}
          trigger={
            <Button>
              <Plus /> Dodaj status
            </Button>
          }
        />
      </div>

      <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
        {statuses.length === 0 ? (
          <p className="text-ink-soft px-4 py-6 text-sm">Još nema statusa.</p>
        ) : (
          statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <StatusPill name={s.name} color={s.color} />
              <span className="num text-ink-faint text-xs">redosled: {s.sort_order}</span>
              <span className="text-ink-faint ml-auto font-mono text-xs">{s.color ?? "—"}</span>
              <StatusFormDialog
                mode="edit"
                status={s}
                nextSort={s.sort_order}
                pending={pending}
                run={run}
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label="Izmeni status">
                    <Pencil />
                  </Button>
                }
              />
              <Button
                variant="danger"
                size="icon-sm"
                disabled={pending}
                aria-label="Obriši status"
                onClick={() => {
                  if (confirm(`Obrisati status „${s.name}"?`)) run(() => deleteOrderStatus(s.id));
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusFormDialog({
  mode,
  status,
  nextSort,
  pending,
  run,
  trigger,
}: {
  mode: "create" | "edit";
  status?: OrderStatusRow;
  nextSort: number;
  pending: boolean;
  run: (fn: () => Promise<SettingsActionState>, onOk?: () => void) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(status?.color ?? "#6B7280");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("color", color);
    if (mode === "edit" && status) fd.set("id", status.id);
    run(
      () => upsertOrderStatus(initial, fd),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novi status" : "Izmena statusa"}</DialogTitle>
          <DialogDescription>Naziv, boja i redosled prikaza u toku porudžbine.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Naziv</Label>
            <Input id="name" name="name" required defaultValue={status?.name ?? ""} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="color">Boja</Label>
            <div className="flex items-center gap-2">
              <input
                id="color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="border-border h-9 w-12 cursor-pointer rounded-md border"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-32 font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sort_order">Redosled</Label>
            <Input
              id="sort_order"
              name="sort_order"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              required
              defaultValue={status?.sort_order ?? nextSort}
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
