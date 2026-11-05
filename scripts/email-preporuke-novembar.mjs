// ============================================================================
// Sportem OS — lične preporuke za novembarski mejl (E1), po kupcu
//
// SAMO ČITA (Supabase, WooCommerce, Sportem Offers). Za svakog kupca iz
// segment CSV-a bira:
//   • glavni paket: prvi paket iz njegove grupe u kome nema ničega što je već
//     kupio (grupe „any" se računaju kao zauzete tek kad ima sve opcije)
//   • 3 proizvoda koja nema, po tome šta drugi kupci kupuju uz ono što on ima
//   • ako nijedan paket ne prolazi, glavna ponuda je prvi preporučeni proizvod
// Rezultat je CSV sa Brevo atributima (HERO_*, R1_*…R3_*, E1_*).
//
//   node --env-file=.env.local scripts/email-preporuke-novembar.mjs <kontakti folder>
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vokativ } from "./lib/vokativ.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("Navedi folder sa segment-*.csv.");
  process.exit(2);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const WOO = process.env.WOO_API_URL.replace(/\/$/, "");
const WOO_AUTH = "Basic " + Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString("base64");
const WP = process.env.SPORTEM_WP_URL.replace(/\/$/, "");

const base = (sku) => String(sku ?? "").split("-")[0].toUpperCase();
const rsd = (n) => Math.round(n).toLocaleString("de-DE");

// Paketi po grupi kupaca, redom kako ih nudimo (slug iz Sportem Offers).
const GROUP_PACKAGES = {
  A: ["booty-paket", "joga-pilates-paket", "kucni-kardio-paket", "kucni-starter-paket", "hex-starter-paket"],
  B: ["kucna-teretana-paket", "street-workout-paket", "kucni-kardio-paket", "hex-starter-paket"],
  C: ["hexit-olimpijski-set", "prenosivi-benc-set", "hexit-powerlifting-set", "crossfit-paket"],
  D: ["street-workout-paket", "crossfit-paket", "hybrid-trening-paket", "kucna-teretana-paket"],
};
// Ne preporučuju se kao „dopuna" (potrošni, delovi, nisu za ovaj mejl).
const NO_RECO = new Set(["SM153", "SM069", "SM067", "SM068", "SM182", "SM240"]);
// Zamene: ko ima jedno iz grupe, ne nudimo mu drugo iz iste grupe, i u preporukama je najviše jedno po grupi.
const SUBSTITUTES = [
  ["SM001", "SM015", "SM195", "SM210", "SM214", "SM223"], // bučice
  ["SM107", "SM108", "SM109", "SM110", "SM111", "SM208"], // prostirke
  ["SM019", "SM020", "SM022"], // zvona
  ["SM032", "SM147", "SM246", "SM250"], // vratila
  ["SM157", "SM249"], // tegovi za noge
  ["SM102", "SM103"], // pilates lopte
];
// Grupa C (teretana) ne dobija joga i pilates dodatke.
const NO_RECO_SEGMENT = { C: new Set(["SM102", "SM103", "SM130", "SM132", "SM173", "SM226", "SM149"]) };
const groupOf = new Map(SUBSTITUTES.flatMap((g, i) => g.map((s) => [s, i])));

async function all(q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// ── Katalog sa sajta ────────────────────────────────────────────────────────
const catalog = new Map();
for (let page = 1; ; page++) {
  const r = await (
    await fetch(
      `${WOO}/products?per_page=100&page=${page}&status=publish&_fields=id,name,sku,permalink,price,stock_status,images,type`,
      { headers: { Authorization: WOO_AUTH } },
    )
  ).json();
  for (const p of r) {
    if (!p.sku || p.stock_status !== "instock" || !Number(p.price) || !p.images?.[0]) continue;
    catalog.set(base(p.sku), {
      name: p.name,
      url: p.permalink,
      img: p.images[0].src,
      price: Number(p.price),
      from: p.type === "variable",
    });
  }
  if (r.length < 100) break;
}

// ── Paketi ──────────────────────────────────────────────────────────────────
const pk = await (
  await fetch(`${WP}/wp-json/sportem-offers/v1/packages`, { headers: { "X-Sportem-Key": process.env.SPORTEM_OFFERS_API_KEY } })
).json();
const packages = new Map();
for (const p of pk.packages) {
  const groups = p.groups
    .filter((g) => g.mode === "all" || g.mode === "any")
    .map((g) => ({ mode: g.mode, skus: g.items.map((i) => base(i.product?.sku)).filter(Boolean) }));
  packages.set(p.slug, {
    name: p.title,
    url: p.url,
    img: p.image,
    price: p.from_price,
    items: p.groups
      .filter((g) => g.mode === "all" || g.mode === "any")
      .map((g) => g.items.map((i) => i.label.trim()).join(g.mode === "any" ? " ili " : ", "))
      .join(" + "),
    excerpt: p.excerpt,
    gift: p.gifts.map((g) => (g.type === "ebook" ? `Ebook: ${g.title}` : g.title)).join(" + "),
    groups,
    skus: new Set(groups.flatMap((g) => g.skus)),
  });
}
const blocks = (pack, owned) =>
  pack.groups.some((g) => (g.mode === "all" ? g.skus.some((s) => owned.has(s)) : g.skus.every((s) => owned.has(s))));

// ── Kupovine ────────────────────────────────────────────────────────────────
const customers = await all(() => db.from("customers").select("id,email"));
const orders = await all(() =>
  db.from("orders").select("customer_id,cancelled_at,order_items(sku,mp_at_sale)").not("customer_id", "is", null),
);
const emailOf = new Map(customers.map((c) => [c.id, (c.email ?? "").trim().toLowerCase()]));
const owned = new Map(); // email → Set(base sku)
const maxPrice = new Map();
for (const o of orders) {
  if (o.cancelled_at) continue;
  const e = emailOf.get(o.customer_id);
  if (!e) continue;
  const set = owned.get(e) ?? new Set();
  for (const i of o.order_items) {
    set.add(base(i.sku));
    maxPrice.set(e, Math.max(maxPrice.get(e) ?? 0, i.mp_at_sale ?? 0));
  }
  owned.set(e, set);
}

// Zajedničke kupovine na nivou kupca: n[a] i co[a][b].
const n = new Map();
const co = new Map();
for (const set of owned.values()) {
  const list = [...set];
  for (const a of list) {
    n.set(a, (n.get(a) ?? 0) + 1);
    const row = co.get(a) ?? new Map();
    for (const b of list) if (a !== b) row.set(b, (row.get(b) ?? 0) + 1);
    co.set(a, row);
  }
}
const popularity = [...n.entries()].sort((x, y) => y[1] - x[1]).map(([s]) => s);

const TOTAL = owned.size;

// Povezanost (lift): koliko je b češći kod onih koji imaju a nego kod svih kupaca.
// Množi se kvadratnim korenom učestalosti, da retki proizvodi sa 2 slučajne kupovine ne isplivaju.
function recommend(have, limit, exclude, cap, seg) {
  const ownedGroups = new Set([...have, ...exclude].map((s) => groupOf.get(s)).filter((g) => g !== undefined));
  const score = new Map();
  for (const a of have) {
    const row = co.get(a);
    if (!row || (n.get(a) ?? 0) < 3) continue;
    for (const [b, c] of row) {
      if (c < 3) continue;
      const lift = c / n.get(a) / (n.get(b) / TOTAL);
      if (lift > 1.2) score.set(b, (score.get(b) ?? 0) + lift * Math.sqrt(c));
    }
  }
  const ok = (s) =>
    catalog.has(s) && !have.has(s) && !exclude.has(s) && !NO_RECO.has(s) && !NO_RECO_SEGMENT[seg]?.has(s) && catalog.get(s).price <= cap && !ownedGroups.has(groupOf.get(s));
  const ranked = [...score.entries()].filter(([s]) => ok(s)).sort((x, y) => y[1] - x[1]).map(([s]) => s);
  for (const s of popularity) if (ok(s) && !ranked.includes(s)) ranked.push(s);
  const picked = [];
  const usedGroups = new Set();
  for (const s of ranked) {
    const g = groupOf.get(s);
    if (g !== undefined && usedGroups.has(g)) continue;
    if (g !== undefined) usedGroups.add(g);
    picked.push(s);
    if (picked.length === limit) break;
  }
  return picked;
}

// ── Po kupcu ────────────────────────────────────────────────────────────────
const out = [];
const stats = { paket: {}, proizvod: 0, bezPreporuka: 0 };
for (const seg of ["A", "B", "C", "D"]) {
  const rows = readFileSync(join(dir, `segment-${seg}.csv`), "utf8").trim().split("\n").slice(1);
  for (const line of rows) {
    const [email, firstName] = line.split(";");
    const have = owned.get(email) ?? new Set();
    const cap = Math.max(8000, (maxPrice.get(email) ?? 0) * 1.5);
    const slug = GROUP_PACKAGES[seg].find((s) => packages.has(s) && !blocks(packages.get(s), have));
    const pack = slug ? packages.get(slug) : null;

    let hero;
    let recs;
    if (pack) {
      recs = recommend(have, 3, pack.skus, cap, seg);
      hero = { tip: "paket", name: pack.name, url: pack.url, img: pack.img, opis: pack.excerpt, cena: `od ${rsd(pack.price)} RSD`, poklon: pack.gift };
      stats.paket[pack.name] = (stats.paket[pack.name] ?? 0) + 1;
    } else {
      const r = recommend(have, 4, new Set(), cap, seg);
      const top = catalog.get(r[0]);
      hero = { tip: "proizvod", name: top.name, url: top.url, img: top.img, opis: "Najčešće se kupuje uz opremu koju već imaš.", cena: `${top.from ? "od " : ""}${rsd(top.price)} RSD`, poklon: "" };
      recs = r.slice(1);
      stats.proizvod++;
    }
    if (recs.length < 3) stats.bezPreporuka++;

    const vok = vokativ(firstName);
    const ime = vok ? `${vok}, ` : "";
    const subject =
      hero.tip === "paket"
        ? `${ime}${vok ? "uz" : "Uz"} ${hero.name} ide poklon 🎁`
        : `${ime}${vok ? "dopuni" : "Dopuni"} opremu za trening kod kuće`;
    const preheader =
      hero.tip === "paket"
        ? `${hero.items ?? hero.opis}. Poklon važi do 30.11.`.replace("undefined. ", "")
        : `${[hero.name, ...recs.map((s) => catalog.get(s).name)].slice(0, 3).join(", ")}.`;
    const attrs = {
      SEGMENT: seg,
      VOKATIV: vok,
      E1_NASLOV: subject,
      E1_PREHEADER: hero.tip === "paket" ? `${hero.poklon.replace(/^Ebook: /, "")} na poklon uz paket, do 30.11.` : preheader,
      HERO_TIP: hero.tip,
      HERO_NAZIV: hero.name,
      HERO_URL: hero.url,
      HERO_SLIKA: hero.img,
      HERO_OPIS: hero.opis,
      HERO_CENA: hero.cena,
      HERO_POKLON: hero.poklon,
    };
    recs.forEach((s, i) => {
      const p = catalog.get(s);
      attrs[`R${i + 1}_NAZIV`] = p.name;
      attrs[`R${i + 1}_URL`] = p.url;
      attrs[`R${i + 1}_SLIKA`] = p.img;
      attrs[`R${i + 1}_CENA`] = `${p.from ? "od " : ""}${rsd(p.price)} RSD`;
    });
    out.push({ email, attrs });
  }
}

const cols = [
  "SEGMENT", "VOKATIV", "E1_NASLOV", "E1_PREHEADER", "HERO_TIP", "HERO_NAZIV", "HERO_URL", "HERO_SLIKA", "HERO_OPIS", "HERO_CENA", "HERO_POKLON",
  ...[1, 2, 3].flatMap((i) => [`R${i}_NAZIV`, `R${i}_URL`, `R${i}_SLIKA`, `R${i}_CENA`]),
];
const esc = (v) => String(v ?? "").replace(/[;\n\r]/g, " ");
writeFileSync(
  join(dir, "e1-personalizovano.csv"),
  ["EMAIL;" + cols.join(";"), ...out.map((r) => [r.email, ...cols.map((c) => esc(r.attrs[c]))].join(";"))].join("\n") + "\n",
);
writeFileSync(join(dir, "e1-personalizovano.json"), JSON.stringify(out));

console.log(`Kupaca: ${out.length}`);
console.log("Glavni paket:", stats.paket);
console.log(`Glavni proizvod (nijedan paket ne prolazi): ${stats.proizvod}`);
console.log(`Manje od 3 preporuke: ${stats.bezPreporuka}`);
