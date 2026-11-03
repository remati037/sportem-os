import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";

import { loadSales, sumItems } from "@/db/sales";
import { getAnthropic } from "@/lib/ai/client";
import { todayBelgrade } from "@/lib/date-belgrade";
import {
  fetchAdInsights,
  fetchLiveAds,
  fetchLiveAdSets,
  type MetaActionApi,
} from "@/lib/meta/client";
import { decimalToMinor, getRates, minorToRsd } from "@/lib/meta/fx";
import { REPORT_PLAN } from "@/lib/meta/report-plan";
import { rangeToUtcPrefilter } from "@/lib/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/paginate";
import { tgEscape } from "@/lib/telegram";

/*
 * Dnevni izveštaj o Meta reklamama za Telegram (cron `/api/cron/meta-report`).
 *
 * Cifre: Meta API po OGLASU i danu (potrošnja → RSD po kursu NBS dana, isti
 * `getRates` kao sync) + porudžbine sa sajta pripisane oglasu po
 * `attr_utm_content` (= Meta ad ID), isti učitavač i pravila kao Dashboard
 * (`loadSales`: Otkazano/Vraćeno po imenu, novac iz zamrznutih stavki).
 * Današnji dan je delimičan i ne ulazi — izveštaj je za JUČE, 7 dana i mesec.
 *
 * Ocenu i sledeće korake piše Claude iz IZRAČUNATIH cifara + `REPORT_PLAN`;
 * ne sme da izmišlja brojeve. Ako AI padne, poruka ide bez tog dela.
 * Samo čita — ništa u Meta nalogu se ne menja.
 */

const REPORT_MODEL = "claude-opus-5-5";
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

type Stat = {
  spendRsd: number;
  impressions: number;
  linkClicks: number;
  metaPurchases: number;
  orders: number; // realizovane porudžbine sa sajta (UTM)
  cancelled: number;
  revenue: number;
  profit: number;
};

const emptyStat = (): Stat => ({
  spendRsd: 0,
  impressions: 0,
  linkClicks: 0,
  metaPurchases: 0,
  orders: 0,
  cancelled: 0,
  revenue: 0,
  profit: 0,
});

type Row = Stat & { id: string; name: string };
type AdRow = Row & { adsetId: string; adsetName: string; status: string | null; createdDay: string | null; yesterday: Stat };
type AdSetRow = Row & { status: string | null; budgetRsd: number | null; yesterday: Stat };

export type DailyReport = {
  day: string;
  week: { from: string; to: string };
  month: { from: string; to: string };
  totals: { yesterday: Stat; week: Stat; month: Stat };
  dailyWeek: { date: string; spendRsd: number; orders: number }[];
  adsets: AdSetRow[];
  ads: AdRow[];
  allSiteOrdersYesterday: number;
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function purchasesOf(list: MetaActionApi[] | undefined): number {
  for (const t of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return Number.parseInt(hit.value, 10) || 0;
  }
  return 0;
}

const STAT_KEYS = Object.keys(emptyStat()) as (keyof Stat)[];

/** Sabira samo brojčana polja Stat-a (red oglasa nosi i id, ime…). */
function add(into: Stat, s: Partial<Stat>) {
  for (const k of STAT_KEYS) into[k] += s[k] ?? 0;
}

const cpa = (s: Stat) => (s.orders > 0 ? Math.round(s.spendRsd / s.orders) : null);

/** Sve cifre izveštaja. Baca grešku ako Meta ili baza ne odgovore. */
export async function buildDailyReport(today = todayBelgrade()): Promise<DailyReport> {
  const supabase = createAdminClient();
  const day = addDays(today, -1);
  const weekFrom = addDays(day, -6);
  const monthFrom = `${day.slice(0, 8)}01`;
  const from = weekFrom < monthFrom ? weekFrom : monthFrom;

  const [insights, adsets, ads, sales] = await Promise.all([
    fetchAdInsights(from, day),
    fetchLiveAdSets(),
    fetchLiveAds(),
    loadSales(supabase, from, day),
  ]);

  // potrošnja u RSD po kursu NBS dana (isto kao sync)
  const currency = insights[0]?.account_currency ?? "USD";
  const { rates } = await getRates(supabase, currency, insights.map((r) => r.date_start), today);
  const spendRsdOf = (spend: string | undefined, date: string) => {
    const rate = rates.get(date);
    return rate ? minorToRsd(decimalToMinor(spend ?? "0", 2), rate.middleMicro) : 0;
  };
  const budgetRate = rates.get(day) ?? [...rates.values()].pop();

  // porudžbine sa sajta → oglas (utm_content = Meta ad ID)
  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, day);
  const attr = await selectAll<{ id: string; attr_utm_content: string | null }>("izveštaj: atribucija", () =>
    supabase
      .from("orders")
      .select("id, attr_utm_content")
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("id", { ascending: true }),
  );
  const adOf = new Map(attr.map((a) => [a.id, a.attr_utm_content?.trim() || null]));

  const totals = { yesterday: emptyStat(), week: emptyStat(), month: emptyStat() };
  const byDay = new Map<string, { date: string; spendRsd: number; orders: number }>();
  for (let d = weekFrom; d <= day; d = addDays(d, 1)) byDay.set(d, { date: d, spendRsd: 0, orders: 0 });

  const adRows = new Map<string, AdRow>();
  const adInfo = new Map(ads.map((a) => [a.id, a]));
  const ensureAd = (id: string, name?: string, adsetId?: string, adsetName?: string): AdRow => {
    let r = adRows.get(id);
    if (!r) {
      const info = adInfo.get(id);
      r = {
        ...emptyStat(),
        id,
        name: name ?? info?.name ?? id,
        adsetId: adsetId ?? info?.adset_id ?? "",
        adsetName: adsetName ?? "",
        status: info?.effective_status ?? null,
        createdDay: info?.created_time ? info.created_time.slice(0, 10) : null,
        yesterday: emptyStat(),
      };
      adRows.set(id, r);
    }
    return r;
  };

  const inPeriods = (date: string) => ({
    y: date === day,
    w: date >= weekFrom && date <= day,
    m: date >= monthFrom && date <= day,
  });

  for (const r of insights) {
    const s: Partial<Stat> = {
      spendRsd: spendRsdOf(r.spend, r.date_start),
      impressions: Number.parseInt(r.impressions ?? "0", 10) || 0,
      linkClicks: Number.parseInt(r.inline_link_clicks ?? "0", 10) || 0,
      metaPurchases: purchasesOf(r.actions),
    };
    const p = inPeriods(r.date_start);
    if (p.y) add(totals.yesterday, s);
    if (p.m) add(totals.month, s);
    if (p.w) {
      add(totals.week, s);
      byDay.get(r.date_start)!.spendRsd += s.spendRsd ?? 0;
      const ad = ensureAd(r.ad_id, r.ad_name, r.adset_id, r.adset_name);
      if (!ad.adsetName) ad.adsetName = r.adset_name;
      add(ad, s);
      if (p.y) add(ad.yesterday, s);
    }
  }

  let allSiteOrdersYesterday = 0;
  for (const o of sales.orders) {
    if (o.day === day) allSiteOrdersYesterday++;
    const adId = adOf.get(o.id);
    if (!adId || !/^\d{6,}$/.test(adId)) continue; // samo Meta oglasi ({{ad.id}})
    const { revenue, profit } = sumItems(o.items);
    const s: Partial<Stat> = o.cancelled ? { cancelled: 1 } : { orders: 1, revenue, profit };
    const p = inPeriods(o.day);
    if (p.y) add(totals.yesterday, s);
    if (p.m) add(totals.month, s);
    if (p.w) {
      add(totals.week, s);
      if (!o.cancelled) byDay.get(o.day)!.orders++;
      const ad = ensureAd(adId);
      add(ad, s);
      if (p.y) add(ad.yesterday, s);
    }
  }

  // ad setovi: zbir oglasa (7 dana) + budžet i status
  const setRows = new Map<string, AdSetRow>();
  for (const s of adsets) {
    setRows.set(s.id, {
      ...emptyStat(),
      id: s.id,
      name: s.name,
      status: s.effective_status ?? null,
      budgetRsd:
        s.daily_budget && budgetRate ? minorToRsd(Number(s.daily_budget), budgetRate.middleMicro) : null,
      yesterday: emptyStat(),
    });
  }
  for (const ad of adRows.values()) {
    if (!ad.adsetId) continue;
    let set = setRows.get(ad.adsetId);
    if (!set) {
      set = { ...emptyStat(), id: ad.adsetId, name: ad.adsetName || ad.adsetId, status: null, budgetRsd: null, yesterday: emptyStat() };
      setRows.set(ad.adsetId, set);
    }
    if (!ad.adsetName) ad.adsetName = set.name;
    add(set, ad);
    add(set.yesterday, ad.yesterday);
  }

  const bySpend = <T extends Stat>(a: T, b: T) => b.spendRsd - a.spendRsd || b.orders - a.orders;
  return {
    day,
    week: { from: weekFrom, to: day },
    month: { from: monthFrom, to: day },
    totals,
    dailyWeek: [...byDay.values()],
    adsets: [...setRows.values()].filter((s) => s.spendRsd > 0 || s.orders > 0 || s.status === "ACTIVE").sort(bySpend),
    ads: [...adRows.values()].filter((a) => a.spendRsd > 0 || a.orders > 0 || a.status === "ACTIVE").sort(bySpend),
    allSiteOrdersYesterday,
  };
}

/* ── formatiranje ── */

const n0 = (n: number) => new Intl.NumberFormat("sr-RS").format(Math.round(n));
const rsd = (n: number) => `${n0(n)} RSD`;
const WEEKDAYS = ["nedelja", "ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota"];

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

function statLine(s: Stat): string {
  const c = cpa(s);
  const net = s.profit - s.spendRsd;
  return [
    `Potrošnja <b>${rsd(s.spendRsd)}</b>`,
    `Porudžbine <b>${s.orders}</b>${s.cancelled ? ` (+${s.cancelled} otk.)` : ""} · Meta ${s.metaPurchases}`,
    `CPA <b>${c === null ? "—" : rsd(c)}</b> · Zarada ${rsd(s.profit)} · Neto <b>${net >= 0 ? "+" : ""}${rsd(net)}</b>`,
  ].join("\n");
}

/** „NOV | Podesive bučice 2 | 20 kg | slika | v1" u setu „NOV | A · …" → „A · Podesive bučice 2 · 20 kg". */
function shortName(ad: AdRow): string {
  const set = /(?:^|\| )([A-Z]) ·/.exec(ad.adsetName)?.[1];
  const parts = ad.name.split("|").map((p) => p.trim()).filter(Boolean);
  const base =
    parts.length >= 3 && /^(NOV|REZ)$/.test(parts[0]) ? `${parts[1]} · ${parts[2]}` : ad.name.replace(/^NOV \| /, "");
  return set ? `${set} · ${base}` : base;
}

export function formatReport(r: DailyReport, commentary: string | null): string {
  const lines: string[] = [];
  lines.push(`📊 <b>Reklame — ${dayLabel(r.day)}</b>`);
  lines.push("");
  lines.push(`<b>Juče</b>`);
  lines.push(statLine(r.totals.yesterday));
  lines.push(`Sve porudžbine sa sajta juče: ${r.allSiteOrdersYesterday}`);
  lines.push("");
  lines.push(`<b>7 dana</b> (${dayLabel(r.week.from)}–${dayLabel(r.week.to)})`);
  lines.push(statLine(r.totals.week));
  lines.push(
    `Po danu: ${r.dailyWeek.map((d) => `${d.date.slice(8)}. ${n0(d.spendRsd / 1000)}k/${d.orders}`).join(" · ")}`,
  );
  lines.push("");
  lines.push(`<b>Mesec do juče</b>`);
  lines.push(statLine(r.totals.month));
  lines.push("");
  lines.push(`<b>Ad setovi (7 dana · juče)</b>`);
  for (const s of r.adsets) {
    const c = cpa(s);
    const budget = s.budgetRsd ? ` · ${n0(s.budgetRsd)}/dan` : "";
    const status = !s.status ? " [pauziran]" : s.status !== "ACTIVE" ? ` [${s.status}]` : "";
    lines.push(
      `• ${tgEscape(s.name.replace(/^NOV \| /, ""))}${budget}${status}\n   ${rsd(s.spendRsd)} · ${s.orders} por. · CPA ${c === null ? "—" : n0(c)} · juče ${n0(s.yesterday.spendRsd)}/${s.yesterday.orders}`,
    );
  }
  const winners = r.ads.filter((a) => a.orders > 0).sort((a, b) => b.orders - a.orders).slice(0, 5);
  const losers = r.ads.filter((a) => a.orders === 0 && a.spendRsd >= 1000).slice(0, 6);
  const dark = r.ads.filter((a) => a.status === "ACTIVE" && a.impressions === 0 && (!a.createdDay || a.createdDay < addDays(r.day, -1)));
  if (winners.length) {
    lines.push("");
    lines.push(`<b>Nose (7 dana)</b>`);
    for (const a of winners) {
      lines.push(`• ${tgEscape(shortName(a))}: ${a.orders} por., CPA ${n0(cpa(a)!)}, zarada ${n0(a.profit)}`);
    }
  }
  if (losers.length) {
    lines.push("");
    lines.push(`<b>Troše bez porudžbine (7 dana)</b>`);
    for (const a of losers) lines.push(`• ${tgEscape(shortName(a))}: ${rsd(a.spendRsd)}`);
  }
  if (dark.length) {
    lines.push("");
    lines.push(`<b>Aktivni bez prikazivanja</b>: ${dark.map((a) => tgEscape(shortName(a))).join(", ")}`);
  }
  lines.push("");
  if (commentary) {
    lines.push(`🧠 <b>Ocena i sledeći koraci</b>`);
    lines.push(tgEscape(commentary).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"));
  } else {
    lines.push(`<i>AI ocena nije dostupna danas — cifre iznad su tačne.</i>`);
  }
  const app = process.env.NEXT_PUBLIC_APP_URL;
  if (app) lines.push(`\n<a href="${app.replace(/\/$/, "")}/reklame">Otvori Reklame u app-u</a>`);
  return lines.join("\n");
}

/* ── AI ocena ── */

/** Ocena i sledeći koraci (Claude). Best-effort: null na bilo kakav problem. */
export async function writeCommentary(r: DailyReport): Promise<string | null> {
  const client = getAnthropic();
  if (!client) return null;
  const data = {
    juce: r.day,
    danas: addDays(r.day, 1),
    totals: r.totals,
    poDanu7: r.dailyWeek,
    adSetovi: r.adsets.map(({ yesterday, ...s }) => ({ ...s, cpa: cpa(s), juce: yesterday })),
    oglasi: r.ads.map(({ yesterday, ...a }) => ({ ...a, cpa: cpa(a), juce: yesterday })),
  };
  try {
    const res = await client.messages.create({
      model: REPORT_MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium" },
      system:
        "Ti si analitičar Meta reklama za Sportem (sportem.rs, fitnes oprema, Srbija). Pišeš jutarnji Telegram izveštaj vlasniku. " +
        "Srpski latinicom, kratko i direktno, bez uvoda i pozdrava. Cifre SAMO iz dostavljenih podataka — nikad ne izmišljaj ni ne zaokružuj u nove tvrdnje. " +
        "CPA je potrošnja / realizovane porudžbine sa sajta (UTM); Meta „kupovine“ su samo signal. Novac u RSD. " +
        "Ne koristi markdown naslove ni tabele; dozvoljeno je **podebljano** i redovi koji počinju sa „• “.",
      messages: [
        {
          role: "user",
          content:
            `PLAN I PRAVILA:\n${REPORT_PLAN}\n\nPODACI (JSON, potrošnja i zarada u RSD; spend 7 dana po oglasu/ad setu, „juce" = samo juče):\n${JSON.stringify(data)}\n\n` +
            "Napiši tri kratka dela, ukupno najviše ~1.200 znakova:\n" +
            "**Ocena** — 2–3 rečenice: kako ide u odnosu na cilj (CPA ≤ 900, break-even 1.200) i trend.\n" +
            "**Predlog za danas** — 1–4 konkretne akcije po pravilima iz plana (koji oglas/ad set, šta i zašto, sa cifrom). Ako je nešto u periodu od 72h bez izmena, reci to. Ako ništa ne treba dirati, reci to.\n" +
            "**Plan dalje** — 1–3 stavke (kreative, rokovi, šta pratiti).",
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "meta-report-ai" } });
    return null;
  }
}
