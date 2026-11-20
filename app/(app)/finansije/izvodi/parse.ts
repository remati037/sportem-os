import Papa from "papaparse";

/** Jedna uplata iz XExpress izvoda (iznos u celim RSD, datum ISO `yyyy-mm-dd`). */
export type IzvodRow = {
  orderCode: string;
  referenceId: string;
  name: string;
  amount: number;
  date: string;
};

export type ParsedFile = {
  fileName: string;
  rows: IzvodRow[];
  skipped: number;
};

type Field = keyof IzvodRow;

/** Sinonimi naziva kolona (normalizovano: mala slova, bez dijakritika i razmaka). */
const SYNONYMS: Record<Field, string[]> = {
  orderCode: ["ordercode", "brojporudzbine", "porudzbina", "brojposiljke", "posiljka", "code"],
  referenceId: ["referenceid", "reference", "referenca", "ref", "pozivnabroj"],
  name: ["rname", "name", "ime", "imeiprezime", "primalac", "kupac"],
  amount: ["amount", "iznos", "otkup", "otkupnina", "uplata", "suma"],
  date: ["paymentdate", "date", "datum", "datumuplate"],
};

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headers: string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    const hit = headers.find((h) => SYNONYMS[field].includes(norm(h)));
    if (hit) out[field] = hit;
  }
  return out;
}

/** „8700.0", „8.700,00", „8 700", „8,700.00" → 8700 (celi RSD). */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\s ]|rsd|din/gi, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Poslednji separator je decimalni, drugi su hiljade.
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.split(",").join("");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.split(".").join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** „2026-11-10", „2026-11-10T…", „10.11.2026.", „10/11/2026" → „2026-11-10". */
export function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./-]\s?(\d{1,2})[./-]\s?(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** XExpress imenuje fajl „20261110_SPORT_NAME_…" — datum iz imena je rezerva. */
export function dateFromFileName(fileName: string): string | null {
  const m = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function toRows(records: Record<string, unknown>[], fileName: string): ParsedFile {
  const headers = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const map = mapHeaders(headers);
  if (!map.amount) {
    throw new Error("Nema kolone sa iznosom (Amount / Iznos).");
  }
  const fallbackDate = dateFromFileName(fileName);
  const rows: IzvodRow[] = [];
  let skipped = 0;
  for (const r of records) {
    const amount = parseAmount(r[map.amount]);
    const date = (map.date ? parseDate(r[map.date]) : null) ?? fallbackDate;
    if (amount === null || !date) {
      skipped++;
      continue;
    }
    const str = (f: Field) => (map[f] ? String(r[map[f]!] ?? "").trim() : "");
    rows.push({
      orderCode: str("orderCode"),
      referenceId: str("referenceId"),
      name: str("name").replace(/\s+/g, " "),
      amount,
      date,
    });
  }
  return { fileName, rows, skipped };
}

export async function parseIzvodFile(file: File): Promise<ParsedFile> {
  const text = (await file.text()).replace(/^﻿/, "");
  const trimmed = text.trimStart();

  if (
    file.name.toLowerCase().endsWith(".json") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{")
  ) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Fajl nije ispravan JSON.");
    }
    const list = Array.isArray(data) ? data : [data];
    return toRows(
      list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object"),
      file.name,
    );
  }

  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t", "|"],
  });
  if (res.data.length === 0) throw new Error("CSV je prazan.");
  return toRows(res.data, file.name);
}

/** Spaja fajlove; ista uplata (broj porudžbine + referenca + iznos) se broji jednom. */
export function mergeRows(files: ParsedFile[]): { rows: IzvodRow[]; duplicates: number } {
  const seen = new Set<string>();
  const rows: IzvodRow[] = [];
  let duplicates = 0;
  for (const f of files) {
    for (const r of f.rows) {
      const key =
        r.orderCode || r.referenceId ? `${r.orderCode}|${r.referenceId}|${r.amount}` : null;
      if (key && seen.has(key)) {
        duplicates++;
        continue;
      }
      if (key) seen.add(key);
      rows.push(r);
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.orderCode.localeCompare(b.orderCode));
  return { rows, duplicates };
}

/** CSV za Excel (UTF-8 BOM, „;" separator — srpski Excel ga otvara u kolonama). */
export function toExcelCsv(rows: IzvodRow[]): string {
  const header = ["Datum uplate", "Ime i prezime", "Iznos (RSD)", "Broj porudžbine", "Referenca"];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const [y, m, d] = r.date.split("-");
    return [`${d}.${m}.${y}.`, r.name, r.amount, r.orderCode, r.referenceId].map(esc).join(";");
  });
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}
