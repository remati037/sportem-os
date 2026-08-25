"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";

import type { StaffProfile } from "@/db/profiles";
import type { TicketLinkOption, TicketListRow } from "@/db/tickets";
import type { TicketColumnRow, TicketPriorityRow, TicketTagRow } from "@/db/tickets-config";
import { initials } from "@/lib/tickets";
import { cn } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { createTicket, searchTicketLinks, updateTicket, type TicketActionState } from "./actions";

/*
 * Kreiranje i izmena tiketa (Korak T2). Jedan dijalog za oba slučaja —
 * obrazac iz `troskovi/expense-dialog.tsx` (server akcija + toast + refresh).
 * Veze (porudžbina / artikal / kupac / „čeka tiket") su OPCIONE i biraju se
 * pretragom; „nema veze" se šalje kao „none" (Select ne sme prazan value).
 */

const initial: TicketActionState = { error: null };
const NONE = "none";

export type TicketOptions = {
  columns: TicketColumnRow[];
  priorities: TicketPriorityRow[];
  tags: TicketTagRow[];
  staff: StaffProfile[];
};

type LinkKind = "order" | "variant" | "customer" | "ticket";

/**
 * Unapred popunjene veze za NOV tiket (Korak T6) — „Napravi tiket" sa detalja
 * porudžbine ili proizvoda. Kod izmene se ignorišu (tada vrede veze tiketa).
 */
export type TicketPrefill = {
  order?: TicketLinkOption | null;
  variant?: TicketLinkOption | null;
  customer?: TicketLinkOption | null;
  /** Pretraga koja se odmah nudi u biraču artikla (proizvod sa više varijanti). */
  variantTerm?: string;
};

export function TicketDialog({
  options,
  ticket,
  defaultColumnId,
  prefill,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  options: TicketOptions;
  /** Zadat = izmena; prazan = kreiranje. */
  ticket?: TicketListRow;
  /** Kolona u koju pada nov tiket (npr. „+" u zaglavlju kolone). */
  defaultColumnId?: string;
  /** Pred-popunjene veze pri kreiranju (detalj porudžbine / proizvoda). */
  prefill?: TicketPrefill;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange?.(o) : setUncontrolledOpen(o));

  // Sadržaj (i sve stanje forme) živi UNUTAR DialogContent-a, koji Radix
  // demontira pri zatvaranju — pa se pri svakom otvaranju polja iznova pune iz
  // svežih podataka (posle `router.refresh()` nema zastarelog prikaza).
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <TicketForm
          options={options}
          ticket={ticket}
          defaultColumnId={defaultColumnId}
          prefill={prefill}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TicketForm({
  options,
  ticket,
  defaultColumnId,
  prefill,
  onDone,
}: {
  options: TicketOptions;
  ticket?: TicketListRow;
  defaultColumnId?: string;
  prefill?: TicketPrefill;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isEdit = Boolean(ticket);
  const { columns, priorities, staff } = options;

  // Izbor tagova: aktivni + oni koji su VEĆ na tiketu (arhiviran tag ostaje na
  // starim tiketima, ali se ne nudi novima — pravilo iz T1).
  const tags = [
    ...options.tags,
    ...(ticket?.tags ?? [])
      .filter((t) => !options.tags.some((o) => o.id === t.id))
      .map((t) => ({ ...t, sort_order: 999, archived_at: null })),
  ];

  const fallbackColumn = defaultColumnId ?? columns[0]?.id ?? "";
  const fallbackPriority = priorities.find((p) => p.is_default)?.id ?? NONE;

  const [columnId, setColumnId] = useState(ticket?.column_id ?? fallbackColumn);
  const [priorityId, setPriorityId] = useState(ticket?.priority_id ?? fallbackPriority);
  const [assignees, setAssignees] = useState<string[]>(
    ticket?.assignees.map((a) => a.user_id) ?? [],
  );
  const [tagIds, setTagIds] = useState<string[]>(ticket?.tags.map((t) => t.id) ?? []);

  // Pri IZMENI vrede veze samog tiketa; `prefill` važi samo za nov tiket.
  const [orderLink, setOrderLink] = useState<TicketLinkOption | null>(
    ticket?.order
      ? {
          id: ticket.order.id,
          label:
            ticket.order.woo_order_id != null ? `#${ticket.order.woo_order_id}` : "Bez Woo broja",
          hint: ticket.order.ship_name ?? undefined,
        }
      : isEdit
        ? null
        : (prefill?.order ?? null),
  );
  const [variantLink, setVariantLink] = useState<TicketLinkOption | null>(
    ticket?.variant
      ? { id: ticket.variant.id, label: ticket.variant.sku, hint: ticket.variant.label }
      : isEdit
        ? null
        : (prefill?.variant ?? null),
  );
  const [customerLink, setCustomerLink] = useState<TicketLinkOption | null>(
    ticket?.customer
      ? {
          id: ticket.customer.id,
          label: ticket.customer.name ?? "Bez imena",
          hint: ticket.customer.phone ?? undefined,
        }
      : isEdit
        ? null
        : (prefill?.customer ?? null),
  );
  const [blockedLink, setBlockedLink] = useState<TicketLinkOption | null>(
    ticket?.blocked_by
      ? {
          id: ticket.blocked_by.id,
          label: `SPT-${ticket.blocked_by.code}`,
          hint: ticket.blocked_by.title,
        }
      : null,
  );

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = isEdit ? await updateTicket(initial, fd) : await createTicket(initial, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      onDone();
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Izmeni tiket" : "Novi tiket"}</DialogTitle>
        <DialogDescription>
          Veze na porudžbinu, artikal i kupca su opcione — tiket može biti i samostalan.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="space-y-4">
        {isEdit ? <input type="hidden" name="id" value={ticket!.id} /> : null}
        <input type="hidden" name="column_id" value={columnId} />
        <input type="hidden" name="priority_id" value={priorityId} />
        {assignees.map((id) => (
          <input key={id} type="hidden" name="assignee_ids" value={id} />
        ))}
        {tagIds.map((id) => (
          <input key={id} type="hidden" name="tag_ids" value={id} />
        ))}
        <input type="hidden" name="order_id" value={orderLink?.id ?? NONE} />
        <input type="hidden" name="variant_id" value={variantLink?.id ?? NONE} />
        <input type="hidden" name="customer_id" value={customerLink?.id ?? NONE} />
        <input type="hidden" name="blocked_by_ticket_id" value={blockedLink?.id ?? NONE} />

        <div className="space-y-1.5">
          <Label htmlFor="title">Naslov</Label>
          <Input
            id="title"
            name="title"
            required
            maxLength={160}
            defaultValue={ticket?.title ?? ""}
            placeholder="npr. Pozovi kupca i potvrdi adresu"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Opis (opciono)</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={4000}
            defaultValue={ticket?.description ?? ""}
            placeholder="Detalji zadatka…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="column_select">Kolona</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger id="column_select" className="h-10 w-full">
                <SelectValue placeholder="Izaberi kolonu…" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority_select">Prioritet</Label>
            <Select value={priorityId} onValueChange={setPriorityId}>
              <SelectTrigger id="priority_select" className="h-10 w-full">
                <SelectValue placeholder="Izaberi prioritet…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Bez prioriteta</SelectItem>
                {priorities.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="due_date">Rok (opciono)</Label>
            <Input
              id="due_date"
              name="due_date"
              type="date"
              defaultValue={ticket?.due_date ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estimate_minutes">Procena (min)</Label>
            <Input
              id="estimate_minutes"
              name="estimate_minutes"
              type="number"
              step="1"
              min="1"
              defaultValue={ticket?.estimate_minutes ?? ""}
              placeholder="npr. 30"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Izvršioci</Label>
          {staff.length === 0 ? (
            <p className="text-ink-faint text-sm">Nema korisnika za dodelu.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {staff.map((s) => {
                const active = assignees.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setAssignees((list) => toggle(list, s.id))}
                    aria-pressed={active}
                    className={cn(
                      "rounded-pill flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-green bg-green-soft text-green-deep"
                        : "border-border text-ink-soft hover:bg-surface-2",
                    )}
                  >
                    <span className="bg-surface-2 text-ink-soft flex size-5 items-center justify-center rounded-full text-[0.625rem] font-semibold">
                      {initials(s.full_name)}
                    </span>
                    {s.full_name ?? "Bez imena"}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Tagovi</Label>
          {tags.length === 0 ? (
            <p className="text-ink-faint text-sm">Nema tagova — dodaj ih u Podešavanjima.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = tagIds.includes(t.id);
                const hex = t.color ?? "#6B7280";
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTagIds((list) => toggle(list, t.id))}
                    aria-pressed={active}
                    className="rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors"
                    style={
                      active
                        ? { borderColor: hex, backgroundColor: `${hex}1A`, color: hex }
                        : undefined
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-border space-y-3 border-t pt-4">
          <div className="eyebrow">Veze (opciono)</div>
          <LinkPicker
            kind="order"
            label="Porudžbina"
            placeholder="Broj porudžbine ili ime kupca…"
            value={orderLink}
            onChange={setOrderLink}
          />
          <LinkPicker
            kind="variant"
            label="Artikal"
            placeholder="SKU ili naziv proizvoda…"
            value={variantLink}
            onChange={setVariantLink}
            defaultTerm={isEdit ? undefined : prefill?.variantTerm}
          />
          <LinkPicker
            kind="customer"
            label="Kupac"
            placeholder="Ime ili telefon…"
            value={customerLink}
            onChange={setCustomerLink}
          />
          <LinkPicker
            kind="ticket"
            label="Čeka tiket"
            placeholder="Šifra ili naslov tiketa…"
            value={blockedLink}
            onChange={setBlockedLink}
            excludeId={ticket?.id}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="subtle" onClick={onDone}>
            Otkaži
          </Button>
          <Button type="submit" disabled={pending}>
            {isEdit ? "Sačuvaj izmene" : "Napravi tiket"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/**
 * Izbor opcione veze pretragom. Prazno polje → prvih nekoliko najnovijih;
 * izabrana veza se prikazuje kao čip sa „×" (skidanje veze).
 */
function LinkPicker({
  kind,
  label,
  placeholder,
  value,
  onChange,
  excludeId,
  defaultTerm,
}: {
  kind: LinkKind;
  label: string;
  placeholder: string;
  value: TicketLinkOption | null;
  onChange: (option: TicketLinkOption | null) => void;
  excludeId?: string;
  /** Pretraga koja se odmah izvršava (T6: proizvod sa više varijanti). */
  defaultTerm?: string;
}) {
  const [term, setTerm] = useState(defaultTerm ?? "");
  const [results, setResults] = useState<TicketLinkOption[]>([]);
  const [searching, setSearching] = useState(false);
  // Sa zadatom početnom pretragom lista je odmah otvorena — jedan klik do veze.
  const [openList, setOpenList] = useState(Boolean(defaultTerm) && !value);

  // Debounce pretrage (300ms, kao filter bar porudžbina).
  useEffect(() => {
    if (!openList) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const options = await searchTicketLinks(kind, term, excludeId);
      if (cancelled) return;
      setResults(options);
      setSearching(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, openList, kind, excludeId]);

  if (value) {
    return (
      <div className="space-y-1">
        <Label className="text-ink-faint text-xs">{label}</Label>
        <div className="border-border bg-surface-2 flex items-center justify-between gap-2 rounded-md border px-3 py-2">
          <span className="min-w-0 truncate text-sm">
            <span className="text-ink font-medium">{value.label}</span>
            {value.hint ? <span className="text-ink-faint"> · {value.hint}</span> : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Skini vezu (${label})`}
            onClick={() => {
              onChange(null);
              setTerm("");
              setOpenList(false);
            }}
          >
            <X />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-ink-faint text-xs">{label}</Label>
      <div className="relative">
        <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={term}
          placeholder={placeholder}
          onFocus={() => setOpenList(true)}
          onChange={(e) => setTerm(e.target.value)}
          className="pl-9"
        />
      </div>
      {openList ? (
        <div className="border-border bg-surface max-h-44 overflow-y-auto rounded-md border">
          {searching ? (
            <p className="text-ink-faint px-3 py-2 text-sm">Pretraga…</p>
          ) : results.length === 0 ? (
            <p className="text-ink-faint px-3 py-2 text-sm">Nema rezultata.</p>
          ) : (
            results.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpenList(false);
                }}
                className="hover:bg-surface-2 block w-full px-3 py-2 text-left text-sm"
              >
                <span className="text-ink font-medium">{option.label}</span>
                {option.hint ? <span className="text-ink-faint"> · {option.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
