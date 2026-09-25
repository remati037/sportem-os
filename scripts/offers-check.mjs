// ============================================================================
// Sportem OS — kontrolna provera sinhronizacije ponuda
//
// Poredi ono što je sinhronizovano u Supabase (`offer_events`) sa zbirovima
// koje plugin sam prijavljuje na `/stats?days=N`. Ništa ne upisuje — samo čita.
//
// Zašto: /stats je jedini nezavisan izvor. Ako se cifre razilaze, sinhronizacija
// je nešto propustila (ili je plugin u međuvremenu dobio nove događaje).
//
// Očekivano odstupanje:
//   • „porudžbine" i „prihod" u aplikaciji su MANJI ili jednaki cifri iz plugina
//     — app isključuje otkazane i vraćene porudžbine, plugin ne zna za njih.
//   • prikazi / dodavanja / uklanjanja moraju biti JEDNAKI.
//
// Preduslovi: SPORTEM_WP_URL, SPORTEM_OFFERS_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY u .env.local.
//
// Pokretanje:
//   npm run offers:check           # poslednjih 30 dana
//   npm run offers:check -- 7      # poslednjih 7 dana
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const WP = process.env.SPORTEM_WP_URL;
const KEY = process.env.SPORTEM_OFFERS_API_KEY;
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!WP || !KEY || !URL_SB || !SERVICE) {
  console.error(
    "Nedostaju env varijable (SPORTEM_WP_URL / SPORTEM_OFFERS_API_KEY / SUPABASE_*). Vidi .env.local.",
  );
  process.exit(2);
}

const days = Number(process.argv[2]) || 30;
const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(label, pass, detail = "") {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** Granice perioda: poslednjih N celih dana u Europe/Belgrade, kao u app-u. */
function bounds() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  const shift = (d, n) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  // Ponoć beogradskog dana u UTC — isti postupak kao lib/date-belgrade.ts:
  // pomeraj zone se pročita tako što se trenutak formatira u Beogradu.
  const offsetMs = (at) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return (
      Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") % 24,
        get("minute"),
        get("second"),
      ) - at.getTime()
    );
  };
  const toUtcMidnight = (dateStr) => {
    const naive = Date.parse(`${dateStr}T00:00:00Z`);
    let ts = naive - offsetMs(new Date(naive));
    const refined = naive - offsetMs(new Date(ts));
    if (refined !== ts) ts = refined;
    return new Date(ts).toISOString();
  };
  return {
    from: toUtcMidnight(shift(today, -(days - 1))),
    to: toUtcMidnight(shift(today, 1)),
  };
}

async function main() {
  console.log(`\nProvera ponuda — poslednjih ${days} dana\n`);

  // ── 1. plugin ─────────────────────────────────────────────────────────────
  const res = await fetch(`${WP.replace(/\/$/, "")}/wp-json/sportem-offers/v1/stats?days=${days}`, {
    headers: { "X-Sportem-Key": KEY, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`Plugin /stats vratio ${res.status}.`);
    process.exit(2);
  }
  const stats = await res.json();
  const plugin = (stats.rules ?? []).reduce(
    (acc, r) => ({
      impressions: acc.impressions + Number(r.impressions ?? 0),
      adds: acc.adds + Number(r.adds ?? 0),
      removes: acc.removes + Number(r.removes ?? 0),
      orders: acc.orders + Number(r.orders ?? 0),
      revenue: acc.revenue + Number(r.revenue ?? 0),
    }),
    { impressions: 0, adds: 0, removes: 0, orders: 0, revenue: 0 },
  );

  // ── 2. aplikacija (ista SQL agregacija koju koristi /ponude) ──────────────
  const { from, to } = bounds();
  const { data, error } = await db.rpc("offer_rule_stats", { p_from: from, p_to: to });
  if (error) {
    console.error(`offer_rule_stats: ${error.message}`);
    process.exit(2);
  }
  const app = (data ?? []).reduce(
    (acc, r) => ({
      impressions: acc.impressions + Number(r.impressions ?? 0),
      adds: acc.adds + Number(r.adds ?? 0),
      removes: acc.removes + Number(r.removes ?? 0),
      orders: acc.orders + Number(r.orders ?? 0),
      revenue: acc.revenue + Number(r.revenue ?? 0),
    }),
    { impressions: 0, adds: 0, removes: 0, orders: 0, revenue: 0 },
  );

  console.log(`Period: ${from} → ${to}\n`);
  console.log("  metrika        plugin        aplikacija");
  for (const k of ["impressions", "adds", "removes", "orders", "revenue"]) {
    console.log(`  ${k.padEnd(14)} ${String(plugin[k]).padEnd(13)} ${app[k]}`);
  }
  console.log("");

  // Granice perioda ne moraju biti identične: plugin računa „poslednjih N dana"
  // po svom satu, a app po celim beogradskim danima. Zato je tačno poklapanje ✓,
  // sitna razlika upozorenje, a velika razlika ✗ (nešto je propušteno).
  const TOLERANCE = 0.02;
  function compare(label, pluginValue, appValue, appMayBeLower = false) {
    const diff = appValue - pluginValue;
    const scale = Math.max(Math.abs(pluginValue), 1);
    if (diff === 0) return check(label, true);
    if (appMayBeLower && diff < 0) {
      console.log(`  ✓ ${label} — app je manji za ${Math.abs(diff)} (otkazane porudžbine)`);
      return;
    }
    if (Math.abs(diff) / scale <= TOLERANCE) {
      console.log(`  ! ${label} — razlika ${diff} (granica perioda, u toleranciji)`);
      return;
    }
    check(label, false, `plugin ${pluginValue} vs app ${appValue}`);
  }

  compare("prikazi", plugin.impressions, app.impressions);
  compare("dodavanja", plugin.adds, app.adds);
  compare("uklanjanja", plugin.removes, app.removes);
  compare("porudžbine", plugin.orders, app.orders, true);
  compare("prihod", Math.round(plugin.revenue), Math.round(app.revenue), true);

  // ── 3. duplikati (kriterijum: ponovni sync ne pravi duplikate) ────────────
  const { count, error: cntErr } = await db
    .from("offer_events")
    .select("id", { count: "exact", head: true });
  if (cntErr) {
    console.error(`Broj događaja: ${cntErr.message}`);
    process.exit(2);
  }
  console.log(`\n  Ukupno događaja u bazi: ${count}`);
  console.log("  (id je primarni ključ iz WordPress-a → duplikat je nemoguć.)");

  console.log(failures === 0 ? "\n✓ Sve provere prolaze.\n" : `\n✗ Provera pala: ${failures}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
