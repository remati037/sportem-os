import "server-only";

import * as Sentry from "@sentry/nextjs";

import { belgradeLocalToUtc } from "@/lib/date-belgrade";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchEvents,
  fetchRules,
  offersConfigured,
  type OfferEventApi,
  type OfferRuleApi,
} from "@/lib/offers/client";

/*
 * Sinhronizacija ponuda: plugin → Supabase.
 *
 * Tok: /rules → upsert (ogledalo pravila), pa /events od poslednjeg id-ja po
 * 1000 dok ne stigne prazan niz. Upsert ide po `id` iz WordPress-a, pa je
 * ponovni sync idempotentan — ne pravi duplikate.
 *
 * Piše kroz service role klijent (offer_* tabele nemaju nijednu write politiku).
 * `last_event_id` se pomera SAMO kad batch prođe; greška se upiše u
 * `last_error` i vidi se na stranici, a sledeći pokušaj kreće od istog mesta.
 */

const SYNC_KEY = "offers";
const PAGE_SIZE = 1000; // koliko se traži od plugina po pozivu
const UPSERT_CHUNK = 500; // koliko redova ide u jedan upsert (PostgREST telo)

export type SyncResult = {
  ok: boolean;
  rules: number;
  events: number;
  lastEventId: number;
  error?: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/** Pravilo iz plugina → red u `offer_rules` (vreme iz Beograda u UTC). */
function ruleRow(r: OfferRuleApi) {
  return {
    id: String(r.id),
    name: r.name ?? "",
    active: Boolean(r.active),
    priority: Number.isFinite(r.priority) ? Math.trunc(r.priority) : 0,
    placements: Array.isArray(r.placements) ? r.placements : [],
    offer_product: Number.isFinite(r.offer_product) ? Math.trunc(r.offer_product) : null,
    offer_sku: r.offer_sku ?? null,
    offer_name: r.offer_name ?? null,
    price_rule: r.price_rule ?? null,
    conditions: r.conditions ?? null,
    wp_updated_at: r.updated ? belgradeLocalToUtc(r.updated) : null,
    synced_at: new Date().toISOString(),
  };
}

/** Događaj iz plugina → red u `offer_events`. */
function eventRow(e: OfferEventApi) {
  return {
    id: Math.trunc(e.id),
    created_at: e.created_at,
    event: e.event,
    rule_id: e.rule_id ? String(e.rule_id) : null,
    placement: e.placement ?? null,
    product_id: Number.isFinite(e.product_id) ? Math.trunc(e.product_id) : null,
    order_id: Number.isFinite(e.order_id) ? Math.trunc(e.order_id) : 0,
    value: Number.isFinite(e.value) ? e.value : 0,
  };
}

/** Trenutno stanje sinhronizacije (red se kreira u migraciji; ovde je rezerva). */
async function readState(supabase: AdminClient): Promise<number> {
  const { data, error } = await supabase
    .from("offer_sync_state")
    .select("last_event_id")
    .eq("key", SYNC_KEY)
    .maybeSingle();

  if (error) throw new Error(`Čitanje stanja sinhronizacije: ${error.message}`);
  return data?.last_event_id ?? 0;
}

async function writeState(
  supabase: AdminClient,
  patch: { last_event_id?: number; last_synced_at?: string | null; last_error: string | null },
) {
  const { error } = await supabase
    .from("offer_sync_state")
    .upsert({ key: SYNC_KEY, ...patch }, { onConflict: "key" });

  // Stanje je dijagnostika — neuspeh upisa ne sme da obori već sinhronizovane podatke.
  if (error) Sentry.captureException(new Error(`Upis stanja sinhronizacije: ${error.message}`));
}

/** Upsert u blokovima — jedan ogroman zahtev PostgREST ne prima. */
async function upsertChunked(
  supabase: AdminClient,
  table: "offer_rules" | "offer_events",
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`Upis u ${table}: ${error.message}`);
  }
}

/**
 * Povuci pravila i sve nove događaje. Nikad ne baca — greška se vrati u
 * rezultatu i upiše u `offer_sync_state.last_error` (pozivalac je cron ruta
 * ili dugme na stranici, oba prikazuju poruku).
 */
export async function syncOffers(): Promise<SyncResult> {
  const supabase = createAdminClient();

  if (!offersConfigured()) {
    const error = "Plugin nije podešen — nedostaje SPORTEM_WP_URL ili SPORTEM_OFFERS_API_KEY.";
    await writeState(supabase, { last_error: error });
    return { ok: false, rules: 0, events: 0, lastEventId: 0, error };
  }

  let lastEventId = 0;
  let rulesCount = 0;
  let eventsCount = 0;

  try {
    lastEventId = await readState(supabase);

    // ── 1. pravila (ogledalo — plugin je izvor istine) ──────────────────────
    const rules = await fetchRules();
    if (rules.length > 0) {
      await upsertChunked(supabase, "offer_rules", rules.map(ruleRow), "id");
      rulesCount = rules.length;
    }

    // ── 2. događaji od poslednjeg id-ja, po stranicama ──────────────────────
    // Petlja staje kad stigne prazan niz ili kad `last_id` prestane da raste
    // (zaštita od beskonačne petlje ako plugin vrati isti odgovor).
    for (;;) {
      const page = await fetchEvents(lastEventId, PAGE_SIZE);
      if (page.events.length === 0) break;

      await upsertChunked(supabase, "offer_events", page.events.map(eventRow), "id");
      eventsCount += page.events.length;

      const maxId = page.events.reduce((max, e) => Math.max(max, Math.trunc(e.id)), lastEventId);
      const nextId = Math.max(Number.isFinite(page.last_id) ? page.last_id : 0, maxId);
      if (nextId <= lastEventId) break;

      lastEventId = nextId;
      // Stanje se pomera posle SVAKE uspešne stranice — prekid usred velikog
      // uvoza ne tera sledeći pokušaj da počne iz početka.
      await writeState(supabase, { last_event_id: lastEventId, last_error: null });

      if (page.events.length < PAGE_SIZE) break;
    }

    await writeState(supabase, {
      last_event_id: lastEventId,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });

    return { ok: true, rules: rulesCount, events: eventsCount, lastEventId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nepoznata greška pri sinhronizaciji.";
    Sentry.captureException(err);
    // `last_event_id` se NE pomera — sledeći pokušaj kreće od istog mesta.
    await writeState(supabase, { last_error: message });
    return { ok: false, rules: rulesCount, events: eventsCount, lastEventId, error: message };
  }
}
