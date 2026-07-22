import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/woo";

/*
 * „Rizičan kupac" — kupac koji je nekad OTKAZAO ili VRATIO porudžbinu.
 * Poklapanje po normalizovanom telefonu ILI e-mailu (customer_id je nepouzdan:
 * kupci bez telefona dobijaju nov `customers` red svaki put). Računa se u letu,
 * bez perzistentne kolone — uvek tačno, bez migracije. NE dira snapshot cena.
 */

export type CancelEntry = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
};

export type CancellationIndex = {
  byPhone: Map<string, CancelEntry[]>;
  byEmail: Map<string, CancelEntry[]>;
};

type IndexRow = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  ship_phone: string | null;
  customer: { phone: string | null; email: string | null } | null;
};

/*
 * Naši interni mejlovi — ponekad sami napravimo porudžbinu sa svojim mejlom kad
 * nam se kupac javi. Ne smeju da čine kupca „rizičnim": tretiramo ih kao da nema
 * e-maila (izbacuje ih i iz indeksa i iz poklapanja). Telefon i dalje matchuje.
 */
const OUR_EMAILS = new Set(["mmarkom2000@gmail.com", "milenkovic.m2003@gmail.com"]);

function normEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || OUR_EMAILS.has(e)) return null;
  return e;
}

function pushTo(map: Map<string, CancelEntry[]>, key: string | null, entry: CancelEntry): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/**
 * Indeks svih otkazanih/vraćenih porudžbina po telefonu i e-mailu (jedan upit).
 * Prima Supabase klijent: RLS klijent za UI, admin klijent za webhook.
 */
export async function buildCancellationIndex(
  supabase: SupabaseClient,
): Promise<CancellationIndex> {
  const byPhone = new Map<string, CancelEntry[]>();
  const byEmail = new Map<string, CancelEntry[]>();

  const { data } = await supabase
    .from("orders")
    .select("id, woo_order_id, ordered_at, ship_phone, customer:customers(phone, email)")
    .not("cancelled_at", "is", null);

  for (const row of (data as unknown as IndexRow[]) ?? []) {
    const entry: CancelEntry = {
      id: row.id,
      woo_order_id: row.woo_order_id,
      ordered_at: row.ordered_at,
    };
    pushTo(byPhone, normalizePhone(row.ship_phone), entry);
    pushTo(byPhone, normalizePhone(row.customer?.phone), entry);
    pushTo(byEmail, normEmail(row.customer?.email), entry);
  }

  return { byPhone, byEmail };
}

/**
 * Prethodne otkazane/vraćene porudžbine za dati telefon/e-mail, bez same
 * porudžbine (`excludeId`), dedup po id-u, novije prvo.
 */
export function matchCancellations(
  index: CancellationIndex,
  { phone, email, excludeId }: { phone?: string | null; email?: string | null; excludeId?: string },
): CancelEntry[] {
  const byId = new Map<string, CancelEntry>();

  const p = normalizePhone(phone);
  if (p) for (const e of index.byPhone.get(p) ?? []) byId.set(e.id, e);

  const em = normEmail(email);
  if (em) for (const e of index.byEmail.get(em) ?? []) byId.set(e.id, e);

  if (excludeId) byId.delete(excludeId);

  return [...byId.values()].sort((a, b) =>
    (b.ordered_at ?? "").localeCompare(a.ordered_at ?? ""),
  );
}

/** Istorija otkazivanja za jednu porudžbinu (detalj) — otvara RLS klijent. */
export async function getOrderCancellationHistory(order: {
  id: string;
  ship_phone: string | null;
  customer: { phone: string | null; email: string | null } | null;
}): Promise<CancelEntry[]> {
  const supabase = await createClient();
  const index = await buildCancellationIndex(supabase);
  return matchCancellations(index, {
    phone: order.ship_phone ?? order.customer?.phone,
    email: order.customer?.email,
    excludeId: order.id,
  });
}

/** Srpska množina reči „porudžbina" (1 / 2–4 / 5+). */
export function porudzbinePlural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "porudžbinu";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "porudžbine";
  return "porudžbina";
}
