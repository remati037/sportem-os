/**
 * Sportem: spisak za sastanak sa drugom — uvoz kraj oktobra + početak novembra 2026.
 *
 * Jedan PDF za štampu: svaka stavka ima polja „važi / ne važi" i prazno polje za dogovor.
 * Podaci iz drugovih PDF-ova su upisani ovde (šifre HE…), a naše cene, stanje i prodaja
 * (6 meseci, bez otkazanih/vraćenih, iz zamrznutih order_items) čitaju se iz baze.
 * Uparivanje HE šifra → naš SKU je urađeno po nazivu, ručno — zato i jeste za proveru.
 *
 * NE prikazuje našu zaradu ni maržu (papir ide na sto). MP sa sajta je javna, pa se navodi
 * samo gde je potrebna da se objasni problem.
 * Skripta SAMO ČITA bazu.
 *
 * Pokretanje iz root-a repoa:
 *   node --env-file=.env.local scripts/uvoz-okt-nov.mjs
 */
import path from "node:path";
import { createElement as h } from "react";
import { createClient } from "@supabase/supabase-js";
import { Document, Font, Page, StyleSheet, Text, View, renderToFile } from "@react-pdf/renderer";

const GREEN = "#1B7A45";
const RED = "#B91C1C";
const AMBER = "#B45309";
const LINE = "#9CA3AF";
const MUTED = "#6B7280";
const DAY = 864e5;

const fontDir = path.join(process.cwd(), "assets", "fonts");
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(fontDir, "Geist-Regular.ttf") },
    { src: path.join(fontDir, "Geist-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

// ───────────────────────────── drugovi PDF-ovi ─────────────────────────────
// [uvoz, HE šifra, naziv iz njegovog PDF-a, količina, VP, MP (njegova), naš SKU | null, kg (cena po kg), par]
// kg != null → VP/MP u PDF-u su PO KILOGRAMU; naša cena = cena × kg (× 2 kad se prodaje u paru).
const OKT = "Kraj okt.";
const NOV = "Poč. nov.";
const R = (u, he, naziv, kol, vp, mp, sku = null, kg = null, par = false) => ({ u, he, naziv, kol, vp, mp, sku, kg, par });

const UVOZ = [
  R(OKT, "HE1035E", "Podesiva bučica 24kg", 40, 9900, 12500, "SM195"),
  R(OKT, "HE2046A-1", "Set podesivih bučica i girija 20kg", 20, 4000, 5000, "SM210-1"),
  R(OKT, "HE2046A-2", "Set podesivih bučica i girija 30kg", 80, 5000, 6200, "SM210-2"),
  R(OKT, "HE2006N-1", "Bamper tegovi bela šara 5kg", 10, 300, 350, null, 5),
  R(OKT, "HE2006N-2", "Bamper tegovi bela šara 10kg", 10, 300, 350, null, 10),
  R(OKT, "HE2006N-3", "Bamper tegovi bela šara 15kg", 10, 300, 350, null, 15),
  R(OKT, "HE2006N-4", "Bamper tegovi bela šara 20kg", 10, 300, 350, null, 20),
  R(OKT, "HE2006N-5", "Bamper tegovi bela šara 25kg", 2, 300, 350, null, 25),
  R(OKT, "HE2005-1", "Gumirani tegovi fi50 1.25kg", 150, 270, 290, "SM009-1", 1.25),
  R(OKT, "HE2005-2", "Gumirani tegovi fi50 2.5kg", 150, 270, 290, "SM009-2", 2.5),
  R(OKT, "HE2005-3", "Gumirani tegovi fi50 5kg", 200, 270, 290, "SM009-3", 5),
  R(OKT, "HE2005-4", "Gumirani tegovi fi50 10kg", 150, 270, 290, "SM009-4", 10),
  R(OKT, "HE2005-5", "Gumirani tegovi fi50 15kg", 60, 270, 290, "SM009-5", 15),
  R(OKT, "HE2005-6", "Gumirani tegovi fi50 20kg", 70, 270, 290, "SM009-6", 20),
  R(OKT, "HE2005-7", "Gumirani tegovi fi50 25kg", 20, 270, 290, "SM009-7", 25),
  R(OKT, "HE910", "Podesiva klupa", 100, 7500, 9200, "SM204"),
  R(OKT, "HE9196", "Zakrivljena bezmotorna traka za trčanje", 5, 167200, 197000, "SM044"),
  R(OKT, "HE9205-1", "Vratilo za propadanja i zgibove", 50, 11900, 15200, "SM214"),
  R(OKT, "HE00492-1", "Hexit glute box", 15, 14800, 18000),
  R(OKT, "HE9185", "Smit rack mašina", 6, 115000, 132000, "SM198"),
  R(OKT, "HE9204G", "Klupa za hiperekstenziju", 50, 8500, 10500),
  R(OKT, "HE5003-5", "Olimpijska šipka fi50 150cm", 20, 7000, 8300, "SM053"),
  R(OKT, "HE9106B-2", "Mašina za prednju i zadnju ložu 100kg", 10, 110400, 128400, "SM218"),
  R(OKT, "HE1103B-1", "Hexit strunjača 0.6kg", 150, 950, 1300, "SM208-1"),
  R(OKT, "HE1103B-2", "Hexit strunjača 2.2kg", 270, 1400, 1850, "SM208-2"),
  R(OKT, "HE1103B-3", "Hexit strunjača 3.5kg", 50, 1800, 2300, "SM208-3"),
  R(OKT, "HE1218-1", "Hexit medicinka sa rukohvatom 4kg", 10, 3100, 3900, "SM211-1"),
  R(OKT, "HE1218-2", "Hexit medicinka sa rukohvatom 5kg", 10, 3400, 4300, "SM211-2"),
  R(OKT, "HE1218-3", "Hexit medicinka sa rukohvatom 6kg", 10, 3600, 4500, "SM211-3"),
  R(OKT, "HE1218-4", "Hexit medicinka sa rukohvatom 8kg", 10, 5300, 6900, "SM211-4"),
  R(OKT, "HE6005", "Nastavak uski paralelni hvat", 50, 1500, 1900),
  R(OKT, "HE6008", "Kanap za triceps 70cm", 200, 900, 1250, "SM070-1"),
  R(OKT, "HE6008-1", "Kanap za triceps 90cm", 50, 1200, 1700, "SM070-2"),
  R(OKT, "HE65041C", "Aluminijumski osigurači", 20, 1300, 1700, "SM068"),
  R(OKT, "HE0077D", "Visoki metalni sklekeri", 30, 5900, 7200, "SM241"),
  R(OKT, "HE2046", "Set plastičnih bučica 20kg", 50, 2600, 3400, "SM207"),
  R(OKT, "HE1719-1", "Hexit tegovi za zglob 0.6kg", 30, 470, 700),
  R(OKT, "HE1719-2", "Hexit tegovi za zglob 1kg", 100, 590, 880),
  R(OKT, "HE1719-3", "Hexit tegovi za zglob 2kg", 150, 780, 1100),
  R(OKT, "HE1719-4", "Hexit tegovi za zglob 4kg", 100, 1200, 1680),
  R(OKT, "HE1036A", "Podesive bučice 5kg x 2 roze", 20, 7600, 9800),
  R(OKT, "HE1036B", "Podesive bučice 5kg x 2 siva", 10, 7600, 9800),
  R(OKT, "HE1745-1", "Prsluk sa opterećenjem 10kg", 30, 4000, 5500, "SM202-1"),
  R(OKT, "HE1745-2", "Prsluk sa opterećenjem 20kg", 100, 5800, 7200, "SM202-2"),
  R(OKT, "HE1009F4-1", "PVC rusko zvono 6kg", 20, 1000, 1350, "SM022-1"),
  R(OKT, "HE1009F4-2", "PVC rusko zvono 8kg", 20, 1200, 1800, "SM022-2"),
  R(OKT, "HE1009F4-3", "PVC rusko zvono 10kg", 20, 1500, 2350, "SM022-3"),
  R(OKT, "HE1009F4-4", "PVC rusko zvono 12kg", 20, 1800, 2600, "SM022-4"),
  R(OKT, "HE6082B", "Hex farm bar fi50 duži", 2, 21200, 26200),

  R(NOV, "HE1001A", "Hexit vinil bučice 0.5kg", 200, 310, 330, "SM015-1", 0.5, true),
  R(NOV, "HE1001A-1", "Hexit vinil bučice 1kg", 350, 310, 330, "SM015-2", 1, true),
  R(NOV, "HE1001A-2", "Hexit vinil bučice 2kg", 350, 310, 330, "SM015-3", 2, true),
  R(NOV, "HE1001A-3", "Hexit vinil bučice 3kg", 100, 310, 330, "SM015-4", 3, true),
  R(NOV, "HE1001A-4", "Hexit vinil bučice 4kg", 80, 285, 330, "SM015-5", 4, true),
  R(NOV, "HE1001A-5", "Hexit vinil bučice 5kg", 80, 285, 330, "SM015-6", 5, true),
  R(NOV, "HE1003-1", "Hexit vinil zvona 4kg", 20, 285, 350, "SM019-1", 4),
  R(NOV, "HE1003-2", "Hexit vinil zvona 6kg", 100, 285, 350, "SM019-2", 6),
  R(NOV, "HE1003-3", "Hexit vinil zvona 8kg", 40, 285, 330, "SM019-3", 8),
  R(NOV, "HE1003-4", "Hexit vinil zvona 10kg", 50, 285, 330, "SM019-4", 10),
  R(NOV, "HE1003-5", "Hexit vinil zvona 12kg", 60, 285, 330, "SM019-5", 12),
  R(NOV, "HE1003-6", "Hexit vinil zvona 16kg", 50, 285, 330, "SM019-6", 16),
  R(NOV, "HE1003-7", "Hexit vinil zvona 20kg", 50, 285, 330, "SM019-7", 20),
  R(NOV, "HE1003-8", "Hexit vinil zvona 24kg", 24, 285, 330, "SM019-8", 24),
  R(NOV, "HE1003-9", "Hexit vinil zvona 28kg", 10, 285, 330, "SM019-9", 28),
  R(NOV, "HE1003-10", "Hexit vinil zvona 32kg", 4, 285, 330, "SM019-10", 32),
  R(NOV, "HE2006-1-1", "Hexit bamper tegovi fi50 5kg", 20, 280, 320, "SM012-1", 5),
  R(NOV, "HE2006-1-2", "Hexit bamper tegovi fi50 10kg", 20, 280, 320, "SM012-2", 10),
  R(NOV, "HE2006-1-3", "Hexit bamper tegovi fi50 15kg", 20, 280, 320, "SM012-3", 15),
  R(NOV, "HE2006-1-4", "Hexit bamper tegovi fi50 20kg", 20, 280, 320, "SM012-4", 20),
  R(NOV, "HE2006-1-5", "Hexit bamper tegovi fi50 25kg", 20, 280, 330, "SM012-5", 25),
  R(NOV, "HE1116A-2", "G podloga kocka 100x100x1.5cm tačke", 500, 2700, 3000),
  R(NOV, "HE1101-1", "NBR prostirka 1.5cm crna", 150, 1300, 1700, "SM109-1"),
  R(NOV, "HE1245A", "Hexit joga blok", 100, 300, 550, "SM130"),
  R(NOV, "HE1118-1", "Tatami podloga crno siva", 200, 2000, 2700, "SM087-3"),
  R(NOV, "HE1953", "Kanap za penjanje 3m", 30, 2500, 3300),
  R(NOV, "HE1953-1", "Kanap za penjanje 5m", 30, 3000, 3800, "SM115-1"),
  R(NOV, "HE1953-2", "Kanap za penjanje 7m", 10, 4000, 5000, "SM115-2"),
  R(NOV, "HE6093B", "Hexit kaiševi za zglob", 150, 750, 1200, "SM140"),
  R(NOV, "HE0005A", "Hexit vertikalni stalak jelka 1-10 kg", 30, 9500, 10800, "SM002"),
  R(NOV, "HE1925-2", "Power band guma crvena", 100, 500, 800, "SM120-2"),
  R(NOV, "HE1925-3", "Power band guma crna", 100, 800, 1100, "SM120-3"),
  R(NOV, "HE1925-4", "Power band guma ljubičasta", 100, 1100, 1500, "SM120-4"),
  R(NOV, "HE1925-5", "Power band guma zelena", 70, 1500, 1900, "SM120-5"),
  R(NOV, "HE0085", "Hexit stalak za bugarski čučanj", 30, 10100, 13200, "SM033"),
  R(NOV, "HE9188A", "Hexit lat mašina 135kg", 3, 107340, 118200, "SM039"),
  R(NOV, "HE1951-1", "Battle rope 9m", 30, 4100, 5000, "SM114-1"),
  R(NOV, "HE1951-2", "Battle rope 12m", 10, 5200, 6200, "SM114-2"),
  R(NOV, "HE1901", "Hexit steper", 100, 2000, 2800, "SM105"),
  R(NOV, "HE1932A-1", "Hexit drvene karike 28mm", 40, 3300, 4300, "SM155-2"),
  R(NOV, "HE1227B-2", "Hexit slam ball 4kg", 15, 1350, 1700, "SM098-2"),
  R(NOV, "HE1227B-3", "Hexit slam ball 6kg", 15, 1650, 2000, "SM098-3"),
  R(NOV, "HE1227B-4", "Hexit slam ball 8kg", 15, 2190, 2500, "SM098-4"),
  R(NOV, "HE1227B-5", "Hexit slam ball 10kg", 10, 2400, 2800, "SM098-5"),
  R(NOV, "HE1217B-1", "Hexit premium wall ball 4kg", 20, 3600, 4200),
  R(NOV, "HE1217B-2", "Hexit premium wall ball 6kg", 20, 4200, 4800),
  R(NOV, "HE1217B-3", "Hexit premium wall ball 8kg", 20, 4600, 5300),
  R(NOV, "HE1217B-4", "Hexit premium wall ball 10kg", 20, 5200, 5900),
  R(NOV, "HE0005A*", "Hexit vertikalni stalak jelka 6 pari", 30, 5900, 7600),
  R(NOV, "HE5002-1", "Hexit cerakote šipka fi50 military", 10, 18500, 23500),
  R(NOV, "HE5002-2", "Hexit cerakote šipka fi50 plava", 10, 18500, 22500, "SM048-1"),
  R(NOV, "HE5002-3", "Hexit cerakote šipka fi50 crvena", 10, 18500, 22500),
  R(NOV, "HE0011A", "Hexit stalak za okrugle bučice 10 pari", 5, 270, 300),
  R(NOV, "HE0029E", "Nosač za šipke 2 mesta", 30, 1800, 2400),
  R(NOV, "HE0015", "Stalak za hex bučice 3 nivoa", 20, 18600, 23400),
  R(NOV, "HE2030-1", "TPU olimpijski tegovi 4 hvata 1.25kg", 10, 43500, 53500),
  R(NOV, "HE2030-2", "TPU olimpijski tegovi 4 hvata 2.5kg", 10, 43500, 53500),
  R(NOV, "HE2030-3", "TPU olimpijski tegovi 4 hvata 5kg", 10, 43500, 53500),
  R(NOV, "HE2030-4", "TPU olimpijski tegovi 4 hvata 10kg", 10, 43500, 53500),
  R(NOV, "HE2030-5", "TPU olimpijski tegovi 4 hvata 15kg", 10, 43500, 53500),
  R(NOV, "HE2030-6", "TPU olimpijski tegovi 4 hvata 20kg", 10, 43500, 53500),
  R(NOV, "HE1119A", "EVA podloga 600x600x20", 400, 550, 750),
  R(NOV, "HE1119B", "EVA podloga 600x600x20", 400, 550, 750),
  R(NOV, "HE6090", "Hexit sunđer za šipku bolji", 200, 1250, 1680),
  R(NOV, "HE910F-R", "Naslon za klupu hexit", 25, 4400, 5200),
  R(NOV, "—", "Klupa HEXIT sa boljim naslonom", null, 28500, 33500),
];

// Stavke koje imaju svoj odeljak (poruke / nejasno) — ne ponavljaju se u auto-odeljcima.
const PORUKA_HE = new Set(["HE1035E", "HE2046A-1", "HE2046A-2", "HE2046"]);
const VINIL = "SM015-";
const ZVONA = "SM019-";
const BAMPERI = "SM012-";
const NEJASNO_HE = new Set([
  "HE9204G", "HE0011A", "HE0005A*", "HE2030-1", "HE2030-2", "HE2030-3", "HE2030-4", "HE2030-5", "HE2030-6",
  "HE5002-1", "HE5002-3", "HE1217B-1", "HE1217B-2", "HE1217B-3", "HE1217B-4", "HE6090", "HE6005", "—",
]);

// ───────────────────────────── baza ─────────────────────────────

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function selectAll(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const [varijante, stavke, statusi] = await Promise.all([
  selectAll("product_variants", "id, sku, variant_name, mp_price, vp_price, stock_quantity, stock_counted_at, archived_at, products(name, archived_at)"),
  selectAll("order_items", "sku, quantity, orders!inner(ordered_at, cancelled_at, status_id)"),
  selectAll("order_statuses", "id, name"),
]);
const otkazni = new Set(statusi.filter((s) => ["Otkazano", "Vraćeno"].includes(s.name)).map((s) => s.id));
const od180 = Date.now() - 180 * DAY;
const prodato = new Map();
for (const i of stavke) {
  if (i.orders.cancelled_at || otkazni.has(i.orders.status_id)) continue;
  if (Date.parse(i.orders.ordered_at) < od180) continue;
  const k = String(i.sku ?? "").trim();
  prodato.set(k, (prodato.get(k) ?? 0) + i.quantity);
}
const katalog = new Map();
for (const v of varijante) {
  const p = Array.isArray(v.products) ? v.products[0] : v.products;
  const sku = String(v.sku ?? "").trim();
  const ime = v.variant_name && v.variant_name !== "Default" ? v.variant_name.trim() : "";
  katalog.set(sku, {
    sku,
    naziv: `${p?.name?.trim() ?? ""}${ime ? ` — ${ime}` : ""}`,
    proizvod: p?.name?.trim() ?? "",
    ime,
    vp: v.vp_price,
    mp: v.mp_price,
    stanje: v.stock_quantity,
    popisano: !!v.stock_counted_at,
    aktivan: !v.archived_at && !p?.archived_at,
    q180: prodato.get(sku) ?? 0,
  });
}
const kat = (sku) => {
  const k = katalog.get(sku);
  if (!k) throw new Error(`SKU ${sku} nije u katalogu — proveri uparivanje`);
  return k;
};

// Naša VP po PDF-u: po kg → × kg (× 2 za par).
const nasaVp = (r, poKg = r.vp) => (r.kg == null ? poKg : Math.round(poKg * r.kg * (r.par ? 2 : 1)));
for (const r of UVOZ) {
  r.k = r.sku ? kat(r.sku) : null;
  r.vpNasa = nasaVp(r);
}

// ───────────────────────────── format ─────────────────────────────

const fmt = new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 });
const rsd = (n) => (n == null ? "—" : fmt.format(n));
const razlika = (a, b) => (a == null || b == null || Math.abs(a - b) <= 1 ? "" : `${b > a ? "+" : "−"}${fmt.format(Math.abs(b - a))}`);
const stanje = (k) => (k ? `${fmt.format(k.stanje)}${k.popisano ? "" : "*"}` : "");
const datum = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
const danas = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(new Date());

// ───────────────────────────── stilovi ─────────────────────────────

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8.5, color: "#111111", paddingTop: 24, paddingBottom: 30, paddingHorizontal: 26 },
  h1: { fontSize: 17, fontWeight: "bold", color: GREEN, marginBottom: 2 },
  h2: { fontSize: 12, fontWeight: "bold", color: GREEN, marginTop: 4, marginBottom: 3 },
  h3: { fontSize: 10, fontWeight: "bold", marginTop: 8, marginBottom: 3 },
  p: { fontSize: 8.5, lineHeight: 1.4, marginBottom: 2.5 },
  dim: { color: MUTED },
  bold: { fontWeight: "bold" },
  red: { color: RED, fontWeight: "bold" },
  amber: { color: AMBER, fontWeight: "bold" },
  num: { textAlign: "right" },
  li: { flexDirection: "row", marginBottom: 2.5 },
  liDot: { width: 16, fontSize: 8.5 },
  liText: { flex: 1, fontSize: 8.5, lineHeight: 1.4 },
  box: { borderWidth: 1, borderColor: GREEN, borderRadius: 3, padding: 7, marginTop: 4, marginBottom: 4 },
  warn: { borderWidth: 1, borderColor: RED, borderRadius: 3, padding: 7, marginTop: 4, marginBottom: 4 },
  blok: { borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 7, marginBottom: 8 },
  blokTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3, gap: 10 },
  blokNaslov: { fontSize: 10.5, fontWeight: "bold", flex: 1 },
  headRow: { flexDirection: "row", borderWidth: 1, borderColor: "#111111", backgroundColor: "#E5E7EB" },
  headCell: { fontSize: 7, fontWeight: "bold", paddingVertical: 3, paddingHorizontal: 3 },
  row: { flexDirection: "row", borderLeftWidth: 1, borderBottomWidth: 1, borderColor: LINE, minHeight: 17 },
  cell: { borderRightWidth: 1, borderColor: LINE, justifyContent: "center", paddingHorizontal: 3, paddingVertical: 2 },
  upis: { backgroundColor: "#FFFBEB" },
  istaknuto: { backgroundColor: "#FEF2F2" },
  kpis: { flexDirection: "row", gap: 6, marginTop: 6, marginBottom: 4 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 6 },
  kpiLabel: { fontSize: 7, color: MUTED, marginBottom: 2 },
  kpiValue: { fontSize: 12, fontWeight: "bold" },
  kpiSub: { fontSize: 7, color: "#374151", marginTop: 1 },
  odluka: { flexDirection: "row", alignItems: "center", gap: 3 },
  kockica: { width: 8, height: 8, borderWidth: 1, borderColor: "#111111" },
  odlukaTxt: { fontSize: 7.5, marginRight: 5 },
  field: { flexDirection: "row", alignItems: "flex-end", marginTop: 5 },
  fieldLabel: { fontSize: 8.5, marginRight: 6 },
  fieldLine: { flex: 1, borderBottomWidth: 1, borderColor: "#111111", height: 13 },
  line: { borderBottomWidth: 1, borderColor: LINE, height: 19 },
  footer: { position: "absolute", bottom: 12, left: 26, right: 26, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  twoCol: { flexDirection: "row", gap: 14 },
  col: { flex: 1 },
});

// ───────────────────────────── delovi ─────────────────────────────

const Li = ({ children, n }) => h(View, { style: s.li }, h(Text, { style: s.liDot }, n ?? "•"), h(Text, { style: s.liText }, children));
const Kockice = ({ opcije = ["važi", "ne važi"] } = {}) =>
  h(View, { style: s.odluka }, ...opcije.flatMap((o) => [h(View, { key: `k${o}`, style: s.kockica }), h(Text, { key: `t${o}`, style: s.odlukaTxt }, o)]));
const Field = ({ label, width }) => h(View, { style: [s.field, width ? { width } : { flex: 1 }] }, h(Text, { style: s.fieldLabel }, label), h(View, { style: s.fieldLine }));
const Footer = () =>
  h(View, { style: s.footer, fixed: true }, h(Text, null, `Sportem · uvoz kraj oktobra + početak novembra · ${datum}`), h(Text, { render: ({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}` }));

// kolone: { naslov, w?, num?, get(r), stil?(r), bg? }
function Tabela({ kolone, redovi, istakni }) {
  return h(
    View,
    null,
    h(View, { style: s.headRow, wrap: false }, ...kolone.map((k) => h(Text, { key: k.naslov, style: [s.headCell, k.w ? { width: k.w } : { flex: 1 }, k.num ? s.num : null] }, k.naslov))),
    ...redovi.map((r, i) =>
      h(
        View,
        { key: i, style: [s.row, istakni?.(r) ? s.istaknuto : null], wrap: false },
        ...kolone.map((k) => {
          const v = k.get ? k.get(r) : "";
          const stil = typeof k.stil === "function" ? k.stil(r) : k.stil;
          return h(
            View,
            { key: k.naslov, style: [s.cell, k.w ? { width: k.w } : { flex: 1 }, k.bg] },
            typeof v === "string" || typeof v === "number" ? h(Text, { style: [k.num ? s.num : null, stil] }, String(v)) : v,
          );
        }),
      ),
    ),
  );
}

// Zajedničke kolone za „naš artikal".
const kArtikal = { naslov: "Artikal (kod nas)", get: (r) => (r.k ? r.k.naziv : r.naziv) };
const kHe = { naslov: "Njegova šifra", w: 62, get: (r) => r.he, stil: { fontSize: 7 } };
const kSku = { naslov: "Naš SKU", w: 46, get: (r) => r.sku ?? "—", stil: { fontSize: 7 } };
const kKol = { naslov: "Stiže kom", w: 40, num: true, get: (r) => (r.kol == null ? "?" : fmt.format(r.kol)) };
const kStanje = { naslov: "Stanje", w: 36, num: true, get: (r) => stanje(r.k), stil: (r) => (r.k && r.k.stanje <= 0 ? s.red : null) };
const kQ = { naslov: "Prod. 6 m", w: 38, num: true, get: (r) => (r.k?.q180 ? fmt.format(r.k.q180) : "") };
const kVpSada = { naslov: "VP sada", w: 50, num: true, get: (r) => rsd(r.k?.vp), stil: s.bold };
const kVpPdf = { naslov: "VP po PDF-u", w: 54, num: true, get: (r) => rsd(r.vpNasa) };
const kRazl = { naslov: "Razlika", w: 42, num: true, get: (r) => razlika(r.k?.vp, r.vpNasa), stil: (r) => (r.vpNasa > (r.k?.vp ?? Infinity) ? s.red : null) };
const kDog = { naslov: "Dogovoreno VP", w: 66, bg: s.upis };
const kOdluka = { naslov: "Odluka", w: 84, get: () => h(Kockice) };

// ───────────────────────────── 0 · uvod ─────────────────────────────

const komada = (u) => UVOZ.filter((r) => r.u === u).reduce((n, r) => n + (r.kol ?? 0), 0);
const stavkiU = (u) => UVOZ.filter((r) => r.u === u).length;
const noviRedovi = UVOZ.filter((r) => !r.sku && !NEJASNO_HE.has(r.he));
const promenjeni = UVOZ.filter(
  (r) => r.k && !PORUKA_HE.has(r.he) && !r.sku.startsWith(VINIL) && !r.sku.startsWith(ZVONA) && !r.sku.startsWith(BAMPERI) && Math.abs(r.k.vp - r.vpNasa) > 1,
);
const isti = UVOZ.filter(
  (r) => r.k && !PORUKA_HE.has(r.he) && !r.sku.startsWith(VINIL) && !r.sku.startsWith(ZVONA) && !r.sku.startsWith(BAMPERI) && Math.abs(r.k.vp - r.vpNasa) <= 1,
);

// Fali u uvozu: prodaje se (≥ 8 kom za 6 meseci), a stanja ima za manje od ~6 nedelja.
const uUvozu = new Set(UVOZ.map((r) => r.sku).filter(Boolean));
const fali = [...katalog.values()]
  .filter((k) => k.aktivan && !uUvozu.has(k.sku) && k.q180 >= 8 && k.stanje < (k.q180 / 6) * 1.5)
  .sort((a, b) => a.stanje / Math.max(1, a.q180) - b.stanje / Math.max(1, b.q180));

function Uvod() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h1 }, "Uvoz kraj oktobra + početak novembra — šta potvrđujemo"),
    h(Text, { style: [s.p, s.dim] }, `Spisak za sastanak · ${datum} · svaka stavka: štikliraj „važi" ili „ne važi" i upiši ispravku u žuto polje`),
    h(
      View,
      { style: s.kpis },
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Uvoz kraj oktobra"), h(Text, { style: s.kpiValue }, `${stavkiU(OKT)} stavki`), h(Text, { style: s.kpiSub }, `${fmt.format(komada(OKT))} komada`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Uvoz početak novembra"), h(Text, { style: s.kpiValue }, `${stavkiU(NOV)} stavki`), h(Text, { style: s.kpiSub }, `${fmt.format(komada(NOV))} komada`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Promena VP koju nije pomenuo"), h(Text, { style: [s.kpiValue, { color: RED }] }, `${promenjeni.length} artikla`), h(Text, { style: s.kpiSub }, "odeljak 2")),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Nejasno / greška u PDF-u"), h(Text, { style: [s.kpiValue, { color: AMBER }] }, "odeljak 3"), h(Text, { style: s.kpiSub }, "uparivanje i cene")),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Novi artikli (nema ih kod nas)"), h(Text, { style: s.kpiValue }, `${noviRedovi.length} stavki`), h(Text, { style: s.kpiSub }, "odeljak 5")),
    ),
    h(
      View,
      { style: s.twoCol },
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h2 }, "Redosled"),
        h(Li, { n: "1." }, "Šta je javio porukom — da li se poklapa sa PDF-om (podesivo zvono i bučice +200, vinil bučice 310, bamperi i zvona +5)"),
        h(Li, { n: "2." }, "Poskupljenja koja nije pomenuo"),
        h(Li, { n: "3." }, "Nejasno i greške u PDF-ovima"),
        h(Li, { n: "4." }, `Šta se kod nas prodaje, a nije u uvozu (${fali.length})`),
        h(Li, { n: "5." }, "Novi artikli — uvodimo ili ne"),
        h(Li, { n: "6." }, `Ostalo — ista cena, samo potvrda količina (${isti.length})`),
        h(Li, { n: "7." }, "Zapisnik: datumi dolaska, od kada važe nove cene, potpis"),
      ),
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h2 }, "Kako se čita"),
        h(Li, null, "„VP sada\" = VP koja je trenutno upisana kod nas. „VP po PDF-u\" = cena iz njegovog spiska, preračunata na naš artikal."),
        h(Li, null, "Bučice, zvona, bamperi i gumirani tegovi su u njegovom PDF-u PO KILOGRAMU. Kod nas: cena × kg; vinil bučice se prodaju u paru, pa × 2 (npr. 0,5 kg par = 1 kg = 310)."),
        h(Li, null, "„Stanje\" = koliko po našoj evidenciji ima sada. Crveno = nula ili minus. * = količina nije popisana (nije sigurna)."),
        h(Li, null, "„Prod. 6 m\" = koliko smo komada prodali za poslednjih 6 meseci (bez otkazanih i vraćenih)."),
        h(Li, null, "Uparivanje njegove šifre sa našim artiklom je urađeno po nazivu — ako je pogrešno, prekriži i upiši pravi."),
        h(View, { style: s.box }, h(Text, { style: [s.p, s.bold] }, "Nova VP se upisuje u katalog tek kad se dogovorimo od kog datuma važi."), h(Text, { style: s.p }, "Porudžbine pristigle pre tog dana ostaju po staroj VP (cena se zamrzava u trenutku porudžbine).")),
      ),
    ),
    h(Footer),
  );
}

// ───────────────────────────── 1 · poruke ─────────────────────────────

function Blok({ naslov, opis, children, odluka = true }) {
  return h(
    View,
    { style: s.blok, wrap: false },
    h(View, { style: s.blokTop }, h(Text, { style: s.blokNaslov }, naslov), odluka ? h(Kockice) : null),
    opis ? h(Text, { style: [s.p, { marginBottom: 4 }] }, opis) : null,
    children,
  );
}

const poKgKolone = (kolonePoruka) => [
  kArtikal,
  kSku,
  kKol,
  kStanje,
  kQ,
  { naslov: "kg", w: 26, num: true, get: (r) => (r.kg == null ? "" : `${fmt.format(r.kg)}${r.par ? "×2" : ""}`) },
  kVpSada,
  { naslov: "VP/kg sada", w: 46, num: true, get: (r) => rsd(Math.round(r.k.vp / (r.kg * (r.par ? 2 : 1)))), stil: s.dim },
  { naslov: "VP/kg PDF", w: 44, num: true, get: (r) => rsd(r.vp) },
  kVpPdf,
  ...kolonePoruka,
  kDog,
];

function Poruke() {
  const set = UVOZ.filter((r) => PORUKA_HE.has(r.he));
  const vinil = UVOZ.filter((r) => r.sku?.startsWith(VINIL));
  const zvona = UVOZ.filter((r) => r.sku?.startsWith(ZVONA));
  const bamperi = UVOZ.filter((r) => r.sku?.startsWith(BAMPERI));
  const vinil6 = kat("SM015-7");
  return [
    h(
      Page,
      { key: "p1", size: "A4", orientation: "landscape", style: s.page },
      h(Text, { style: s.h2 }, "1 · Šta je javio porukom — da li se poklapa sa PDF-om"),
      h(
        Blok,
        {
          naslov: "1a · „Stiže ponovo podesivo zvono i bučice — digao sam cenu 200 din i u MP i u VP\" (kraj oktobra)",
          opis: "Tačno +200 je samo set plastičnih bučica 20 kg. Kod seta bučica i zvona VP raste više od 200 (20 kg +240, 30 kg +500). Podesiva bučica 24 kg ostaje ista. Pitanje: na koje artikle se odnosi „+200\" i koja VP važi?",
        },
        h(Tabela, {
          kolone: [kArtikal, kHe, kSku, kKol, kStanje, kQ, kVpSada, kVpPdf, kRazl, { naslov: "Po poruci (+200)", w: 64, num: true, get: (r) => rsd((r.k?.vp ?? 0) + 200) }, kDog],
          redovi: set,
          istakni: (r) => r.vpNasa - r.k.vp > 200,
        }),
        h(Text, { style: [s.p, s.dim, { marginTop: 3 }] }, "Napomena: kod nas postoje dva slična artikla — „Set podesivih bučica 20kg\" (SM207, VP 2.400) i „Podesive bučice 2\" (SM223, VP 2.400, prodato 23 za 6 meseci). Koji je njegov HE2046?"),
      ),
      h(
        Blok,
        {
          naslov: "1b · „Ovde se ništa ne menja sem vinil bučice 310\" (početak novembra)",
          opis: `Sada je 290 po kg. U PDF-u je 310 samo za 0,5–3 kg, a 4 i 5 kg su na 285 (jeftinije nego sada). Koja cifra važi za 4 i 5 kg? 6 kg nije u uvozu (sada VP ${rsd(vinil6.vp)}, stanje ${stanje(vinil6)}) — važi li i za nju 310?`,
        },
        h(Tabela, {
          kolone: poKgKolone([kRazl, { naslov: "Sve po 310", w: 50, num: true, get: (r) => rsd(nasaVp(r, 310)) }]),
          redovi: vinil,
          istakni: (r) => r.vp !== 310,
        }),
      ),
      h(Footer),
    ),
    h(
      Page,
      { key: "p2", size: "A4", orientation: "landscape", style: s.page },
      h(
        Blok,
        {
          naslov: "1c · „Za 5 din gore — bamperi, zvona\": RUSKA ZVONA (vinil)",
          opis: "U PDF-u je 285 po kg, a kod nas je VEĆ upisano 290. Ako je „+5\" od 285, to je 290 = ništa se ne menja. Ako je „+5\" od sadašnjih 290, to je 295. Koje?",
        },
        h(Tabela, {
          kolone: poKgKolone([
            { naslov: "290/kg", w: 44, num: true, get: (r) => rsd(nasaVp(r, 290)) },
            { naslov: "295/kg", w: 44, num: true, get: (r) => rsd(nasaVp(r, 295)) },
          ]),
          redovi: zvona,
        }),
      ),
      h(
        Blok,
        {
          naslov: "1d · „Za 5 din gore — bamperi, zvona\": BAMPER TEGOVI FI50",
          opis: "U PDF-u je 280 po kg — isto kao kod nas sada. Poruka kaže +5, dakle 285 po kg. Važi li 285, i od kog datuma?",
        },
        h(Tabela, {
          kolone: poKgKolone([{ naslov: "285/kg", w: 44, num: true, get: (r) => rsd(nasaVp(r, 285)) }]),
          redovi: bamperi,
        }),
      ),
      h(Footer),
    ),
  ];
}

// ───────────────────────────── 2 · nepomenuta poskupljenja ─────────────────────────────

function Promene() {
  const karike = UVOZ.find((r) => r.he === "HE1932A-1");
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, "2 · Promena VP koju nije pomenuo"),
    h(Text, { style: s.p }, "Artikli gde se VP u njegovom PDF-u razlikuje od VP koju sada imamo. Za svaki: da li je promena stvarna i od kada važi."),
    h(Tabela, {
      kolone: [kArtikal, kHe, kSku, kKol, kStanje, kQ, kVpSada, kVpPdf, kRazl, { naslov: "MP sajt", w: 46, num: true, get: (r) => rsd(r.k.mp), stil: (r) => (r.vpNasa >= r.k.mp ? s.red : s.dim) }, kDog, kOdluka],
      redovi: promenjeni,
      istakni: (r) => r.vpNasa >= r.k.mp,
    }),
    karike
      ? h(
          View,
          { style: s.warn },
          h(Text, { style: [s.p, s.bold, { color: RED }] }, `Drvene karike 28 mm: nova VP ${rsd(karike.vpNasa)} je VEĆA od naše cene na sajtu (${rsd(karike.k.mp)}).`),
          h(Text, { style: s.p }, `Po toj VP prodajemo u minus. Ili VP ostaje ${rsd(karike.k.vp)}, ili mi dižemo cenu na sajtu. Njegova preporučena MP je ${rsd(karike.mp)}.`),
        )
      : null,
    h(Text, { style: s.h3 }, "Beleške"),
    ...Array.from({ length: 4 }, (_, i) => h(View, { key: i, style: s.line })),
    h(Footer),
  );
}

// ───────────────────────────── 3 · nejasno ─────────────────────────────

const NEJASNO = [
  {
    naslov: "Stalak za okrugle bučice 10 pari (HE0011A) — cena 270 / 300 din",
    opis: "Očigledno greška u PDF-u. Kod nas: Stalak za okrugle bučice (SM006) VP 36.000. Koja je prava VP?",
    polja: ["Prava VP:", "Naš artikal (SKU):"],
  },
  {
    naslov: "Ista šifra HE0005A na dva artikla",
    opis: "„Vertikalni stalak jelka 1-10 kg\" (9.500 — kod nas SM002, ista VP) i „Vertikalni stalak jelka 6 pari\" (5.900 / 7.600). Koja je šifra za 6 pari i da li je to nov artikal?",
    polja: ["Šifra za „6 pari\":", "Nov artikal?  da / ne"],
  },
  {
    naslov: "TPU olimpijski tegovi 4 hvata (HE2030-1 do -6) — svaka kilaža po 43.500",
    opis: "43.500 je cena našeg seta „Poliuretanski tegovi FI50 2\" (SM008). Da li je to cena CELOG SETA (1,25 do 20 kg), a 10 kom = 10 setova? Ili se prodaje i pojedinačno po kilaži?",
    polja: ["Cena se odnosi na:", "Pojedinačna VP po kg / kom:"],
  },
  {
    naslov: "Klupa za hiperekstenziju (HE9204G) — 8.500 / 10.500, 50 kom",
    opis: "Kod nas: „Klupa za hiperekstenziju 2\" (SM217) VP 8.700, i „Sklopiva benč klupa\" (SM222) VP 8.500 / MP 10.500 — ova druga se poklapa po ceni. Koja je?",
    polja: ["Naš artikal (SKU):", "VP:"],
  },
  {
    naslov: "Klupa HEXIT sa boljim naslonom — 28.500 / 33.500",
    opis: "U PDF-u nema šifre ni količine. Ima i „Naslon za klupu hexit\" (HE910F-R, 4.400, 25 kom). Šta je ovo tačno: nova klupa, ili naša klupa + bolji naslon? Koliko komada stiže?",
    polja: ["Šifra:", "Količina:", "Koja naša klupa:"],
  },
  {
    naslov: "Cerakote šipke fi50 (HE5002-1/2/3) — sve po 18.500 (kao sada)",
    opis: "Kod nas: Siva „Combo Gray\" (SM048-2), Plava (SM048-1) i još jedna Plava (SM049). U uvozu: military, plava, crvena. Da li je „military\" = naša siva? Crvena je nova boja.",
    polja: ["Military = naš SKU:", "Crvena — uvodimo?  da / ne"],
  },
  {
    naslov: "Premium wall ball 4–10 kg (HE1217B) — 3.600 / 4.200 / 4.600 / 5.200",
    opis: "Kod nas Wall ball (SM097) 4 kg 2.900 · 6 kg 3.300 · 8 kg 3.600 · 10 kg 3.900. Da li je „premium\" nov model (ide pored starog) ili zamena starog po novoj ceni?",
    polja: ["Nov model / zamena:", "Stari ostaje u prodaji?  da / ne"],
  },
  {
    naslov: "Sunđer za šipku „bolji\" (HE6090) — 1.250 / 1.680, 200 kom",
    opis: "Kod nas Sunđer za šipku (SM145, roze/crni/plavi) VP 700. Nov model pored starog ili zamena? Koja boja?",
    polja: ["Nov model / zamena:", "Boja:"],
  },
  {
    naslov: "Nastavak uski paralelni hvat (HE6005) — 1.500 / 1.900, 50 kom",
    opis: "Nisam našao ovaj artikal kod nas (imamo „Nastavak za lat 1/2\", 2.950 / 3.120). Nov artikal?",
    polja: ["Nov artikal?  da / ne", "Naš SKU ako postoji:"],
  },
];

function Nejasno() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, "3 · Nejasno i greške u PDF-ovima"),
    h(Text, { style: [s.p, { marginBottom: 6 }] }, "Ovde ne odlučujemo cenu nego šta je šta. Upiši odgovor u polja."),
    h(
      View,
      { style: s.twoCol },
      ...[0, 1].map((c) =>
        h(
          View,
          { key: c, style: s.col },
          ...NEJASNO.filter((_, i) => (i === NEJASNO.length - 1 ? 1 : i % 2) === c).map((n) =>
            h(
              View,
              { key: n.naslov, style: s.blok, wrap: false },
              h(Text, { style: [s.bold, { fontSize: 9.5, marginBottom: 3 }] }, n.naslov),
              h(Text, { style: s.p }, n.opis),
              ...n.polja.map((f) => h(Field, { key: f, label: f, width: "100%" })),
            ),
          ),
        ),
      ),
    ),
    h(Footer),
  );
}

// ───────────────────────────── 4 · fali u uvozu ─────────────────────────────

function Fali() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, `4 · Prodaje se kod nas, a nije u uvozu (${fali.length})`),
    h(Text, { style: s.p }, "Artikli sa bar 8 prodatih komada za 6 meseci kojima stanja ima za manje od ~6 nedelja (ili su na nuli / u minusu). Sortirano od najhitnijeg. Pitanje: ima li ih na lageru i kad stižu?"),
    h(Tabela, {
      kolone: [
        { naslov: "Artikal", get: (k) => k.naziv },
        { naslov: "Naš SKU", w: 50, get: (k) => k.sku, stil: { fontSize: 7 } },
        { naslov: "Prod. 6 m", w: 44, num: true, get: (k) => fmt.format(k.q180) },
        { naslov: "≈ mesečno", w: 44, num: true, get: (k) => fmt.format(Math.round(k.q180 / 6)) },
        { naslov: "Stanje", w: 40, num: true, get: (k) => stanje(k), stil: (k) => (k.stanje <= 0 ? s.red : null) },
        { naslov: "VP sada", w: 50, num: true, get: (k) => rsd(k.vp) },
        { naslov: "Ima na lageru (kom)", w: 78, bg: s.upis },
        { naslov: "Stiže kad / koliko", w: 110, bg: s.upis },
      ],
      redovi: fali,
      istakni: (k) => k.stanje <= 0,
    }),
    h(Text, { style: [s.p, s.dim, { marginTop: 4 }] }, "* = količina nije popisana. Minus = po evidenciji prodato više nego što je upisano — znači da je stvarno stanje kod njega drugačije; dobro je da kaže koliko stvarno ima."),
    h(Footer),
  );
}

// ───────────────────────────── 5 · novi artikli ─────────────────────────────

function Novi() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, `5 · Novi artikli — nema ih u našem katalogu (${noviRedovi.length} stavki)`),
    h(Text, { style: s.p }, "Za svaki: uvodimo ga na sajt ili ne. Ako da — trebaju nam slike, opis/dimenzije, težina paketa i tačna VP. Cene po kg (bamperi bela šara) su preračunate na kom."),
    h(Tabela, {
      kolone: [
        { naslov: "Uvoz", w: 46, get: (r) => r.u, stil: { fontSize: 7 } },
        kHe,
        { naslov: "Naziv (iz njegovog PDF-a)", get: (r) => r.naziv },
        kKol,
        { naslov: "VP", w: 52, num: true, get: (r) => rsd(r.vpNasa), stil: s.bold },
        { naslov: "Njegova MP", w: 52, num: true, get: (r) => rsd(nasaVp(r, r.mp)), stil: s.dim },
        { naslov: "Uvodimo?", w: 76, get: () => h(Kockice, { opcije: ["da", "ne"] }) },
        { naslov: "Slike / opis / težina", w: 92, get: () => h(Kockice, { opcije: ["slike", "opis", "kg"] }) },
        { naslov: "Napomena", w: 92, bg: s.upis },
      ],
      redovi: noviRedovi,
    }),
    h(Footer),
  );
}

// ───────────────────────────── 6 · ista cena ─────────────────────────────

function Isti() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, `6 · Ista VP kao sada — samo potvrda uparivanja i količina (${isti.length})`),
    h(Text, { style: s.p }, "Ovde se cena ne menja. Proveriti da je njegova šifra dobro uparena sa našim artiklom i da li stiže tačno toliko komada. Kad roba stigne, ove količine upisujemo u stanje."),
    h(Tabela, {
      kolone: [
        { naslov: "Uvoz", w: 46, get: (r) => r.u, stil: { fontSize: 7 } },
        kArtikal,
        kHe,
        kSku,
        kVpSada,
        kStanje,
        kQ,
        kKol,
        { naslov: "Stiglo kom", w: 52, bg: s.upis },
        { naslov: "Uparivanje", w: 84, get: () => h(Kockice, { opcije: ["tačno", "pogrešno"] }) },
      ],
      redovi: isti,
    }),
    h(Footer),
  );
}

// ───────────────────────────── 7 · zapisnik ─────────────────────────────

function Zapisnik() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    h(Text, { style: s.h2 }, "7 · Zapisnik"),
    h(
      View,
      { style: s.twoCol },
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h3 }, "Dolazak robe"),
        h(View, { style: { flexDirection: "row", gap: 12 } }, h(Field, { label: "Kraj oktobra stiže:" }), h(Field, { label: "Početak novembra stiže:" })),
        h(Text, { style: [s.p, { marginTop: 6 }] }, "Kako javlja da je roba stigla i koliko je stvarno stiglo (poruka / spisak / Excel):"),
        h(View, { style: s.line }),
        h(Text, { style: s.h3 }, "Od kada važe nove VP"),
        h(View, { style: { flexDirection: "row", gap: 12 } }, h(Field, { label: "Važe od datuma:" }), h(Field, { label: "ili od dolaska robe:  da / ne", width: 210 })),
        h(Text, { style: [s.p, { marginTop: 6 }] }, "Roba sa starog lagera koja se proda posle tog datuma ide po:   [  ] staroj VP    [  ] novoj VP"),
        h(Text, { style: s.h3 }, "Šifre"),
        h(Text, { style: s.p }, "Da li može ubuduće da šalje spisak sa NAŠIM SKU (ili da mi upišemo njegove HE šifre kod nas), da se ne uparuje ručno?"),
        h(View, { style: s.line }),
        h(Text, { style: s.h3 }, "Stanje (minus u evidenciji)"),
        h(Text, { style: s.p }, "Vinil bučice i prsluk 20 kg su kod nas u minusu. Dogovor oko popisa — kad prebrojimo šta stvarno ima:"),
        h(View, { style: s.line }),
      ),
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h3 }, "Ostalo dogovoreno"),
        ...Array.from({ length: 11 }, (_, i) => h(View, { key: i, style: s.line })),
        h(Text, { style: s.h3 }, "Potpisi"),
        h(
          View,
          { style: { flexDirection: "row", gap: 24, marginTop: 16 } },
          h(View, { style: s.col }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Sportem")),
          h(View, { style: s.col }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Dobavljač")),
          h(View, { style: { width: 100 } }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Datum")),
        ),
      ),
    ),
    h(Footer),
  );
}

// ───────────────────────────── render ─────────────────────────────

const doc = h(
  Document,
  { title: "Sportem — uvoz kraj oktobra + početak novembra" },
  h(Uvod),
  ...Poruke(),
  h(Promene),
  h(Nejasno),
  h(Fali),
  h(Novi),
  h(Isti),
  h(Zapisnik),
);

const izlaz = path.join(process.cwd(), `uvoz-okt-nov-za-sastanak-${danas}.pdf`);
await renderToFile(doc, izlaz);
console.log(`promenjeni ${promenjeni.length} · isti ${isti.length} · novi ${noviRedovi.length} · fali ${fali.length}`);
console.log(promenjeni.map((r) => `${r.sku} ${r.k.vp}→${r.vpNasa}`).join("\n"));
console.log("FALI:", fali.map((k) => `${k.sku} ${k.naziv} st=${k.stanje} q=${k.q180}`).join("\n"));
console.log(`→ ${izlaz}`);
