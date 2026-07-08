"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MoreHorizontalIcon, PackageIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { rsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/patterns/data-table";
import { DataTableColumnHeader } from "@/components/patterns/data-table-column-header";
import { TextField, NumberField, SelectField } from "@/components/patterns/form-fields";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import {
  CardSkeleton,
  FormSkeleton,
  StatCardSkeleton,
  TableSkeleton,
} from "@/components/patterns/loading";

/* Demo podaci ----------------------------------------------------------- */

type Artikal = { sku: string; naziv: string; mp: number; vp: number; stanje: number };

const data: Artikal[] = [
  { sku: "SM021-4", naziv: "Rukavice za trening — M", mp: 2490, vp: 1450, stanje: 24 },
  { sku: "SM021-5", naziv: "Rukavice za trening — L", mp: 2490, vp: 1450, stanje: 3 },
  { sku: "PT100", naziv: "Protein 1kg — čokolada", mp: 3990, vp: 2600, stanje: 0 },
  { sku: "PT101", naziv: "Protein 1kg — vanila", mp: 3990, vp: 2600, stanje: 12 },
  { sku: "BB050", naziv: "Bučice 5kg (par)", mp: 5990, vp: 4100, stanje: 7 },
];

function stanjeBadge(n: number, prag = 5) {
  if (n === 0) return <Badge variant="danger">Nema</Badge>;
  if (n <= prag) return <Badge variant="warning">Pri kraju</Badge>;
  return <Badge variant="success">Na stanju</Badge>;
}

const columns: ColumnDef<Artikal>[] = [
  {
    accessorKey: "sku",
    header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.sku}</span>,
  },
  {
    accessorKey: "naziv",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Naziv" />,
  },
  {
    accessorKey: "mp",
    header: ({ column }) => <DataTableColumnHeader column={column} title="MP" align="right" />,
    cell: ({ row }) => rsd(row.original.mp),
    meta: { align: "right", numeric: true },
  },
  {
    accessorKey: "vp",
    header: ({ column }) => <DataTableColumnHeader column={column} title="VP" align="right" />,
    cell: ({ row }) => rsd(row.original.vp),
    meta: { align: "right", numeric: true },
  },
  {
    id: "zarada",
    accessorFn: (r) => r.mp - r.vp,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Zarada" align="right" />,
    cell: ({ row }) => (
      <span className="text-success font-medium">{rsd(row.original.mp - row.original.vp)}</span>
    ),
    meta: { align: "right", numeric: true },
  },
  {
    accessorKey: "stanje",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Stanje" align="right" />,
    cell: ({ row }) => <div className="text-right">{stanjeBadge(row.original.stanje)}</div>,
    meta: { align: "right" },
  },
];

/* Forma (zod) ----------------------------------------------------------- */

const schema = z.object({
  naziv: z.string().min(2, "Naziv mora imati bar 2 znaka."),
  kategorija: z.string().min(1, "Izaberi kategoriju."),
  mp: z.number({ error: "Unesi cenu." }).int().positive("Cena mora biti veća od 0."),
});
type FormValues = z.infer<typeof schema>;

function DemoForma() {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { naziv: "", kategorija: "", mp: undefined },
  });

  function onSubmit(values: FormValues) {
    toast.success("Sačuvano", { description: `${values.naziv} — ${rsd(values.mp)}` });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-5">
        <TextField
          control={form.control}
          name="naziv"
          label="Naziv proizvoda"
          placeholder="npr. Rukavice za trening"
        />
        <SelectField
          control={form.control}
          name="kategorija"
          label="Kategorija"
          options={[
            { value: "oprema", label: "Oprema" },
            { value: "suplementi", label: "Suplementi" },
            { value: "odeca", label: "Odeća" },
          ]}
        />
        <NumberField
          control={form.control}
          name="mp"
          label="MP cena (RSD)"
          placeholder="2490"
          description="Ceo broj u dinarima, bez decimala."
        />
        <div className="flex gap-3">
          <Button type="submit">Sačuvaj</Button>
          <Button type="button" variant="ghost" onClick={() => form.reset()}>
            Poništi
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* Stranica -------------------------------------------------------------- */

export default function KomponentePage() {
  const [showSkeleton, setShowSkeleton] = React.useState(false);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <div className="eyebrow">Korak 0.3 · shadcn/ui</div>
        <h1 className="text-ink text-[1.75rem] font-bold">Komponente i obrasci</h1>
        <p className="text-ink-soft text-[0.9375rem]">
          Interaktivna biblioteka u brendu — data tabela, forma (zod), dijalozi, toast i stanja.
        </p>
        <Button asChild variant="subtle" size="sm">
          <Link href="/stil">← Tokeni i dizajn sistem</Link>
        </Button>
      </header>

      <Tabs defaultValue="tabela" className="w-full">
        <TabsList>
          <TabsTrigger value="tabela">Data tabela</TabsTrigger>
          <TabsTrigger value="forma">Forma</TabsTrigger>
          <TabsTrigger value="overlay">Dijalozi & Toast</TabsTrigger>
          <TabsTrigger value="stanja">Stanja</TabsTrigger>
        </TabsList>

        {/* Data tabela */}
        <TabsContent value="tabela" className="space-y-4 pt-4">
          <p className="text-ink-soft text-sm">
            Sortiranje (klik na header), pretraga, sticky header, desno poravnate numeričke kolone
            (tnum).
          </p>
          <DataTable
            columns={columns}
            data={data}
            searchKey="naziv"
            searchPlaceholder="Pretraga po nazivu…"
            initialSorting={[{ id: "stanje", desc: false }]}
          />
        </TabsContent>

        {/* Forma */}
        <TabsContent value="forma" className="space-y-4 pt-4">
          <p className="text-ink-soft text-sm">
            react-hook-form + zod validacija. Pošalji praznu formu da vidiš greške; validnu → toast.
          </p>
          <Card className="p-6">
            <DemoForma />
          </Card>
        </TabsContent>

        {/* Overlay + toast */}
        <TabsContent value="overlay" className="space-y-6 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost">Otvori dijalog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Obriši artikal?</DialogTitle>
                  <DialogDescription>
                    Ako artikal ima istorijske porudžbine, biće arhiviran umesto obrisan.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Otkaži</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="danger">Obriši</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Akcije">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Akcije</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Izmeni</DropdownMenuItem>
                <DropdownMenuItem>Arhiviraj</DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Obriši</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="subtle"
              onClick={() => toast.success("Porudžbina označena kao poslata")}
            >
              Toast: uspeh
            </Button>
            <Button variant="subtle" onClick={() => toast.warning("Artikal je pri kraju zaliha")}>
              Toast: upozorenje
            </Button>
            <Button variant="subtle" onClick={() => toast.error("Greška pri čuvanju")}>
              Toast: greška
            </Button>
          </div>
        </TabsContent>

        {/* Stanja */}
        <TabsContent value="stanja" className="space-y-6 pt-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowSkeleton((s) => !s)}>
              {showSkeleton ? "Prikaži sadržaj" : "Prikaži loading"}
            </Button>
          </div>

          {showSkeleton ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </div>
              <TableSkeleton rows={4} cols={5} />
              <div className="grid gap-4 sm:grid-cols-2">
                <CardSkeleton />
                <FormSkeleton />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <EmptyState
                icon={<PackageIcon />}
                title="Nema porudžbina za ovaj period."
                description="Kada stigne prva porudžbina kroz webhook, pojaviće se ovde."
              />
              <ErrorState onRetry={() => toast.info("Ponovni pokušaj…")} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
