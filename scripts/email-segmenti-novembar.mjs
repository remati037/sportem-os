// ============================================================================
// Sportem OS — izvoz kupaca za novembarsku email kampanju (paketi + Crni petak)
//
// SAMO ČITA Supabase. Pravi CSV za uvoz u Brevo, jedan red po email adresi:
//   EMAIL;FIRSTNAME;SEGMENT;PORUDZBINE;POSLEDNJA
//
// Segment = najozbiljnija kategorija koju je kupac ikad kupio:
//   C teretana (FI50/FI30 tegovi, šipke, rack, klupe za teretanu)
//   D funkcionalno (vratilo, prsluk, crossfit, kardio mašine)
//   B bučice i kućna teretana (HEX, podesive, set 3u1, zvona, HEXIT klupa)
//   A kućni trening (sve ostalo: trake, prostirke, joga, pilates, steper…)
//
// Izbacuje: kupce bez nijedne neotkazane porudžbine, duple adrese, adrese
// sa očiglednom greškom u domenu.
//
// Pokretanje:
//   node --env-file=.env.local scripts/email-segmenti-novembar.mjs <izlazni folder>
//   … <izlazni folder> 2026-11-23   # izbaci kupce koji su poručili od tog datuma
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const excludeFrom = process.argv[3] ?? "";
if (!out) {
  console.error("Navedi izlazni folder.");
  process.exit(2);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function all(q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const prefixes = (list) => list.map((s) => new RegExp(`^${s}(-|$)`));
const SEG = {
  C: prefixes([
    "SM009", "SM012", "SM013", "SM018", "SM021", "SM024", "SM026", "SM031", "SM048", "SM050", "SM051",
    "SM052", "SM053", "SM054", "SM055", "SM058", "SM059", "SM061", "SM062", "SM063", "SM064", "SM065",
    "SM066", "SM069", "SM179", "SM180", "SM196", "SM198", "SM203", "SM221", "SM237", "SM245",
  ]),
  D: prefixes([
    "SM020", "SM032", "SM091", "SM092", "SM097", "SM098", "SM114", "SM120", "SM147", "SM158", "SM181",
    "SM202", "SM238", "SM239", "SM246", "SM250",
  ]),
  B: prefixes(["SM001", "SM019", "SM022", "SM185", "SM186", "SM195", "SM204", "SM210", "SM214", "SM222", "SM223"]),
};
const ORDER = ["C", "D", "B"];

const BAD_DOMAIN = /\.(frcom|con|cm|comm|co)$|gmial|gmai\.|gamil|hotmial|yahho/i;
const VALID = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function firstName(name) {
  const t = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}-]{2,}$/u.test(t)) return "";
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

const customers = await all(() => db.from("customers").select("id,name,email"));
const orders = await all(() =>
  db.from("orders").select("customer_id,ordered_at,cancelled_at,order_items(sku)").not("customer_id", "is", null),
);

const byCustomer = new Map();
for (const o of orders) {
  if (o.cancelled_at) continue;
  const list = byCustomer.get(o.customer_id) ?? [];
  list.push(o);
  byCustomer.set(o.customer_id, list);
}

const byEmail = new Map();
let skippedBad = 0;
for (const c of customers) {
  const own = byCustomer.get(c.id);
  if (!own) continue;
  const email = (c.email ?? "").trim().toLowerCase();
  if (!VALID.test(email) || BAD_DOMAIN.test(email.split("@")[1])) {
    skippedBad++;
    continue;
  }
  const row = byEmail.get(email) ?? { email, name: "", skus: new Set(), n: 0, last: "" };
  row.name ||= firstName(c.name);
  for (const o of own) {
    row.n++;
    if ((o.ordered_at ?? "") > row.last) row.last = o.ordered_at ?? "";
    for (const i of o.order_items) row.skus.add(i.sku);
  }
  byEmail.set(email, row);
}

const groups = { A: [], B: [], C: [], D: [] };
let skippedRecent = 0;
for (const r of byEmail.values()) {
  if (excludeFrom && r.last.slice(0, 10) >= excludeFrom) {
    skippedRecent++;
    continue;
  }
  const skus = [...r.skus];
  const seg = ORDER.find((s) => skus.some((sku) => SEG[s].some((re) => re.test(sku)))) ?? "A";
  groups[seg].push(r);
}

mkdirSync(out, { recursive: true });
const header = "EMAIL;FIRSTNAME;SEGMENT;PORUDZBINE;POSLEDNJA";
const line = (r, s) => [r.email, r.name, s, r.n, r.last.slice(0, 10)].join(";");
const allLines = [];
for (const [s, rows] of Object.entries(groups)) {
  rows.sort((a, b) => b.last.localeCompare(a.last));
  const lines = rows.map((r) => line(r, s));
  allLines.push(...lines);
  writeFileSync(join(out, `segment-${s}.csv`), [header, ...lines].join("\n") + "\n");
}
writeFileSync(join(out, "svi-kupci.csv"), [header, ...allLines].join("\n") + "\n");

console.log(`Adrese: ${byEmail.size} (izbačeno zbog greške u adresi: ${skippedBad})`);
if (excludeFrom) console.log(`  izbačeno jer su poručili od ${excludeFrom}: ${skippedRecent}`);
for (const [s, rows] of Object.entries(groups)) console.log(`  segment ${s}: ${rows.length}`);
