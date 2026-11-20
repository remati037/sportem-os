"use client";

import { ChevronDown, Download, FileText, FileUp, Plus, Search, Trash2, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  MobileCard,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { datum, num, rsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  type IzvodRow,
  type ParsedFile,
  dateFromFileName,
  mergeRows,
  parseIzvodFile,
  toExcelCsv,
} from "./parse";

type DayGroup = { date: string; rows: IzvodRow[]; total: number };

function groupByDay(rows: IzvodRow[]): DayGroup[] {
  const map = new Map<string, IzvodRow[]>();
  for (const r of rows) {
    const list = map.get(r.date) ?? [];
    list.push(r);
    map.set(r.date, list);
  }
  return Array.from(map, ([date, list]) => ({
    date,
    rows: list,
    total: list.reduce((s, r) => s + r.amount, 0),
  }));
}

/** 1 uplata · 2–4 uplate · 5+ uplata (21 uplata, 22 uplate, 12 uplata). */
function uplataWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "uplate" : "uplata";
}

/** 1 fajl · 2–4 fajla · 5+ fajlova. */
function fajlWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "fajl";
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "fajla" : "fajlova";
}

function normSearch(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
}

export function IzvodiViewer() {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const { rows, duplicates } = useMemo(() => mergeRows(files), [files]);
  const allDays = useMemo(() => groupByDay(rows), [rows]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const filteredDays = useMemo(() => {
    const q = normSearch(query.trim());
    if (!q) return allDays;
    return allDays
      .map((d) => {
        const list = d.rows.filter((r) =>
          normSearch(`${r.name} ${r.orderCode} ${r.referenceId}`).includes(q),
        );
        return { ...d, rows: list, total: list.reduce((s, r) => s + r.amount, 0) };
      })
      .filter((d) => d.rows.length > 0);
  }, [allDays, query]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const parsed: ParsedFile[] = [];
    for (const file of Array.from(list)) {
      try {
        const p = await parseIzvodFile(file);
        parsed.push(p);
        if (p.skipped > 0) {
          toast.warning(`${file.name}: preskočeno ${p.skipped} redova bez iznosa ili datuma.`);
        }
      } catch (e) {
        toast.error(
          `${file.name}: ${e instanceof Error ? e.message : "fajl nije moguće pročitati."}`,
        );
      }
    }
    if (parsed.length === 0) return;
    setFiles((prev) => {
      // Isti fajl učitan ponovo zamenjuje stari.
      const names = new Set(parsed.map((p) => p.fileName));
      return [...prev.filter((f) => !names.has(f.fileName)), ...parsed].sort((a, b) =>
        a.fileName.localeCompare(b.fileName),
      );
    });
  }

  function onInput(e: ChangeEvent<HTMLInputElement>) {
    void addFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  }

  function exportCsv() {
    const blob = new Blob([toExcelCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const first = allDays[0]?.date ?? "";
    const last = allDays.at(-1)?.date ?? "";
    a.href = url;
    a.download = `uplate-xexpress-${first}${last && last !== first ? `_${last}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="space-y-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {files.length === 0 ? (
        <label
          className={cn(
            "border-border bg-surface hover:bg-surface-2 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
            dragging && "border-green bg-green-soft",
          )}
        >
          <FileUp className="text-ink-faint size-7" />
          <span className="text-ink text-[0.9375rem] font-medium">
            Prevuci izvode ovde ili klikni da izabereš
          </span>
          <span className="text-ink-soft text-sm">
            CSV ili JSON od XExpressa, može više fajlova odjednom. Ništa se ne čuva u bazi.
          </span>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            multiple
            onChange={onInput}
            className="hidden"
          />
        </label>
      ) : (
        <>
          {/* Učitani fajlovi — sažeto u jedan red, lista na klik */}
          <div
            className={cn(
              "border-border bg-surface shadow-soft rounded-lg border transition-colors",
              dragging && "border-green bg-green-soft",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 p-2 pl-3">
              <button
                type="button"
                onClick={() => setShowFiles((v) => !v)}
                aria-expanded={showFiles}
                className="text-ink hover:text-green-deep flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
              >
                <FileText className="text-ink-faint size-4 shrink-0" />
                <span className="num truncate">
                  {num(files.length)} {fajlWord(files.length)} · {num(rows.length)}{" "}
                  {uplataWord(rows.length)}
                </span>
                <ChevronDown
                  className={cn(
                    "text-ink-faint size-4 shrink-0 transition-transform",
                    showFiles && "rotate-180",
                  )}
                />
              </button>
              <Button variant="ghost" size="sm" asChild>
                <label className="cursor-pointer" title="Dodaj izvode" aria-label="Dodaj izvode">
                  <Plus /> <span className="hidden sm:inline">Dodaj</span>
                  <input
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    multiple
                    onChange={onInput}
                    className="hidden"
                  />
                </label>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiles([])}
                title="Očisti sve"
                aria-label="Očisti sve"
              >
                <Trash2 /> <span className="hidden sm:inline">Očisti sve</span>
              </Button>
            </div>

            {showFiles ? (
              <ul className="border-border divide-border max-h-64 divide-y overflow-y-auto border-t">
                {files.map((f) => {
                  const d = dateFromFileName(f.fileName);
                  const sum = f.rows.reduce((s, r) => s + r.amount, 0);
                  return (
                    <li
                      key={f.fileName}
                      className="flex items-center gap-3 py-1.5 pr-2 pl-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate" title={f.fileName}>
                        {d ? (
                          <span className="num text-ink">{datum(d)}</span>
                        ) : (
                          <span className="text-ink">{f.fileName}</span>
                        )}
                        <span className="text-ink-faint ml-2 text-xs">
                          {num(f.rows.length)} {uplataWord(f.rows.length)}
                        </span>
                      </span>
                      <span className="num text-ink-soft shrink-0">{rsd(sum)}</span>
                      <button
                        type="button"
                        aria-label={`Ukloni ${f.fileName}`}
                        onClick={() =>
                          setFiles((prev) => prev.filter((x) => x.fileName !== f.fileName))
                        }
                        className="text-ink-faint hover:bg-surface-2 hover:text-danger shrink-0 rounded p-1"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {/* Zbir */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Ukupno uplaćeno" value={rsd(total)} strong />
            <Stat label="Broj uplata" value={num(rows.length)} />
            <Stat
              label="Period"
              value={
                allDays.length === 0
                  ? "—"
                  : allDays.length === 1
                    ? datum(allDays[0].date)
                    : `${datum(allDays[0].date)} – ${datum(allDays.at(-1)!.date)}`
              }
            />
          </div>
          {duplicates > 0 ? (
            <p className="text-warning text-sm">
              {num(duplicates)} uplata se ponavlja u više fajlova — računata je samo jednom.
            </p>
          ) : null}

          {/* Pregled po danima */}
          <section className="space-y-2">
            <h2 className="eyebrow">Po danima</h2>
            <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="eyebrow bg-surface-2 h-9 px-4">Datum uplate</TableHead>
                    <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                      Uplata
                    </TableHead>
                    <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                      Iznos
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allDays.map((d) => (
                    <TableRow key={d.date} className="border-border">
                      <TableCell className="num text-ink px-4 py-2.5">
                        <a href={`#dan-${d.date}`} className="hover:underline">
                          {datum(d.date)}
                        </a>
                      </TableCell>
                      <TableCell className="num px-4 py-2.5 text-right">
                        {num(d.rows.length)}
                      </TableCell>
                      <TableCell className="num text-ink px-4 py-2.5 text-right font-medium">
                        {rsd(d.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-surface-2 hover:bg-surface-2 font-semibold">
                    <TableCell className="text-ink px-4 py-2.5">Ukupno</TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">{num(rows.length)}</TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right">
                      {rsd(total)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Sve uplate */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="eyebrow">Sve uplate</h2>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative flex-1 sm:w-64 sm:flex-none">
                  <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ime, broj porudžbine, referenca"
                    className="pl-9"
                  />
                </div>
                <Button variant="ghost" onClick={exportCsv} className="shrink-0">
                  <Download /> Excel
                </Button>
              </div>
            </div>

            {filteredDays.length === 0 ? (
              <p className="text-ink-soft text-sm">Nema uplata za „{query}“.</p>
            ) : (
              filteredDays.map((d) => (
                <div key={d.date} id={`dan-${d.date}`} className="scroll-mt-20 space-y-2">
                  <div className="flex items-baseline justify-between gap-3 px-1">
                    <h3 className="text-ink font-semibold">
                      <span className="num">{datum(d.date)}</span>
                      <span className="text-ink-faint ml-2 text-sm font-normal">
                        {num(d.rows.length)} {uplataWord(d.rows.length)}
                      </span>
                    </h3>
                    <span className="num text-ink font-semibold">{rsd(d.total)}</span>
                  </div>

                  <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="eyebrow bg-surface-2 h-9 w-12 px-4">#</TableHead>
                          <TableHead className="eyebrow bg-surface-2 h-9 px-4">
                            Ime i prezime
                          </TableHead>
                          <TableHead className="eyebrow bg-surface-2 h-9 px-4">
                            Porudžbina
                          </TableHead>
                          <TableHead className="eyebrow bg-surface-2 h-9 px-4">Referenca</TableHead>
                          <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                            Iznos
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.rows.map((r, i) => (
                          <TableRow
                            key={`${r.orderCode}-${r.referenceId}-${i}`}
                            className="border-border"
                          >
                            <TableCell className="num text-ink-faint px-4 py-2">{i + 1}</TableCell>
                            <TableCell className="text-ink px-4 py-2">{r.name || "—"}</TableCell>
                            <TableCell className="num text-ink-soft px-4 py-2">
                              {r.orderCode || "—"}
                            </TableCell>
                            <TableCell className="num text-ink-soft px-4 py-2">
                              {r.referenceId || "—"}
                            </TableCell>
                            <TableCell className="num text-ink px-4 py-2 text-right font-medium">
                              {rsd(r.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <MobileCardList>
                    {d.rows.map((r, i) => (
                      <MobileCard key={`${r.orderCode}-${r.referenceId}-${i}`}>
                        <MobileCardHeader
                          title={r.name || "—"}
                          subtitle={
                            <span className="num">
                              {r.orderCode || "—"} · {r.referenceId || "—"}
                            </span>
                          }
                          trailing={<span className="num font-medium">{rsd(r.amount)}</span>}
                        />
                      </MobileCard>
                    ))}
                  </MobileCardList>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border p-4">
      <div className="eyebrow">{label}</div>
      <div className={cn("num text-ink mt-1 text-lg", strong ? "font-bold" : "font-semibold")}>
        {value}
      </div>
    </div>
  );
}
