/*
 * Konstante i helperi modula Tiketi (Korak T1).
 *
 * Nema `server-only` — fajl se uvozi i u klijentske komponente (šifra tiketa,
 * imena podrazumevanog config-a). Ne dira porudžbine, finansije ni snapshot.
 *
 * Pravilo iz CLAUDE.md: `is_done` kolona i podrazumevani prioritet se čitaju po
 * ZASTAVICI (`is_done` / `is_default`), a imena ispod su samo podrazumevani
 * sadržaj iz migracije — korisnik ih sme preimenovati u Podešavanjima.
 */

/** Prefiks šifre tiketa u prikazu i URL-u („SPT-42"). */
export const TICKET_CODE_PREFIX = "SPT";

/** Završeni tiketi se sakrivaju iza „Prikaži arhivu" posle ovoliko dana. */
export const TICKET_ARCHIVE_DAYS = 14;

/** Podrazumevani sadržaj upisan migracijom `20260825120000_tiketi.sql`. */
export const TICKET_DEFAULTS = {
  columns: {
    todo: "Za rad",
    inProgress: "U toku",
    waiting: "Čeka",
    done: "Završeno",
  },
  priorities: {
    low: "Nizak",
    medium: "Srednji",
    high: "Visok",
    urgent: "Hitno",
  },
  tags: {
    call: "Poziv",
    xexpress: "XExpress",
    complaint: "Reklamacija",
    supply: "Nabavka",
  },
} as const;

/** Izvor tiketa (`tickets.source`). */
export const TICKET_SOURCE = {
  manual: "manual",
  autoRiskyCustomer: "auto_risky_customer",
} as const;

export type TicketSource = (typeof TICKET_SOURCE)[keyof typeof TICKET_SOURCE];

/** Razmak između susednih `position` vrednosti pri dodavanju na dno kolone. */
export const TICKET_POSITION_STEP = 1000;

/** Broj → prikaz šifre: `42` → „SPT-42". */
export function formatTicketCode(code: number): string {
  return `${TICKET_CODE_PREFIX}-${code}`;
}

/**
 * URL/unos → broj tiketa. Prima „SPT-42", „spt-42" i goli „42";
 * sve ostalo → `null` (poziv tada vraća 404).
 */
export function parseTicketParam(param: string): number | null {
  const cleaned = decodeURIComponent(param ?? "")
    .trim()
    .replace(new RegExp(`^${TICKET_CODE_PREFIX}-?`, "i"), "");
  if (!/^\d+$/.test(cleaned)) return null;
  const code = Number(cleaned);
  return Number.isSafeInteger(code) && code > 0 ? code : null;
}
