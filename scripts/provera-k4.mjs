// ============================================================================
// Sportem OS — dokaz za Korak K4 (docs/Sportem-Plan-Optimizacija.md, odluka O4)
//
// Dve provere, obe MORAJU da ispišu 0:
//
//   (A) norm_phone — SQL kopija `normalizePhone` iz `lib/woo.ts` mora da daje
//       IDENTIČAN rezultat na SVIM `orders.ship_phone` i `customers.phone`
//       vrednostima u bazi. Poredi se generisana kolona (`ship_phone_norm` /
//       `phone_norm`) sa pravom TS funkcijom, plus set graničnih slučajeva kroz
//       RPC. Razlika → K6 „rizičan kupac" ne bi bio isti skup → korak se staje.
//
//   (B) order_profit — koliko porudžbina view vraća DRUGAČIJE posle K4.
//       Staro pravilo: `sum(profit_at_sale)` (Postgres `sum` PRESKAČE NULL →
//       [8000, NULL] = 8000, faktura umanjena → docs/backlog.md #5).
//       Novo pravilo: ijedna stavka bez VP → cela porudžbina NULL.
//       Plan je izmerio 0 pogođenih redova. Očekuje se 0.
//
// TS funkcija se NE PREPISUJE u ovaj fajl — čita se i izvršava IZ `lib/woo.ts`
// (ekstrakcija izvora + skidanje TS anotacija sa potpisa). Kopija bi dokazivala
// samo da su dve kopije iste; ovako izmena u `lib/woo.ts` odmah obori proveru.
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete. Jedini `rpc` poziv je
//   `norm_phone` — IMMUTABLE čista funkcija nad stringom, bez pristupa tabelama.
//
// Pokretanje (POSLE `supabase db push`):
//   npm run provera:k4
//   npm run provera:k4 -- --verbose     (ispiši i ekstrahovani TS izvor)
//
// Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ili Admin nalog
//      kroz RLS_TEST_ADMIN_EMAIL / RLS_TEST_ADMIN_PASSWORD u .env.test.local).
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.RLS_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.RLS_TEST_ADMIN_PASSWORD;

const VERBOSE = process.argv.includes("--verbose");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── Dohvat: prepis lib/supabase/paginate.ts (PostgREST seče na 1000) ─────── */

const PAGE_SIZE = 1000;
const IN_CHUNK = 200;

/** `.range()` petlja dok stiže pun blok. Greška BACA (nikad tiho prazno). */
async function selectAll(label, build) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/* ── (A1) normalizePhone iz lib/woo.ts — čita se, ne prepisuje ────────────── */

/**
 * Izvuci izvor `normalizePhone` iz `lib/woo.ts` i napravi pravu JS funkciju.
 * `lib/woo.ts` se ne može direktno importovati (`import "server-only"` baca van
 * React Server Component-a), a `npx tsx` nije zavisnost projekta.
 */
function loadNormalizePhone() {
  const path = join(ROOT, "lib", "woo.ts");
  const src = readFileSync(path, "utf8");

  const start = src.indexOf("export function normalizePhone");
  if (start < 0) {
    throw new Error("lib/woo.ts: `export function normalizePhone` nije nađen (preimenovan?).");
  }

  // Brojanje vitičastih zagrada od prve `{` posle potpisa do zatvaranja tela.
  const bodyStart = src.indexOf("{", start);
  if (bodyStart < 0) throw new Error("lib/woo.ts: telo normalizePhone nije nađeno.");
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("lib/woo.ts: nezatvoreno telo normalizePhone.");

  const tsSrc = src.slice(start, end);
  // Jedine TS anotacije su na potpisu — telo je čist JS.
  const jsSrc = tsSrc.replace(
    /^export\s+function\s+normalizePhone\s*\([^)]*\)\s*:[^{]*\{/,
    "function normalizePhone(raw) {",
  );
  if (jsSrc === tsSrc) {
    throw new Error("lib/woo.ts: potpis normalizePhone se ne poklapa sa očekivanim oblikom.");
  }
  const fn = new Function(`${jsSrc}\nreturn normalizePhone;`)();

  // Kapija: ekstrahovana funkcija mora da se ponaša po ugovoru iz lib/woo.ts.
  // Ako regex iznad jednog dana izvuče pogrešan komad, ovde staje — ne kasnije,
  // kao „0 razlika" nad funkcijom koja ne radi ništa.
  const sanity = [
    ["+381601234567", "0601234567"],
    ["00381601234567", "0601234567"],
    ["abc", null],
    ["", null],
    [null, null],
  ];
  for (const [input, want] of sanity) {
    if (fn(input) !== want) {
      throw new Error(
        `lib/woo.ts: ekstrahovana normalizePhone(${JSON.stringify(input)}) daje ` +
          `${JSON.stringify(fn(input))}, a ugovor je ${JSON.stringify(want)} — ekstrakcija je pogrešna.`,
      );
    }
  }

  return { fn, tsSrc };
}

/* ── (A2) Granični slučajevi (isti set kao samo-provera u migraciji) ──────── */

const EDGE_CASES = [
  "0601234567",
  "+381601234567",
  "00381601234567",
  "381601234567",
  "+381 60 123-4567",
  "(060) 123 4567",
  "060/123-4567",
  "tel: 060 1234567",
  "3811234567",
  "0038112345",
  "",
  "   ",
  "abc",
  "12345",
  "123456",
  "381123",
  "0038160",
  "00381",
  "١٢٣٤٥٦٧٨٩٠",
  "０６０１２３４５６７",
  null,
];

/* ── (B) order_profit: staro vs novo pravilo ──────────────────────────────── */

/** Staro pravilo = Postgres `sum()`: preskače NULL, a grupa sa SAMO NULL → NULL. */
function oldProfit(values) {
  const known = values.filter((v) => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

/** Novo pravilo (K4): IJEDNA NULL stavka → cela porudžbina NULL. */
function newProfit(values) {
  if (values.some((v) => v === null)) return null;
  return values.reduce((a, b) => a + b, 0);
}

/* ── Ispis ───────────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 });
const rsd = (n) => (n === null ? "NULL" : `${nf.format(n)} RSD`);
const pad = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);
const show = (v) => (v === null ? "<null>" : v === "" ? "<prazno>" : JSON.stringify(v));

function header(title) {
  console.log(`\n${"=".repeat(88)}`);
  console.log(title);
  console.log("=".repeat(88));
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  if (!URL_) {
    console.error("Nema NEXT_PUBLIC_SUPABASE_URL — proveri .env.local.");
    process.exit(2);
  }

  let c = null;
  let mode = "";
  if (ANON && ADMIN_EMAIL && ADMIN_PASSWORD) {
    const authed = createClient(URL_, ANON, {
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
    c = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
    mode = "service-role (RLS zaobiđen)";
  } else {
    console.error("Nema ni Admin kredencijala ni SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }

  console.log("=".repeat(88));
  console.log("PROVERA K4 — norm_phone vs normalizePhone  ·  order_profit staro vs novo");
  console.log("=".repeat(88));
  console.log(`  režim: ${mode}`);

  const { fn: normalizePhone, tsSrc } = loadNormalizePhone();
  console.log(`  TS funkcija: pročitana iz lib/woo.ts (${tsSrc.split("\n").length} linija)`);
  if (VERBOSE) console.log(`\n${tsSrc.replace(/^/gm, "    ")}\n`);

  let fail = 0;

  /* ── Preduslov: migracija je primenjena ────────────────────────────────── */
  const probe = await c.from("orders").select("id, ship_phone_norm").limit(1);
  if (probe.error) {
    console.error(
      `\n✗ Kolona orders.ship_phone_norm ne postoji (${probe.error.message}).\n` +
        "  Migracija K4 nije primenjena — pokreni `supabase db push` pa ponovo ovu skriptu.",
    );
    process.exit(2);
  }

  /* ══ (A) norm_phone ═══════════════════════════════════════════════════════ */
  header("(A) norm_phone(text) u bazi  vs  normalizePhone() iz lib/woo.ts");

  // A1 — granični slučajevi kroz RPC (dokazuje samu funkciju, ne samo kolonu).
  let rpcOk = true;
  const edgeBad = [];
  for (const v of EDGE_CASES) {
    const { data, error } = await c.rpc("norm_phone", { p_raw: v });
    if (error) {
      rpcOk = false;
      console.log(
        `  ⚠ RPC norm_phone nije dostupan (${error.message}).\n` +
          "    PostgREST keš šeme se osvežava sa zakašnjenjem posle migracije.\n" +
          "    Granični slučajevi se preskaču — provera nad PRAVIM podacima ispod\n" +
          "    ide kroz generisane kolone i nije zahvaćena.",
      );
      break;
    }
    const expected = normalizePhone(v);
    const got = data ?? null;
    if (got !== expected) edgeBad.push({ v, got, expected });
  }
  if (rpcOk) {
    if (edgeBad.length === 0) {
      console.log(`  granični slučajevi: ${EDGE_CASES.length}/${EDGE_CASES.length} se poklapa ✓`);
    } else {
      fail++;
      console.log(`  ✗ granični slučajevi: ${edgeBad.length} razlika`);
      for (const b of edgeBad) {
        console.log(
          `      ulaz ${pad(show(b.v), 24)} baza ${pad(show(b.got), 16)} TS ${show(b.expected)}`,
        );
      }
    }
  }

  // A2 — SVE vrednosti iz baze, kroz generisane kolone.
  for (const t of [
    { table: "orders", raw: "ship_phone", norm: "ship_phone_norm", label: "orders.ship_phone" },
    { table: "customers", raw: "phone", norm: "phone_norm", label: "customers.phone" },
  ]) {
    const rows = await selectAll(`${t.label}`, () =>
      c.from(t.table).select(`id, ${t.raw}, ${t.norm}`).order("id", { ascending: true }),
    );

    const bad = [];
    let nonNull = 0;
    for (const r of rows) {
      const expected = normalizePhone(r[t.raw]);
      const got = r[t.norm] ?? null;
      if (expected !== null) nonNull++;
      if (got !== expected) bad.push({ raw: r[t.raw], got, expected });
    }

    const distinct = new Set(rows.map((r) => String(r[t.raw]))).size;
    if (bad.length === 0) {
      console.log(
        `  ${pad(t.label, 22)} ${padS(nf.format(rows.length), 6)} redova ` +
          `(${nf.format(distinct)} različitih vrednosti, ${nf.format(nonNull)} normalizovanih) → 0 razlika ✓`,
      );
    } else {
      fail++;
      console.log(`  ✗ ${t.label}: ${bad.length} razlika od ${nf.format(rows.length)} redova`);
      for (const b of bad.slice(0, 20)) {
        console.log(
          `      ulaz ${pad(show(b.raw), 24)} baza ${pad(show(b.got), 16)} TS ${show(b.expected)}`,
        );
      }
      if (bad.length > 20) console.log(`      … i još ${bad.length - 20}`);
    }
  }

  /* ══ (B) order_profit ═════════════════════════════════════════════════════ */
  header("(B) order_profit — koliko porudžbina vraća drugačiju cifru posle K4");

  const items = await selectAll("order_items", () =>
    c.from("order_items").select("id, order_id, profit_at_sale").order("id", { ascending: true }),
  );

  const byOrder = new Map();
  for (const it of items) {
    const list = byOrder.get(it.order_id);
    if (list) list.push(it.profit_at_sale ?? null);
    else byOrder.set(it.order_id, [it.profit_at_sale ?? null]);
  }

  const viewRows = await selectAll("order_profit", () =>
    c.from("order_profit").select("order_id, profit").order("order_id", { ascending: true }),
  );
  const viewMap = new Map(viewRows.map((r) => [r.order_id, r.profit ?? null]));

  const changed = [];
  const viewMismatch = [];
  for (const [orderId, values] of byOrder) {
    const oldV = oldProfit(values);
    const newV = newProfit(values);
    const actual = viewMap.has(orderId) ? viewMap.get(orderId) : undefined;
    if (actual !== newV) viewMismatch.push({ orderId, actual, newV });
    if (oldV !== newV) changed.push({ orderId, oldV, newV });
  }

  console.log(
    `  ${pad("porudžbina sa stavkama", 34)}${padS(nf.format(byOrder.size), 10)}\n` +
      `  ${pad("stavki ukupno", 34)}${padS(nf.format(items.length), 10)}\n` +
      `  ${pad("stavki bez VP (profit_at_sale NULL)", 34)}${padS(
        nf.format(items.filter((i) => i.profit_at_sale === null).length),
        10,
      )}`,
  );

  // Kontrola da je migracija stvarno primenjena: view == novo pravilo.
  if (viewMismatch.length === 0) {
    console.log(`  ${pad("view == novo pravilo", 34)}${padS("da ✓", 10)}`);
  } else {
    fail++;
    console.log(`  ✗ view NE prati novo pravilo na ${viewMismatch.length} porudžbina.`);
    console.log("    (Migracija K4 nije primenjena, ili je view prepisan.)");
    for (const m of viewMismatch.slice(0, 10)) {
      console.log(
        `      ${m.orderId}  view ${pad(rsd(m.actual ?? null), 16)} novo pravilo ${rsd(m.newV)}`,
      );
    }
  }

  if (changed.length === 0) {
    console.log(`  ${pad("PROMENJENIH CIFARA", 34)}${padS("0 ✓", 10)}`);
  } else {
    // Ne uvećava `fail`: > 0 znači da je bug #5 stvarno pogodio podatke i da je
    // ispravka POTREBNA. Ali plan je izmerio 0 → svaka cifra ovde se gleda ručno.
    console.log(`  ⚠ ${pad("PROMENJENIH CIFARA", 32)}${padS(nf.format(changed.length), 10)}`);
    console.log("    Plan je izmerio 0. Pogledaj listu ispod PRE nego što komituješ:");

    // Parčad po IN_CHUNK (dugačak `.in()` URL obori zahtev — v. paginate.ts).
    const ids = changed.map((c2) => c2.orderId);
    const ctxMap = new Map();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const ctx = await selectAll("kontekst promenjenih porudžbina", () =>
        c
          .from("orders")
          .select("id, woo_order_id, ship_name, needs_vp, payout_id, invoice_id")
          .in("id", chunk)
          .order("id", { ascending: true }),
      );
      for (const o of ctx) ctxMap.set(o.id, o);
    }

    console.log(
      `\n    ${pad("porudžbina", 14)}${pad("kupac", 24)}${padS("STARO", 16)}${padS("NOVO", 10)}` +
        `${padS("needs_vp", 10)}${padS("uplata", 9)}${padS("faktura", 9)}`,
    );
    for (const ch of changed.slice(0, 50)) {
      const o = ctxMap.get(ch.orderId);
      console.log(
        `    ${pad(o?.woo_order_id ? `#${o.woo_order_id}` : ch.orderId.slice(0, 12), 14)}` +
          `${pad((o?.ship_name ?? "—").slice(0, 22), 24)}${padS(rsd(ch.oldV), 16)}${padS(rsd(ch.newV), 10)}` +
          `${padS(o?.needs_vp ? "da" : "ne", 10)}${padS(o?.payout_id ? "da" : "ne", 9)}` +
          `${padS(o?.invoice_id ? "da" : "ne", 9)}`,
      );
    }
    if (changed.length > 50) console.log(`    … i još ${changed.length - 50}`);

    const blocking = changed.filter((ch) => {
      const o = ctxMap.get(ch.orderId);
      return o && o.payout_id && !o.invoice_id;
    });
    console.log(
      `\n    Od toga u NEFAKTURISANOJ uplati: ${blocking.length} → ` +
        `toliko uplata ${blocking.length ? "NE MOŽE" : "može"} da se fakturiše ` +
        "dok se VP ne unese (issueInvoice sada tvrdo odbija).",
    );
  }

  /* ── Zaključak ─────────────────────────────────────────────────────────── */
  header("ZAKLJUČAK");
  if (fail === 0 && changed.length === 0) {
    console.log("  ✓ 0 razlika u telefonima, 0 porudžbina sa promenjenim profitom.");
    console.log("    K4 je bezbedan za commit (dalje po planu: rls:test, perf, commit).");
  } else if (fail === 0) {
    console.log(
      `  ⚠ Telefoni su čisti (0 razlika), ali ${changed.length} porudžbina menja profit.\n` +
        "    Plan kaže: STANI i pozovi Marka pre commita.",
    );
    process.exit(1);
  } else {
    console.log(`  ✗ ${fail} provera(e) NIJE prošla — K4 se ne komituje.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nProvera je pala: ${err.message}`);
  process.exit(1);
});
