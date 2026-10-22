import { belgradeDate } from "@/lib/date-belgrade";

/*
 * CSV izvoz (Računica P1; specifikacija iz Izveštaji R0 — docs/Sportem-Plan-Izvestaji.md).
 * Format koji Excel sa srpskim podešavanjima otvara bez čarobnjaka:
 *   - separator `;`, decimalni zarez, CRLF, UTF-8 sa BOM-om;
 *   - navodnici samo kad ćelija sadrži `;`, `"` ili novi red;
 *   - RSD i količine kao celi brojevi BEZ razdvajača hiljada (Excel ih čita kao broj);
 *   - procenti sa jednom decimalom („32,5"), datumi „DD.MM.YYYY.".
 * Bez `server-only` — koristi se i na klijentu (preuzimanje iz pregledača).
 */

export type CsvKind = "rsd" | "int" | "pct" | "date" | "text";

export type CsvColumn<Row> = {
  header: string;
  /** Za `pct`: vrednost u procentima (32.5 = 32,5 %), ne udeo 0..1. */
  value: (row: Row) => string | number | null | undefined;
  kind?: CsvKind;
};

const BOM = "﻿";

function formatCell(value: string | number | null | undefined, kind: CsvKind): string {
  if (value == null || value === "") return "";
  if (kind === "rsd" || kind === "int") {
    return typeof value === "number" ? String(Math.round(value)) : value;
  }
  if (kind === "pct") {
    return typeof value === "number" ? value.toFixed(1).replace(".", ",") : value;
  }
  if (kind === "date") {
    const s = String(value);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : belgradeDate(s);
    const [y, m, d] = day.split("-");
    return `${d}.${m}.${y}.`;
  }
  return String(value);
}

function quote(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Ceo CSV dokument (sa BOM-om) iz definicija kolona i redova. */
export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [columns.map((c) => quote(c.header)).join(";")];
  for (const row of rows) {
    lines.push(columns.map((c) => quote(formatCell(c.value(row), c.kind ?? "text"))).join(";"));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Preuzimanje u pregledaču (samo klijent). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
