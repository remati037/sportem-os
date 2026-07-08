// ============================================================================
// Sportem OS — automatizovan RLS test (Korak 0.5)
//
// Uloguje se anon klijentom kao Logistika i kao Admin, pa proverava da RLS
// zaista skriva finansije od Logistike, a Adminu ih otkriva.
//
// Preduslovi:
//   • RLS migracija primenjena (supabase db push)
//   • dev-fixtures učitani na bazu (proizvodi/varijante/porudžbine)
//   • test nalozi postoje; kredencijali kroz env varijable
//
// Pokretanje:
//   node --env-file=.env.local --env-file=.env.test.local scripts/rls-test.mjs
//   (ili: npm run rls:test)
//
// Potrebne env varijable (pored NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY):
//   RLS_TEST_ADMIN_EMAIL, RLS_TEST_ADMIN_PASSWORD
//   RLS_TEST_LOGISTICS_EMAIL, RLS_TEST_LOGISTICS_PASSWORD
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CREDS = {
  admin: {
    email: process.env.RLS_TEST_ADMIN_EMAIL,
    password: process.env.RLS_TEST_ADMIN_PASSWORD,
  },
  logistics: {
    email: process.env.RLS_TEST_LOGISTICS_EMAIL,
    password: process.env.RLS_TEST_LOGISTICS_PASSWORD,
  },
};

let failures = 0;

function check(label, pass, detail = "") {
  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** Vrati broj vidljivih redova (RLS deny → 0), ili -1 na grešku pristupa. */
async function countRows(client, table) {
  const { data, error } = await client.from(table).select("*");
  if (error) return -1;
  return data.length;
}

async function signIn(role) {
  const { email, password } = CREDS[role];
  if (!email || !password) {
    console.error(`\nNedostaju kredencijali za ulogu "${role}". Postavi env varijable.`);
    process.exit(2);
  }
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`\nPrijava kao "${role}" nije uspela: ${error.message}`);
    process.exit(2);
  }
  return client;
}

async function testLogistics() {
  console.log("\nLogistika — finansije MORAJU biti nedostupne:");
  const c = await signIn("logistics");

  check("product_variants (cene) → 0 redova", (await countRows(c, "product_variants")) === 0);
  check("orders → 0 redova", (await countRows(c, "orders")) === 0);
  check("order_items → 0 redova", (await countRows(c, "order_items")) === 0);
  check("invoices → 0 redova", (await countRows(c, "invoices")) === 0);
  check("payouts → 0 redova", (await countRows(c, "payouts")) === 0);
  check("expenses → 0 redova", (await countRows(c, "expenses")) === 0);

  const publicCount = await countRows(c, "product_variants_public");
  check("product_variants_public → vidljiv (>0)", publicCount > 0, `${publicCount} redova`);
  const productsCount = await countRows(c, "products");
  check("products → vidljiv (>0)", productsCount > 0, `${productsCount} redova`);

  await c.auth.signOut();
}

async function testAdmin() {
  console.log("\nAdmin — sve MORA biti dostupno:");
  const c = await signIn("admin");

  const variants = await countRows(c, "product_variants");
  check("product_variants (cene) → vidljiv (>0)", variants > 0, `${variants} redova`);
  check("orders → dostupno (bez greške pristupa)", (await countRows(c, "orders")) >= 0);
  check("invoices → dostupno (bez greške pristupa)", (await countRows(c, "invoices")) >= 0);
  check("expenses → dostupno (bez greške pristupa)", (await countRows(c, "expenses")) >= 0);

  await c.auth.signOut();
}

async function main() {
  if (!URL || !ANON) {
    console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    process.exit(2);
  }
  console.log("RLS test — Sportem OS (Korak 0.5)");

  await testLogistics();
  await testAdmin();

  console.log(
    failures === 0
      ? "\n✅ PASS — RLS ispravno skriva finansije od Logistike.\n"
      : `\n❌ FAIL — ${failures} provera(e) nije prošla.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
