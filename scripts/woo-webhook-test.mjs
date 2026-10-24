// ============================================================================
// Sportem OS — test WooCommerce webhooka (Korak 1.2)
//
// Šalje potpisane payload-e na lokalnu rutu i proverava stanje u bazi kroz
// service role klijent. Koristi visoke woo_order_id-jeve (99xxxx) i briše
// svoje podatke na kraju — ne dira prave porudžbine.
//
// Pokriva i automatsko skidanje robe sa stanja (nova porudžbina −količina,
// otkazivanje +količina, bez duplog skidanja na Woo retry). Stanje test
// varijante se na kraju vraća na polaznu cifru.
//
// Pokriva i poklone iz paketa (plugin „Sportem Offers", Woo meta
// `sportem_pokloni_tekst` / `sportem_besplatna_dostava`): snimaju se na prvom
// prijemu, `order.updated` ih ne prepisuje, a prazne samo dopunjuje.
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
const WOO_ID_D = 990004; // paket sa poklonima na prvom prijemu
const WOO_ID_E = 990005; // pokloni stigli tek sa order.updated
const WOO_ID_F = 990006; // atribucija na prvom prijemu (Reklame M3)
const WOO_ID_G = 990007; // atribucija stigla tek sa order.updated
const TEST_PHONE = "0699990001";
// Drugi kupac za poklone — da ga ne poveže „rizičan kupac" sa otkazanom A.
const GIFT_PHONE = "0699990002";

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
  if (!noSignature)
    headers["x-wc-webhook-signature"] = badSignature ? sign(`${body}x`) : sign(body);
  const res = await fetch(`${APP_URL}/api/webhooks/woo`, {
    method: "POST",
    headers,
    body,
  });
  return res.status;
}

function makeOrder({ id, sku, phone = "+381 69/999-0001", status = "processing", meta }) {
  return {
    ...(meta ? { meta_data: meta } : {}),
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
      "id, needs_vp, needs_review, review_reason, woo_status, cancelled_at, gift_text, free_shipping, attr_source_type, attr_utm_source, attr_utm_medium, attr_utm_campaign, goods_total, shipping_charged, cod_amount, customer_id, payment_status, stock_applied, order_statuses(name), order_items(sku, quantity, mp_at_sale, vp_at_sale, profit_at_sale, variant_id)",
    )
    .eq("woo_order_id", wooId)
    .maybeSingle();
  return data;
}

/** Trenutno stanje varijante (test automatskog skidanja sa stanja). */
async function stockOf(variantId) {
  const { data } = await db
    .from("product_variants")
    .select("stock_quantity")
    .eq("id", variantId)
    .single();
  return data?.stock_quantity;
}

async function cleanup() {
  await db
    .from("orders")
    .delete()
    .in("woo_order_id", [WOO_ID_A, WOO_ID_B, WOO_ID_C, WOO_ID_D, WOO_ID_E, WOO_ID_F, WOO_ID_G]);
  await db.from("customers").delete().in("phone", [TEST_PHONE, GIFT_PHONE]);
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

  // Polazno stanje varijante — sve provere skidanja/vraćanja idu u odnosu na njega.
  const baseStock = await stockOf(variant.id);

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
  check("stock_applied = true", a?.stock_applied === true);
  check(
    "stanje skinuto za 2 komada",
    (await stockOf(variant.id)) === baseStock - 2,
    `${await stockOf(variant.id)} (polazno ${baseStock})`,
  );

  console.log("\n2) Idempotentnost — isti payload 2×");
  check("HTTP 200", (await post(orderA)) === 200);
  const { count } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("woo_order_id", WOO_ID_A);
  check("nema duplikata", count === 1);
  check("stanje nije duplo skinuto", (await stockOf(variant.id)) === baseStock - 2);

  console.log("\n3) Nepoznat SKU → needs_vp");
  check("HTTP 200", (await post(makeOrder({ id: WOO_ID_B, sku: "NE-POSTOJI-XYZ" }))) === 200);
  const b = await getOrder(WOO_ID_B);
  check("needs_vp = true", b?.needs_vp === true);
  check("vp_at_sale null", b?.order_items?.[0]?.vp_at_sale === null);
  check("profit_at_sale null", b?.order_items?.[0]?.profit_at_sale === null);
  check("nepoznat SKU ne dira stanje", (await stockOf(variant.id)) === baseStock - 2);

  console.log("\n4) order.updated — otkazivanje");
  check(
    "HTTP 200",
    (await post(makeOrder({ id: WOO_ID_A, sku: variant.sku, status: "cancelled" }))) === 200,
  );
  a = await getOrder(WOO_ID_A);
  check("status Otkazano", a?.order_statuses?.name === "Otkazano");
  check("cancelled_at upisan", Boolean(a?.cancelled_at));
  check("woo_status = cancelled", a?.woo_status === "cancelled");
  check("stavke netaknute", a?.order_items?.length === 1);
  check("stock_applied = false", a?.stock_applied === false);
  check(
    "stanje vraćeno na polazno",
    (await stockOf(variant.id)) === baseStock,
    `${await stockOf(variant.id)} (polazno ${baseStock})`,
  );
  // Woo retry istog „cancelled" ne sme drugi put da vrati robu na stanje.
  await post(makeOrder({ id: WOO_ID_A, sku: variant.sku, status: "cancelled" }));
  check("2× otkazivanje ne vraća duplo", (await stockOf(variant.id)) === baseStock);

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
  // Status se nije promenio → roba ostaje skinuta dok Admin ručno ne odluči.
  check("stock_applied ostao true", c?.stock_applied === true);
  check("stanje ostalo skinuto", (await stockOf(variant.id)) === baseStock - 2);

  console.log("\n6) Pogrešan potpis → 401");
  check(
    "HTTP 401",
    (await post(makeOrder({ id: 990009, sku: variant.sku }), { badSignature: true })) === 401,
  );

  console.log("\n7) Potpisan ping → 200");
  check("form-encoded ping", (await post("webhook_id=42")) === 200);
  check("JSON ping", (await post({ webhook_id: 42 })) === 200);

  console.log("\n7b) NEPOTPISAN ping → 200 (Woo deliver_ping ne šalje potpis)");
  check(
    "form-encoded ping bez potpisa",
    (await post("webhook_id=42", { noSignature: true })) === 200,
  );
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

  console.log("\n9) Pokloni iz paketa (Woo meta) — snapshot");
  check("porudžbina bez paketa → gift_text null", a?.gift_text === null);
  check("porudžbina bez paketa → free_shipping false", a?.free_shipping === false);

  const GIFT = "Poklon: Šejker 500 ml\nPoklon: Peškir";
  const giftMeta = [
    { id: 1, key: "_metorik_source_type", value: "organic" },
    { id: 2, key: "sportem_pokloni_tekst", value: GIFT },
    { id: 3, key: "sportem_besplatna_dostava", value: "1" },
  ];
  const gPhone = "+381 69/999-0002";
  check(
    "HTTP 200 (paket)",
    (await post(
      makeOrder({ id: WOO_ID_D, sku: "NE-POSTOJI-XYZ", phone: gPhone, meta: giftMeta }),
    )) === 200,
  );
  let d = await getOrder(WOO_ID_D);
  check("gift_text snimljen", d?.gift_text === GIFT, JSON.stringify(d?.gift_text));
  check("free_shipping = true", d?.free_shipping === true);

  check(
    "HTTP 200 (update sa drugim poklonom)",
    (await post(
      makeOrder({
        id: WOO_ID_D,
        sku: "NE-POSTOJI-XYZ",
        phone: gPhone,
        status: "completed",
        meta: [{ key: "sportem_pokloni_tekst", value: "PREPISANO" }],
      }),
    )) === 200,
  );
  d = await getOrder(WOO_ID_D);
  check("order.updated NE prepisuje poklon", d?.gift_text === GIFT);
  check("woo_status ipak osvežen", d?.woo_status === "completed");

  check(
    "HTTP 200 (bez meta)",
    (await post(makeOrder({ id: WOO_ID_E, sku: "NE-POSTOJI-XYZ", phone: gPhone }))) === 200,
  );
  check("bez meta → gift_text null", (await getOrder(WOO_ID_E))?.gift_text === null);
  check(
    "HTTP 200 (meta stigla sa update-om)",
    (await post(
      makeOrder({
        id: WOO_ID_E,
        sku: "NE-POSTOJI-XYZ",
        phone: gPhone,
        meta: [{ key: "sportem_pokloni_tekst", value: ["Poklon: Čarape", "Poklon: Flašica"] }],
      }),
    )) === 200,
  );
  check(
    "prazan poklon dopunjen na update-u (niz → redovi)",
    (await getOrder(WOO_ID_E))?.gift_text === "Poklon: Čarape\nPoklon: Flašica",
  );

  console.log("\n10) Atribucija (Woo Order Attribution) — snapshot");
  const attrMeta = (source, campaign) => [
    { key: "_wc_order_attribution_source_type", value: "utm" },
    { key: "_wc_order_attribution_utm_source", value: source },
    { key: "_wc_order_attribution_utm_medium", value: "(none)" },
    { key: "_wc_order_attribution_utm_campaign", value: campaign },
  ];
  const aPhone = "+381 69/999-0003";
  check(
    "HTTP 200 (sa atribucijom)",
    (await post(
      makeOrder({
        id: WOO_ID_F,
        sku: "NE-POSTOJI-XYZ",
        phone: aPhone,
        meta: attrMeta("ig", "120252079699270136"),
      }),
    )) === 200,
  );
  let f = await getOrder(WOO_ID_F);
  check("utm_source snimljen", f?.attr_utm_source === "ig", JSON.stringify(f?.attr_utm_source));
  check("utm_campaign = ID kampanje", f?.attr_utm_campaign === "120252079699270136");
  check("„(none)“ → null", f?.attr_utm_medium === null);
  check("source_type snimljen", f?.attr_source_type === "utm");
  check(
    "HTTP 200 (update sa drugom atribucijom)",
    (await post(
      makeOrder({
        id: WOO_ID_F,
        sku: "NE-POSTOJI-XYZ",
        phone: aPhone,
        meta: attrMeta("fb", "PREPISANO"),
      }),
    )) === 200,
  );
  f = await getOrder(WOO_ID_F);
  check("order.updated NE prepisuje atribuciju", f?.attr_utm_campaign === "120252079699270136");

  check(
    "HTTP 200 (bez atribucije)",
    (await post(makeOrder({ id: WOO_ID_G, sku: "NE-POSTOJI-XYZ", phone: aPhone }))) === 200,
  );
  check("bez meta → atribucija null", (await getOrder(WOO_ID_G))?.attr_source_type === null);
  check(
    "HTTP 200 (atribucija stigla sa update-om)",
    (await post(
      makeOrder({
        id: WOO_ID_G,
        sku: "NE-POSTOJI-XYZ",
        phone: aPhone,
        meta: attrMeta("fb", "777"),
      }),
    )) === 200,
  );
  const g = await getOrder(WOO_ID_G);
  check(
    "prazna atribucija dopunjena na update-u",
    g?.attr_utm_source === "fb" && g?.attr_utm_campaign === "777",
  );

  await cleanup();
  // Test porudžbina C je ostala „skinuta sa stanja" (needs_review) — brisanje reda
  // ne vraća robu, pa stanje vraćamo ručno da katalog ostane netaknut.
  await db.from("product_variants").update({ stock_quantity: baseStock }).eq("id", variant.id);
  check("stanje varijante vraćeno posle testa", (await stockOf(variant.id)) === baseStock);

  console.log(failures === 0 ? "\n✅ Svi testovi prošli." : `\n❌ ${failures} provera palo.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
