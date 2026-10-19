// ============================================================================
// Sportem OS — provera alata AI asistenta (Korak A3, `npm run ai:check`)
//
// Pokreće STVARNE alate iz `lib/ai/tools` nad bazom i poredi njihove cifre sa
// NEZAVISNIM računom po pravilima Dashboarda (`db/metrics.ts`
// computePeriodMetrics): period po `ordered_at` u celim beogradskim danima,
// Otkazano/Vraćeno po IMENU, promet/zarada iz zamrznutih `order_items`.
// Za 5 perioda tvrdi 0 RSD razlike i isti broj porudžbina.
//
// Alati koji čitaju kroz `db/*` (cookies/sesija) se ovde ne pokreću —
// prodaja_pregled zove baš computePeriodMetrics, pa je pokriven poređenjem.
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete.
//
// Pokretanje: npm run ai:check   (traži NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { belgradeDate, todayBelgrade } from "@/lib/date-belgrade";
import { createAiTools } from "@/lib/ai/tools";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";

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
  const { data: st } = await sb.from("order_statuses").select("id, name");
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
  const ids = realized.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const items = await all<{
      quantity: number;
      mp_at_sale: number;
      profit_at_sale: number | null;
    }>((a, b) =>
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
    }
  }
  return { broj: orders.length, otkazano: orders.length - realized.length, promet, zarada };
}

// ── Pokretanje alata ─────────────────────────────────────────────────────────
const tools = createAiTools(supabase);
async function runTool(name: string, input: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Nema alata ${name}`);
  const raw = await tool.run(tool.parse(input) as never);
  const out = JSON.parse(String(raw));
  if (out.greska) throw new Error(`${name}: ${out.greska}`);
  return out;
}

function periods() {
  const today = todayBelgrade();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevLast = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  return [
    { label: "tekući mesec", od: `${today.slice(0, 7)}-01`, do: today },
    {
      label: "prošli mesec",
      od: `${prevY}-${pad(prevM)}-01`,
      do: `${prevY}-${pad(prevM)}-${pad(prevLast)}`,
    },
    { label: "tekuća godina", od: `${y}-01-01`, do: today },
    { label: "jedan dan (juče)", od: shift(today, -1), do: shift(today, -1) },
    { label: "sve", od: "2026-01-01", do: today },
  ];
}
function shift(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

const rsd = (n: number) => `${new Intl.NumberFormat("sr-RS").format(n)} RSD`;

// ── kupac_profil (Kupci C4) — cifre = nezavisan zbir porudžbina tog kupca ───
type ProfileOut = {
  ime: string | null;
  porudzbine_ukupno: number;
  otkazano_ili_vraceno: number;
  promet_rsd: number;
  zarada_rsd: number;
  porudzbine: { broj: number | null }[];
};

async function referenceForOrders(wooNumbers: number[]) {
  const { data: st } = await supabase.from("order_statuses").select("id, name");
  const cancelIds = new Set(
    (st ?? []).filter((s) => CANCELLED_STATUS_NAMES.includes(s.name)).map((s) => s.id),
  );
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status_id")
    .in("woo_order_id", wooNumbers);
  if (error) throw new Error(error.message);
  const realized = (orders ?? []).filter((o) => !cancelIds.has(o.status_id)).map((o) => o.id);
  let promet = 0;
  let zarada = 0;
  if (realized.length > 0) {
    const { data: items, error: e2 } = await supabase
      .from("order_items")
      .select("quantity, mp_at_sale, profit_at_sale")
      .in("order_id", realized);
    if (e2) throw new Error(e2.message);
    for (const it of items ?? []) {
      promet += it.mp_at_sale * it.quantity;
      zarada += it.profit_at_sale ?? 0;
    }
  }
  return {
    broj: orders?.length ?? 0,
    otkazano: (orders?.length ?? 0) - realized.length,
    promet,
    zarada,
  };
}

async function checkCustomerProfiles() {
  console.log("\nkupac_profil — 3 kupca, cifre = zbir njihovih porudžbina:");
  // Kandidati: najveći ponovni kupci sa ≤ 20 porudžbina (alat vraća do 20 porudžbina)
  // + jedan sa otkazivanjem. Biraju se iz porudžbina, ne iz koda koji se proverava.
  const { data: rows, error } = await supabase
    .from("orders")
    .select("woo_order_id, customer_id, cancelled_at")
    .not("woo_order_id", "is", null)
    .order("ordered_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const byCustomer = new Map<string, { woo: number; cancelled: boolean }[]>();
  for (const r of rows ?? []) {
    const list = byCustomer.get(r.customer_id) ?? [];
    list.push({ woo: r.woo_order_id, cancelled: r.cancelled_at != null });
    byCustomer.set(r.customer_id, list);
  }
  const multi = [...byCustomer.values()].filter((l) => l.length >= 2 && l.length <= 20);
  multi.sort((a, b) => b.length - a.length);
  const live = (l: { cancelled: boolean }[]) => l.filter((o) => !o.cancelled).length;
  const withSales = multi.filter((l) => live(l) >= 2);
  const mixed = multi.find((l) => live(l) >= 1 && l.some((o) => o.cancelled));
  const picks = [
    ...new Set([withSales[0], withSales[1], mixed].filter(Boolean).map((l) => l![0].woo)),
  ];

  for (const woo of picks) {
    const out = (await runTool("kupac_profil", { broj_porudzbine: woo })) as ProfileOut;
    const numbers = out.porudzbine.map((o) => o.broj).filter((n): n is number => n != null);
    const ref = await referenceForOrders(numbers);
    const label = `${out.ime ?? "kupac"} (#${woo}, ${out.porudzbine_ukupno} porudžbina)`;
    check(
      `${label} — lista porudžbina je potpuna`,
      out.porudzbine_ukupno <= 20 &&
        numbers.length === out.porudzbine_ukupno &&
        numbers.includes(woo),
      `${numbers.length} u listi`,
    );
    check(
      `${label} — otkazano/vraćeno`,
      out.otkazano_ili_vraceno === ref.otkazano,
      `${out.otkazano_ili_vraceno} vs ${ref.otkazano}`,
    );
    check(
      `${label} — promet`,
      out.promet_rsd === ref.promet,
      `${rsd(out.promet_rsd)} vs ${rsd(ref.promet)}`,
    );
    check(
      `${label} — zarada`,
      out.zarada_rsd === ref.zarada,
      `${rsd(out.zarada_rsd)} vs ${rsd(ref.zarada)}`,
    );
    check(`${label} — bez kontakta podrazumevano`, !("telefon" in out) && !("email" in out));
  }
}

async function main() {
  console.log("Provera alata AI asistenta — Sportem OS (samo čita)\n");

  for (const p of periods()) {
    console.log(`${p.label} (${p.od} – ${p.do}):`);
    const ref = await reference(supabase, p.od, p.do);

    const series = await runTool("prodaja_po_vremenu", { od: p.od, do: p.do, grupisanje: "mesec" });
    const s = (
      series.serija as {
        porudzbine: number;
        otkazano_ili_vraceno: number;
        promet_rsd: number;
        zarada_rsd: number;
      }[]
    ).reduce(
      (t, r) => ({
        broj: t.broj + r.porudzbine,
        otkazano: t.otkazano + r.otkazano_ili_vraceno,
        promet: t.promet + r.promet_rsd,
        zarada: t.zarada + r.zarada_rsd,
      }),
      { broj: 0, otkazano: 0, promet: 0, zarada: 0 },
    );
    check("broj porudžbina", s.broj === ref.broj, `${s.broj} vs ${ref.broj}`);
    check("otkazano/vraćeno", s.otkazano === ref.otkazano, `${s.otkazano} vs ${ref.otkazano}`);
    check("promet", s.promet === ref.promet, `${rsd(s.promet)} vs ${rsd(ref.promet)}`);
    check("zarada", s.zarada === ref.zarada, `${rsd(s.zarada)} vs ${rsd(ref.zarada)}`);

    const top = await runTool("top_artikli", { od: p.od, do: p.do, sortiraj: "promet", limit: 50 });
    const topSum = (top.artikli as { promet_rsd: number }[]).reduce((t, a) => t + a.promet_rsd, 0);
    check(
      "top_artikli ⊆ ukupan promet",
      topSum <= ref.promet && (top.ukupno_artikala > 50 || topSum === ref.promet),
      `${rsd(topSum)} od ${rsd(ref.promet)} (${top.ukupno_artikala} artikala)`,
    );

    const otk = await runTool("otkazivanja", { od: p.od, do: p.do });
    check(
      "otkazivanja = otkazano + vraćeno",
      otk.otkazano + otk.vraceno === ref.otkazano,
      `${otk.otkazano}+${otk.vraceno} vs ${ref.otkazano}`,
    );

    const kupci = await runTool("kupci_top", { od: p.od, do: p.do, limit: 50 });
    check("kupci_top vraća listu", Array.isArray(kupci.kupci), `${kupci.kupaca_ukupno} kupaca`);
    console.log("");
  }

  console.log("Ostali alati (samo da rade, bez poređenja):");
  const today = todayBelgrade();
  const art = await runTool("artikal_prodaja", {
    pretraga: "lopta",
    od: "2026-01-01",
    do: today,
    grupisanje: "mesec",
  });
  check(
    "artikal_prodaja „lopta”",
    typeof art.ukupno?.komada === "number",
    `${art.ukupno.komada} kom`,
  );
  const por = await runTool("porudzbine_pretraga", { od: shift(today, -30), do: today, limit: 5 });
  check("porudzbine_pretraga", Array.isArray(por.porudzbine), `${por.pronadjeno} pronađeno`);
  const tro = await runTool("troskovi", { od: "2026-01-01", do: today });
  check("troskovi", typeof tro.ukupno_rsd === "number", rsd(tro.ukupno_rsd));

  await checkCustomerProfiles();

  console.log(
    failures === 0
      ? "\n✅ PASS — alati daju iste cifre kao Dashboard.\n"
      : `\n❌ FAIL — ${failures} provera nije prošla.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
