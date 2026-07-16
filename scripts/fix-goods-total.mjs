/*
 * Jednokratni fix: preračunaj `orders.goods_total` iz trenutnih stavki
 * (Σ mp_at_sale × quantity) za jednu porudžbinu po Woo broju. Rešava stare
 * porudžbine kojima je stavka obrisana/izmenjena pre nego što je akcija počela
 * da preračunava total.
 *
 *   node --env-file-if-exists=.env.local scripts/fix-goods-total.mjs 2818          # dry-run
 *   node --env-file-if-exists=.env.local scripts/fix-goods-total.mjs 2818 --apply  # upiši
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const wooId = Number(args.find((a) => /^\d+$/.test(a)) ?? "2818");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (vidi .env.local).");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const { data: order, error: orderErr } = await db
  .from("orders")
  .select("id, woo_order_id, goods_total")
  .eq("woo_order_id", wooId)
  .maybeSingle();
if (orderErr) throw orderErr;
if (!order) {
  console.error(`Porudžbina #${wooId} nije pronađena.`);
  process.exit(1);
}

const { data: items, error: itemsErr } = await db
  .from("order_items")
  .select("sku, product_name, quantity, mp_at_sale")
  .eq("order_id", order.id);
if (itemsErr) throw itemsErr;

const computed = (items ?? []).reduce((sum, i) => sum + (i.mp_at_sale ?? 0) * (i.quantity ?? 0), 0);

console.log(`Porudžbina #${wooId} (${order.id})`);
for (const i of items ?? []) {
  console.log(`  ${i.sku}  ${i.product_name}  ${i.quantity} × ${i.mp_at_sale} = ${i.mp_at_sale * i.quantity}`);
}
console.log(`  Trenutni goods_total: ${order.goods_total}`);
console.log(`  Izračunati goods_total: ${computed}`);

if (order.goods_total === computed) {
  console.log("Već je usklađeno — nema izmene.");
  process.exit(0);
}

if (!APPLY) {
  console.log("\nDry-run. Dodaj --apply da upišeš.");
  process.exit(0);
}

const { error: updErr } = await db.from("orders").update({ goods_total: computed }).eq("id", order.id);
if (updErr) throw updErr;
console.log(`\nUpisano: goods_total = ${computed}.`);
