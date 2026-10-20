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
//   • AI Asistent (A6): istorija je LIČNA — Logistika ne vidi i ne piše
//     `ai_*`, Menadžer ne vidi i ne dira Adminov razgovor, poruke se posle
//     upisa ne menjaju (nema update/delete politike)
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
// statičke provere (politike u migracijama tiketa i ponuda, RLS `initplan`
// omotač iz K3, kapije ruta) i izađi PRE ijedne prijave. Tako postoji kapija za politike i bez test naloga —
// Menadžer i Logistika trenutno ne postoje. Bez zastavice je ponašanje nedirano.
//
// Potrebne env varijable (pored NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY):
//   RLS_TEST_ADMIN_EMAIL, RLS_TEST_ADMIN_PASSWORD
//   RLS_TEST_LOGISTICS_EMAIL, RLS_TEST_LOGISTICS_PASSWORD
//   RLS_TEST_MANAGER_EMAIL, RLS_TEST_MANAGER_PASSWORD   (opciono — bez njih se
//     Menadžer deo preskače uz upozorenje, ostatak testa i dalje važi)
//
// NAPOMENA: AI deo pravi jedan razgovor „__rls-test" sa jednom porukom kao
// Admin i briše ga na kraju (poruke idu kaskadno).
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
  console.log(
    "\nKapije ruta — /tiketi, /ponude, /asistent i /kupci propuštaju samo Admina i Menadžera:",
  );
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
    "app/(app)/ponude/paketi/page.tsx",
    "app/(app)/ponude/paketi/[id]/page.tsx",
    "app/(app)/asistent/page.tsx",
    "app/(app)/asistent/[id]/page.tsx",
    "app/(app)/asistent/actions.ts",
    "app/(app)/kupci/page.tsx",
    "app/(app)/kupci/[id]/page.tsx",
    "app/(app)/kupci/actions.ts",
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

  // API ruta asistenta vraća JSON 403 umesto redirecta → kapija je getAiSession,
  // a spisak rola u njoj mora biti tačno admin + manager.
  const route = await readFile(join(root, "app/api/asistent/chat/route.ts"), "utf8").catch(
    () => "",
  );
  const access = await readFile(join(root, "lib/ai/access.ts"), "utf8").catch(() => "");
  check(
    "app/api/asistent/chat/route.ts → getAiSession() pre svega",
    /export async function POST[\s\S]*?const session = await getAiSession\(\);\s*if \(!session\)/.test(
      route,
    ),
  );
  check(
    'lib/ai/access.ts → AI_ROLES = ["admin", "manager"]',
    /AI_ROLES: Role\[\] = \["admin", "manager"\];/.test(access),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * RLS `initplan` (Korak K3) — svaki poziv u politici mora biti u `(select …)`.
 *
 * Bez omotača Postgres izvršava `current_app_role()` / `auth.uid()` PO REDU;
 * sa omotačem jednom po upitu. Migracija 20260926100000_rls_initplan.sql je to
 * sredila za sve politike koje su postojale tada. Ova provera pazi da se
 * regresija ne vrati kroz kod:
 *   • svaka politika iz migracija PRE K3 koja zove funkciju nezaomotano mora
 *     biti nabrojana u `alter policy` unutar K3 migracije;
 *   • u migracijama POSLE K3 nijedan poziv ne sme biti nezaomotan.
 * ──────────────────────────────────────────────────────────────────────────── */

const K3_MIGRATION = "20260926100000_rls_initplan.sql";

/** Ukloni SQL linijske komentare — UNDO blok u K3 migraciji je zakomentarisan. */
function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Sve `create policy` / `alter policy` naredbe iz fajla, bez komentara. */
function policyStatements(sql) {
  return stripSqlComments(sql).match(/\b(?:create|alter)\s+policy\s+"[^"]+"[\s\S]*?;/gi) ?? [];
}

/** Ime politike iz naredbe. */
function policyName(statement) {
  return statement.match(/policy\s+"([^"]+)"/i)?.[1] ?? "?";
}

/**
 * Pozivi koji NISU u `(select …)`. Omotane pojave se prvo zamene sentinelom,
 * pa se gleda šta je ostalo — isti obrazac koji koristi i DO blok migracije.
 */
function unwrappedCalls(statement) {
  const rest = statement
    .replace(/\(\s*select\s+(?:[a-z_][a-z0-9_]*\.)?current_app_role\s*\(\)\s*\)/gi, "<<OMOTANO>>")
    .replace(/\(\s*select\s+auth\.uid\s*\(\)\s*\)/gi, "<<OMOTANO>>");
  return [
    ...(rest.match(/(?:[a-z_][a-z0-9_]*\.)?current_app_role\s*\(\)/gi) ?? []),
    ...(rest.match(/auth\.uid\s*\(\)/gi) ?? []),
  ];
}

async function testRlsInitplanInMigrations() {
  console.log("\nRLS initplan — nijedan `current_app_role()` bez `(select …)`:");
  const { readdir, readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "supabase", "migrations");

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    check("supabase/migrations → čitljiv", false, "folder nije pronađen");
    return;
  }

  if (!files.includes(K3_MIGRATION)) {
    check(`${K3_MIGRATION} → postoji`, false, "migracija K3 nedostaje");
    return;
  }

  const sources = new Map();
  for (const f of files) sources.set(f, await readFile(join(dir, f), "utf8"));

  // (1) K3 migracija pokriva svaku staru politiku koja zove nezaomotano.
  const k3Altered = new Set(
    policyStatements(sources.get(K3_MIGRATION))
      .filter((s) => /^alter/i.test(s.trim()))
      .map(policyName),
  );
  const nepokrivene = [];
  for (const f of files.filter((f) => f < K3_MIGRATION)) {
    for (const stmt of policyStatements(sources.get(f))) {
      if (unwrappedCalls(stmt).length > 0 && !k3Altered.has(policyName(stmt))) {
        nepokrivene.push(`${policyName(stmt)} (${f})`);
      }
    }
  }
  check(
    `${K3_MIGRATION} → zaomotava svaku stariju politiku`,
    nepokrivene.length === 0,
    nepokrivene.length ? `nepokriveno: ${nepokrivene.join(", ")}` : `${k3Altered.size} politika`,
  );

  // (2) K3 i sve posle njega: nijedan nezaomotan poziv.
  for (const f of files.filter((f) => f >= K3_MIGRATION)) {
    const greske = [];
    for (const stmt of policyStatements(sources.get(f))) {
      const calls = unwrappedCalls(stmt);
      if (calls.length > 0) greske.push(`"${policyName(stmt)}" → ${calls.join(", ")}`);
    }
    check(`${f} → svi pozivi u politikama su omotani`, greske.length === 0, greske.join("; "));
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

/* ────────────────────────────────────────────────────────────────────────────
 * AI Asistent — istorija je lična i samo za Admina/Menadžera; Logistika nema
 * nijednu politiku, a poruke se posle upisa ne menjaju.
 * ──────────────────────────────────────────────────────────────────────────── */

async function testAiPoliciesInMigration() {
  console.log("\nPolitike u migraciji — matrica dozvola za `ai_*`:");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = "supabase/migrations/20261018120000_ai_asistent.sql";

  let sql = "";
  try {
    sql = await readFile(join(root, file), "utf8");
  } catch {
    check(`${file} → postoji`, false, "migracija nije pronađena");
    return;
  }

  const policies = sql.match(/create policy "ai_[\s\S]*?;/g) ?? [];
  for (const table of ["ai_conversations", "ai_messages"]) {
    check(
      `${table} → RLS uključen`,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(sql),
    );
    const own = policies.filter((b) => b.includes(`on public.${table}`));
    check(
      `${table} → svaka politika traži vlasnika i admin/manager`,
      own.length > 0 &&
        own.every(
          (b) => b.includes("(select auth.uid())") && b.includes("in ('admin', 'manager')"),
        ),
      `${own.length} politika`,
    );
  }

  check(
    "nijedna ai politika ne pominje 'logistics'",
    policies.every((b) => !b.includes("logistics")),
  );
  check(
    "ai_messages nema update/delete politiku (poruke su append-only)",
    policies
      .filter((b) => b.includes("on public.ai_messages"))
      .every((b) => /for (select|insert)/.test(b)),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * AI Asistent (A6) — istorija je lična i samo za Admina/Menadžera.
 * ──────────────────────────────────────────────────────────────────────────── */

const AI_TABLES = ["ai_conversations", "ai_messages"];

async function userIdOf(client) {
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

/** Admin pravi svoj razgovor + poruku; vraća {client, convId} za kasnije provere i čišćenje. */
async function testAdminAi() {
  console.log("\nAdmin — sopstveni AI razgovor: piše, čita, ali poruke ne menja:");
  const c = await signIn("admin");
  const me = await userIdOf(c);

  const conv = await c
    .from("ai_conversations")
    .insert({ user_id: me, title: TEST_PREFIX, model: "claude-haiku-5-5" })
    .select("id")
    .single();
  check("ai_conversations ← insert sopstvenog razgovora", !conv.error, conv.error?.message ?? "");
  const convId = conv.data?.id ?? null;
  if (!convId) return { client: c, convId: null };

  const msg = await c
    .from("ai_messages")
    .insert({
      conversation_id: convId,
      role: "user",
      content: [{ type: "text", text: TEST_PREFIX }],
    })
    .select("id")
    .single();
  check("ai_messages ← insert u sopstveni razgovor", !msg.error, msg.error?.message ?? "");

  const read = await c.from("ai_messages").select("id").eq("conversation_id", convId);
  check("ai_messages → čita sopstvenu poruku", (read.data?.length ?? 0) === 1);

  if (msg.data?.id) {
    await expectUpdateNoRows(
      c,
      "ai_messages",
      msg.data.id,
      { content: [{ type: "text", text: "izmenjeno" }] },
      "ai_messages → update ne menja nijedan red (append-only)",
    );
    const del = await c.from("ai_messages").delete().eq("id", msg.data.id).select("id");
    check(
      "ai_messages → delete ne briše nijedan red (briše se samo kaskadno)",
      !!del.error || (del.data?.length ?? 0) === 0,
      del.error ? `odbijeno (${del.error.code ?? "greška"})` : `obrisano: ${del.data?.length ?? 0}`,
    );
  }

  await expectInsertDenied(
    c,
    "ai_conversations",
    { user_id: "00000000-0000-0000-0000-000000000000", title: TEST_PREFIX, model: "x" },
    "ai_conversations ← insert na TUĐE ime odbijen",
  );

  return { client: c, convId };
}

async function testLogisticsAi() {
  console.log("\nLogistika — AI asistent MORA biti nedostupan (vidi zaradu):");
  const c = await signIn("logistics");
  for (const table of AI_TABLES) check(`${table} → 0 redova`, (await countRows(c, table)) === 0);
  await expectInsertDenied(
    c,
    "ai_conversations",
    { user_id: await userIdOf(c), title: TEST_PREFIX, model: "x" },
    "ai_conversations ← insert sopstvenog razgovora odbijen",
  );
  await c.auth.signOut();
}

async function testManagerAi(adminConvId) {
  console.log("\nMenadžer — ne vidi i ne dira Adminov razgovor (istorija je lična):");
  const c = await signInOptional("manager");
  if (!c) return;
  if (!adminConvId) {
    console.log("  ⚠ preskočeno — Adminov test razgovor nije napravljen");
    await c.auth.signOut();
    return;
  }

  const seen = await c.from("ai_conversations").select("id").eq("id", adminConvId);
  check("ai_conversations → Adminov razgovor nevidljiv", (seen.data?.length ?? 0) === 0);
  const msgs = await c.from("ai_messages").select("id").eq("conversation_id", adminConvId);
  check("ai_messages → Adminove poruke nevidljive", (msgs.data?.length ?? 0) === 0);
  await expectInsertDenied(
    c,
    "ai_messages",
    { conversation_id: adminConvId, role: "user", content: [{ type: "text", text: TEST_PREFIX }] },
    "ai_messages ← upis u Adminov razgovor odbijen",
  );
  await expectUpdateNoRows(
    c,
    "ai_conversations",
    adminConvId,
    { title: "preuzeto" },
    "ai_conversations → preimenovanje Adminovog razgovora ne menja red",
  );
  const del = await c.from("ai_conversations").delete().eq("id", adminConvId).select("id");
  check(
    "ai_conversations → brisanje Adminovog razgovora ne briše red",
    !!del.error || (del.data?.length ?? 0) === 0,
  );
  await c.auth.signOut();
}

async function cleanupAdminAi({ client, convId }) {
  if (convId) {
    const del = await client.from("ai_conversations").delete().eq("id", convId).select("id");
    check(
      "čišćenje — Adminov test razgovor obrisan (poruke kaskadno)",
      (del.data?.length ?? 0) === 1,
    );
  }
  await client.auth.signOut();
}

/**
 * Statičke provere — čitaju samo fajlove iz repoa (migracije + rute), nikad
 * bazu. Zato rade i bez kredencijala i pokreću se PRE svake prijave.
 */
/* ────────────────────────────────────────────────────────────────────────────
 * Kupci (C3) — beleške i oznake: samo Admin/Menadžer, belešku menja samo autor.
 * ──────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * Kupci (C5) — beleške/oznake: samo Admin i Menadžer, belešku menja samo autor.
 * Test piše pod ključem `p:__rls-test` i sve briše na kraju.
 * ──────────────────────────────────────────────────────────────────────────── */

const CUSTOMER_TABLES = ["customer_notes", "customer_flags"];
const TEST_CUSTOMER_KEY = `p:${TEST_PREFIX}`;

/** Admin upisuje belešku + oznaku; vraća {client, noteId} za kasnije provere i čišćenje. */
async function testAdminCustomers() {
  console.log("\nAdmin — beleška i oznaka kupca: piše i čita:");
  const c = await signIn("admin");
  const me = await userIdOf(c);
  const note = await c
    .from("customer_notes")
    .insert({ customer_key: TEST_CUSTOMER_KEY, body: TEST_PREFIX, created_by: me })
    .select("id")
    .single();
  check("customer_notes ← insert sopstvene beleške", !note.error, note.error?.message ?? "");
  const flag = await c
    .from("customer_flags")
    .insert({ customer_key: TEST_CUSTOMER_KEY, flag: "zvati", created_by: me });
  check("customer_flags ← insert oznake", !flag.error, flag.error?.message ?? "");
  await expectInsertDenied(
    c,
    "customer_notes",
    { customer_key: TEST_CUSTOMER_KEY, body: TEST_PREFIX, created_by: null },
    "customer_notes ← beleška bez autora (tuđe ime) odbijena",
  );
  return { client: c, noteId: note.data?.id ?? null };
}

async function testLogisticsCustomers() {
  console.log("\nLogistika — beleške i oznake kupaca MORAJU biti nedostupne:");
  const c = await signIn("logistics");
  for (const table of CUSTOMER_TABLES) {
    check(`${table} → 0 redova`, (await countRows(c, table)) === 0);
  }
  await expectInsertDenied(
    c,
    "customer_notes",
    { customer_key: TEST_CUSTOMER_KEY, body: TEST_PREFIX, created_by: await userIdOf(c) },
    "customer_notes ← insert odbijen",
  );
  const flag = await c
    .from("customer_flags")
    .insert({ customer_key: `${TEST_CUSTOMER_KEY}-log`, flag: "stalni" });
  check("customer_flags ← insert odbijen", !!flag.error, flag.error?.code ?? "upis PROŠAO");
  if (!flag.error)
    await c.from("customer_flags").delete().eq("customer_key", `${TEST_CUSTOMER_KEY}-log`);
  await c.auth.signOut();
}

async function testManagerCustomers(adminNoteId) {
  console.log("\nMenadžer — čita i piše svoje, ali ne menja Adminovu belešku:");
  const c = await signInOptional("manager");
  if (!c) return;
  const me = await userIdOf(c);

  const seen = await c.from("customer_notes").select("id").eq("customer_key", TEST_CUSTOMER_KEY);
  check("customer_notes → vidi Adminovu belešku", (seen.data?.length ?? 0) >= 1);
  if (adminNoteId) {
    await expectUpdateNoRows(
      c,
      "customer_notes",
      adminNoteId,
      { body: "preuzeto" },
      "customer_notes → izmena Adminove beleške ne menja red",
    );
    const del = await c.from("customer_notes").delete().eq("id", adminNoteId).select("id");
    check(
      "customer_notes → brisanje Adminove beleške ne briše red",
      !!del.error || (del.data?.length ?? 0) === 0,
    );
  }
  const own = await c
    .from("customer_notes")
    .insert({ customer_key: TEST_CUSTOMER_KEY, body: TEST_PREFIX, created_by: me })
    .select("id")
    .single();
  check("customer_notes ← insert sopstvene beleške", !own.error, own.error?.message ?? "");
  if (own.data?.id) {
    const upd = await c
      .from("customer_notes")
      .update({ body: `${TEST_PREFIX} izmena` })
      .eq("id", own.data.id)
      .select("id");
    check("customer_notes → menja sopstvenu belešku", (upd.data?.length ?? 0) === 1);
    const del = await c.from("customer_notes").delete().eq("id", own.data.id).select("id");
    check("customer_notes → briše sopstvenu belešku", (del.data?.length ?? 0) === 1);
  }
  const flag = await c
    .from("customer_flags")
    .insert({ customer_key: TEST_CUSTOMER_KEY, flag: "stalni", created_by: me });
  check("customer_flags ← Menadžer postavlja oznaku", !flag.error, flag.error?.message ?? "");
  await c.auth.signOut();
}

async function cleanupAdminCustomers({ client }) {
  await client.from("customer_notes").delete().eq("customer_key", TEST_CUSTOMER_KEY);
  await client.from("customer_flags").delete().eq("customer_key", TEST_CUSTOMER_KEY);
  const left = await client
    .from("customer_notes")
    .select("id")
    .eq("customer_key", TEST_CUSTOMER_KEY);
  check("čišćenje → test beleške obrisane", (left.data?.length ?? 0) === 0);
  await client.auth.signOut();
}

async function testCustomerPoliciesInMigration() {
  console.log("\nPolitike u migraciji — matrica dozvola za `customer_notes` / `customer_flags`:");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = "supabase/migrations/20261019120000_kupci_beleske.sql";

  let sql = "";
  try {
    sql = await readFile(join(root, file), "utf8");
  } catch {
    check(`${file} → postoji`, false, "migracija nije pronađena");
    return;
  }

  const policies = sql.match(/create policy "customer_[\s\S]*?;/g) ?? [];
  for (const table of ["customer_notes", "customer_flags"]) {
    check(
      `${table} → RLS uključen`,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(sql),
    );
    const own = policies.filter((b) => b.includes(`on public.${table}`));
    check(
      `${table} → svaka politika traži admin/manager`,
      own.length > 0 &&
        own.every((b) => b.includes("(select public.current_app_role()) in ('admin', 'manager')")),
      `${own.length} politika`,
    );
  }
  check(
    "nijedna customer_* politika ne pominje 'logistics'",
    policies.every((b) => !b.includes("logistics")),
  );
  const authorOnly = policies.filter(
    (b) => b.includes("on public.customer_notes") && /for (update|delete)/.test(b),
  );
  check(
    "customer_notes → izmenu i brisanje sme samo autor (created_by = auth.uid())",
    authorOnly.length === 2 &&
      authorOnly.every((b) => b.includes("created_by = (select auth.uid())")),
    `${authorOnly.length} politika`,
  );
  check(
    "customer_notes → nema `for all` politike (zaobišla bi pravilo autora)",
    !policies.some((b) => b.includes("on public.customer_notes") && /for all/.test(b)),
  );
}

async function runStaticChecks() {
  await testTicketPoliciesInMigration();
  await testOfferPoliciesInMigration();
  await testAiPoliciesInMigration();
  await testCustomerPoliciesInMigration();
  await testRlsInitplanInMigrations();
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
  console.log("RLS test — Sportem OS (Korak 0.5 + T7 Tiketi + A6 Asistent + C5 Kupci)");

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

  const adminAi = await testAdminAi();
  await testLogisticsAi();
  await testManagerAi(adminAi.convId);
  await cleanupAdminAi(adminAi);

  const adminCustomers = await testAdminCustomers();
  await testLogisticsCustomers();
  await testManagerCustomers(adminCustomers.noteId);
  await cleanupAdminCustomers(adminCustomers);

  console.log(
    failures === 0
      ? "\n✅ PASS — RLS skriva finansije, tikete, AI i beleške kupaca od Logistike; Menadžer ne dira podešavanja, tuđe razgovore ni tuđe beleške.\n"
      : `\n❌ FAIL — ${failures} provera(e) nije prošla.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
