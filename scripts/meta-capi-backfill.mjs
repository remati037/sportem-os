// ============================================================================
// Sportem OS — CAPI backfill propuštenih Purchase evenata (16–27.10.2026)
//
// Pixel nije slao Purchase dok thank-you stranica nije prepoznata kao
// order-received (popravljeno 27.10). Ova skripta šalje porudžbine sa sajta
// iz tog perioda kao Purchase preko Conversions API-ja.
//
// Meta prima evente stare NAJVIŠE 7 dana — starije porudžbine skripta
// automatski preskače (uz margin od 15 min).
//
// Bira: woo_order_id postoji, delivery_method = xexpress (bez ličnih),
// attr_source_type != admin. Pojedinačne porudžbine se izbacuju sa --exclude.
//
// Pokretanje:
//   node --env-file=.env.local scripts/meta-capi-backfill.mjs --to 2026-10-27T14:00
//       → dry-run: samo spisak i provera payload-a, ništa ne šalje
//   ... --test TEST12345   → šalje sa test_event_code (vidi se u Test Events)
//   ... --live             → pravo slanje
//   --from <iso>  (default 2026-10-16T00:00, Beograd)
//   --to   <iso>  (obavezno: trenutak popravke, Beograd)
//   --exclude 3644,3645
// ============================================================================

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const GRAPH = "v25.0"; // isto kao GRAPH_API_VERSION u lib/meta/client.ts
const PIXEL_ID = "1809630962935446";
const TOKEN = process.env.META_CAPI_TOKEN;
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !URL_SB || !SERVICE) {
  console.error("Nedostaju env varijable (META_CAPI_TOKEN / SUPABASE_*). Vidi .env.local.");
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}
const has = (name) => process.argv.includes(`--${name}`);

// Lokalno vreme Beograda (CET/CEST) → Date. Oktobar 2026: CEST do 25.10 03:00.
function belgrade(iso) {
  const naive = new Date(`${iso}Z`);
  const offH = naive < new Date("2026-10-25T01:00:00Z") ? 2 : 1;
  return new Date(naive.getTime() - offH * 3600_000);
}

const from = belgrade(arg("from") ?? "2026-10-16T00:00");
const toArg = arg("to");
if (!toArg) {
  console.error("Obavezno --to <trenutak popravke, npr. 2026-10-27T14:00>.");
  process.exit(2);
}
const to = belgrade(toArg);
const testCode = arg("test");
const live = has("live");
const exclude = new Set((arg("exclude") ?? "").split(",").filter(Boolean).map(Number));

const sha = (v) => (v ? createHash("sha256").update(v).digest("hex") : undefined);
const norm = (v) => (v ?? "").trim().toLowerCase();

function phone(raw) {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return undefined;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `381${d.slice(1)}`;
  else if (!d.startsWith("381")) d = `381${d}`;
  return d;
}

const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
const { data: orders, error } = await db
  .from("orders")
  .select(
    "id, woo_order_id, ordered_at, delivery_method, woo_status, goods_total, attr_source_type, " +
      "customer_id, ship_name, ship_phone, ship_city, ship_postal_code, customers(email, name), " +
      "order_items(sku, quantity, mp_at_sale)",
  )
  .not("woo_order_id", "is", null)
  .gte("ordered_at", from.toISOString())
  .lt("ordered_at", to.toISOString())
  .order("ordered_at");
if (error) throw error;

const oldest = Date.now() / 1000 - 7 * 86400 + 15 * 60;
const events = [];
for (const o of orders) {
  const t = Math.floor(new Date(o.ordered_at).getTime() / 1000);
  const skip =
    o.delivery_method !== "xexpress" ? "lično"
    : o.attr_source_type === "admin" ? "admin"
    : exclude.has(o.woo_order_id) ? "--exclude"
    : t < oldest ? "starije od 7 dana"
    : null;
  const when = new Date(o.ordered_at).toLocaleString("sr-RS", { timeZone: "Europe/Belgrade" });
  console.log(`${skip ? "  –" : "  +"} #${o.woo_order_id}  ${when}  ${o.goods_total} RSD  ${o.woo_status}${skip ? `  (preskočeno: ${skip})` : ""}`);
  if (skip) continue;

  const [fn, ...rest] = norm(o.ship_name || o.customers?.name).split(/\s+/);
  events.push({
    event_name: "Purchase",
    event_time: t,
    event_id: `backfill_${o.woo_order_id}`,
    action_source: "website",
    event_source_url: "https://sportem.rs/checkout/",
    user_data: {
      em: sha(norm(o.customers?.email)),
      ph: sha(phone(o.ship_phone)),
      fn: sha(fn),
      ln: sha(rest.join(" ")),
      ct: sha(norm(o.ship_city).replace(/[\s\-.,']/g, "")),
      zp: sha((o.ship_postal_code ?? "").replace(/\D/g, "")),
      country: sha("rs"),
      external_id: sha(o.customer_id ?? o.id),
    },
    custom_data: {
      value: o.goods_total,
      currency: "RSD",
      order_id: String(o.woo_order_id),
      content_type: "product",
      contents: o.order_items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: i.mp_at_sale })),
      num_items: o.order_items.reduce((s, i) => s + i.quantity, 0),
    },
  });
}

const total = events.reduce((s, e) => s + e.custom_data.value, 0);
console.log(`\nZa slanje: ${events.length} Purchase, ukupno ${total} RSD.`);
const missing = events.filter((e) => !e.user_data.em || !e.user_data.ph).map((e) => e.custom_data.order_id);
if (missing.length) console.log(`Bez email-a ili telefona: ${missing.join(", ")}`);

if (!testCode && !live) {
  console.log("Dry-run. Za slanje dodaj --test <kod> ili --live.");
  process.exit(0);
}
if (!events.length) process.exit(0);

const body = { data: events, access_token: TOKEN };
if (testCode && !live) body.test_event_code = testCode;
const res = await fetch(`https://graph.facebook.com/${GRAPH}/${PIXEL_ID}/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(`${live ? "LIVE" : `TEST (${testCode})`} → HTTP ${res.status}`, JSON.stringify(json));
process.exit(res.ok ? 0 : 1);
