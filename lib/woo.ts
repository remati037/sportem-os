import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/*
 * WooCommerce webhook helperi (Korak 1.2).
 * Koristi ih webhook ruta (app/api/webhooks/woo) i backfill skripta (Korak 1.3).
 */

/* ── HMAC potpis ─────────────────────────────────────────────────────────── */

/**
 * Provera `x-wc-webhook-signature`: HMAC-SHA256 (base64) nad SIROVIM telom
 * zahteva, tajna = WOO_WEBHOOK_SECRET. Timing-safe poređenje.
 */
export function verifyWooSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WOO_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signature, "base64");

  // timingSafeEqual baca izuzetak na različite dužine — proveri prvo.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Woo „ping" pri kreiranju/aktivaciji webhooka (`WC_Webhook::deliver_ping()`).
 * Telo je `{"webhook_id":N}` (JSON) ili `webhook_id=N` (form-encoded) i NEMA
 * potpis — mora se prepoznati PRE provere potpisa, inače padne na 401 i Woo ne
 * dozvoli snimanje. Ping ne nosi podatke po kojima delujemo — samo ACK 200.
 */
export function isWooPing(rawBody: string): boolean {
  const body = rawBody.trim();
  if (/^webhook_id=\d+$/.test(body)) return true;
  try {
    const p = JSON.parse(body);
    return typeof p === "object" && p !== null && "webhook_id" in p && !("id" in p);
  } catch {
    return false;
  }
}

/* ── Normalizacija ───────────────────────────────────────────────────────── */

/**
 * Srpski telefon u kanonski oblik za dedup kupaca (`customers.phone` UNIQUE):
 * skini sve osim cifara, `+381`/`00381`/`381` prefiks → `0`. Rezultat samo
 * cifre (npr. „+381 64/123-4567" → „0641234567"). Prekratko/prazno → null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00381")) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith("381")) digits = `0${digits.slice(3)}`;
  if (digits.length < 6) return null;
  return digits;
}

/**
 * Woo decimalni string („12500.00") → integer RSD. Nikad float dalje u sistem
 * (CLAUDE.md 5). Nevalidno/prazno → null.
 */
export function parseRsd(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/* ── Woo payload (loose šema — webhook ne sme pucati na varijacije) ──────── */

const wooAddress = z
  .looseObject({
    first_name: z.string().optional().default(""),
    last_name: z.string().optional().default(""),
    address_1: z.string().optional().default(""),
    address_2: z.string().optional().default(""),
    city: z.string().optional().default(""),
    postcode: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    email: z.string().optional().default(""),
  })
  .optional();

const wooLineItem = z.looseObject({
  sku: z.string().nullish().default(""),
  name: z.string().nullish().default(""),
  quantity: z.coerce.number().int().positive().default(1),
  /** Ukupno naplaćeno za liniju (posle popusta) — izvor za mp_at_sale. */
  total: z.union([z.string(), z.number()]).nullish(),
  /** Jedinična cena — fallback ako total nedostaje. */
  price: z.union([z.string(), z.number()]).nullish(),
});

export const wooOrderSchema = z.looseObject({
  id: z.coerce.number().int().positive(),
  status: z.string().optional().default(""),
  date_created_gmt: z.string().nullish(),
  total: z.union([z.string(), z.number()]).nullish(),
  shipping_total: z.union([z.string(), z.number()]).nullish(),
  payment_method: z.string().nullish(),
  customer_note: z.string().nullish(),
  billing: wooAddress,
  shipping: wooAddress,
  line_items: z.array(wooLineItem).optional().default([]),
});

export type WooOrder = z.infer<typeof wooOrderSchema>;
export type WooLineItem = z.infer<typeof wooLineItem>;

/* ── Mapiranje statusa ───────────────────────────────────────────────────── */

/** Woo statusi koji znače otkazano/vraćeno. Ostali NE menjaju app status. */
const WOO_CANCELLED_STATUSES = new Set(["cancelled", "refunded", "failed", "trash"]);

export function isWooCancelled(status: string): boolean {
  return WOO_CANCELLED_STATUSES.has(status);
}

/** Nazivi app statusa iz `order_statuses` seed-a (lookup po imenu, ne UUID). */
export const APP_STATUS = {
  created: "Kreirano",
  sent: "Poslato",
  delivered: "Isporučeno",
  cancelled: "Otkazano/Vraćeno",
} as const;
