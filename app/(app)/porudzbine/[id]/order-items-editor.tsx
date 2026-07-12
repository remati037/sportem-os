"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote, Hash, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { OrderItemRow, VariantOption } from "@/db/orders";
import { rsd } from "@/lib/format";
import { RowActions } from "@/components/patterns/row-actions";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  addItemFromCatalog,
  deleteItem,
  setItemVp,
  updateItemPrice,
  updateItemQuantity,
  type OrderActionState,
} from "../actions";

const initial: OrderActionState = { error: null };

type RunFn = (fn: () => Promise<OrderActionState>, onOk?: () => void) => void;

/*
 * Stavke sa ZAMRZNUTIM cenama + admin edit (Korak 1.2). Izmene diraju samo
 * zamrznute vrednosti ove porudžbine — katalog netaknut. Fakturisana
 * porudžbina → editor zaključan (server akcije svakako blokiraju).
 * Desktop = tabela, mobilni = kartice; sve akcije kroz „⋮" meni.
 */
export function OrderItemsEditor({
  orderId,
  items,
  isAdmin,
  locked,
  variantOptions,
}: {
  orderId: string;
  items: OrderItemRow[];
  isAdmin: boolean;
  locked: boolean;
  variantOptions: VariantOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const canEdit = isAdmin && !locked;

  const run: RunFn = (fn, onOk) => {
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
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-ink text-base font-semibold">Stavke</h2>
        {isAdmin && locked ? (
          <span className="text-ink-soft inline-flex items-center gap-1.5 text-sm">
            <Lock className="size-3.5" /> Porudžbina je fakturisana — stavke su zaključane.
          </span>
        ) : null}
        {canEdit ? (
          <AddItemDialog
            orderId={orderId}
            variantOptions={variantOptions}
            pending={pending}
            run={run}
          />
        ) : null}
      </div>

      {/* Mobilni: kartice umesto horizontalnog skrola. */}
      <MobileCardList>
        {items.length === 0 ? (
          <div className="border-border bg-surface shadow-soft rounded-lg border">
            <p className="text-ink-soft px-4 py-6 text-center text-sm">Porudžbina nema stavki.</p>
          </div>
        ) : (
          items.map((item) => (
            <MobileCard key={item.id}>
              <MobileCardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {item.product_name}
                    {item.vp_at_sale == null ? <Badge variant="warning">Nedostaje VP</Badge> : null}
                  </span>
                }
                subtitle={<span className="num">{item.sku}</span>}
                trailing={
                  canEdit ? <ItemActions item={item} pending={pending} run={run} /> : undefined
                }
              />
              <div className="mt-3 space-y-1.5">
                <MobileCardField label="Količina">
                  <span className="num">{item.quantity}</span>
                </MobileCardField>
                <MobileCardField label="MP">
                  <span className="num">{rsd(item.mp_at_sale)}</span>
                </MobileCardField>
                <MobileCardField label="VP">
                  <span className="num">{item.vp_at_sale != null ? rsd(item.vp_at_sale) : "—"}</span>
                </MobileCardField>
                <MobileCardField label="Zarada">
                  <span className="num text-green-deep font-medium">
                    {item.profit_at_sale != null ? rsd(item.profit_at_sale) : "—"}
                  </span>
                </MobileCardField>
              </div>
            </MobileCard>
          ))
        )}
      </MobileCardList>

      <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">SKU</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4">Artikal</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Kol.</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">MP</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">VP</TableHead>
              <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">Zarada</TableHead>
              {canEdit ? <TableHead className="eyebrow bg-surface-2 h-9 w-12 px-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="border-border hover:bg-green-soft">
                <TableCell className="num text-ink px-4 py-2.5 font-medium">{item.sku}</TableCell>
                <TableCell className="text-ink px-4 py-2.5 whitespace-normal">
                  {item.product_name}
                  {item.vp_at_sale == null ? (
                    <Badge variant="warning" className="ml-2">
                      Nedostaje VP
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="num px-4 py-2.5 text-right">{item.quantity}</TableCell>
                <TableCell className="num px-4 py-2.5 text-right">{rsd(item.mp_at_sale)}</TableCell>
                <TableCell className="num px-4 py-2.5 text-right">
                  {item.vp_at_sale != null ? rsd(item.vp_at_sale) : "—"}
                </TableCell>
                <TableCell className="num text-green-deep px-4 py-2.5 text-right font-medium">
                  {item.profit_at_sale != null ? rsd(item.profit_at_sale) : "—"}
                </TableCell>
                {canEdit ? (
                  <TableCell className="px-4 py-2 text-right">
                    <ItemActions item={item} pending={pending} run={run} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 7 : 6}
                  className="text-ink-soft px-4 py-6 text-center text-sm"
                >
                  Porudžbina nema stavki.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/** „⋮" akcije stavke — MP, količina, VP, brisanje. Dijalozi su kontrolisani. */
function ItemActions({
  item,
  pending,
  run,
}: {
  item: OrderItemRow;
  pending: boolean;
  run: RunFn;
}) {
  const [openDialog, setOpenDialog] = useState<"mp" | "qty" | "vp" | null>(null);

  return (
    <>
      <RowActions label={`Akcije za ${item.sku}`}>
        <DropdownMenuItem onSelect={() => setOpenDialog("mp")}>
          <Pencil /> Izmeni MP cenu
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setOpenDialog("qty")}>
          <Hash /> Izmeni količinu
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setOpenDialog("vp")}>
          <Banknote /> {item.vp_at_sale == null ? "Unesi VP cenu" : "Izmeni VP cenu"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => {
            if (confirm(`Obrisati stavku „${item.sku}" iz porudžbine?`))
              run(() => deleteItem(item.id));
          }}
        >
          <Trash2 /> Obriši
        </DropdownMenuItem>
      </RowActions>

      <NumberFieldDialog
        open={openDialog === "mp"}
        onOpenChange={(o) => setOpenDialog(o ? "mp" : null)}
        title="Izmeni MP cenu (popust)"
        description="Menja samo zamrznutu cenu ove stavke — katalog ostaje netaknut."
        label="MP cena (RSD)"
        name="mp_at_sale"
        defaultValue={item.mp_at_sale}
        min={0}
        pending={pending}
        onSubmit={(fd) => {
          fd.set("item_id", item.id);
          return updateItemPrice(initial, fd);
        }}
        run={run}
      />
      <NumberFieldDialog
        open={openDialog === "qty"}
        onOpenChange={(o) => setOpenDialog(o ? "qty" : null)}
        title="Izmeni količinu"
        description="Zamrznute cene po komadu ostaju iste."
        label="Količina"
        name="quantity"
        defaultValue={item.quantity}
        min={1}
        pending={pending}
        onSubmit={(fd) => {
          fd.set("item_id", item.id);
          return updateItemQuantity(initial, fd);
        }}
        run={run}
      />
      <NumberFieldDialog
        open={openDialog === "vp"}
        onOpenChange={(o) => setOpenDialog(o ? "vp" : null)}
        title={item.vp_at_sale == null ? "Unesi VP cenu" : "Izmeni VP cenu"}
        description={`VP koja je važila u trenutku prodaje. Unos skida oznaku „Nedostaje VP" kad su sve stavke pokrivene.`}
        label="VP cena (RSD)"
        name="vp_at_sale"
        defaultValue={item.vp_at_sale ?? undefined}
        min={0}
        pending={pending}
        onSubmit={(fd) => {
          fd.set("item_id", item.id);
          return setItemVp(initial, fd);
        }}
        run={run}
      />
    </>
  );
}

/** Kontrolisan dijalog sa jednim numeričkim poljem — MP, količina ili VP. */
function NumberFieldDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  name,
  defaultValue,
  min,
  pending,
  onSubmit,
  run,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  name: string;
  defaultValue?: number;
  min: number;
  pending: boolean;
  onSubmit: (fd: FormData) => Promise<OrderActionState>;
  run: RunFn;
}) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(
      () => onSubmit(fd),
      () => onOpenChange(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={name}>{label}</Label>
            <Input
              id={name}
              name={name}
              type="number"
              inputMode="numeric"
              step={1}
              min={min}
              defaultValue={defaultValue}
              required
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => onOpenChange(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              Sačuvaj
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** „Dodaj stavku" — izbor aktivne varijante; snapshot MP/VP pravi server akcija. */
function AddItemDialog({
  orderId,
  variantOptions,
  pending,
  run,
}: {
  orderId: string;
  variantOptions: VariantOption[];
  pending: boolean;
  run: RunFn;
}) {
  const [open, setOpen] = useState(false);
  const [variantId, setVariantId] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("order_id", orderId);
    fd.set("variant_id", variantId);
    run(
      () => addItemFromCatalog(initial, fd),
      () => {
        setOpen(false);
        setVariantId("");
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Dodaj stavku
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj stavku iz kataloga</DialogTitle>
          <DialogDescription>
            MP i VP se zamrzavaju po trenutnim cenama iz kataloga u trenutku dodavanja.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Artikal</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Izaberite artikal…" />
              </SelectTrigger>
              <SelectContent>
                {variantOptions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="num">{v.sku}</span> — {v.product_name}
                    {v.variant_name ? ` (${v.variant_name})` : ""} · {rsd(v.mp_price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Količina</Label>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              step={1}
              min={1}
              defaultValue={1}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending || !variantId}>
              Dodaj
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
