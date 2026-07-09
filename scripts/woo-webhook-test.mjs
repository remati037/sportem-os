// ============================================================================
// Sportem OS — test WooCommerce webhooka (Korak 1.2)
//
// Šalje potpisane payload-e na lokalnu rutu i proverava stanje u bazi kroz
// service role klijent. Koristi visoke woo_order_id-jeve (99xxxx) i briše
// svoje podatke na kraju — ne dira prave porudžbine.
//
// Preduslovi:
//   • `npm run dev` radi na http://localhost:3000
//   • WOO_WEBHOOK_SECRET + SUPABASE_SERVICE_ROLE_KEY u .env.local
//   • bar jedna aktivna varijanta u katalogu (za snapshot test)
//
// Pokretanje:
//   node --env-file=.env.local scripts/woo-webhook-test.mjs
// ============================================================================

import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.WOO_WEBHOOK_SECRET;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SECRET || !URL || !SERVICE) {
  console.error("Nedostaju env varijable (WOO_WEBHOOK_SECRET / SUPABASE_*). Vidi .env.local.");
  process.exit(2);
}

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const WOO_ID_A = 990001; // poznat SKU
const WOO_ID_B = 990002; // nepoznat SKU
const WOO_ID_C = 990003; // otkazivanje na plaćenoj
const TEST_PHONE = "0699990001";

let failures = 0;
function check(label, pass, detail = "") {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function sign(body) {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

async function post(payload, { badSignature = false, noSignature = false } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = {
    "content-type": "application/json",
    "x-wc-webhook-topic": "order.created",
  };
  // noSignature = Woo ping / napad bez potpisa; badSignature = pogrešan potpis.
  if (!noSignature) headers["x-wc-webhook-signature"] = badSignature ? sign(`${body}x`) : sign(body);
  const res = await fetch(`${APP_URL}/api/webhooks/woo`, {
    method: "POST",
    headers,
    body,
  });
  return res.status;
}

function makeOrder({ id, sku, phone = "+381 69/999-0001", status = "processing" }) {
  return {
    id,
    status,
    date_created_gmt: "2026-07-09T10:00:00",
    total: "13390.00",
    shipping_total: "390.00",
    payment_method: "cod",
    customer_note: "Test napomena",
    billing: {
      first_name: "Test",
      last_name: "Kupac",
      address_1: "Testna 1",
      city: "Beograd",
      postcode: "11000",
      phone,
      email: "test.kupac@example.com",
    },
    shipping: {
      first_name: "Test",
      last_name: "Kupac",
      address_1: "Testna 1",
      city: "Beograd",
      postcode: "11000",
    },
    line_items: [{ sku, name: "Test artikal", quantity: 2, total: "13000.00", price: 6500 }],
  };
}

async function getOrder(wooId) {
  const { data } = await db
    .from("orders")
    .select(
      "id, needs_vp, needs_review, review_reason, woo_status, cancelled_at, goods_total, shipping_charged, cod_amount, customer_id, payment_status, order_statuses(name), order_items(sku, quantity, mp_at_sale, vp_at_sale, profit_at_sale, variant_id)",
    )
    .eq("woo_order_id", wooId)
    .maybeSingle();
  return data;
}

async function cleanup() {
  await db.from("orders").delete().in("woo_order_id", [WOO_ID_A, WOO_ID_B, WOO_ID_C]);
  await db.from("customers").delete().eq("phone", TEST_PHONE);
}

async function main() {
  await cleanup();

  // Realna varijanta iz kataloga za snapshot test.
  const { data: variant } = await db
    .from("product_variants")
    .select("id, sku, vp_price")
    .is("archived_at", null)
    .limit(1)
    .single();
  if (!variant) {
    console.error("Nema aktivnih varijanti u katalogu — učitaj katalog pa ponovi.");
    process.exit(2);
  }

  console.log("\n1) order.created — poznat SKU, snapshot cena");
  const orderA = makeOrder({ id: WOO_ID_A, sku: variant.sku });
  check("HTTP 200", (await post(orderA)) === 200);
  let a = await getOrder(WOO_ID_A);
  check("order upisan", Boolean(a));
  check("status Kreirano", a?.order_statuses?.name === "Kreirano");
  const itemA = a?.order_items?.[0];
  check("mp_at_sale = 6500 (13000/2)", itemA?.mp_at_sale === 6500);
  check("vp_at_sale = vp_price varijante", itemA?.vp_at_sale === variant.vp_price);
  check("variant_id povezan", itemA?.variant_id === variant.id);
  check(
    "profit_at_sale generisan",
    itemA?.profit_at_sale === (6500 - variant.vp_price) * 2,
    String(itemA?.profit_at_sale),
  );
  check("needs_vp = false", a?.needs_vp === false);
  check("goods_total = 13000", a?.goods_total === 13000);
  check("shipping_charged = 390", a?.shipping_charged === 390);
  check("cod_amount = 13390", a?.cod_amount === 13390);

  console.log("\n2) Idempotentnost — isti payload 2×");
  check("HTTP 200", (await post(orderA)) === 200);
  const { count } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("woo_order_id", WOO_ID_A);
  check("nema duplikata", count === 1);

  console.log("\n3) Nepoznat SKU → needs_vp");
  check("HTTP 200", (await post(makeOrder({ id: WOO_ID_B, sku: "NE-POSTOJI-XYZ" }))) === 200);
  const b = await getOrder(WOO_ID_B);
  check("needs_vp = true", b?.needs_vp === true);
  check("vp_at_sale null", b?.order_items?.[0]?.vp_at_sale === null);
  check("profit_at_sale null", b?.order_items?.[0]?.profit_at_sale === null);

  console.log("\n4) order.updated — otkazivanje");
  check(
    "HTTP 200",
    (await post(makeOrder({ id: WOO_ID_A, sku: variant.sku, status: "cancelled" }))) === 200,
  );
  a = await getOrder(WOO_ID_A);
  check("status Otkazano/Vraćeno", a?.order_statuses?.name === "Otkazano/Vraćeno");
  check("cancelled_at upisan", Boolean(a?.cancelled_at));
  check("woo_status = cancelled", a?.woo_status === "cancelled");
  check("stavke netaknute", a?.order_items?.length === 1);

  console.log("\n5) Otkazivanje na plaćenoj → needs_review, status netaknut");
  check("HTTP 200", (await post(makeOrder({ id: WOO_ID_C, sku: variant.sku }))) === 200);
  await db.from("orders").update({ payment_status: "kes" }).eq("woo_order_id", WOO_ID_C);
  check(
    "HTTP 200",
    (await post(makeOrder({ id: WOO_ID_C, sku: variant.sku, status: "refunded" }))) === 200,
  );
  const c = await getOrder(WOO_ID_C);
  check("status ostao Kreirano", c?.order_statuses?.name === "Kreirano");
  check("needs_review = true", c?.needs_review === true);
  check("review_reason upisan", Boolean(c?.review_reason));

  console.log("\n6) Pogrešan potpis → 401");
  check(
    "HTTP 401",
    (await post(makeOrder({ id: 990009, sku: variant.sku }), { badSignature: true })) === 401,
  );

  console.log("\n7) Potpisan ping → 200");
  check("form-encoded ping", (await post("webhook_id=42")) === 200);
  check("JSON ping", (await post({ webhook_id: 42 })) === 200);

  console.log("\n7b) NEPOTPISAN ping → 200 (Woo deliver_ping ne šalje potpis)");
  check("form-encoded ping bez potpisa", (await post("webhook_id=42", { noSignature: true })) === 200);
  check("JSON ping bez potpisa", (await post({ webhook_id: 42 }, { noSignature: true })) === 200);
  check(
    "nepotpisana PRAVA porudžbina → 401",
    (await post(makeOrder({ id: 990009, sku: variant.sku }), { noSignature: true })) === 401,
  );

  console.log("\n8) Dedup kupca po telefonu (+381 vs 0…)");
  const { count: custCount } = await db
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("phone", TEST_PHONE);
  check("jedan kupac za sve tri porudžbine", custCount === 1, `count=${custCount}`);

  await cleanup();

  console.log(failures === 0 ? "\n✅ Svi testovi prošli." : `\n❌ ${failures} provera palo.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
