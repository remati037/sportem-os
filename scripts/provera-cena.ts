/**
 * Sportem: poređenje cena u bazi (Supabase, product_variants) i na sajtu (Woo Store API).
 *
 * Pokretanje iz root-a repoa:
 *   npx tsx --env-file=.env.local scripts/provera-cena.ts
 *
 * Potrebno u .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Izlaz: tabela u terminalu + provera-cena-YYYY-MM-DD.csv. Exit code 1 ako ima razlika.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SITE = 'https://sportem.rs';

type Red = { status: string; sku: string; naziv: string; baza: number | ''; sajt: number | ''; akcija: number | '' };
type Woo = { sku: string; naziv: string; regular: number; sale: number | ''; onSale: boolean };

async function ucitajBazu() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb
    .from('product_variants')
    .select('sku, variant_name, mp_price, archived_at, products(name, archived_at)')
    .range(0, 4999);
  if (error) throw error;

  const map = new Map<string, { mp: number; naziv: string; aktivan: boolean; nadjen?: boolean }>();
  for (const v of data as any[]) {
    const sku = String(v.sku ?? '').trim();
    if (!sku) continue;
    const p = Array.isArray(v.products) ? v.products[0] : v.products;
    const varijanta = v.variant_name && v.variant_name !== 'Default' ? ` – ${v.variant_name}` : '';
    map.set(sku, {
      mp: Number(v.mp_price),
      naziv: `${p?.name ?? ''}${varijanta}`,
      aktivan: !v.archived_at && !p?.archived_at,
    });
  }
  return map;
}

function cena(p: any): Woo {
  const m = 10 ** (p.prices.currency_minor_unit ?? 0);
  return {
    sku: String(p.sku ?? '').trim(),
    naziv: p.name,
    regular: Math.round(Number(p.prices.regular_price) / m),
    sale: p.on_sale ? Math.round(Number(p.prices.sale_price) / m) : '',
    onSale: !!p.on_sale,
  };
}

async function ucitajSajt() {
  const out: Woo[] = [];
  const varijante: { id: number; naziv: string }[] = [];

  for (let page = 1; ; page++) {
    const r = await fetch(`${SITE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!r.ok) break;
    const items: any[] = await r.json();
    if (!items.length) break;
    for (const p of items) {
      if (p.type === 'variable' && p.variations?.length) {
        for (const v of p.variations)
          varijante.push({ id: v.id, naziv: `${p.name} – ${v.attributes.map((a: any) => a.value).join(', ')}` });
      } else out.push(cena(p));
    }
    if (items.length < 100) break;
  }

  for (let i = 0; i < varijante.length; i += 10) {
    const batch = varijante.slice(i, i + 10);
    const res = await Promise.all(
      batch.map(async (v) => {
        const r = await fetch(`${SITE}/wp-json/wc/store/v1/products/${v.id}`);
        return r.ok ? { ...cena(await r.json()), naziv: v.naziv } : null;
      }),
    );
    res.forEach((x) => x && out.push(x));
  }
  return out;
}

async function main() {
  const [baza, sajt] = await Promise.all([ucitajBazu(), ucitajSajt()]);
  const redovi: Red[] = [];

  for (const w of sajt) {
    if (!w.sku) { redovi.push({ status: 'Nema SKU na sajtu', sku: '', naziv: w.naziv, baza: '', sajt: w.regular, akcija: w.sale }); continue; }
    const b = baza.get(w.sku);
    if (!b) { redovi.push({ status: 'Nema u bazi', sku: w.sku, naziv: w.naziv, baza: '', sajt: w.regular, akcija: w.sale }); continue; }
    b.nadjen = true;
    const r = { sku: w.sku, naziv: b.naziv, baza: b.mp, sajt: w.regular, akcija: w.sale };
    if (b.mp !== w.regular) redovi.push({ status: 'Različita cena', ...r });
    if (w.onSale && (w.sale as number) >= w.regular) redovi.push({ status: 'Akcija nije niža od regularne', ...r });
    else if (w.onSale) redovi.push({ status: 'Na akciji (info)', ...r });
    if (!b.aktivan) redovi.push({ status: 'Arhiviran u bazi, aktivan na sajtu', ...r });
  }
  for (const [sku, b] of baza)
    if (!b.nadjen && b.aktivan) redovi.push({ status: 'Nema na sajtu', sku, naziv: b.naziv, baza: b.mp, sajt: '', akcija: '' });

  const redosled = ['Različita cena', 'Akcija nije niža od regularne', 'Nema u bazi', 'Nema na sajtu',
    'Arhiviran u bazi, aktivan na sajtu', 'Nema SKU na sajtu', 'Na akciji (info)'];
  redovi.sort((a, b) => redosled.indexOf(a.status) - redosled.indexOf(b.status) || a.sku.localeCompare(b.sku));

  const greske = redovi.filter((r) => r.status !== 'Na akciji (info)');
  console.table(greske);
  console.log(`\nProvereno: ${sajt.length} na sajtu, ${baza.size} u bazi. Za ispravku: ${greske.length}. Na akciji: ${redovi.length - greske.length}.`);

  const csv = ['Status;SKU;Proizvod;Baza MP;Sajt regularna;Sajt akcijska',
    ...redovi.map((r) => [r.status, r.sku, r.naziv, r.baza, r.sajt, r.akcija].join(';'))].join('\n');
  const fajl = `provera-cena-${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(fajl, '\uFEFF' + csv);
  console.log(`CSV: ${fajl}`);

  process.exit(greske.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });