/**
 * Sportem: PDF obrazac za magacin — težina i dimenzije paketa po varijanti.
 *
 * Štampa se, popunjava rukom u magacinu, pa se cifre unose u katalog.
 * Sve aktivne varijante (i one bez stanja), po nazivu proizvoda abecedno.
 * Skripta SAMO ČITA bazu; nikad ne ispisuje cene.
 *
 * Pokretanje iz root-a repoa:
 *   node --env-file=.env.local scripts/magacin-popis-paketa.mjs
 *
 * Potrebno u .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Izlaz: magacin-tezine-dimenzije-YYYY-MM-DD.pdf u root-u repoa.
 */
import path from "node:path";
import { createElement as h } from "react";
import { createClient } from "@supabase/supabase-js";
import { Document, Font, Page, StyleSheet, Text, View, renderToFile } from "@react-pdf/renderer";

const GREEN = "#1B7A45";
const LINE = "#9CA3AF";
const ROW_H = 21;

// Geist sa diska — Helvetica nema č/ć/đ (isto kao lista za slanje).
const fontDir = path.join(process.cwd(), "assets", "fonts");
Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(fontDir, "Geist-Regular.ttf") },
    { src: path.join(fontDir, "Geist-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

async function ucitajGrupe() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("product_variants")
      .select("id, sku, variant_name, archived_at, products(id, name, archived_at)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`product_variants: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const grupe = new Map();
  for (const v of rows) {
    const p = Array.isArray(v.products) ? v.products[0] : v.products;
    if (v.archived_at || !p || p.archived_at) continue;
    if (!grupe.has(p.id)) grupe.set(p.id, { naziv: p.name.trim(), varijante: [] });
    const ime = v.variant_name && v.variant_name !== "Default" ? v.variant_name.trim() : "";
    grupe.get(p.id).varijante.push({ sku: v.sku, ime });
  }

  // Varijante od najmanje ka najvećoj ("2.5 kg" pre "10 kg"), inače abecedno.
  const broj = (s) => {
    const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(s);
    return m ? Number(m[1].replace(",", ".")) : null;
  };
  const poVarijanti = (a, b) => {
    const x = broj(a.ime);
    const y = broj(b.ime);
    if (x != null && y != null && x !== y) return x - y;
    return a.ime.localeCompare(b.ime, "sr", { numeric: true }) || a.sku.localeCompare(b.sku, "sr", { numeric: true });
  };

  const lista = [...grupe.values()];
  for (const g of lista) g.varijante.sort(poVarijanti);
  lista.sort((a, b) => a.naziv.localeCompare(b.naziv, "sr", { numeric: true }));
  return lista;
}

const W = { sku: 58, tezina: 56, dim: 44, paketa: 40, napomena: 108 };

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: "#111111", paddingTop: 62, paddingBottom: 34, paddingHorizontal: 24 },
  top: { position: "absolute", top: 20, left: 24, right: 24 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 },
  title: { fontSize: 13, fontWeight: "bold", color: GREEN },
  meta: { fontSize: 8, color: "#4B5563" },
  headRow: { flexDirection: "row", borderWidth: 1, borderColor: "#111111", backgroundColor: "#E5E7EB" },
  headCell: { fontSize: 7.5, fontWeight: "bold", paddingVertical: 3, paddingHorizontal: 3, textAlign: "center" },
  uputstvo: { borderWidth: 1, borderColor: GREEN, borderRadius: 3, padding: 8, marginBottom: 8 },
  uputstvoNaslov: { fontSize: 10, fontWeight: "bold", marginBottom: 3 },
  uputstvoRed: { fontSize: 9, marginBottom: 2, lineHeight: 1.35 },
  potpis: { flexDirection: "row", marginTop: 6, fontSize: 9 },
  grupa: { marginBottom: 5 },
  grupaNaziv: {
    fontSize: 9.5,
    fontWeight: "bold",
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: LINE,
  },
  row: { flexDirection: "row", minHeight: ROW_H, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  rowPrvi: { borderTopWidth: 1 },
  cell: { borderRightWidth: 1, borderColor: LINE, justifyContent: "center", paddingHorizontal: 3 },
  sku: { fontSize: 8 },
  bold: { fontWeight: "bold" },
  footer: { position: "absolute", bottom: 14, left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#6B7280" },
});

const KOLONE = [
  ["Šifra", { width: W.sku }],
  ["Artikal / varijanta", { flex: 1, textAlign: "left" }],
  ["Težina (kg)", { width: W.tezina }],
  ["D (cm)", { width: W.dim }],
  ["Š (cm)", { width: W.dim }],
  ["V (cm)", { width: W.dim }],
  ["Paketa", { width: W.paketa }],
  ["Napomena", { width: W.napomena }],
];

function Red({ sku, tekst, bold, prvi }) {
  return h(
    View,
    { style: [s.row, prvi && s.rowPrvi], wrap: false },
    h(View, { style: [s.cell, { width: W.sku }] }, h(Text, { style: s.sku }, sku)),
    h(View, { style: [s.cell, { flex: 1 }] }, h(Text, { style: bold ? s.bold : undefined }, tekst)),
    h(View, { style: [s.cell, { width: W.tezina }] }),
    h(View, { style: [s.cell, { width: W.dim }] }),
    h(View, { style: [s.cell, { width: W.dim }] }),
    h(View, { style: [s.cell, { width: W.dim }] }),
    h(View, { style: [s.cell, { width: W.paketa }] }),
    h(View, { style: [s.cell, { width: W.napomena }] }),
  );
}

function Grupa({ g }) {
  // Proizvod bez pravih varijanti = jedan red sa nazivom proizvoda.
  if (g.varijante.length === 1 && !g.varijante[0].ime) {
    return h(View, { style: s.grupa, wrap: false }, h(Red, { sku: g.varijante[0].sku, tekst: g.naziv, bold: true, prvi: true }));
  }
  return h(
    View,
    { style: s.grupa, wrap: false },
    h(Text, { style: s.grupaNaziv }, g.naziv),
    ...g.varijante.map((v) => h(Red, { key: v.sku, sku: v.sku, tekst: v.ime || "(osnovna)" })),
  );
}

function Obrazac({ grupe, datum, brojVarijanti }) {
  return h(
    Document,
    { title: "Sportem — težine i dimenzije paketa" },
    h(
      Page,
      { size: "A4", style: s.page },
      h(
        View,
        { style: s.top, fixed: true },
        h(
          View,
          { style: s.topRow },
          h(Text, { style: s.title }, "Sportem — težine i dimenzije paketa"),
          h(Text, { style: s.meta }, `${grupe.length} proizvoda · ${brojVarijanti} artikala · ${datum}`),
        ),
        h(View, { style: s.headRow }, ...KOLONE.map(([naziv, stil]) => h(Text, { key: naziv, style: [s.headCell, stil] }, naziv))),
      ),
      h(
        View,
        { style: s.uputstvo },
        h(Text, { style: s.uputstvoNaslov }, "Kako se popunjava"),
        h(Text, { style: s.uputstvoRed }, "1.  Meri se ZAPAKOVAN artikal, onako kako se predaje kuriru (sa kutijom i zaštitom)."),
        h(Text, { style: s.uputstvoRed }, "2.  Težina u kilogramima, sa jednom decimalom (npr. 12,5). Dimenzije u centimetrima: D = dužina, Š = širina, V = visina."),
        h(Text, { style: s.uputstvoRed }, "3.  Paketa = u koliko kutija ide JEDAN komad. Ako je više od 1: upiši ukupnu težinu, dimenzije najveće kutije, a ostale kutije u napomenu."),
        h(Text, { style: s.uputstvoRed }, "4.  Ako je red isti kao red iznad, dovoljno je upisati  =  u polja. Artikal kog nema u magacinu ostavi prazan."),
        h(
          View,
          { style: s.potpis },
          h(Text, { style: { flex: 1 } }, "Popunio: ______________________________"),
          h(Text, null, "Datum: ____________________"),
        ),
      ),
      ...grupe.map((g) => h(Grupa, { key: g.naziv + g.varijante[0].sku, g })),
      h(
        View,
        { style: s.footer, fixed: true },
        h(Text, null, "Sportem · obrazac za magacin"),
        h(Text, { render: ({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}` }),
      ),
    ),
  );
}

const grupe = await ucitajGrupe();
const brojVarijanti = grupe.reduce((n, g) => n + g.varijante.length, 0);
const danas = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(new Date());
const datum = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
const izlaz = path.join(process.cwd(), `magacin-tezine-dimenzije-${danas}.pdf`);

await renderToFile(h(Obrazac, { grupe, datum, brojVarijanti }), izlaz);
console.log(`${grupe.length} proizvoda, ${brojVarijanti} artikala → ${izlaz}`);
