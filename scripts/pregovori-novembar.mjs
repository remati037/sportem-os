/**
 * Sportem: materijal za pregovore sa dobavljačem (novembar / Black Friday).
 *
 * Pravi DVA PDF-a za štampu:
 *   - INTERNO     — samo za nas: MP, zarada, marža, ciljna VP pri −10/−15/−20 % MP, taktika.
 *   - ZA STOLOM   — za zajedničko popunjavanje: SAMO VP i količine, prazna polja za dogovor.
 *
 * Ceo aktivan katalog, po proizvodu (varijante ispod), u tri dela:
 *   A) top proizvodi koji nose 80 % nabavke (VP) u poslednjih 6 meseci,
 *   B) ostali koji su se prodavali u poslednjih 90 dana,
 *   C) bez prodaje 90 dana → kandidati za rasprodaju (po robi na lageru × VP).
 * Prodaja = zamrznute stavke porudžbina (order_items), bez otkazanih/vraćenih.
 * Skripta SAMO ČITA bazu.
 *
 * Pokretanje iz root-a repoa:
 *   node --env-file=.env.local scripts/pregovori-novembar.mjs
 */
import path from "node:path";
import { createElement as h } from "react";
import { createClient } from "@supabase/supabase-js";
import { Document, Font, Page, StyleSheet, Text, View, renderToFile } from "@react-pdf/renderer";

const GREEN = "#1B7A45";
const RED = "#B91C1C";
const LINE = "#9CA3AF";
const MUTED = "#6B7280";
const DAY = 864e5;
const POPUSTI = [0.1, 0.15, 0.2];

const fontDir = path.join(process.cwd(), "assets", "fonts");
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(fontDir, "Geist-Regular.ttf") },
    { src: path.join(fontDir, "Geist-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

// Predlozi kompleta. `zajedno` se računa iz porudžbina (koliko puta je kupljeno u istoj porudžbini).
const KOMPLETI = [
  { naziv: "Kućni starter", razlog: "najčešća kombinacija u porudžbinama", delovi: [["Platnene trake"], ["Vinil bučice", "2 kg"], ["NBR prostirka", "Crna"]] },
  { naziv: "Trake + bučice", razlog: "najčešći par", delovi: [["Platnene trake"], ["Vinil bučice", "2 kg"]] },
  { naziv: "Bučice + gumene trake", razlog: "čest par", delovi: [["Vinil bučice", "2 kg"], ["Gumene trake"]] },
  { naziv: "HEX starter", razlog: "HEX bučice idu uz trake i prostirku", delovi: [["HEX Bučice", "5 kg"], ["Platnene trake"], ["NBR prostirka", "Crna"]] },
  { naziv: "Zvono + HEX", razlog: "čest par", delovi: [["Ruska zvona", "8 kg"], ["HEX Bučice", "5 kg"]] },
  { naziv: "Noge i gluteus", razlog: "tegovi za noge idu uz trake i bučice", delovi: [["Tegovi za noge", "2 x 1.5 kg"], ["Platnene trake"], ["Vinil bučice", "2 kg"]] },
  { naziv: "Kardio kod kuće", razlog: "zvona + steper se kupuju zajedno", delovi: [["Ruska zvona", "8 kg"], ["HEXIT Steper"]] },
  { naziv: "Joga / pilates set", razlog: "ideja — sitni artikli, veća korpa", delovi: [["TPE prostirka"], ["Joga blok"], ["Pilates trake"], ["Joga prsten"]] },
  { naziv: "Klupa + podesive bučice", razlog: "RASPRODAJA: Kombinovana HEXIT klupa stoji bez prodaje", delovi: [["Kombinovana HEXIT klupa"], ["Podesive bučice"]] },
  { naziv: "Olimpijska šipka + tegovi", razlog: "RASPRODAJA: šipke stoje, tegovi FI50 na lageru", delovi: [["Olimpijska šipka 180cm"], ["Gumirani olimpijski tegovi FI50", "10 kg", 2], ["Gumirani olimpijski tegovi FI50", "5 kg", 2]] },
  { naziv: "Kućna teretana", razlog: "RASPRODAJA: rack, šipka i bamper set stoje", delovi: [["Half rack"], ["Olimpijska šipka 220cm"], ["Animal print bamper tegovi FI50", "Set 100 kg (5, 10, 15, 20)"]] },
  { naziv: "EZ šipka + tegovi", razlog: "RASPRODAJA: EZ šipke FI30 stoje", delovi: [["Sipka EZ FI30 120cm"], ["Liveni tegovi FI30", "5 kg", 2], ["Liveni tegovi FI30", "2.5 kg", 2]] },
];

// ───────────────────────────── podaci ─────────────────────────────

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
  selectAll("product_variants", "id, product_id, sku, variant_name, mp_price, vp_price, stock_quantity, archived_at, products(id, name, archived_at)"),
  selectAll("order_items", "order_id, variant_id, sku, quantity, vp_at_sale, orders!inner(ordered_at, cancelled_at, status_id)"),
  selectAll("order_statuses", "id, name"),
]);
const otkazniStatusi = new Set(statusi.filter((s) => ["Otkazano", "Vraćeno"].includes(s.name)).map((s) => s.id));

const sada = Date.now();
const od180 = sada - 180 * DAY;
const od90 = sada - 90 * DAY;

const poId = new Map(varijante.map((v) => [v.id, v]));
const poSku = new Map(varijante.map((v) => [v.sku, v]));
const prodaja = new Map(); // variant_id → { q180, q90, vp180 }
const poPorudzbini = new Map(); // order_id → Set(product_id)
let ukupnoVp = 0, ukupnoKom = 0, vp180 = 0, kom180 = 0, prvi = Infinity;
const kom90 = { n: 0 };

for (const i of stavke) {
  if (i.orders.cancelled_at || otkazniStatusi.has(i.orders.status_id)) continue;
  const v = poId.get(i.variant_id) ?? poSku.get(i.sku);
  const t = Date.parse(i.orders.ordered_at);
  const vp = (i.vp_at_sale ?? 0) * i.quantity;
  prvi = Math.min(prvi, t);
  ukupnoVp += vp;
  ukupnoKom += i.quantity;
  if (t >= od180) { vp180 += vp; kom180 += i.quantity; }
  if (t >= od90) kom90.n += i.quantity;
  if (!v) continue;
  const p = prodaja.get(v.id) ?? { q180: 0, q90: 0, vp180: 0 };
  if (t >= od180) { p.q180 += i.quantity; p.vp180 += vp; }
  if (t >= od90) p.q90 += i.quantity;
  prodaja.set(v.id, p);
  if (!poPorudzbini.has(i.order_id)) poPorudzbini.set(i.order_id, new Set());
  poPorudzbini.get(i.order_id).add(v.product_id);
}

const broj = (s) => {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s ?? "");
  return m ? Number(m[1].replace(",", ".")) : null;
};
const poVarijanti = (a, b) => {
  const x = broj(a.ime), y = broj(b.ime);
  if (x != null && y != null && x !== y) return x - y;
  return a.ime.localeCompare(b.ime, "sr", { numeric: true });
};

const proizvodi = new Map();
for (const v of varijante) {
  const p = Array.isArray(v.products) ? v.products[0] : v.products;
  if (v.archived_at || !p || p.archived_at) continue;
  if (!proizvodi.has(p.id)) proizvodi.set(p.id, { id: p.id, naziv: p.name.trim(), varijante: [] });
  const s = prodaja.get(v.id) ?? { q180: 0, q90: 0, vp180: 0 };
  proizvodi.get(p.id).varijante.push({
    sku: v.sku,
    ime: v.variant_name && v.variant_name !== "Default" ? v.variant_name.trim() : "",
    vp: v.vp_price,
    mp: v.mp_price,
    zaliha: v.stock_quantity,
    ...s,
  });
}
const lista = [...proizvodi.values()];
for (const g of lista) {
  g.varijante.sort(poVarijanti);
  g.vp180 = g.varijante.reduce((n, v) => n + v.vp180, 0);
  g.q180 = g.varijante.reduce((n, v) => n + v.q180, 0);
  g.q90 = g.varijante.reduce((n, v) => n + v.q90, 0);
  g.kapital = g.varijante.reduce((n, v) => n + Math.max(0, v.zaliha) * (v.vp ?? 0), 0);
}

// A: top do 80 % nabavke (6 meseci), B: ostali sa prodajom u 90 dana, C: ostalo.
const poNabavci = [...lista].sort((a, b) => b.vp180 - a.vp180);
const ukupno180 = poNabavci.reduce((n, g) => n + g.vp180, 0);
const deoA = [];
let kum = 0;
for (const g of poNabavci) {
  if (kum >= 0.8 * ukupno180 || g.vp180 === 0) break;
  kum += g.vp180;
  deoA.push(g);
}
const uA = new Set(deoA.map((g) => g.id));
const deoB = poNabavci.filter((g) => !uA.has(g.id) && g.q90 > 0);
const uB = new Set(deoB.map((g) => g.id));
const deoC = lista
  .filter((g) => !uA.has(g.id) && !uB.has(g.id))
  .sort((a, b) => b.kapital - a.kapital || a.naziv.localeCompare(b.naziv, "sr"));
const kapitalC = deoC.reduce((n, g) => n + g.kapital, 0);
const varC = deoC.reduce((n, g) => n + g.varijante.length, 0);
const brojVarijanti = lista.reduce((n, g) => n + g.varijante.length, 0);

const viseArtikala = [...poPorudzbini.values()].filter((s) => s.size > 1).length;

// Kompleti: razreši delove na varijante + koliko puta su svi proizvodi bili u istoj porudžbini.
const poNazivu = new Map(lista.map((g) => [g.naziv, g]));
const kompleti = KOMPLETI.map((k) => {
  const delovi = k.delovi.map(([naziv, ime = "", kol = 1]) => {
    const g = poNazivu.get(naziv);
    if (!g) throw new Error(`Komplet „${k.naziv}": nema proizvoda „${naziv}"`);
    const v = g.varijante.find((x) => x.ime === ime) ?? g.varijante[0];
    return { naziv, ime: v.ime, sku: v.sku, kol, vp: v.vp, mp: v.mp };
  });
  const ids = [...new Set(k.delovi.map(([n]) => poNazivu.get(n).id))];
  const zajedno = [...poPorudzbini.values()].filter((s) => ids.every((id) => s.has(id))).length;
  return { ...k, delovi, zajedno };
});

// ───────────────────────────── format ─────────────────────────────

const fmt = new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 0 });
const rsd = (n) => (n == null ? "—" : fmt.format(n));
const mil = (n) => `${new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(n / 1e6)} mil.`;
const mesecno = (q90) => {
  const m = q90 / 3;
  if (m === 0) return "";
  return m < 10 ? new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 1 }).format(m) : fmt.format(m);
};
const cilj = (v, d) => {
  if (v.vp == null || v.mp == null) return "—";
  const x = Math.round((v.vp - d * v.mp) / 10) * 10;
  return x > 0 ? rsd(x) : "—";
};
const danas = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(new Date());
const datum = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
const odDatum = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(prvi));
const meseci = Math.max(1, (sada - prvi) / (30.44 * DAY));

// ───────────────────────────── stilovi ─────────────────────────────

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 8.5, color: "#111111", paddingTop: 66, paddingBottom: 30, paddingHorizontal: 22 },
  pageFree: { fontFamily: "Geist", fontSize: 9.5, color: "#111111", paddingTop: 26, paddingBottom: 30, paddingHorizontal: 30 },
  top: { position: "absolute", top: 18, left: 22, right: 22 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 },
  title: { fontSize: 12, fontWeight: "bold", color: GREEN },
  sub: { fontSize: 7.5, color: "#374151", marginBottom: 4 },
  meta: { fontSize: 7.5, color: "#4B5563" },
  headRow: { flexDirection: "row", borderWidth: 1, borderColor: "#111111", backgroundColor: "#E5E7EB" },
  headCell: { fontSize: 7, fontWeight: "bold", paddingVertical: 3, paddingHorizontal: 2, textAlign: "center" },
  grupa: { marginBottom: 4 },
  grupaRed: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, paddingHorizontal: 4, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: LINE },
  grupaNaziv: { fontSize: 9, fontWeight: "bold" },
  grupaMeta: { fontSize: 7, color: "#374151" },
  row: { flexDirection: "row", borderLeftWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  rowPrvi: { borderTopWidth: 1 },
  cell: { borderRightWidth: 1, borderColor: LINE, justifyContent: "center", paddingHorizontal: 3 },
  num: { textAlign: "right" },
  dim: { color: MUTED },
  bold: { fontWeight: "bold" },
  red: { color: RED, fontWeight: "bold" },
  cilj: { backgroundColor: "#ECFDF3" },
  upis: { backgroundColor: "#FFFBEB" },
  footer: { position: "absolute", bottom: 12, left: 22, right: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  h1: { fontSize: 17, fontWeight: "bold", color: GREEN, marginBottom: 2 },
  h2: { fontSize: 11, fontWeight: "bold", color: GREEN, marginTop: 9, marginBottom: 4 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 2.5 },
  li: { flexDirection: "row", marginBottom: 2.5 },
  liDot: { width: 18, fontSize: 9 },
  liText: { flex: 1, fontSize: 9, lineHeight: 1.4 },
  kpis: { flexDirection: "row", gap: 6, marginTop: 6 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 6 },
  kpiLabel: { fontSize: 7, color: MUTED, marginBottom: 2 },
  kpiValue: { fontSize: 12, fontWeight: "bold" },
  kpiSub: { fontSize: 7, color: "#374151", marginTop: 1 },
  box: { borderWidth: 1, borderColor: GREEN, borderRadius: 3, padding: 7, marginTop: 6 },
  warn: { borderWidth: 1, borderColor: RED, borderRadius: 3, padding: 7, marginTop: 6 },
  twoCol: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  line: { borderBottomWidth: 1, borderColor: LINE, height: 20, marginBottom: 2 },
  field: { flexDirection: "row", alignItems: "flex-end", marginBottom: 7 },
  fieldLabel: { fontSize: 9.5, marginRight: 6 },
  fieldLine: { flex: 1, borderBottomWidth: 1, borderColor: "#111111", height: 14 },
  komplet: { borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 6, marginBottom: 7 },
  kompletTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  kompletNaziv: { fontSize: 10, fontWeight: "bold" },
  kompletRazlog: { fontSize: 7.5, color: "#374151" },
  kompletUpis: { flexDirection: "row", gap: 10, marginTop: 5 },
});

// ───────────────────────────── zajednički delovi ─────────────────────────────

const Li = ({ children, n }) => h(View, { style: s.li }, h(Text, { style: s.liDot }, n ?? "•"), h(Text, { style: s.liText }, children));
const Field = ({ label, width }) =>
  h(View, { style: [s.field, width ? { width } : null] }, h(Text, { style: s.fieldLabel }, label), h(View, { style: s.fieldLine }));
const Footer = ({ oznaka }) =>
  h(View, { style: s.footer, fixed: true }, h(Text, null, `Sportem · ${oznaka} · ${datum}`), h(Text, { render: ({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}` }));

function Tabela({ kolone, naslov, podnaslov, grupe, red, meta, oznaka, orientation }) {
  const Header = h(
    View,
    { style: s.top, fixed: true },
    h(View, { style: s.topRow }, h(Text, { style: s.title }, naslov), h(Text, { style: s.meta }, oznaka)),
    h(Text, { style: s.sub }, podnaslov),
    h(View, { style: s.headRow }, ...kolone.map((k) => h(Text, { key: k.naslov, style: [s.headCell, k.w ? { width: k.w } : { flex: 1, textAlign: "left" }] }, k.naslov))),
  );
  const Celija = (k, v, prvi, rowH, kljuc) => {
    const sadrzaj = k.get ? k.get(v) : "";
    const stil = typeof k.stil === "function" ? k.stil(v) : k.stil;
    return h(
      View,
      { key: kljuc, style: [s.cell, k.w ? { width: k.w } : { flex: 1 }, k.bg] },
      h(Text, { style: [k.num ? s.num : null, stil] }, sadrzaj),
    );
  };
  const Red = (v, i, rowH, nazivOverride) =>
    h(
      View,
      { key: v.sku, style: [s.row, { minHeight: rowH }, i === 0 && s.rowPrvi], wrap: false },
      ...kolone.map((k, ki) =>
        ki === 0 && nazivOverride
          ? h(View, { key: "n", style: [s.cell, { flex: 1 }] }, h(Text, { style: s.bold }, nazivOverride))
          : Celija(k, v, i === 0, rowH, k.naslov),
      ),
    );
  return h(
    Page,
    { size: "A4", orientation, style: s.page },
    Header,
    ...grupe.map((g) => {
      if (g.varijante.length === 1 && !g.varijante[0].ime) {
        // Proizvod bez pravih varijanti = jedan red sa nazivom proizvoda (kolone već nose brojeve).
        return h(View, { key: g.id, style: s.grupa, wrap: false }, Red(g.varijante[0], 0, red, g.naziv));
      }
      return h(
        View,
        { key: g.id, style: s.grupa, wrap: false },
        h(View, { style: s.grupaRed }, h(Text, { style: s.grupaNaziv }, g.naziv), h(Text, { style: s.grupaMeta }, meta(g))),
        ...g.varijante.map((v, i) => Red(v, i + 1, red)),
      );
    }),
    h(Footer, { oznaka }),
  );
}

// ───────────────────────────── INTERNO ─────────────────────────────

const nisko = (v) => v.zaliha <= 0 || (v.q90 > 0 && v.zaliha < 1.5 * (v.q90 / 3));

const koloneInterno = [
  { naslov: "Artikal / varijanta", get: (v) => v.ime || "(osnovna)" },
  { naslov: "Šifra", w: 50, get: (v) => v.sku, stil: { fontSize: 7 } },
  { naslov: "6 mes.", w: 34, num: true, get: (v) => (v.q180 ? fmt.format(v.q180) : "") },
  { naslov: "kom/mes.", w: 32, num: true, get: (v) => mesecno(v.q90) },
  { naslov: "Zaliha", w: 34, num: true, get: (v) => fmt.format(v.zaliha), stil: (v) => (nisko(v) && (v.q90 > 0 || v.zaliha < 0) ? s.red : null) },
  { naslov: "VP", w: 46, num: true, get: (v) => rsd(v.vp), stil: s.bold },
  { naslov: "MP", w: 46, num: true, get: (v) => rsd(v.mp) },
  { naslov: "Zarada", w: 42, num: true, get: (v) => rsd(v.mp - v.vp) },
  { naslov: "Marža", w: 30, num: true, get: (v) => (v.mp ? `${Math.round(((v.mp - v.vp) / v.mp) * 100)}%` : "") },
  ...POPUSTI.map((d) => ({ naslov: `VP pri −${d * 100}%`, w: 46, num: true, bg: s.cilj, get: (v) => cilj(v, d) })),
  { naslov: "Dogovoreno", w: 62, bg: s.upis },
];
const metaInterno = (g) => {
  const delovi = [];
  if (g.q180) delovi.push(`6 mes.: ${fmt.format(g.q180)} kom · VP ${rsd(g.vp180)}`);
  if (g.kapital) delovi.push(`na lageru po VP: ${rsd(g.kapital)}`);
  return delovi.join("   ·   ");
};

function BriefInterno() {
  const mesProsek = vp180 / 6;
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.pageFree },
    h(Text, { style: s.h1 }, "Pregovori sa dobavljačem — novembar / Black Friday"),
    h(Text, { style: [s.p, { color: RED, fontWeight: "bold" }] }, `INTERNO — ne pokazivati. Za stolom se koristi samo papir „ZA STOLOM". · ${datum}`),
    h(
      View,
      { style: s.kpis },
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, `Uzeto od njega (VP) od ${odDatum}`), h(Text, { style: s.kpiValue }, `${mil(ukupnoVp)} RSD`), h(Text, { style: s.kpiSub }, `${fmt.format(ukupnoKom)} kom · ~${mil(ukupnoVp / meseci)} RSD mesečno`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Poslednjih 6 meseci (VP)"), h(Text, { style: s.kpiValue }, `${mil(vp180)} RSD`), h(Text, { style: s.kpiSub }, `${fmt.format(kom180)} kom · ~${mil(mesProsek)} RSD mesečno`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Top proizvodi = 80 % nabavke"), h(Text, { style: s.kpiValue }, `${deoA.length} proizvoda`), h(Text, { style: s.kpiSub }, `od ${lista.length} aktivnih (${brojVarijanti} varijanti)`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Bez prodaje kod nas 90 dana"), h(Text, { style: s.kpiValue }, `${mil(kapitalC)} RSD`), h(Text, { style: s.kpiSub }, `${deoC.length} proizvoda, po VP × zaliha`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Porudžbine sa 2+ proizvoda"), h(Text, { style: s.kpiValue }, `${Math.round((viseArtikala / poPorudzbini.size) * 100)} %`), h(Text, { style: s.kpiSub }, `${fmt.format(viseArtikala)} od ${fmt.format(poPorudzbini.size)} — osnova za komplete`)),
    ),
    h(
      View,
      { style: s.twoCol },
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h2 }, "Cilj: ista zarada u RSD na akcijskim artiklima"),
        h(Text, { style: s.p }, "Popust na sajtu treba da pokrije on, ne ti. Zato je:"),
        h(View, { style: s.box }, h(Text, { style: [s.p, s.bold] }, "Ciljna VP = BF MP − današnja zarada   (= današnja VP − popust u RSD)"), h(Text, { style: s.p }, "Primer: MP 9.999, VP 7.500, zarada 2.499. Na BF −15 % MP = 8.499 → ciljna VP 6.000.")),
        h(Text, { style: [s.p, { marginTop: 4 }] }, "U tabeli su zelene kolone gotova ciljna VP za −10/−15/−20 % MP. „—\" znači da bi VP pala na nulu ili ispod — tu popust od toliko nije realan, smanji ga."),
        h(Text, { style: s.h2 }, "Zašto bi pristao (bez da nudiš nešto zauzvrat)"),
        h(Li, { n: "1." }, `Obim: od ${odDatum} je kroz nas prošlo ${mil(ukupnoVp)} RSD njegove robe po VP. Svaka porudžbina ide preko njega — BF je dodatni obim za njega, ne samo za nas.`),
        h(Li, { n: "2." }, `Rasprodaja: ${deoC.length} proizvoda (${mil(kapitalC)} RSD robe po VP na lageru) nema nijednu prodaju preko nas 90+ dana. Ako mu i inače stoji, BF je trenutak da se pokrene — niža VP mu oslobađa magacin i novac. (Pitaj ga šta mu stvarno stoji — možda neke prodaje drugima.)`),
        h(Li, { n: "3." }, "Kompleti: svaki komplet prodaje 2–4 njegova artikla odjednom, a uz sporu robu (klupe, šipke, rack) gura i ono što inače stoji."),
        h(Li, { n: "4." }, "Privremeno je: nova VP važi samo za period akcije, posle se vraća stara. On ne gubi trajno ništa."),
      ),
      h(
        View,
        { style: s.col },
        h(Text, { style: s.h2 }, "Taktika"),
        h(Li, null, "Kreni od top proizvoda (deo A) — tu je najveći novac. Traži punu ciljnu VP. Ako ne ide: rezervna pozicija je da podelite popust pola-pola, ali to ne nudi prvi."),
        h(Li, null, "Za proizvode sa mnogo varijanti (HEX bučice, tegovi, zvona) dogovaraj % na VP za celu grupu i upiši ga na red proizvoda — ne cenkaj se za svaku kilažu."),
        h(Li, null, "Rasprodaju (deo C) predstavi kao uslugu njemu: „ovo ti stoji, hajde da ga izbacimo\" — tu traži najveći popust."),
        h(Li, null, "Deo B ide brzo, po grupama. Ako nema vremena, preskoči ga — ostaje stara VP."),
        h(Li, null, "Crvena zaliha = po našoj evidenciji ima manje od 1,5 mesečne prodaje ili je u minusu (evidencija nije tačna). Pitaj koliko stvarno ima i da li može da dopuni PRE akcije — bez robe nema ni akcije."),
        h(Text, { style: s.h2 }, "Redosled sastanka"),
        h(Li, { n: "1." }, `Top proizvodi (${deoA.length}) — nova VP za BF`),
        h(Li, { n: "2." }, `Kompleti (${kompleti.length} predloga + prazni obrasci)`),
        h(Li, { n: "3." }, `Rasprodaja (${deoC.length} proizvoda, sortirano po robi na lageru)`),
        h(Li, { n: "4." }, `Ostali katalog (${deoB.length} proizvoda) — brzo`),
        h(Li, { n: "5." }, "Uslovi (period, zalihe) i potpis zapisnika — poslednja strana papira „ZA STOLOM\""),
      ),
    ),
    h(Footer, { oznaka: "INTERNO" }),
  );
}

function KompletiStrana({ interno }) {
  const blok = (k) => {
    const sumVp = k.delovi.reduce((n, d) => n + d.vp * d.kol, 0);
    const sumMp = k.delovi.reduce((n, d) => n + d.mp * d.kol, 0);
    return h(
      View,
      { key: k.naziv, style: s.komplet, wrap: false },
      h(
        View,
        { style: s.kompletTop },
        h(Text, { style: s.kompletNaziv }, k.naziv),
        h(Text, { style: s.kompletRazlog }, `${k.razlog}${k.zajedno ? ` · kupljeno zajedno ${k.zajedno}×` : ""}`),
      ),
      ...k.delovi.map((d) =>
        h(
          View,
          { key: d.sku + d.kol, style: { flexDirection: "row", fontSize: 8.5, marginBottom: 1 } },
          h(Text, { style: { flex: 1 } }, `${d.kol > 1 ? `${d.kol} × ` : ""}${d.naziv}${d.ime ? ` — ${d.ime}` : ""}`),
          h(Text, { style: [s.dim, { width: 50 }] }, d.sku),
          h(Text, { style: [s.num, { width: 70 }] }, `VP ${rsd(d.vp * d.kol)}`),
          interno ? h(Text, { style: [s.num, s.dim, { width: 70 }] }, `MP ${rsd(d.mp * d.kol)}`) : null,
        ),
      ),
      h(
        View,
        { style: { flexDirection: "row", fontSize: 8.5, borderTopWidth: 1, borderColor: LINE, paddingTop: 2, marginTop: 1 } },
        h(Text, { style: [s.bold, { flex: 1 }] }, "Zbir pojedinačno"),
        h(Text, { style: [s.num, s.bold, { width: 70 }] }, `VP ${rsd(sumVp)}`),
        interno ? h(Text, { style: [s.num, s.dim, { width: 70 }] }, `MP ${rsd(sumMp)}`) : null,
      ),
      interno
        ? h(
            Text,
            { style: [s.kompletRazlog, { marginTop: 2, color: GREEN }] },
            `Zarada pojedinačno ${rsd(sumMp - sumVp)} · ciljna VP kompleta (ista zarada) pri MP kompleta −10 %: ${rsd(Math.round((sumVp - 0.1 * sumMp) / 10) * 10)} · −15 %: ${rsd(Math.round((sumVp - 0.15 * sumMp) / 10) * 10)}`,
          )
        : null,
      h(
        View,
        { style: s.kompletUpis },
        h(Field, { label: "VP kompleta:", width: 150 }),
        interno ? h(Field, { label: "MP kompleta:", width: 150 }) : null,
        h(Field, { label: "Napomena:", width: interno ? 200 : 260 }),
      ),
    );
  };
  const prazan = (i) =>
    h(
      View,
      { key: `prazan-${i}`, style: s.komplet, wrap: false },
      h(Text, { style: s.kompletNaziv }, `Novi komplet ${i}: ______________________________`),
      ...[1, 2, 3, 4].map((n) =>
        h(View, { key: n, style: { flexDirection: "row", gap: 8, marginTop: 6 } }, h(Field, { label: `${n}. artikal:`, width: 300 }), h(Field, { label: "kom:", width: 60 }), h(Field, { label: "VP:", width: 100 })),
      ),
      h(View, { style: s.kompletUpis }, h(Field, { label: "VP kompleta:", width: 150 }), interno ? h(Field, { label: "MP kompleta:", width: 150 }) : null),
    );
  return h(
    Page,
    { size: "A4", orientation: interno ? "landscape" : "portrait", style: s.pageFree },
    h(Text, { style: s.h1 }, "Kompleti (bundle-ovi)"),
    h(
      Text,
      { style: [s.p, { marginBottom: 6 }] },
      interno
        ? "Predlozi iz stvarnih porudžbina (koliko puta su ti proizvodi kupljeni zajedno) + kompleti za rasprodaju spore robe. Varijanta je predlog — prekriži i upiši drugu ako treba. Ciljna VP kompleta čuva istu zaradu kao kad se prodaje pojedinačno."
        : "Predlozi kompleta. VP kompleta = jedna cena za ceo komplet (niža od zbira pojedinačno). Varijanta je predlog — prekriži i upiši drugu ako treba.",
    ),
    ...kompleti.map(blok),
    ...[1, 2, 3, 4].map(prazan),
    h(Footer, { oznaka: interno ? "INTERNO" : "ZA STOLOM" }),
  );
}

function PosleInterno() {
  return h(
    Page,
    { size: "A4", orientation: "landscape", style: s.pageFree },
    h(Text, { style: s.h1 }, "Posle sastanka — šta uraditi u aplikaciji"),
    h(View, { style: s.warn }, h(Text, { style: [s.p, s.bold] }, "VP se zamrzava u trenutku kada porudžbina stigne (snapshot). Porudžbina primljena pre nego što uneseš novu VP ostaje po staroj VP — kasnije samo ručno, stavku po stavku."), h(Text, { style: s.p }, "Zato: nove VP uneti u katalog NAJKASNIJE dan pre starta akcije, i vratiti stare čim akcija završi.")),
    h(Text, { style: s.h2 }, "Spisak"),
    h(Li, { n: "[  ]" }, "Fotografisati popunjen papir „ZA STOLOM\" (oba primerka ako ih ima dva) odmah na sastanku."),
    h(Li, { n: "[  ]" }, "Pre starta akcije: u Katalogu promeniti VP za svaki dogovoren artikal. Zapisati staru VP (ovaj PDF je ima) da bi se posle vratila."),
    h(Li, { n: "[  ]" }, "Na sajtu (WooCommerce) postaviti akcijske MP — app NE gura MP na sajt."),
    h(Li, { n: "[  ]" }, "Kompleti: napraviti proizvod kompleta sa SVOJIM SKU i u katalogu i na sajtu, sa dogovorenom VP. Bez istog SKU u app-u porudžbina stiže kao „nepoznat SKU\" i dobija oznaku „fali VP\"."),
    h(Li, { n: "[  ]" }, "Komplet kao poseban SKU ne skida komponente sa stanja automatski — dogovoriti sa njim kako se vodi zaliha kompleta (ili ga voditi ručno)."),
    h(Li, { n: "[  ]" }, "Kraj akcije: vratiti stare VP i ugasiti akcijske MP na sajtu."),
    h(Li, { n: "[  ]" }, "Posle akcije: uporediti zaradu po danu tokom akcije sa oktobrom (Dashboard, period po danima)."),
    h(Text, { style: s.h2 }, "Beleške"),
    ...Array.from({ length: 9 }, (_, i) => h(View, { key: i, style: s.line })),
    h(Footer, { oznaka: "INTERNO" }),
  );
}

const sekcijeInterno = [
  { grupe: deoA, naslov: `A · Top proizvodi — ${deoA.length} proizvoda nose 80 % nabavke`, podnaslov: "6 mes. = prodatih komada za 6 meseci, kom/mes. = prosek poslednja 3 meseca. Sortirano po nabavci (VP). Zeleno = ciljna VP koja čuva istu zaradu pri tom popustu na MP. Crvena zaliha = proveri ima li robe za BF." },
  { grupe: deoB, naslov: `B · Ostali katalog koji se prodaje — ${deoB.length} proizvoda`, podnaslov: "Prodaja u poslednjih 90 dana, sortirano po nabavci. Ide brzo, po grupama." },
  { grupe: deoC, naslov: `C · Bez prodaje 90 dana — rasprodaja (${deoC.length} proizvoda, ${varC} varijanti)`, podnaslov: `Sortirano po robi na lageru kod njega (zaliha × VP), ukupno ${rsd(kapitalC)} RSD. Ovde traži najveći popust.` },
];

const interno = h(
  Document,
  { title: "Sportem — pregovori novembar (INTERNO)" },
  h(BriefInterno),
  ...sekcijeInterno.map((sek) =>
    h(Tabela, { key: sek.naslov, kolone: koloneInterno, ...sek, red: 15, meta: metaInterno, oznaka: "INTERNO — ne pokazivati", orientation: "landscape" }),
  ),
  h(KompletiStrana, { interno: true }),
  h(PosleInterno),
);

// ───────────────────────────── ZA STOLOM ─────────────────────────────

const koloneZajedno = [
  { naslov: "Artikal / varijanta", get: (v) => v.ime || "(osnovna)" },
  { naslov: "Šifra", w: 50, get: (v) => v.sku, stil: { fontSize: 7 } },
  { naslov: "6 mes.", w: 44, num: true, get: (v) => (v.q180 ? fmt.format(v.q180) : "") },
  { naslov: "VP sada", w: 52, num: true, get: (v) => rsd(v.vp), stil: s.bold },
  { naslov: "Nova VP", w: 68, bg: s.upis },
  { naslov: "Napomena", w: 110 },
];
const metaZajedno = (g) => (g.q180 ? `prodato 6 mes.: ${fmt.format(g.q180)} kom` : "");

function UvodZajedno() {
  return h(
    Page,
    { size: "A4", style: s.pageFree },
    h(Text, { style: s.h1 }, "Sportem — dogovor za novembar 2026"),
    h(Text, { style: [s.p, { color: MUTED }] }, `Black Friday akcija · kompleti · rasprodaja · ${datum}`),
    h(
      View,
      { style: s.kpis },
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, `Uzeli smo od tebe (VP) od ${odDatum}`), h(Text, { style: s.kpiValue }, `${mil(ukupnoVp)} RSD`), h(Text, { style: s.kpiSub }, `${fmt.format(ukupnoKom)} komada`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Poslednjih 6 meseci"), h(Text, { style: s.kpiValue }, `${mil(vp180)} RSD`), h(Text, { style: s.kpiSub }, `${fmt.format(kom180)} komada`)),
      h(View, { style: s.kpi }, h(Text, { style: s.kpiLabel }, "Bez prodaje kod nas 90 dana (zaliha × VP)"), h(Text, { style: s.kpiValue }, `${mil(kapitalC)} RSD`), h(Text, { style: s.kpiSub }, `${deoC.length} proizvoda`)),
    ),
    h(Text, { style: s.h2 }, "Plan"),
    h(Li, { n: "1." }, `Najprodavaniji proizvodi (${deoA.length}) — nova VP za vreme akcije`),
    h(Li, { n: "2." }, "Kompleti — jedna VP za ceo komplet"),
    h(Li, { n: "3." }, `Rasprodaja — roba koja se kod nas ne prodaje (${deoC.length} proizvoda)`),
    h(Li, { n: "4." }, `Ostali katalog (${deoB.length} proizvoda)`),
    h(Li, { n: "5." }, "Uslovi i potpis (poslednja strana)"),
    h(Text, { style: s.h2 }, "Kako se popunjava"),
    h(Li, null, "„Nova VP\" = VP koja važi za vreme akcije. Prazno = ostaje ista VP."),
    h(Li, null, "Za proizvod sa više varijanti može jedan popust za sve: upiši npr. „−8 %\" na sivi red sa nazivom proizvoda."),
    h(Li, null, "„=\" znači isto kao red iznad. „X\" = ne ide u akciju."),
    h(Li, null, "U napomenu: koliko robe ima za akciju, ako treba dopuna, ili ograničenje (npr. „max 20 kom\")."),
    h(Text, { style: s.h2 }, "Brze beleške"),
    ...Array.from({ length: 10 }, (_, i) => h(View, { key: i, style: s.line })),
    h(Footer, { oznaka: "ZA STOLOM" }),
  );
}

function ZapisnikZajedno() {
  return h(
    Page,
    { size: "A4", style: s.pageFree },
    h(Text, { style: s.h1 }, "Zapisnik dogovora — novembar 2026"),
    h(Text, { style: s.h2 }, "Period važenja"),
    h(View, { style: { flexDirection: "row", gap: 16 } }, h(Field, { label: "Akcijska VP važi od:", width: 240 }), h(Field, { label: "do:", width: 200 })),
    h(Text, { style: s.p }, "Važi za porudžbine KREIRANE u tom periodu (datum porudžbine na sajtu), bez obzira kad su poslate.   [  ] da   [  ] drugačije: ____________"),
    h(Text, { style: s.h2 }, "Rasprodaja"),
    h(View, { style: { flexDirection: "row", gap: 16 } }, h(Field, { label: "Rasprodajna VP važi od:", width: 240 }), h(Field, { label: "do:", width: 200 })),
    h(Text, { style: s.p }, "[  ] isto kao akcija    [  ] dok se roba ne proda    [  ] drugo: ____________________"),
    h(Text, { style: s.h2 }, "Zalihe za akciju"),
    h(Text, { style: s.p }, "Šta mora da se dopuni pre akcije i do kog datuma:"),
    ...Array.from({ length: 4 }, (_, i) => h(View, { key: `z${i}`, style: s.line })),
    h(Text, { style: s.h2 }, "Kompleti"),
    h(Text, { style: s.p }, "Kako se vodi zaliha kompleta (komponente se skidaju pojedinačno?), ko pakuje, da li ide u jedan paket:"),
    ...Array.from({ length: 3 }, (_, i) => h(View, { key: `k${i}`, style: s.line })),
    h(Text, { style: s.h2 }, "Ostalo dogovoreno"),
    ...Array.from({ length: 6 }, (_, i) => h(View, { key: `o${i}`, style: s.line })),
    h(Text, { style: s.h2 }, "Potpisi"),
    h(
      View,
      { style: { flexDirection: "row", gap: 30, marginTop: 14 } },
      h(View, { style: s.col }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Sportem")),
      h(View, { style: s.col }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Dobavljač")),
      h(View, { style: { width: 120 } }, h(View, { style: s.fieldLine }), h(Text, { style: [s.p, { marginTop: 3 }] }, "Datum")),
    ),
    h(Footer, { oznaka: "ZA STOLOM" }),
  );
}

const sekcijeZajedno = [
  { grupe: deoA, naslov: `1 · Najprodavaniji proizvodi (${deoA.length})`, podnaslov: "6 mes. = koliko smo komada prodali za poslednjih 6 meseci. Ovde nam je nova VP najvažnija." },
  { grupe: deoB, naslov: `4 · Ostali katalog (${deoB.length})`, podnaslov: "Proizvodi koji se prodaju, ali manje. Može po grupama." },
  { grupe: deoC, naslov: `3 · Rasprodaja — bez prodaje 90 dana (${deoC.length})`, podnaslov: "Roba koja se preko nas ne prodaje. Sortirano po robi na lageru (zaliha × VP) — najveća prvo. Predlog: niža VP + akcija na sajtu da se pokrene." },
];

const zajedno = h(
  Document,
  { title: "Sportem — dogovor za novembar (ZA STOLOM)" },
  h(UvodZajedno),
  h(Tabela, { kolone: koloneZajedno, ...sekcijeZajedno[0], red: 17, meta: metaZajedno, oznaka: "ZA STOLOM", orientation: "portrait" }),
  h(KompletiStrana, { interno: false }),
  h(Tabela, { kolone: koloneZajedno, ...sekcijeZajedno[2], red: 17, meta: metaZajedno, oznaka: "ZA STOLOM", orientation: "portrait" }),
  h(Tabela, { kolone: koloneZajedno, ...sekcijeZajedno[1], red: 17, meta: metaZajedno, oznaka: "ZA STOLOM", orientation: "portrait" }),
  h(ZapisnikZajedno),
);

const izlazInterno = path.join(process.cwd(), `pregovori-novembar-INTERNO-${danas}.pdf`);
const izlazZajedno = path.join(process.cwd(), `pregovori-novembar-ZA-STOLOM-${danas}.pdf`);
await renderToFile(interno, izlazInterno);
await renderToFile(zajedno, izlazZajedno);
console.log(`A ${deoA.length} · B ${deoB.length} · C ${deoC.length} proizvoda (${brojVarijanti} varijanti)`);
console.log(`→ ${izlazInterno}\n→ ${izlazZajedno}`);
