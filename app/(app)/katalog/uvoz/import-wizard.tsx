"use client";

import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import Papa from "papaparse";
import { type ChangeEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS, type ImportFieldKey } from "@/lib/validation/catalog";

import { commitImport, previewImport } from "./actions";
import type { ImportItem, ImportReport } from "./types";

const NONE = "__none__";
const MAX_ERROR_ROWS = 50;

/** Sinonimi za auto-mapiranje po normalizovanom nazivu headera. */
const SYNONYMS: Record<ImportFieldKey, string[]> = {
  sku: ["sku", "sifra", "šifra", "code", "kod", "artikal"],
  name: ["naziv", "name", "proizvod", "product", "nazivproizvoda"],
  mp_price: ["mp", "mpc", "maloprodaja", "maloprodajna", "cena", "price", "mpcena"],
  vp_price: ["vp", "vpc", "veleprodaja", "veleprodajna", "nabavna", "cost", "vpcena"],
  category: ["kategorija", "category", "grupa"],
  brand: ["brend", "brand", "proizvodjac", "proizvođač", "marka"],
  description: ["opis", "description", "napomena"],
  variant_name: ["varijanta", "nazivvarijante", "variant", "velicina", "veličina", "broj"],
  stock_quantity: ["stanje", "stock", "kolicina", "količina", "zaliha", "lager"],
  low_stock_threshold: ["prag", "threshold", "min", "minimum"],
  supplier_sku: ["dobavljac", "dobavljač", "supplier", "suppliersku", "sifradobavljaca"],
  weight_grams: ["tezina", "težina", "weight", "masa", "gramaza", "gramaža"],
};

function normalizeHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function autoMap(headers: string[]): Partial<Record<ImportFieldKey, string>> {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const mapping: Partial<Record<ImportFieldKey, string>> = {};
  for (const field of IMPORT_FIELDS) {
    const syns = SYNONYMS[field.key].map(normalizeHeader);
    const hit =
      normalized.find((h) => syns.includes(h.norm)) ??
      normalized.find((h) => syns.some((s) => h.norm.includes(s)));
    if (hit) mapping[field.key] = hit.raw;
  }
  return mapping;
}

type Phase = "upload" | "mapping" | "preview" | "done";

export function ImportWizard() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportFieldKey, string>>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const fields = res.meta.fields ?? [];
        if (fields.length === 0) {
          toast.error("CSV nema zaglavlje (header red).");
          return;
        }
        setHeaders(fields);
        setRows(res.data);
        setMapping(autoMap(fields));
        setPhase("mapping");
      },
      error: () => toast.error("Čitanje CSV-a nije uspelo."),
    });
  }

  function buildItems(): ImportItem[] {
    return rows.map((row) => {
      const item: ImportItem = {};
      for (const field of IMPORT_FIELDS) {
        const header = mapping[field.key];
        if (header) item[field.key] = row[header] ?? "";
      }
      return item;
    });
  }

  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]);

  function runPreview() {
    if (missingRequired.length > 0) {
      toast.error(`Mapiraj obavezna polja: ${missingRequired.map((f) => f.label).join(", ")}.`);
      return;
    }
    const items = buildItems();
    startTransition(async () => {
      const r = await previewImport(items);
      setReport(r);
      setPhase("preview");
      if (r.fatalError) toast.error(r.fatalError);
    });
  }

  function runCommit() {
    const items = buildItems();
    startTransition(async () => {
      const r = await commitImport(items);
      setReport(r);
      setPhase("done");
      if (r.fatalError) toast.error(r.fatalError);
      else toast.success("Uvoz završen.");
    });
  }

  function reset() {
    setPhase("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setReport(null);
  }

  /* ── UPLOAD ── */
  if (phase === "upload") {
    return (
      <label className="border-border hover:border-green hover:bg-green-soft/40 flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center transition-colors">
        <FileUp className="text-ink-faint size-8" />
        <div className="space-y-1">
          <p className="text-ink text-[0.9375rem] font-medium">Izaberi CSV fajl</p>
          <p className="text-ink-soft text-sm">
            Prvi red mora biti zaglavlje sa nazivima kolona. Podržan i „;“ separator.
          </p>
        </div>
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        <span className="bg-green mt-1 inline-flex h-10 items-center rounded-md px-4 text-[0.9375rem] font-semibold text-white">
          Učitaj CSV
        </span>
      </label>
    );
  }

  /* ── MAPPING ── */
  if (phase === "mapping") {
    return (
      <div className="space-y-5">
        <div className="text-ink-soft flex items-center gap-2 text-sm">
          <Badge variant="info">{fileName}</Badge>
          <span>
            {rows.length} redova · {headers.length} kolona
          </span>
        </div>

        <div className="border-border bg-surface shadow-soft divide-border divide-y rounded-lg border">
          {IMPORT_FIELDS.map((field) => {
            const selected = mapping[field.key] ?? NONE;
            const sample = mapping[field.key] ? (rows[0]?.[mapping[field.key]!] ?? "") : "";
            return (
              <div key={field.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="w-48 shrink-0">
                  <span className="text-ink text-sm font-medium">{field.label}</span>
                  {field.required ? <span className="text-danger ml-1">*</span> : null}
                </div>
                <Select
                  value={selected}
                  onValueChange={(v) =>
                    setMapping((m) => ({ ...m, [field.key]: v === NONE ? undefined : v }))
                  }
                >
                  <SelectTrigger className="h-9 w-56">
                    <SelectValue placeholder="— ne uvozi —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— ne uvozi —</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sample ? (
                  <span className="text-ink-faint truncate text-xs">npr. „{sample}“</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {missingRequired.length > 0 ? (
          <p className="text-danger text-sm">
            Obavezno mapiraj: {missingRequired.map((f) => f.label).join(", ")}.
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={reset} disabled={pending}>
            Nazad
          </Button>
          <Button onClick={runPreview} disabled={pending || missingRequired.length > 0}>
            {pending ? "Analiza…" : "Pregled (dry-run)"}
          </Button>
        </div>
      </div>
    );
  }

  /* ── PREVIEW / DONE ── */
  if (!report) return null;
  const done = phase === "done";
  const importable = report.newVariants + report.updatedVariants;

  return (
    <div className="space-y-5">
      {done ? (
        <div className="border-success/40 bg-success-soft/40 flex items-center gap-3 rounded-lg border px-4 py-3">
          <CheckCircle2 className="text-success size-5" />
          <p className="text-ink text-sm font-medium">
            {report.fatalError ? "Uvoz zaustavljen." : "Uvoz je uspešno završen."}
          </p>
        </div>
      ) : null}

      {report.fatalError ? (
        <div className="border-danger/40 bg-danger-soft/40 text-danger rounded-lg border px-4 py-3 text-sm">
          {report.fatalError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={done ? "Kreirano proizvoda" : "Novih proizvoda"} value={report.newProducts} />
        <Stat label={done ? "Novih varijanti" : "Novih varijanti"} value={report.newVariants} />
        <Stat
          label={done ? "Ažurirano varijanti" : "Za ažuriranje"}
          value={report.updatedVariants}
          warning={report.updatedVariants > 0}
        />
        <Stat
          label="Problematičnih"
          value={report.errors.length}
          danger={report.errors.length > 0}
        />
      </div>

      {report.updatedVariants > 0 ? (
        <div className="border-warning/40 bg-warning-soft/50 flex items-start gap-3 rounded-lg border px-4 py-3">
          <AlertTriangle className="text-warning mt-0.5 size-5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="text-ink font-medium">
              {report.updatedVariants} postojećih varijanti{" "}
              {done ? "je ažurirano" : "će biti ažurirano"} (MP/VP/stanje/naziv se prepisuju).
            </p>
            <p className="text-ink-soft wrap-break-word">
              SKU: {report.updatedSkus.slice(0, 30).join(", ")}
              {report.updatedSkus.length > 30 ? ` … +${report.updatedSkus.length - 30}` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {report.newCategories.length > 0 ? (
        <p className="text-ink-soft text-sm">
          Nove kategorije {done ? "kreirane" : "za kreiranje"}:{" "}
          <span className="text-ink font-medium">{report.newCategories.join(", ")}</span>
        </p>
      ) : null}

      {report.errors.length > 0 ? (
        <div className="border-border bg-surface shadow-soft overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="eyebrow bg-surface-2 h-9 px-4">Red</TableHead>
                <TableHead className="eyebrow bg-surface-2 h-9 px-4">SKU</TableHead>
                <TableHead className="eyebrow bg-surface-2 h-9 px-4">Razlog</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.errors.slice(0, MAX_ERROR_ROWS).map((err, i) => (
                <TableRow key={i} className="border-border hover:bg-green-soft">
                  <TableCell className="num text-ink-soft px-4 py-2">{err.row}</TableCell>
                  <TableCell className="num text-ink px-4 py-2">{err.sku || "—"}</TableCell>
                  <TableCell className="text-ink-soft px-4 py-2">{err.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.errors.length > MAX_ERROR_ROWS ? (
            <p className="text-ink-faint px-4 py-2 text-xs">
              … i još {report.errors.length - MAX_ERROR_ROWS} problematičnih redova.
            </p>
          ) : null}
        </div>
      ) : null}

      {!done && importable === 0 && !report.fatalError ? (
        <EmptyState
          title="Nema redova za uvoz"
          description="Nijedan ispravan red nije pronađen. Proveri mapiranje kolona."
          className="border-0 shadow-none"
        />
      ) : null}

      {done ? (
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/katalog">Nazad na katalog</Link>
          </Button>
          <Button variant="ghost" onClick={reset}>
            Novi uvoz
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setPhase("mapping")} disabled={pending}>
            Nazad
          </Button>
          <Button onClick={runCommit} disabled={pending || importable === 0 || !!report.fatalError}>
            <Upload /> {pending ? "Uvoz…" : `Potvrdi uvoz (${importable})`}
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warning,
  danger,
}: {
  label: string;
  value: number;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "num mt-1 text-2xl font-bold",
          warning ? "text-warning" : danger ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}
