// ============================================================================
// Sportem OS — automatizovan RLS test (Korak 0.5 + Korak T7 „Tiketi")
//
// Uloguje se anon klijentom kao Logistika, Menadžer i Admin, pa proverava da
// RLS zaista:
//   • skriva finansije od Logistike, a Adminu ih otkriva            (0.5)
//   • ne pušta Logistiku ni do jedne od 9 `ticket_*` tabela         (T7)
//   • pušta Menadžera da piše tikete, ali NE i podešavanja board-a  (T7)
//   • pušta Admina i na podešavanja board-a                         (T7)
//   • ne pušta Logistiku ni do jedne `offer_*` tabele (Ponude), i ne
//     dozvoljava upis nijednoj roli — ponude piše samo service role
//
// Preduslovi:
//   • RLS migracije primenjene (supabase db push, uklj. 20260825120000_tiketi.sql)
//   • dev-fixtures učitani na bazu (proizvodi/varijante/porudžbine)
//   • test nalozi postoje; kredencijali kroz env varijable
//
// Pokretanje:
//   node --env-file=.env.local --env-file=.env.test.local scripts/rls-test.mjs
//   (ili: npm run rls:test)
//
// `--static` (npm run rls:static, odluka O5 iz plana optimizacije): pokreni SAMO
// tri statičke provere (politike u migracijama tiketa i ponuda + kapije ruta) i
// izađi PRE ijedne prijave. Tako postoji kapija za politike i bez test naloga —
// Menadžer i Logistika trenutno ne postoje. Bez zastavice je ponašanje nedirano.
//
// Potrebne env varijable (pored NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY):
//   RLS_TEST_ADMIN_EMAIL, RLS_TEST_ADMIN_PASSWORD
//   RLS_TEST_LOGISTICS_EMAIL, RLS_TEST_LOGISTICS_PASSWORD
//   RLS_TEST_MANAGER_EMAIL, RLS_TEST_MANAGER_PASSWORD   (opciono — bez njih se
//     Menadžer deo preskače uz upozorenje, ostatak testa i dalje važi)
//
// NAPOMENA: test tiketa PIŠE u bazu (pravi i odmah briše jedan tiket i jednu
// kolonu sa prefiksom „__rls-test“). Brojač `ticket_code_seq` time odmakne za
// jedan — šifre tiketa (SPT-N) dobiju rupu. To je jedini način da se dokaže
// da Menadžer STVARNO sme da piše. Ništa drugo se ne dira: porudžbine,
// `order_items` (zamrznute cene) i finansije ostaju netaknuti.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

/** Samo statičke provere (bez prijave i bez ijednog upita na bazu). */
const STATIC_ONLY = process.argv.slice(2).includes("--static");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CREDS = {
  admin: {
    email: process.env.RLS_TEST_ADMIN_EMAIL,
    password: process.env.RLS_TEST_ADMIN_PASSWORD,
  },
  manager: {
    email: process.env.RLS_TEST_MANAGER_EMAIL,
    password: process.env.RLS_TEST_MANAGER_PASSWORD,
  },
  logistics: {
    email: process.env.RLS_TEST_LOGISTICS_EMAIL,
    password: process.env.RLS_TEST_LOGISTICS_PASSWORD,
  },
};

/* Devet tabela modula Tiketi (T1). Logistika ne sme da vidi nijednu. */
const TICKET_TABLES = [
  "ticket_columns",
  "ticket_priorities",
  "ticket_tags",
  "tickets",
  "ticket_assignees",
  "ticket_tag_links",
  "ticket_checklist_items",
  "ticket_comments",
  "ticket_events",
];

/* Tri tabele modula Ponude. Vide ih Admin i Menadžer; Logistika nijednu, a
   upis ide isključivo kroz service role (nema nijedne write politike). */
const OFFER_TABLES = ["offer_rules", "offer_events", "offer_sync_state"];

/* Prefiks privremenih redova koje test pravi pa briše. */
const TEST_PREFIX = "__rls-test";

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

/**
 * Prijava koja ne ruši test ako kredencijali nedostaju (Menadžer je opcion).
 * Vraća `null` uz upozorenje umesto `process.exit`.
 */
async function signInOptional(role) {
  const { email, password } = CREDS[role];
  if (!email || !password) {
    console.log(
      `  ⚠ preskočeno — nema RLS_TEST_${role.toUpperCase()}_EMAIL / _PASSWORD u okruženju`,
    );
    return null;
  }
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.log(`  ⚠ preskočeno — prijava kao "${role}" nije uspela: ${error.message}`);
    return null;
  }
  return client;
}

/** Insert koji MORA da padne na RLS-u. Ako slučajno prođe, red se odmah briše. */
async function expectInsertDenied(client, table, row, label) {
  const { data, error } = await client.from(table).insert(row).select("id");
  if (error) {
    check(label, true, `odbijeno (${error.code ?? "greška"})`);
    return;
  }
  check(label, false, "upis je PROŠAO — RLS ne štiti tabelu");
  // Higijena: ne ostavljati smeće u bazi ako je politika slaba.
  const id = data?.[0]?.id;
  if (id) await client.from(table).delete().eq("id", id);
}

/** Update koji sme da prođe bez greške, ali NE sme da promeni nijedan red. */
async function expectUpdateNoRows(client, table, id, patch, label) {
  const { data, error } = await client.from(table).update(patch).eq("id", id).select("id");
  if (error) {
    check(label, true, `odbijeno (${error.code ?? "greška"})`);
    return;
  }
  check(label, (data?.length ?? 0) === 0, `promenjeno redova: ${data?.length ?? 0}`);
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

/* ────────────────────────────────────────────────────────────────────────────
 * Tiketi (Korak T7) — dokaz dozvola nad 9 `ticket_*` tabela.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Adminove brojke služe i kao kontrola: 0 kod Admina znači da je provera prazna. */
async function ticketRowCountsAsAdmin() {
  const c = await signIn("admin");
  const counts = {};
  for (const table of TICKET_TABLES) counts[table] = await countRows(c, table);
  await c.auth.signOut();
  return counts;
}

async function testLogisticsTickets(adminCounts) {
  console.log("\nLogistika — tiketi MORAJU biti nedostupni (nema nijednu politiku):");
  const c = await signIn("logistics");

  for (const table of TICKET_TABLES) {
    const n = await countRows(c, table);
    const adminN = adminCounts[table];
    // Ako ni Admin ne vidi red, provera je prazna — reci to naglas, ne laži „prošlo".
    const note =
      adminN === -1
        ? "Admin dobija grešku — je li migracija push-ovana?"
        : adminN === 0
          ? "napomena: tabela je prazna i za Admina (provera je prazna)"
          : `Admin vidi ${adminN}`;
    check(`${table} → 0 redova`, n === 0, note);
  }

  await expectInsertDenied(
    c,
    "tickets",
    { title: `${TEST_PREFIX} logistika`, position: 1 },
    "tickets ← insert odbijen",
  );

  await c.auth.signOut();
}

async function testManagerTickets() {
  console.log("\nMenadžer — piše tikete, ali NE i podešavanja board-a:");
  const c = await signInOptional("manager");
  if (!c) return;

  // 1. Čitanje: Menadžer vidi ceo modul (config + tikete).
  const columns = await c.from("ticket_columns").select("id, name").order("sort_order");
  const canReadColumns = !columns.error;
  check("ticket_columns → čitljivo", canReadColumns, columns.error?.message ?? "");
  check("tickets → čitljivo", (await countRows(c, "tickets")) >= 0);
  check("ticket_comments → čitljivo", (await countRows(c, "ticket_comments")) >= 0);
  check("ticket_events → čitljivo", (await countRows(c, "ticket_events")) >= 0);

  // 2. Pisanje tiketa MORA da prođe (Menadžer je ravnopravan Adminu nad tiketima).
  const column = columns.data?.[0];
  if (!column) {
    console.log("  ⚠ nema nijedne kolone board-a — upis tiketa se ne može proveriti");
  } else {
    const created = await c
      .from("tickets")
      .insert({ title: `${TEST_PREFIX} tiket`, column_id: column.id, position: 1 })
      .select("id, code")
      .single();
    check(
      "tickets ← insert prolazi",
      !created.error,
      created.error?.message ?? `SPT-${created.data?.code}`,
    );

    if (created.data?.id) {
      const del = await c.from("tickets").delete().eq("id", created.data.id).select("id");
      check("tickets ← delete prolazi (čišćenje)", !del.error && del.data?.length === 1);
    }
  }

  // 3. Podešavanja board-a MORAJU biti odbijena (piše ih samo Admin).
  await expectInsertDenied(
    c,
    "ticket_columns",
    { name: `${TEST_PREFIX} kolona`, sort_order: 999 },
    "ticket_columns ← insert odbijen",
  );
  await expectInsertDenied(
    c,
    "ticket_priorities",
    { name: `${TEST_PREFIX} prioritet`, level: 9, sort_order: 999 },
    "ticket_priorities ← insert odbijen",
  );
  await expectInsertDenied(
    c,
    "ticket_tags",
    { name: `${TEST_PREFIX} tag`, sort_order: 999 },
    "ticket_tags ← insert odbijen",
  );
  if (column) {
    await expectUpdateNoRows(
      c,
      "ticket_columns",
      column.id,
      { name: column.name },
      "ticket_columns ← update ne menja nijedan red",
    );
  }

  await c.auth.signOut();
}

async function testAdminTickets() {
  console.log("\nAdmin — tiketi i podešavanja board-a MORAJU biti dostupni:");
  const c = await signIn("admin");

  check("tickets → dostupno", (await countRows(c, "tickets")) >= 0);

  const created = await c
    .from("ticket_columns")
    .insert({ name: `${TEST_PREFIX} kolona`, sort_order: 999 })
    .select("id")
    .single();
  check("ticket_columns ← insert prolazi", !created.error, created.error?.message ?? "");

  if (created.data?.id) {
    const del = await c.from("ticket_columns").delete().eq("id", created.data.id).select("id");
    check("ticket_columns ← delete prolazi (čišćenje)", !del.error && del.data?.length === 1);
  }

  await c.auth.signOut();
}

/* Politike u migraciji (statička provera) — radi i bez test naloga.
   Uhvati regresiju tipa „neko je dopisao 'logistics' u ticket politiku" pre
   nego što stigne na bazu; živi test ispod dokazuje isto nad pravom bazom. */
async function testTicketPoliciesInMigration() {
  console.log("\nPolitike u migraciji — matrica dozvola za `ticket_*`:");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = "supabase/migrations/20260825120000_tiketi.sql";

  let sql = "";
  try {
    sql = await readFile(join(root, file), "utf8");
  } catch {
    check(`${file} → postoji`, false, "migracija nije pronađena");
    return;
  }

  for (const table of TICKET_TABLES) {
    check(
      `${table} → RLS uključen`,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(sql),
    );
  }

  // Konfiguracija board-a: čitaju admin+manager, piše SAMO admin.
  for (const table of ["ticket_columns", "ticket_priorities", "ticket_tags"]) {
    check(
      `${table} → write politika je admin-only`,
      new RegExp(
        `create policy "${table}_admin_write"[\\s\\S]*?current_app_role\\(\\) = 'admin'`,
      ).test(sql),
    );
  }

  // Tiketi i sadržaj: Menadžer je ravnopravan Adminu.
  for (const table of [
    "tickets",
    "ticket_assignees",
    "ticket_tag_links",
    "ticket_checklist_items",
    "ticket_comments",
    "ticket_events",
  ]) {
    check(
      `${table} → politika za admin + manager`,
      new RegExp(`create policy "${table}_staff_all"[\\s\\S]*?in \\('admin', 'manager'\\)`).test(
        sql,
      ),
    );
  }

  // Nijedna ticket politika ne sme da pomene Logistiku.
  const policyBlocks = sql.match(/create policy "ticket[\s\S]*?;/g) ?? [];
  const leaks = policyBlocks.filter((b) => b.includes("logistics"));
  check("nijedna ticket politika ne pominje 'logistics'", leaks.length === 0, `${leaks.length}`);
}

/* Kapije ruta su higijena (RLS je izvor sigurnosti), ali `/tiketi` mora da
   redirektuje Logistiku — statički proveravamo da svaki ulaz zove requireRole. */
async function testRouteGuards() {
  console.log("\nKapije ruta — /tiketi i /ponude propuštaju samo Admina i Menadžera:");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  // Putanje sadrže zagrade i uglaste zagrade — `new URL()` bi ih enkodirao.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    "app/(app)/tiketi/page.tsx",
    "app/(app)/tiketi/[id]/page.tsx",
    "app/(app)/@modal/(.)tiketi/[id]/page.tsx",
    "app/(app)/tiketi/actions.ts",
    "app/(app)/ponude/page.tsx",
    "app/(app)/ponude/[id]/page.tsx",
    "app/(app)/ponude/actions.ts",
  ];

  for (const file of files) {
    let source = "";
    try {
      source = await readFile(join(root, file), "utf8");
    } catch {
      check(`${file} → postoji`, false, "fajl nije pronađen");
      continue;
    }
    const gates = source.match(/requireRole\("admin", "manager"\)/g)?.length ?? 0;
    if (file.endsWith("actions.ts")) {
      // Svaka izvezena server akcija mora imati svoju kapiju.
      const actions = source.match(/^export async function /gm)?.length ?? 0;
      check(
        `${file} → svaka akcija ima requireRole`,
        actions > 0 && gates >= actions,
        `${gates} kapija / ${actions} akcija`,
      );
    } else {
      check(`${file} → requireRole("admin", "manager")`, gates >= 1);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ponude — Logistika ne sme do `offer_*`, a upis je rezervisan za service role.
 * ──────────────────────────────────────────────────────────────────────────── */

async function testOfferPoliciesInMigration() {
  console.log("\nPolitike u migraciji — matrica dozvola za `offer_*`:");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = "supabase/migrations/20260925120000_ponude.sql";

  let sql = "";
  try {
    sql = await readFile(join(root, file), "utf8");
  } catch {
    check(`${file} → postoji`, false, "migracija nije pronađena");
    return;
  }

  for (const table of OFFER_TABLES) {
    check(
      `${table} → RLS uključen`,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(sql),
    );
    check(
      `${table} → select politika za admin + manager`,
      new RegExp(`create policy "${table}_select"[\\s\\S]*?in \\('admin', 'manager'\\)`).test(sql),
    );
  }

  // Nijedna write politika ne sme da postoji — upis je samo service role.
  const writePolicies = (sql.match(/create policy "offer_[\s\S]*?;/g) ?? []).filter(
    (b) => !b.includes("for select"),
  );
  check("nema nijedne write politike na offer_*", writePolicies.length === 0);

  // I nijedna politika ne sme da pomene Logistiku.
  const leaks = (sql.match(/create policy "offer_[\s\S]*?;/g) ?? []).filter((b) =>
    b.includes("logistics"),
  );
  check("nijedna offer politika ne pominje 'logistics'", leaks.length === 0, `${leaks.length}`);
}

async function offerRowCountsAsAdmin() {
  const c = await signIn("admin");
  const counts = {};
  for (const table of OFFER_TABLES) counts[table] = await countRows(c, table);
  await c.auth.signOut();
  return counts;
}

async function testLogisticsOffers(adminCounts) {
  console.log("\nLogistika — ponude MORAJU biti nedostupne (prihod je finansijski podatak):");
  const c = await signIn("logistics");

  for (const table of OFFER_TABLES) {
    const n = await countRows(c, table);
    const adminN = adminCounts[table];
    const note =
      adminN === -1
        ? "Admin dobija grešku — je li migracija push-ovana?"
        : adminN === 0
          ? "napomena: tabela je prazna i za Admina (provera je prazna)"
          : `Admin vidi ${adminN}`;
    check(`${table} → 0 redova`, n === 0, note);
  }

  // Agregacija je security invoker → Logistici vraća 0 redova, ne cifre.
  const stats = await c.rpc("offer_rule_stats", {
    p_from: "2000-01-01T00:00:00Z",
    p_to: "2100-01-01T00:00:00Z",
  });
  check(
    "offer_rule_stats → bez podataka za Logistiku",
    !stats.error ? (stats.data?.length ?? 0) === 0 : true,
    stats.error ? `odbijeno: ${stats.error.message}` : "",
  );

  await c.auth.signOut();
}

async function testStaffOffersReadOnly() {
  console.log("\nMenadžer — čita ponude, ali ih ne piše (sinhronizacija ide service role):");
  const c = await signInOptional("manager");
  if (!c) return;

  check("offer_rules → čitljivo", (await countRows(c, "offer_rules")) >= 0);
  check("offer_events → čitljivo", (await countRows(c, "offer_events")) >= 0);

  await expectInsertDenied(
    c,
    "offer_events",
    { id: -1, created_at: new Date().toISOString(), event: "add", rule_id: TEST_PREFIX, value: 0 },
    "offer_events ← insert odbijen",
  );

  await c.auth.signOut();
}

/**
 * Tri statičke provere — čitaju samo fajlove iz repoa (migracije + rute), nikad
 * bazu. Zato rade i bez kredencijala i pokreću se PRE svake prijave.
 */
async function runStaticChecks() {
  await testTicketPoliciesInMigration();
  await testOfferPoliciesInMigration();
  await testRouteGuards();
}

async function main() {
  if (STATIC_ONLY) {
    console.log("RLS statičke provere — Sportem OS (bez prijave, bez upita na bazu)");
    await runStaticChecks();
    console.log(
      failures === 0
        ? "\n✅ PASS — matrica politika u migracijama i kapije ruta su na mestu.\n"
        : `\n❌ FAIL — ${failures} provera(e) nije prošla.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  if (!URL || !ANON) {
    console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    process.exit(2);
  }
  console.log("RLS test — Sportem OS (Korak 0.5 + T7 Tiketi)");

  // Statičke provere prve — daju rezultat i kad test nalozi nisu podešeni.
  await runStaticChecks();

  await testLogistics();
  await testAdmin();

  const adminTicketCounts = await ticketRowCountsAsAdmin();
  await testLogisticsTickets(adminTicketCounts);
  await testManagerTickets();
  await testAdminTickets();

  const adminOfferCounts = await offerRowCountsAsAdmin();
  await testLogisticsOffers(adminOfferCounts);
  await testStaffOffersReadOnly();

  console.log(
    failures === 0
      ? "\n✅ PASS — RLS skriva finansije i tikete od Logistike; Menadžer ne dira podešavanja.\n"
      : `\n❌ FAIL — ${failures} provera(e) nije prošla.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
