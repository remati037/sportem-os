// ============================================================================
// Sportem OS — popuna atribucije za postojeće porudžbine (plan Reklame, M3)
//
// Čita `_wc_order_attribution_*` sa WooCommerce REST API-ja i upisuje SAMO
// `orders.attr_*` kolone — i to samo porudžbinama kojima je `attr_source_type`
// još prazan (ono što je webhook već snimio se ne prepisuje). Ništa drugo se
// ne dira: stavke, cene, status, adresa ostaju netaknuti.
//
// Pravila parsiranja su ista kao `wooAttribution` u lib/woo.ts („(none)" → null,
// najviše 500 znakova).
//
// Pokretanje:
//   npm run backfill:atribucija            # dry-run: samo prebroji i prikaže
//   npm run backfill:atribucija -- --apply # upiše
// Preduslovi (.env.local): WOO_API_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const { WOO_API_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET } = process.env;
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!WOO_API_URL || !WOO_CONSUMER_KEY || !WOO_CONSUMER_SECRET || !URL_SB || !SERVICE) {
  console.error("Nedostaju env varijable (WOO_* / SUPABASE_*). Vidi .env.local.");
  process.exit(2);
}

const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
const base = WOO_API_URL.replace(/\/$/, "");
const api = base.includes("/wp-json") ? base : `${base}/wp-json/wc/v3`;
const auth = "Basic " + Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString("base64");

const FIELDS = ["source_type", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer"];

function text(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join("\n") || null;
  if (typeof v === "string" || typeof v === "number") return String(v).trim() || null;
  return null;
}

function attribution(meta) {
  const out = {};
  for (const f of FIELDS) {
    const t = text(meta.find((m) => m.key === `_wc_order_attribution_${f}`)?.value);
    out[`attr_${f}`] = t && t !== "(none)" ? t.slice(0, 500) : null;
  }
  return out;
}

// ── 1. porudžbine u app-u bez atribucije ────────────────────────────────────
const missing = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("orders")
    .select("id, woo_order_id")
    .is("attr_source_type", null)
    .not("woo_order_id", "is", null)
    .order("woo_order_id")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  missing.push(...data);
  if (data.length < 1000) break;
}
console.log(`Porudžbina bez atribucije u app-u: ${missing.length}`);
if (missing.length === 0) process.exit(0);

const wanted = new Map(missing.map((o) => [Number(o.woo_order_id), o.id]));

// ── 2. Woo porudžbine (samo id + meta_data), sve strane redom ──────────────
const found = new Map();
for (let page = 1; ; page++) {
  const url = new URL(`${api}/orders`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("orderby", "id");
  url.searchParams.set("order", "asc");
  url.searchParams.set("status", "any");
  url.searchParams.set("_fields", "id,meta_data");
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Woo ${res.status} na strani ${page}`);
  const rows = await res.json();
  for (const r of rows) if (wanted.has(r.id)) found.set(r.id, attribution(r.meta_data ?? []));
  process.stdout.write(`\r  Woo strana ${page} — pronađeno ${found.size}/${wanted.size}`);
  if (rows.length < 100 || found.size === wanted.size) break;
}
console.log();

// ── 3. pregled ──────────────────────────────────────────────────────────────
const withData = [...found].filter(([, a]) => Object.values(a).some((v) => v != null));
const tally = new Map();
for (const [, a] of withData) {
  const k = `${a.attr_source_type ?? "?"} · ${a.attr_utm_source ?? "—"}`;
  tally.set(k, (tally.get(k) ?? 0) + 1);
}
console.log(`Sa atribucijom: ${withData.length} · bez podataka na Woo-u: ${found.size - withData.length} · nema na Woo-u: ${wanted.size - found.size}`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${k}`);
const metaCampaigns = new Set(withData.map(([, a]) => a.attr_utm_campaign).filter((c) => c && /^\d{6,}$/.test(c)));
console.log(`Različitih Meta ID kampanja (utm_campaign): ${metaCampaigns.size}`);

if (!APPLY) {
  console.log("\nDry-run — ništa nije upisano. Pokreni sa --apply.\n");
  process.exit(0);
}

// ── 4. upis (samo attr_*, samo dok je i dalje prazno) ──────────────────────
let written = 0;
for (let i = 0; i < withData.length; i += 10) {
  const batch = withData.slice(i, i + 10);
  await Promise.all(
    batch.map(async ([wooId, attr]) => {
      const { error } = await db
        .from("orders")
        .update(attr)
        .eq("id", wanted.get(wooId))
        .is("attr_source_type", null);
      if (error) throw new Error(`#${wooId}: ${error.message}`);
      written++;
    }),
  );
}
console.log(`\nUpisano: ${written} porudžbina.\n`);
