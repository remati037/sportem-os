// ============================================================================
// Sportem OS — dokaz za Korak K2 (docs/Sportem-Plan-Optimizacija.md, odluka O4)
//
// Za pet perioda ispisuje STARU (današnju, bug-ovanu) i NOVU vrednost zarade,
// prometa i broja porudžbina jednu pored druge, pa razliku.
//
// „Za ovaj filter" iznad liste porudžbina (`getOrdersSummary` u `db/orders.ts`)
// je do K2 radio dve greške:
//   1. `.range(0, 19999)` — PostgREST tvrdo seče na 1000 redova, pa je zbir
//      video samo deo porudžbina;
//   2. `.in("order_id", [500 UUID])` — predugačak URL obori zahtev
//      (`TypeError: fetch failed`), a greška se NIJE proveravala → `data = null`
//      → zarada i promet 0 RSD, bez poruke i bez Sentry zapisa.
//
// STARA kolona doslovno reprodukuje taj kod (uključujući gutanje greške), NOVA
// ide kroz `lib/supabase/paginate.ts` (paginacija + parčad po 200 + throw).
//
// POSLOVNA PRAVILA SU IDENTIČNA u obe kolone: isti filter po `ordered_at`,
// isto isključivanje statusa „Otkazano"/„Vraćeno" po IMENU, iste ZAMRZNUTE
// cifre iz `order_items` (nikad iz kataloga). Razlika u ciframa je isključivo
// posledica popravke dohvata.
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete.
//
// Pokretanje:
//   npm run provera:k2
//   npm run provera:k2 -- --verbose     (ispiši i redosled upita)
//
// Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ili Admin nalog
//      kroz RLS_TEST_ADMIN_EMAIL / RLS_TEST_ADMIN_PASSWORD u .env.test.local).
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.RLS_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.RLS_TEST_ADMIN_PASSWORD;

const VERBOSE = process.argv.includes("--verbose");

/* ── Konstante prepisane iz app koda (.mjs ne može TS import) ─────────────── */

// lib/woo.ts — statusi se razrešavaju po IMENU, nikad po UUID-u.
const CANCELLED_STATUS_NAMES = ["Otkazano", "Vraćeno"];

// PRE K2: db/orders.ts
const OLD_SUMMARY_SCAN_CAP = 20000;
const OLD_ITEMS_CHUNK = 500;

// POSLE K2: lib/supabase/paginate.ts
const PAGE_SIZE = 1000;
const IN_CHUNK = 200;

const SUMMARY_ORDER_COLS = "id, status_id, ship_phone, customer:customers(phone, email)";
const ITEM_COLS = "quantity, mp_at_sale, profit_at_sale";

/* ── Belgrade datumi (prepis iz lib/date-belgrade.ts) ─────────────────────── */

function belgradeToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Poslednji kalendarski dan meseca (1-based mesec). */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRange(year, month) {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
  };
}

/** Pet perioda iz zahteva K2. */
function buildPeriods() {
  const today = belgradeToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  return [
    { label: `Tekući mesec (${year}-${pad2(month)})`, ...monthRange(year, month) },
    { label: `Prošli mesec (${prevYear}-${pad2(prevMonth)})`, ...monthRange(prevYear, prevMonth) },
    { label: `Tekuća godina (${year})`, from: `${year}-01-01`, to: `${year}-12-31` },
    { label: "2026 cela", from: "2026-01-01", to: "2026-12-31" },
    { label: "Sve (bez filtera)", from: undefined, to: undefined },
  ];
}

/* ── Zajedničko: id-jevi statusa Otkazano/Vraćeno (po IMENU) ──────────────── */

async function cancelledStatusIds(c) {
  const { data, error } = await c
    .from("order_statuses")
    .select("id")
    .in("name", CANCELLED_STATUS_NAMES);
  if (error) throw new Error(`order_statuses: ${error.message}`);
  return new Set((data ?? []).map((s) => s.id));
}

/**
 * Filter porudžbina — IDENTIČAN u staroj i novoj verziji (`getOrdersSummary`
 * bez ostalih filtera: samo opseg `ordered_at`, kao kad se lista otvori sa
 * datumskim filterom i ničim drugim).
 */
function applyRange(query, from, to) {
  let q = query;
  if (from) q = q.gte("ordered_at", from);
  if (to) q = q.lte("ordered_at", `${to}T23:59:59.999Z`);
  return q;
}

/* ── STARO: doslovna reprodukcija koda pre K2 ─────────────────────────────── */

async function oldSummary(c, { from, to }, notes) {
  const excluded = await cancelledStatusIds(c);

  // 1) Jedan „široki" range — PostgREST ga tiho odseče na 1000 redova.
  const scan = await applyRange(c.from("orders").select(SUMMARY_ORDER_COLS), from, to).range(
    0,
    OLD_SUMMARY_SCAN_CAP - 1,
  );
  // Greška se NIJE proveravala (`const { data } = …`) — reprodukujemo to.
  const scanned = scan.data ?? [];
  if (scan.error) notes.push(`orders scan: GREŠKA (progutana) — ${scan.error.message}`);
  if (scanned.length === 1000) notes.push("orders scan: TAČNO 1000 redova — tihi cap");

  const ids = scanned.filter((r) => !excluded.has(r.status_id)).map((r) => r.id);

  // 2) `.in()` po 500 UUID → predugačak URL → `fetch failed`, greška progutana.
  let zarada = 0;
  let promet = 0;
  for (let i = 0; i < ids.length; i += OLD_ITEMS_CHUNK) {
    const chunk = ids.slice(i, i + OLD_ITEMS_CHUNK);
    let res;
    try {
      res = await c.from("order_items").select(ITEM_COLS).in("order_id", chunk);
    } catch (err) {
      // `fetch failed` je u app-u izlazio kao odbijeni promise — ista posledica
      // kao progutana PostgREST greška: 0 RSD.
      res = { data: null, error: { message: String(err?.message ?? err) } };
    }
    if (res.error) {
      notes.push(`order_items .in(${chunk.length}): GREŠKA (progutana) — ${res.error.message}`);
    }
    for (const it of res.data ?? []) {
      zarada += it.profit_at_sale ?? 0;
      promet += it.mp_at_sale * it.quantity;
    }
  }

  return { zarada, promet, broj: ids.length, marza: promet > 0 ? zarada / promet : 0 };
}

/* ── NOVO: kroz lib/supabase/paginate.ts (paginacija + parčad 200 + throw) ── */

/** `selectAll()` — `.range()` petlja dok stiže pun blok, greška baca. */
async function selectAll(label, build) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (VERBOSE) console.log(`      ↳ ${label} strana ${offset / PAGE_SIZE + 1}: ${page.length}`);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunked(ids, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function newSummary(c, { from, to }) {
  const excluded = await cancelledStatusIds(c);

  const scanned = await selectAll("orders scan", () =>
    applyRange(c.from("orders").select(SUMMARY_ORDER_COLS), from, to).order("id", {
      ascending: true,
    }),
  );

  const ids = scanned.filter((r) => !excluded.has(r.status_id)).map((r) => r.id);

  let zarada = 0;
  let promet = 0;
  for (const chunk of chunked(ids)) {
    const items = await selectAll("order_items", () =>
      c
        .from("order_items")
        .select(ITEM_COLS)
        .in("order_id", chunk)
        .order("id", { ascending: true }),
    );
    for (const it of items) {
      zarada += it.profit_at_sale ?? 0;
      promet += it.mp_at_sale * it.quantity;
    }
  }

  return { zarada, promet, broj: ids.length, marza: promet > 0 ? zarada / promet : 0 };
}

/* ── Kontrola: Dashboard metrike za isti period (moraju da se poklope) ────── */

/**
 * `db/metrics.ts → computePeriodMetrics`, ali samo do zarade/prometa. Ovo je
 * kontrolna cifra iz plana: „zbir na /porudzbine mora da se poklopi sa
 * Dashboardom za isti period". Dashboard broji SVE statuse u `brojPorudzbina`,
 * a zaradu/promet SAMO nad nekazanim — ovde poredimo zaradu i promet.
 *
 * Razlika prema zbiru liste je NAMERNA i poznata: Dashboard sužava period po
 * BELGRADE kalendarskom danu (`rangeToUtcPrefilter` + `belgradeDate`), a lista
 * porudžbina koristi `T23:59:59.999Z` (UTC granica — `docs/backlog.md` #10,
 * nije predmet K2).
 */
async function dashboardControl(c, { from, to }) {
  if (!from || !to) return null;
  const excluded = await cancelledStatusIds(c);

  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  const gteUtc = new Date(fromMs - 86_400_000).toISOString();
  const ltUtc = new Date(toMs + 2 * 86_400_000).toISOString();

  const rows = await selectAll("metrike orders", () =>
    c
      .from("orders")
      .select("id, ordered_at, status_id")
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  const belgrade = (iso) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));

  const inRange = rows.filter((o) => {
    const d = belgrade(o.ordered_at);
    return d >= from && d <= to;
  });
  const realized = inRange.filter((o) => !excluded.has(o.status_id));

  let zarada = 0;
  let promet = 0;
  for (const chunk of chunked(realized.map((o) => o.id))) {
    const items = await selectAll("metrike order_items", () =>
      c
        .from("order_items")
        .select(ITEM_COLS)
        .in("order_id", chunk)
        .order("id", { ascending: true }),
    );
    for (const it of items) {
      zarada += it.profit_at_sale ?? 0;
      promet += it.mp_at_sale * it.quantity;
    }
  }

  return { zarada, promet, broj: inRange.length, realizovanih: realized.length };
}

/* ── Ispis ───────────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 });
const rsd = (n) => `${nf.format(n)} RSD`;
const pad = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);

function diffLabel(oldV, newV) {
  const d = newV - oldV;
  if (d === 0) return "—";
  return `${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))}`;
}

function printPeriod(label, oldRes, newRes, control, notes) {
  console.log(`\n${label}`);
  console.log("─".repeat(88));
  console.log(
    `  ${pad("cifra", 22)}${padS("STARO (danas)", 20)}${padS("NOVO (posle K2)", 20)}${padS("razlika", 20)}`,
  );
  const line = (name, o, n, fmt = rsd) =>
    console.log(
      `  ${pad(name, 22)}${padS(fmt(o), 20)}${padS(fmt(n), 20)}${padS(diffLabel(o, n), 20)}`,
    );

  line("Zarada", oldRes.zarada, newRes.zarada);
  line("Promet", oldRes.promet, newRes.promet);
  line("Broj porudžbina", oldRes.broj, newRes.broj, (v) => nf.format(v));
  line("Marža", oldRes.marza, newRes.marza, (v) => `${(v * 100).toFixed(1).replace(".", ",")} %`);

  if (control) {
    const poklapa = control.zarada === newRes.zarada && control.promet === newRes.promet;
    console.log(
      `  ${pad("kontrola: Dashboard", 22)}${padS(rsd(control.zarada), 20)}${padS(
        poklapa ? "poklapa se ✓" : "razlika (v. napomenu)",
        20,
      )}${padS(diffLabel(control.zarada, newRes.zarada), 20)}`,
    );
  }

  for (const n of notes) console.log(`  ⚠ STARO → ${n}`);
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  if (!URL) {
    console.error("Nema NEXT_PUBLIC_SUPABASE_URL — proveri .env.local.");
    process.exit(2);
  }

  let c = null;
  let mode = "";

  if (ANON && ADMIN_EMAIL && ADMIN_PASSWORD) {
    const authed = createClient(URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await authed.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    if (error) {
      console.error(`Prijava Admina nije uspela: ${error.message}`);
      process.exit(2);
    }
    c = authed;
    mode = "Admin kroz anon ključ (RLS aktivan)";
  } else if (SERVICE) {
    c = createClient(URL, SERVICE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    mode = "service-role (RLS zaobiđen)";
  } else {
    console.error("Nema ni Admin kredencijala ni SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }

  console.log("=".repeat(88));
  console.log("PROVERA K2 — „Za ovaj filter“ iznad liste porudžbina: staro vs novo");
  console.log("=".repeat(88));
  console.log(`  režim: ${mode}`);
  console.log(`  danas (Belgrade): ${belgradeToday()}`);
  console.log(
    "  STARO = kod pre K2 (range 0..19999 + .in po 500, greška progutana)\n" +
      "  NOVO  = lib/supabase/paginate.ts (paginacija po 1000 + .in po 200, greška baca)\n" +
      "  Poslovna pravila su ISTA u obe kolone (isti filter, isti statusi po imenu,\n" +
      "  iste zamrznute cifre iz order_items).",
  );

  const periods = buildPeriods();
  const summary = [];

  for (const period of periods) {
    const notes = [];
    const oldRes = await oldSummary(c, period, notes);
    const newRes = await newSummary(c, period);
    const control = await dashboardControl(c, period);
    printPeriod(period.label, oldRes, newRes, control, notes);
    summary.push({ label: period.label, oldRes, newRes });
  }

  console.log(`\n${"=".repeat(88)}`);
  console.log("ZBIRNO — zarada po periodu");
  console.log("=".repeat(88));
  console.log(
    `  ${pad("period", 30)}${padS("STARO", 18)}${padS("NOVO", 18)}${padS("razlika", 18)}`,
  );
  for (const r of summary) {
    console.log(
      `  ${pad(r.label, 30)}${padS(rsd(r.oldRes.zarada), 18)}${padS(rsd(r.newRes.zarada), 18)}${padS(
        diffLabel(r.oldRes.zarada, r.newRes.zarada),
        18,
      )}`,
    );
  }

  console.log("\nNapomena: „Tekuća godina“ i „2026 cela“ se poklapaju dok je tekuća godina 2026.");
  console.log(
    "Napomena: kontrolna cifra Dashboarda sme da odstupa na granici perioda — lista\n" +
      "porudžbina reže po UTC-u (`T23:59:59.999Z`), Dashboard po Belgrade danu\n" +
      "(docs/backlog.md #10). To pravilo K2 NE menja.",
  );
}

main().catch((err) => {
  console.error(`\nProvera je pala: ${err.message}`);
  process.exit(1);
});
