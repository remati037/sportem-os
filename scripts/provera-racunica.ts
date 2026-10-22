// ============================================================================
// Sportem OS — provera Računice (P1, `npm run provera:racunica`)
//
// Pokreće STVARNI `getRacunica` (db/racunica.ts) nad bazom i poredi ga sa
// NEZAVISNIM računom po pravilima Dashboarda (db/metrics.ts
// computePeriodMetrics): `ordered_at` u celim beogradskim danima,
// Otkazano/Vraćeno po IMENU, promet/zarada iz zamrznutih `order_items`.
// Za 5 perioda tvrdi: Σ zarade i prometa svih redova (uklj. „Van kataloga")
// = referenca, 0 RSD razlike; svaki SKU je u tačno jednom redu.
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete.
//
// Pokretanje: npm run provera:racunica  (traži NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { belgradeDate, todayBelgrade } from "@/lib/date-belgrade";
import { RANGE_PRESETS, rangePresetBounds } from "@/lib/period";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";
import { getRacunica } from "@/db/racunica";
import { classifyAbc, deadStock, shiftDay } from "@/lib/racunica";
import { projectMonth } from "@/lib/sales-velocity";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const supabase = createClient(URL, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const fmt = (n: number) => new Intl.NumberFormat("sr-RS").format(n);

// ── Nezavisan račun (kopija pravila iz db/metrics.ts, bez deljenog koda) ────
async function all<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(JSON.stringify(error));
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function reference(sb: SupabaseClient, from: string, to: string) {
  const { data: st, error } = await sb.from("order_statuses").select("id, name");
  if (error) throw new Error(error.message);
  const cancelIds = new Set(
    (st ?? []).filter((s) => CANCELLED_STATUS_NAMES.includes(s.name)).map((s) => s.id),
  );
  const fromMs = new Date(`${from}T00:00:00Z`).getTime() - 86_400_000;
  const toMs = new Date(`${to}T00:00:00Z`).getTime() + 2 * 86_400_000;
  const orders = (
    await all<{ id: string; ordered_at: string; status_id: string }>((a, b) =>
      sb
        .from("orders")
        .select("id, ordered_at, status_id")
        .not("ordered_at", "is", null)
        .gte("ordered_at", new Date(fromMs).toISOString())
        .lt("ordered_at", new Date(toMs).toISOString())
        .order("id")
        .range(a, b),
    )
  ).filter((o) => {
    const d = belgradeDate(o.ordered_at);
    return d >= from && d <= to;
  });
  const realized = orders.filter((o) => !cancelIds.has(o.status_id));
  let promet = 0;
  let zarada = 0;
  let komada = 0;
  const ids = realized.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const items = await all<{ quantity: number; mp_at_sale: number; profit_at_sale: number | null }>(
      (a, b) =>
        sb
          .from("order_items")
          .select("quantity, mp_at_sale, profit_at_sale")
          .in("order_id", chunk)
          .order("id")
          .range(a, b),
    );
    for (const it of items) {
      promet += it.mp_at_sale * it.quantity;
      zarada += it.profit_at_sale ?? 0;
      komada += it.quantity;
    }
  }
  return { promet, zarada, komada };
}

async function main() {
  const today = todayBelgrade();
  console.log(`Računica vs Dashboard pravila (danas ${today})`);

  for (const { key, label } of RANGE_PRESETS) {
    const { from, to } = rangePresetBounds(key, today);
    console.log(`\n${label} (${from} – ${to})`);
    const [data, ref] = await Promise.all([getRacunica({ from, to }, supabase), reference(supabase, from, to)]);

    let zarada = 0;
    let promet = 0;
    let komada = 0;
    const seen = new Map<string, number>();
    for (const r of data.rows) {
      zarada += r.stats.profit;
      promet += r.stats.revenue;
      komada += r.stats.qty;
      for (const v of r.variants) seen.set(v.sku, (seen.get(v.sku) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
    const out = data.rows.find((r) => r.outOfCatalog);

    check("zarada = referenca", zarada === ref.zarada, `${fmt(zarada)} vs ${fmt(ref.zarada)} RSD`);
    check("promet = referenca", promet === ref.promet, `${fmt(promet)} vs ${fmt(ref.promet)} RSD`);
    check("komadi = referenca", komada === ref.komada, `${fmt(komada)} vs ${fmt(ref.komada)}`);
    check("zbir kartica = zbir redova", data.totals.profit === zarada && data.totals.revenue === promet);
    check("svaki SKU u tačno jednom redu", dupes.length === 0, dupes.slice(0, 5).join(", "));
    // P2: ABC — svaki red ima klasu, A+B+C = ukupna zarada, A nosi ≥ 80 % pozitivne zarade.
    const abc = classifyAbc(data.rows);
    const byClass = { A: 0, B: 0, C: 0 };
    for (const r of data.rows) byClass[abc.get(r.key) ?? "C"] += r.stats.profit;
    const positive = data.rows.reduce((s, r) => s + Math.max(r.stats.profit, 0), 0);
    check("ABC: svaki red ima klasu", data.rows.every((r) => abc.has(r.key)));
    check("ABC: A+B+C = ukupna zarada", byClass.A + byClass.B + byClass.C === zarada);
    check(
      "ABC: A nosi ≥ 80 % pozitivne zarade",
      positive === 0 || byClass.A / positive >= 0.8,
      `A ${fmt(byClass.A)} / B ${fmt(byClass.B)} / C ${fmt(byClass.C)} RSD`,
    );

    console.log(
      `    redova ${fmt(data.rows.length)} · van kataloga ${fmt(out?.variants.length ?? 0)} SKU / ${fmt(out?.stats.profit ?? 0)} RSD · bez VP ${fmt(data.totals.unknownQty)} kom`,
    );
  }

  // P2: mrtva roba ne zavisi od perioda — proverava se jednom, nad „sve".
  {
    const data = await getRacunica({ from: rangePresetBounds("sve", today).from, to: today }, supabase);
    console.log("\nMrtva roba (90 dana)");
    const dead = deadStock(data.rows, today, 90);
    const cutoff = shiftDay(today, -90);
    check(
      "nijedna nema prodaju posle granice",
      dead.every((d) => !d.variant.lastSoldDay || d.variant.lastSoldDay <= cutoff),
    );
    check(
      "sve su popisane, aktivne, stanje > 0",
      dead.every((d) => d.variant.counted && !d.variant.archived && (d.variant.stock ?? 0) > 0),
    );
    console.log(
      `    ${fmt(dead.length)} varijanti · ${fmt(dead.reduce((s, d) => s + d.value, 0))} RSD po VP`,
    );
  }

  // P3: prozori tempa i zarada meseca (od danas, nezavisno od perioda).
  {
    const data = await getRacunica({ from: rangePresetBounds("sve", today).from, to: today }, supabase);
    console.log("\nTempo i mesec (P3)");
    const sum = { q30: 0, qPrev30: 0, q31to90: 0 };
    for (const r of data.rows) {
      sum.q30 += r.vel.q30;
      sum.qPrev30 += r.vel.qPrev30;
      sum.q31to90 += r.vel.q31to90;
    }
    const [r30, rPrev, r31, rMonth, r28] = await Promise.all([
      reference(supabase, shiftDay(today, -29), today),
      reference(supabase, shiftDay(today, -59), shiftDay(today, -30)),
      reference(supabase, shiftDay(today, -89), shiftDay(today, -30)),
      reference(supabase, data.month.monthFrom, today),
      reference(supabase, shiftDay(today, -28), shiftDay(today, -1)),
    ]);
    check("komadi 30 d = referenca", sum.q30 === r30.komada, `${fmt(sum.q30)} vs ${fmt(r30.komada)}`);
    check("komadi 31–60 d = referenca", sum.qPrev30 === rPrev.komada, `${fmt(sum.qPrev30)} vs ${fmt(rPrev.komada)}`);
    check("komadi 31–90 d = referenca", sum.q31to90 === r31.komada, `${fmt(sum.q31to90)} vs ${fmt(r31.komada)}`);
    check(
      "ostvareno u mesecu = Dashboard",
      data.month.mtdProfit === rMonth.zarada && data.month.mtdRevenue === rMonth.promet,
      `${fmt(data.month.mtdProfit)} vs ${fmt(rMonth.zarada)} RSD`,
    );
    const last28 = data.month.last28Profit.reduce((s, x) => s + x, 0);
    check("28 punih dana = referenca", data.month.last28Profit.length === 28 && last28 === r28.zarada, `${fmt(last28)} vs ${fmt(r28.zarada)} RSD`);
    const p = projectMonth(data.month);
    check("raspon obuhvata procenu", p.low <= p.projected && p.projected <= p.high);
    console.log(
      `    procena ${fmt(p.projected)} RSD (raspon ${fmt(p.low)}–${fmt(p.high)}), tempo ${fmt(p.dailyAvg)} RSD/dan, još ${p.remainingDays} dana`,
    );
  }

  console.log(failures === 0 ? "\n✅ PASS — 0 RSD razlike." : `\n❌ FAIL — ${failures} provera palo.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
