// ============================================================================
// Sportem OS — kontrolna provera Meta Ads sinhronizacije (plan Reklame, M1)
//
// SAMO ČITA (Supabase + Meta Graph API). Proverava:
//   1. Potrošnja po danu: Σ ad_insights_daily.spend_minor (sve kampanje) ==
//      Meta Insights na nivou NALOGA (level=account) — nezavisan zbir. Danas se
//      preskače (dan je delimičan i Meta ga još puni).
//   2. RSD po danu: svaki dan sa potrošnjom ima kurs i spend_rsd = round(centi × kurs).
//   3. Automatski trošak: za svaki mesec red „meta:YYYY-MM" u expenses ==
//      Σ spend_rsd tog meseca, i najviše jedan takav red po mesecu.
//
// Pokretanje:
//   npm run meta:check           # poslednjih 30 dana (tačka 1)
//   npm run meta:check -- 90
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const GRAPH = "v25.0"; // isto kao GRAPH_API_VERSION u lib/meta/client.ts
const TOKEN = process.env.META_ACCESS_TOKEN;
const RAW_ACCT = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !RAW_ACCT || !URL_SB || !SERVICE) {
  console.error("Nedostaju env varijable (META_* / SUPABASE_*). Vidi .env.local.");
  process.exit(2);
}

const ACCT = RAW_ACCT.startsWith("act_") ? RAW_ACCT : `act_${RAW_ACCT}`;
const days = Number(process.argv[2]) || 30;
const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(label, pass, detail = "") {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const shift = (d, n) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** „12.34" → 1234 (string, bez float-a) — ista pravila kao decimalToMinor. */
function cents(v) {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(String(v ?? "0").trim());
  if (!m) return 0n;
  const frac = ((m[2] ?? "") + "000").slice(0, 3);
  let c = BigInt(m[1] || "0") * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1n;
  return c;
}

async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function metaAccountDaily(since, until) {
  const url = new URL(`https://graph.facebook.com/${GRAPH}/${ACCT}/insights`);
  url.searchParams.set("level", "account");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("fields", "spend");
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", TOKEN);
  const out = new Map();
  let next = url;
  while (next) {
    const res = await fetch(next);
    const body = await res.json();
    if (body.error) throw new Error(`Meta greška kod ${body.error.code}`); // bez URL-a (token)
    for (const r of body.data ?? []) out.set(r.date_start, cents(r.spend));
    next = body.paging?.next ? new URL(body.paging.next) : null;
  }
  return out;
}

const since = shift(today, -days);
const until = shift(today, -1);

console.log(`\n1. Potrošnja po danu ${since} – ${until} (baza vs Meta nivo naloga):`);
const meta = await metaAccountDaily(since, until);
const rows = await selectAll(() =>
  db
    .from("ad_insights_daily")
    .select("date, campaign_id, spend_minor, spend_rsd, fx_rate_micro")
    .gte("date", since)
    .lte("date", until)
    .order("date")
    .order("campaign_id"),
);
const dbDaily = new Map();
for (const r of rows) dbDaily.set(r.date, (dbDaily.get(r.date) ?? 0n) + BigInt(r.spend_minor));
const allDays = [...new Set([...meta.keys(), ...dbDaily.keys()])].sort();
let diffDays = 0;
for (const d of allDays) {
  const a = meta.get(d) ?? 0n;
  const b = dbDaily.get(d) ?? 0n;
  if (a !== b) {
    diffDays++;
    console.log(`    ${d}: Meta ${Number(a) / 100} $ · baza ${Number(b) / 100} $`);
  }
}
const sumMeta = [...meta.values()].reduce((s, v) => s + v, 0n);
const sumDb = [...dbDaily.values()].reduce((s, v) => s + v, 0n);
check(
  `${allDays.length} dana, svaki dan jednak`,
  diffDays === 0,
  `Meta ${Number(sumMeta) / 100} $ · baza ${Number(sumDb) / 100} $`,
);

console.log("\n2. RSD po danu (cela istorija):");
const all = await selectAll(() =>
  db
    .from("ad_insights_daily")
    .select("date, campaign_id, spend_minor, spend_rsd, fx_rate_micro")
    .order("date")
    .order("campaign_id"),
);
const noRate = all.filter((r) => Number(r.spend_minor) > 0 && r.spend_rsd == null);
check("svaki dan sa potrošnjom ima kurs i RSD", noRate.length === 0, `${noRate.length} redova bez kursa`);
const badRsd = all.filter((r) => {
  if (r.spend_rsd == null) return false;
  const denom = 100_000_000n;
  const want = (BigInt(r.spend_minor) * BigInt(r.fx_rate_micro) + denom / 2n) / denom;
  return BigInt(r.spend_rsd) !== want;
});
check("spend_rsd = round(centi × kurs)", badRsd.length === 0, `${badRsd.length} odstupanja`);

console.log("\n3. Automatski mesečni trošak (expenses, source = meta):");
const exp = await selectAll(() =>
  db.from("expenses").select("source_key, amount, date").eq("source", "meta").order("source_key"),
);
const byMonth = new Map();
for (const r of all) {
  if (r.spend_rsd == null) continue;
  const m = r.date.slice(0, 7);
  byMonth.set(m, (byMonth.get(m) ?? 0) + r.spend_rsd);
}
for (const [m, rsd] of [...byMonth].sort()) {
  const hits = exp.filter((e) => e.source_key === `meta:${m}`);
  check(
    `${m}: ${rsd.toLocaleString("sr-RS")} RSD`,
    hits.length === 1 && hits[0].amount === rsd && hits[0].date === `${m}-01`,
    hits.length === 0 ? "nema reda" : hits.length > 1 ? `${hits.length} reda` : `u troškovima ${hits[0].amount.toLocaleString("sr-RS")}`,
  );
}

console.log(failures === 0 ? "\nPASS\n" : `\nFAIL — ${failures} provera nije prošlo\n`);
process.exit(failures === 0 ? 0 : 1);
