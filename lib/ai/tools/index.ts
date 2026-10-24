import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { computePeriodMetrics } from "@/db/metrics";
import { getLowStockVariants, getUncountedVariantCount } from "@/db/catalog";
import {
  getDrugMiDuguje,
  getInvoiceCandidates,
  getSaldoPostarine,
  getUnpaidDeliveredXexpress,
} from "@/db/finance";
import { getOrderDetail, getOrderStatusHistory } from "@/db/orders";
import { getOfferStats, listOfferRules } from "@/db/offers";
import {
  adsSiteTotals,
  buildCampaignRows,
  costPerPurchaseRsd,
  ctrPct,
  getAdAttribution,
  getAdsOverview,
  metaRoas,
  type SiteStats,
} from "@/db/ads";
import {
  findCustomerGroup,
  getCustomerFlags,
  getCustomerNotes,
  getCustomerProfileForGroup,
  isRepeatCustomer,
  isRiskyCustomer,
  loadCustomerGroups,
  searchCustomerGroups,
  type CustomerGroup,
} from "@/db/customers";
import { customerFlagMeta } from "@/lib/customers";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { chunked, mustOne, mustRows, selectAll } from "@/lib/supabase/paginate";

import { AI_TOOL_LABELS } from "@/lib/ai/tool-labels";

import { bucketOf, loadSales, norm, sumItems, type Sales } from "@/db/sales";
import { getRacunica } from "@/db/racunica";
import {
  DEFAULT_TARGET_PCT,
  catalogMarginOf,
  classifyAbc,
  compareRows,
  deadStock,
  discountPct,
  effectiveMarginPct,
  hasActivity,
  medianQty,
  normText,
  quadrantOf,
  realMarginPct,
  rowDaysToZero,
  type RacunicaSort,
} from "@/lib/racunica";
import { forecastQty, projectMonth, trendOf } from "@/lib/sales-velocity";

/*
 * Alati AI asistenta (Korak A3). SVI samo čitaju — nijedan ne piše u bazu.
 *
 * - Čitaju RLS klijentom korisnika (prosleđen u `createAiTools`), pa RLS
 *   ostaje izvor sigurnosti i za AI.
 * - Promet/zarada isključivo iz zamrznutih `order_items` (§4), grupisanje
 *   artikala po `sku` (+ `product_name` snapshot), ne po `variant_id`.
 * - Vraćaju KOMPAKTAN JSON (agregati, ne sirovi redovi), sa `napomena` kad je
 *   cifra nepotpuna (npr. porudžbine bez VP → zarada je niža od stvarne).
 * - Greška alata ne obara razgovor: vraća `{greska}` modelu + Sentry.
 *
 * `onCall` beleži koji alat je pozvan i sa kojim periodom — za karticu
 * „Pogledao…" ispod odgovora.
 */

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum u formatu YYYY-MM-DD.")
  .describe("Datum YYYY-MM-DD (Europe/Belgrade, inkluzivno)");

const period = {
  od: DATE.describe("Prvi dan perioda, YYYY-MM-DD (inkluzivno)"),
  do: DATE.describe("Poslednji dan perioda, YYYY-MM-DD (inkluzivno)"),
};

const GRAIN = z.enum(["dan", "nedelja", "mesec"]);

export type AiToolCall = { name: string; label: string; input: Record<string, unknown> };

function json(value: unknown): string {
  return JSON.stringify(value);
}

function checkPeriod(od: string, doDate: string) {
  if (od > doDate) throw new Error("Početak perioda je posle kraja.");
}

const round = (n: number) => Math.round(n);
const one = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export function createAiTools(
  supabase: SupabaseClient,
  onCall: (call: AiToolCall) => void = () => {},
) {
  // Memo po zahtevu — više alata u istom odgovoru ne čita isti period dvaput.
  const salesCache = new Map<string, Promise<Sales>>();
  const sales = (from: string, to: string) => {
    const key = `${from}|${to}`;
    let hit = salesCache.get(key);
    if (!hit) {
      hit = loadSales(supabase, from, to);
      salesCache.set(key, hit);
    }
    return hit;
  };

  function tool<S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    run: (input: z.infer<S>) => Promise<unknown>,
  ) {
    return betaZodTool({
      name,
      description,
      inputSchema,
      run: async (input) => {
        onCall({
          name,
          label: AI_TOOL_LABELS[name] ?? name,
          input: input as Record<string, unknown>,
        });
        try {
          return json(await run(input));
        } catch (err) {
          Sentry.captureException(err, { tags: { area: "ai-tool", tool: name } });
          const message = err instanceof Error ? err.message : "nepoznata greška";
          return json({ greska: `Alat nije uspeo: ${message}` });
        }
      },
    });
  }

  return [
    tool(
      "prodaja_pregled",
      "Zbirne cifre prodaje za period: broj porudžbina (svi statusi), realizovane (bez Otkazano/Vraćeno), promet, zarada, marža, troškovi, neto profit, prosečna porudžbina. Iste cifre kao Dashboard. Koristi za pitanja tipa „koliko smo zaradili/prodali u…”.",
      z.object(period),
      async ({ od, do: doDate }) => {
        checkPeriod(od, doDate);
        const [metrics, s] = await Promise.all([
          computePeriodMetrics({ from: od, to: doDate }),
          sales(od, doDate),
        ]);
        const realized = s.orders.filter((o) => !o.cancelled);
        const totals = sumItems(realized.flatMap((o) => o.items));
        const needsVp = realized.filter((o) => o.needs_vp).length;
        const keš = realized.filter((o) => o.delivery_method === "licno").length;
        return {
          period: { od, do: doDate },
          porudzbine_ukupno: metrics.brojPorudzbina,
          porudzbine_realizovane: realized.length,
          otkazano_ili_vraceno: s.orders.length - realized.length,
          licne_kes_prodaje: keš,
          komada_prodato: totals.quantity,
          promet_rsd: totals.revenue,
          zarada_rsd: metrics.zarada,
          marza_procenat: Math.round(metrics.marza * 1000) / 10,
          troskovi_rsd: metrics.troskovi,
          neto_profit_rsd: metrics.neto,
          prosecna_porudzbina_rsd: realized.length ? round(totals.revenue / realized.length) : 0,
          ...(needsVp
            ? {
                napomena: `${needsVp} porudžbina nema unetu VP cenu — zarada je za njih 0, pa je stvarna zarada veća.`,
              }
            : {}),
        };
      },
    ),

    tool(
      "top_artikli",
      "Najprodavaniji artikli u periodu, grupisano po SKU (bez otkazanih/vraćenih). Sortira po komadima, prometu ili zaradi. Opciona pretraga po delu naziva ili SKU-a (npr. „lopta”, „nike”).",
      z.object({
        ...period,
        sortiraj: z.enum(["komadi", "promet", "zarada"]).default("komadi"),
        limit: z.number().int().min(1).max(50).default(10),
        pretraga: z.string().max(100).optional().describe("Deo naziva ili SKU-a za filter"),
      }),
      async ({ od, do: doDate, sortiraj, limit, pretraga }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const q = pretraga ? norm(pretraga) : null;
        const groups = new Map<
          string,
          {
            sku: string;
            naziv: string;
            komada: number;
            promet: number;
            zarada: number;
            porudzbina: Set<string>;
            bezVp: boolean;
          }
        >();
        for (const o of s.orders) {
          if (o.cancelled) continue;
          for (const it of o.items) {
            if (q && !norm(`${it.sku} ${it.product_name}`).includes(q)) continue;
            const g = groups.get(it.sku) ?? {
              sku: it.sku,
              naziv: it.product_name,
              komada: 0,
              promet: 0,
              zarada: 0,
              porudzbina: new Set<string>(),
              bezVp: false,
            };
            g.komada += it.quantity;
            g.promet += it.mp_at_sale * it.quantity;
            g.zarada += it.profit_at_sale ?? 0;
            if (it.profit_at_sale == null) g.bezVp = true;
            g.porudzbina.add(o.id);
            groups.set(it.sku, g);
          }
        }
        const key = sortiraj === "komadi" ? "komada" : sortiraj;
        const list = [...groups.values()].sort((a, b) => b[key] - a[key]);
        return {
          period: { od, do: doDate },
          ukupno_artikala: list.length,
          artikli: list.slice(0, limit).map((g) => ({
            sku: g.sku,
            naziv: g.naziv,
            komada: g.komada,
            porudzbina: g.porudzbina.size,
            promet_rsd: g.promet,
            zarada_rsd: g.zarada,
            ...(g.bezVp ? { napomena: "deo stavki bez VP — zarada nepotpuna" } : {}),
          })),
        };
      },
    ),

    tool(
      "artikal_prodaja",
      "Prodaja jednog artikla (ili grupe po delu naziva/SKU-a) kroz vreme: komadi, promet, zarada po danu/nedelji/mesecu, plus koje varijante (SKU) su ušle u zbir.",
      z.object({
        pretraga: z.string().min(2).max(100).describe("Deo naziva ili SKU-a"),
        ...period,
        grupisanje: GRAIN.default("mesec"),
      }),
      async ({ pretraga, od, do: doDate, grupisanje }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const q = norm(pretraga);
        const series = new Map<string, { komada: number; promet: number; zarada: number }>();
        const skus = new Map<string, { naziv: string; komada: number }>();
        for (const o of s.orders) {
          if (o.cancelled) continue;
          for (const it of o.items) {
            if (!norm(`${it.sku} ${it.product_name}`).includes(q)) continue;
            const b = bucketOf(o.day, grupisanje);
            const row = series.get(b) ?? { komada: 0, promet: 0, zarada: 0 };
            row.komada += it.quantity;
            row.promet += it.mp_at_sale * it.quantity;
            row.zarada += it.profit_at_sale ?? 0;
            series.set(b, row);
            const sk = skus.get(it.sku) ?? { naziv: it.product_name, komada: 0 };
            sk.komada += it.quantity;
            skus.set(it.sku, sk);
          }
        }
        const rows = [...series.entries()].sort(([a], [b]) => a.localeCompare(b));
        const total = rows.reduce(
          (t, [, r]) => ({
            komada: t.komada + r.komada,
            promet: t.promet + r.promet,
            zarada: t.zarada + r.zarada,
          }),
          { komada: 0, promet: 0, zarada: 0 },
        );
        return {
          pretraga,
          period: { od, do: doDate },
          ukupno: { komada: total.komada, promet_rsd: total.promet, zarada_rsd: total.zarada },
          pogodjeni_sku: [...skus.entries()]
            .sort(([, a], [, b]) => b.komada - a.komada)
            .slice(0, 30)
            .map(([sku, v]) => ({ sku, naziv: v.naziv, komada: v.komada })),
          po_periodu: rows.map(([period, r]) => ({
            period,
            komada: r.komada,
            promet_rsd: r.promet,
            zarada_rsd: r.zarada,
          })),
          ...(skus.size === 0
            ? { napomena: "Nijedna prodata stavka ne odgovara pretrazi u ovom periodu." }
            : {}),
        };
      },
    ),

    tool(
      "prodaja_po_vremenu",
      "Serija prodaje po danu, nedelji (od ponedeljka) ili mesecu: broj porudžbina, otkazane/vraćene, promet i zarada. Za trendove, sezonalnost, poređenje perioda i najjače dane.",
      z.object({ ...period, grupisanje: GRAIN.default("dan") }),
      async ({ od, do: doDate, grupisanje }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const series = new Map<
          string,
          { porudzbine: number; otkazano: number; promet: number; zarada: number }
        >();
        for (const o of s.orders) {
          const b = bucketOf(o.day, grupisanje);
          const row = series.get(b) ?? { porudzbine: 0, otkazano: 0, promet: 0, zarada: 0 };
          row.porudzbine += 1;
          if (o.cancelled) row.otkazano += 1;
          else {
            const t = sumItems(o.items);
            row.promet += t.revenue;
            row.zarada += t.profit;
          }
          series.set(b, row);
        }
        const rows = [...series.entries()].sort(([a], [b]) => a.localeCompare(b));
        return {
          period: { od, do: doDate },
          grupisanje,
          napomena:
            "Porudžbine = svi statusi; promet/zarada bez otkazanih i vraćenih. Periodi bez ijedne porudžbine su izostavljeni.",
          serija: rows.slice(-400).map(([period, r]) => ({
            period,
            porudzbine: r.porudzbine,
            otkazano_ili_vraceno: r.otkazano,
            promet_rsd: r.promet,
            zarada_rsd: r.zarada,
          })),
        };
      },
    ),

    tool(
      "kupci_top",
      "Kupci u periodu: najbolji po broju porudžbina ili prometu, broj novih vs ponovljenih kupaca (ponovljen = ima bar 2 porudžbine u periodu). Vraća ime i grad, bez telefona i adrese.",
      z.object({
        ...period,
        sortiraj: z.enum(["porudzbine", "promet"]).default("promet"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      async ({ od, do: doDate, sortiraj, limit }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const groups = new Map<
          string,
          {
            ime: string | null;
            grad: string | null;
            porudzbine: number;
            otkazano: number;
            promet: number;
          }
        >();
        for (const o of s.orders) {
          const key = o.customer_id ?? `bez-kupca:${o.ship_name ?? o.id}`;
          const g = groups.get(key) ?? {
            ime: o.ship_name,
            grad: o.ship_city,
            porudzbine: 0,
            otkazano: 0,
            promet: 0,
          };
          if (o.cancelled) g.otkazano += 1;
          else {
            g.porudzbine += 1;
            g.promet += sumItems(o.items).revenue;
          }
          groups.set(key, g);
        }
        const list = [...groups.values()].filter((g) => g.porudzbine > 0);
        list.sort((a, b) =>
          sortiraj === "porudzbine"
            ? b.porudzbine - a.porudzbine || b.promet - a.promet
            : b.promet - a.promet,
        );
        const repeat = list.filter((g) => g.porudzbine >= 2).length;
        return {
          period: { od, do: doDate },
          kupaca_ukupno: list.length,
          ponovljenih_kupaca: repeat,
          procenat_ponovljenih: pct(repeat, list.length),
          kupci: list.slice(0, limit).map((g) => ({
            ime: g.ime ?? "nepoznato",
            grad: g.grad,
            porudzbine: g.porudzbine,
            promet_rsd: g.promet,
            otkazano_ili_vraceno: g.otkazano,
          })),
        };
      },
    ),

    tool(
      "porudzbine_pretraga",
      "Lista porudžbina u periodu (najnovije prve, najviše 50) sa filterima: status, način isporuke, deo imena kupca ili grada. Za „pokaži porudžbine…”, „ko je naručio…”.",
      z.object({
        ...period,
        status: z.enum(["Kreirano", "Poslato", "Isporučeno", "Otkazano", "Vraćeno"]).optional(),
        nacin_isporuke: z.enum(["xexpress", "licno"]).optional(),
        kupac_ili_grad: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      async ({ od, do: doDate, status, nacin_isporuke, kupac_ili_grad, limit }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const q = kupac_ili_grad ? norm(kupac_ili_grad) : null;
        const list = s.orders
          .filter((o) => !status || o.status === status)
          .filter((o) => !nacin_isporuke || o.delivery_method === nacin_isporuke)
          .filter((o) => !q || norm(`${o.ship_name ?? ""} ${o.ship_city ?? ""}`).includes(q))
          .reverse();
        return {
          period: { od, do: doDate },
          pronadjeno: list.length,
          porudzbine: list.slice(0, limit).map((o) => {
            const t = sumItems(o.items);
            return {
              broj: o.woo_order_id,
              datum: o.day,
              status: o.status,
              isporuka: o.delivery_method,
              placanje: o.payment_status,
              kupac: o.ship_name,
              grad: o.ship_city,
              artikli: o.items.map((it) => `${it.quantity}× ${it.product_name}`).join(", "),
              promet_rsd: t.revenue,
              zarada_rsd: o.cancelled ? 0 : t.profit,
            };
          }),
        };
      },
    ),

    tool(
      "kupac_profil",
      "Profil JEDNOG kupca kroz celu istoriju (kupac = sve porudžbine spojene po telefonu, pa po e-mailu — iste cifre kao strana /kupci): broj porudžbina, otkazane/vraćene, promet, zarada, prosečna korpa, prva i poslednja kupovina, šta kupuje (po SKU), razlozi otkazivanja, oznake i beleške tima. Traži po imenu, gradu, telefonu ili e-mailu (`pretraga`) ili po broju porudžbine. Kad pretraga pogodi više kupaca, vraća spisak kandidata — tada pitaj korisnika na kog misli. Telefon i e-mail vraća SAMO uz `sa_kontaktom: true`, i to samo kad korisnik izričito traži kontakt.",
      z.object({
        pretraga: z.string().max(100).optional().describe("Ime, grad, telefon ili e-mail kupca"),
        broj_porudzbine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Woo broj neke porudžbine tog kupca"),
        sa_kontaktom: z.boolean().default(false),
      }),
      async ({ pretraga, broj_porudzbine, sa_kontaktom }) => {
        // Svi kupci jednom po pozivu, kroz klijent alata (RLS korisnika).
        const groups = await loadCustomerGroups(supabase);
        let group: CustomerGroup | null = null;

        if (broj_porudzbine) {
          const order = mustOne<{ customer_id: string | null }>(
            await supabase
              .from("orders")
              .select("customer_id")
              .eq("woo_order_id", broj_porudzbine)
              .maybeSingle(),
            "AI: porudžbina kupca",
          );
          if (!order) return { greska: `Porudžbina #${broj_porudzbine} ne postoji.` };
          group = await findCustomerGroup(order.customer_id ?? "", supabase, groups);
        } else if (pretraga?.trim()) {
          const found = searchCustomerGroups(groups, pretraga, 10);
          if (found.length === 0) return { greska: `Nema kupca za „${pretraga}”.` };
          if (found.length > 1) {
            return {
              napomena:
                "Više kupaca odgovara pretrazi — pitaj korisnika na kog misli (ili suzi po gradu/broju porudžbine).",
              kandidati: found.map((c) => ({
                ime: c.name,
                grad: c.city,
                porudzbine: c.orderCount,
                promet_rsd: c.revenue,
                poslednja_kupovina: c.lastOrderAt.slice(0, 10),
              })),
            };
          }
          group = found[0];
        } else {
          return { greska: "Zadaj pretragu (ime/telefon/e-mail) ili broj porudžbine." };
        }

        if (!group) return { greska: "Kupac nije pronađen." };
        const [profile, flags, notes] = await Promise.all([
          getCustomerProfileForGroup(group, supabase),
          getCustomerFlags(group, supabase),
          getCustomerNotes(group, supabase),
        ]);
        const g = profile.group;

        return {
          ime: g.name,
          grad: g.city,
          ...(sa_kontaktom ? { telefon: g.phone, email: g.email, adresa: profile.address } : {}),
          link: `/kupci/${g.repId}`,
          porudzbine_ukupno: g.orderCount,
          porudzbine_realizovane: g.realizedCount,
          otkazano_ili_vraceno: g.cancelledCount,
          stopa_otkazivanja_procenat: pct(g.cancelledCount, g.orderCount),
          promet_rsd: g.revenue,
          zarada_rsd: g.profit,
          komada: g.units,
          prosecna_korpa_rsd: g.realizedCount > 0 ? round(g.revenue / g.realizedCount) : 0,
          prva_kupovina: g.firstOrderAt.slice(0, 10),
          poslednja_kupovina: g.lastOrderAt.slice(0, 10),
          ponovni_kupac: isRepeatCustomer(g),
          rizican_kupac: isRiskyCustomer(g),
          oznake: flags.map((f) => customerFlagMeta(f).label),
          porudzbine: profile.orders.slice(0, 20).map((o) => ({
            broj: o.woo_order_id,
            datum: o.ordered_at.slice(0, 10),
            status: o.status?.name ?? null,
            vrednost_rsd: o.revenue,
            zarada_rsd: o.cancelled ? null : o.profit,
          })),
          artikli: profile.articles.slice(0, 15).map((a) => ({
            sku: a.sku,
            naziv: a.name,
            komada: a.units,
            porudzbina: a.orders,
          })),
          razlozi_otkazivanja: profile.cancellations.slice(0, 10).map((c) => ({
            broj: c.woo_order_id,
            status: c.status,
            razlog: c.reason,
          })),
          beleske: notes.slice(0, 5).map((n) => ({
            datum: n.created_at.slice(0, 10),
            autor: n.authorName,
            tekst: n.body,
          })),
          ...(g.needsVpCount > 0
            ? {
                napomena: `${g.needsVpCount} porudžbina bez VP — zarada je nepotpuna (niža od stvarne).`,
              }
            : {}),
        };
      },
    ),

    tool(
      "porudzbina_detalj",
      "Detalj jedne porudžbine po Woo broju (npr. 2419): status i istorija statusa sa razlozima, kupac i kontakt, stavke sa cenama i zaradom, poštarina, plaćanje.",
      z.object({ broj: z.number().int().positive().describe("Woo broj porudžbine") }),
      async ({ broj }) => {
        const o = await getOrderDetail(String(broj));
        if (!o) return { greska: `Porudžbina #${broj} ne postoji.` };
        const history = await getOrderStatusHistory(o.id);
        return {
          broj: o.woo_order_id,
          status: o.status?.name ?? null,
          isporuka: o.delivery_method,
          placanje: o.payment_status,
          fakturisano: !!o.invoice_id,
          kupac: { ime: o.customer?.name ?? o.ship_name, telefon: o.ship_phone, grad: o.ship_city },
          kreirano: o.ordered_at,
          poslato: o.shipped_at,
          isporuceno: o.delivered_at,
          placeno: o.paid_at,
          otkazano: o.cancelled_at,
          roba_rsd: o.goods_total,
          postarina_naplacena_rsd: o.shipping_charged,
          stavke: o.items.map((it) => ({
            sku: it.sku,
            naziv: it.product_name,
            kolicina: it.quantity,
            mp_rsd: it.mp_at_sale,
            vp_rsd: it.vp_at_sale,
            zarada_rsd: it.profit_at_sale,
          })),
          istorija_statusa: history.map((h) => ({
            kada: h.created_at,
            status: h.toStatus?.name ?? null,
            ko: h.changedByName,
            napomena: h.note,
          })),
          ...(o.needs_vp ? { napomena: "Bar jedna stavka nema VP — zarada nepotpuna." } : {}),
        };
      },
    ),

    tool(
      "zalihe",
      "Stanje u katalogu: „nisko” (popisane varijante na ili ispod praga), „nula” (popisane sa 0), „nepopisano” (količina nikad uneta) ili „pretraga” stanja po delu naziva/SKU-a.",
      z.object({
        vrsta: z.enum(["nisko", "nula", "nepopisano", "pretraga"]),
        pretraga: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      async ({ vrsta, pretraga, limit }) => {
        if (vrsta === "nisko" || vrsta === "nula") {
          const low = await getLowStockVariants();
          const list = vrsta === "nula" ? low.filter((v) => v.stock_quantity <= 0) : low;
          return {
            vrsta,
            ukupno: list.length,
            varijante: list.slice(0, limit).map((v) => ({
              sku: v.sku,
              naziv: v.variant_name ? `${v.product_name} — ${v.variant_name}` : v.product_name,
              stanje: v.stock_quantity,
              prag: v.low_stock_threshold,
            })),
          };
        }
        if (vrsta === "nepopisano") {
          return { vrsta, ukupno_varijanti: await getUncountedVariantCount() };
        }
        if (!pretraga || pretraga.trim().length < 2)
          return { greska: "Za pretragu je potreban deo naziva ili SKU-a." };
        const q = norm(pretraga);
        const rows = await selectAll<{
          sku: string;
          variant_name: string | null;
          stock_quantity: number;
          low_stock_threshold: number;
          stock_counted_at: string | null;
          products: { name: string; archived_at: string | null } | null;
        }>("AI: zalihe pretraga", () =>
          supabase
            .from("product_variants")
            .select(
              "sku, variant_name, stock_quantity, low_stock_threshold, stock_counted_at, products(name, archived_at)",
            )
            .is("archived_at", null)
            .order("id", { ascending: true }),
        );
        const hits = rows.filter(
          (r) =>
            r.products &&
            !r.products.archived_at &&
            norm(`${r.sku} ${r.products.name} ${r.variant_name ?? ""}`).includes(q),
        );
        return {
          vrsta,
          pretraga,
          pronadjeno: hits.length,
          varijante: hits.slice(0, limit).map((r) => ({
            sku: r.sku,
            naziv: r.variant_name ? `${r.products!.name} — ${r.variant_name}` : r.products!.name,
            stanje: r.stock_counted_at ? r.stock_quantity : null,
            popisano: !!r.stock_counted_at,
            prag: r.low_stock_threshold,
          })),
          napomena: "stanje null = količina nikad nije uneta (nepopisano).",
        };
      },
    ),

    tool(
      "finansije_stanje",
      "Trenutno stanje (ne za period): koliko drug duguje za fakturisanje (nefakturisane uplate), isporučene XExpress porudžbine koje još nisu uplaćene, i saldo poštarine.",
      z.object({}),
      async () => {
        const [duguje, kandidati, neuplaceno, postarina] = await Promise.all([
          getDrugMiDuguje(),
          getInvoiceCandidates(),
          getUnpaidDeliveredXexpress(),
          getSaldoPostarine(),
        ]);
        return {
          za_fakturisanje_rsd: duguje.total,
          nefakturisanih_uplata: kandidati.payouts.length,
          isporuceno_a_neuplaceno: {
            porudzbina: neuplaceno.length,
            otkupnina_rsd: neuplaceno.reduce((s, o) => s + o.otkup, 0),
          },
          saldo_postarine_rsd: postarina.balance,
          napomena: "Saldo poštarine > 0 znači da drug duguje Sportemu razliku u poštarini.",
        };
      },
    ),

    tool(
      "troskovi",
      "Troškovi u periodu po kategoriji (Reklame, Pakovanje, Ostalo…) sa zbirom i najvećim pojedinačnim stavkama.",
      z.object(period),
      async ({ od, do: doDate }) => {
        checkPeriod(od, doDate);
        const rows = await selectAll<{
          amount: number;
          date: string;
          description: string | null;
          category: { name: string } | null;
        }>("AI: troškovi", () =>
          supabase
            .from("expenses")
            .select("amount, date, description, category:expense_categories(name)")
            .gte("date", od)
            .lte("date", doDate)
            .order("id", { ascending: true }),
        );
        const byCat = new Map<string, number>();
        for (const r of rows) {
          const c = r.category?.name ?? "Bez kategorije";
          byCat.set(c, (byCat.get(c) ?? 0) + r.amount);
        }
        return {
          period: { od, do: doDate },
          ukupno_rsd: rows.reduce((s, r) => s + r.amount, 0),
          po_kategoriji: [...byCat.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([kategorija, iznos]) => ({ kategorija, iznos_rsd: iznos })),
          najvece_stavke: [...rows]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10)
            .map((r) => ({
              datum: r.date,
              kategorija: r.category?.name ?? null,
              opis: r.description,
              iznos_rsd: r.amount,
            })),
        };
      },
    ),

    tool(
      "otkazivanja",
      "Otkazane i vraćene porudžbine u periodu: broj i stopa, artikli koji se najčešće otkazuju/vraćaju, i upisani razlozi.",
      z.object(period),
      async ({ od, do: doDate }) => {
        checkPeriod(od, doDate);
        const s = await sales(od, doDate);
        const cancelled = s.orders.filter((o) => o.cancelled);
        const byArticle = new Map<string, { naziv: string; komada: number }>();
        for (const o of cancelled)
          for (const it of o.items) {
            const g = byArticle.get(it.sku) ?? { naziv: it.product_name, komada: 0 };
            g.komada += it.quantity;
            byArticle.set(it.sku, g);
          }

        const reasons: { broj: number | null; status: string; razlog: string }[] = [];
        const ids = cancelled.map((o) => o.id);
        if (ids.length) {
          const woo = new Map(cancelled.map((o) => [o.id, o]));
          for (const chunk of chunked(ids)) {
            const notes = mustRows<{ order_id: string; note: string | null }>(
              await supabase
                .from("order_status_history")
                .select("order_id, note")
                .in("order_id", chunk)
                .not("note", "is", null)
                .order("created_at", { ascending: false })
                .limit(1000),
              "AI: razlozi otkazivanja",
            );
            for (const n of notes) {
              const o = woo.get(n.order_id);
              if (o && n.note?.trim())
                reasons.push({ broj: o.woo_order_id, status: o.status, razlog: n.note.trim() });
            }
          }
        }

        return {
          period: { od, do: doDate },
          porudzbina_ukupno: s.orders.length,
          otkazano: cancelled.filter((o) => o.status === "Otkazano").length,
          vraceno: cancelled.filter((o) => o.status === "Vraćeno").length,
          stopa_procenat: pct(cancelled.length, s.orders.length),
          artikli: [...byArticle.entries()]
            .sort(([, a], [, b]) => b.komada - a.komada)
            .slice(0, 15)
            .map(([sku, g]) => ({ sku, naziv: g.naziv, komada: g.komada })),
          razlozi: reasons.slice(0, 40),
          napomena:
            "Razlozi postoje samo za ručne promene statusa u aplikaciji; automatska otkazivanja sa sajta nemaju razlog.",
        };
      },
    ),

    tool(
      "isplativost_artikala",
      "Računica: isplativost artikala za period — iste cifre kao strana /racunica. Po proizvodu: kataloška MP i marža (TRENUTNE cene), stvarno prodato/promet/zarada/marža iz zamrznutih cena, popust u odnosu na katalog, otkazano, ABC klasa (A = prvih 80 % zarade), kvadrant (zvezde / obim / niša / kandidati za izbacivanje — granice: medijana komada i ciljna marža), trend (30 vs 30 dana), prognoza 30 dana, dana do nule. Uz to: zbirovi, procena zarade do kraja meseca i mrtva roba (popisano stanje bez prodaje 90 dana). Koristi za pitanja o marži, šta se isplati, šta poskupeti/izbaciti, šta raste/pada.",
      z.object({
        ...period,
        cilj: z
          .number()
          .min(1)
          .max(99)
          .default(DEFAULT_TARGET_PCT)
          .describe("Ciljna marža u % (od MP)"),
        pretraga: z.string().max(100).optional().describe("Deo naziva, brenda ili SKU"),
        samo: z
          .enum([
            "sve",
            "ispod_cilja",
            "zvezde",
            "obim",
            "nisa",
            "kandidati",
            "raste",
            "pada",
            "nestaje",
          ])
          .default("sve")
          .describe("Suzi listu artikala"),
        sort: z
          .enum([
            "zarada",
            "marza",
            "katalog",
            "promet",
            "prodato",
            "popust",
            "otkazano",
            "trend",
            "prognoza",
            "do_nule",
          ])
          .default("zarada"),
        smer: z.enum(["opadajuce", "rastuce"]).default("opadajuce"),
        limit: z.number().int().min(1).max(40).default(20),
      }),
      async ({ od, do: doDate, cilj, pretraga, samo, sort, smer, limit }) => {
        checkPeriod(od, doDate);
        const data = await getRacunica({ from: od, to: doDate }, supabase);
        const base = data.rows.filter((r) => !r.archived || hasActivity(r.stats));
        const abc = classifyAbc(base);
        const median = medianQty(base);
        const quadrant = (r: (typeof base)[number]) => quadrantOf(r, median, cilj);

        const q = pretraga ? normText(pretraga.trim()) : "";
        const rows = base
          .filter((r) => {
            if (q) {
              const hay = [r.name, r.brand ?? "", ...r.variants.map((v) => v.sku)];
              if (!hay.some((h) => normText(h).includes(q))) return false;
            }
            if (samo === "ispod_cilja") {
              const m = effectiveMarginPct(r);
              return m != null && m < cilj;
            }
            if (samo === "zvezde" || samo === "obim" || samo === "nisa" || samo === "kandidati")
              return quadrant(r) === samo;
            if (samo === "raste") return ["up", "new"].includes(trendOf(r.vel).dir);
            if (samo === "pada") return trendOf(r.vel).dir === "down";
            if (samo === "nestaje") {
              const d = rowDaysToZero(r);
              return d != null && d < 30;
            }
            return true;
          })
          .sort((a, b) =>
            compareRows(a, b, sort as RacunicaSort, smer === "rastuce" ? "asc" : "desc"),
          );

        const t = data.totals;
        const abcSum = {
          A: { artikala: 0, zarada: 0 },
          B: { artikala: 0, zarada: 0 },
          C: { artikala: 0, zarada: 0 },
        };
        for (const r of base) {
          const c = abc.get(r.key) ?? "C";
          abcSum[c].artikala += 1;
          abcSum[c].zarada += r.stats.profit;
        }
        const kvadranti = { zvezde: 0, obim: 0, nisa: 0, kandidati: 0 };
        for (const r of base) {
          const k = quadrant(r);
          if (k) kvadranti[k] += 1;
        }
        const month = projectMonth(data.month);
        const dead = deadStock(data.rows, data.today, 90);

        return {
          period: { od, do: doDate },
          ciljna_marza_procenat: cilj,
          ukupno: {
            zarada_rsd: t.profit,
            promet_rsd: t.revenue,
            marza_procenat: one(t.knownRevenue > 0 ? (t.knownProfit / t.knownRevenue) * 100 : null),
            prodato_komada: t.qty,
            otkazano_komada: t.cancelledQty,
          },
          abc: abcSum,
          kvadranti: { ...kvadranti, medijana_komada: median },
          zarada_do_kraja_meseca: {
            ostvareno_rsd: month.mtdProfit,
            procena_rsd: month.projected,
            raspon_rsd: [month.low, month.high],
            tempo_rsd_dan: month.dailyAvg,
            preostalo_dana: month.remainingDays,
          },
          mrtva_roba_90_dana: {
            varijanti: dead.length,
            vrednost_po_vp_rsd: dead.reduce((s, d) => s + d.value, 0),
            najvece: dead.slice(0, 5).map((d) => ({
              artikal:
                d.variant.label === "—" ? d.productName : `${d.productName} · ${d.variant.label}`,
              sku: d.variant.sku,
              stanje: d.variant.stock,
              vrednost_po_vp_rsd: d.value,
              poslednja_prodaja: d.variant.lastSoldDay ?? "nikad od 2026-02-02",
            })),
          },
          artikala_ukupno: rows.length,
          artikli: rows.slice(0, limit).map((r) => {
            const tr = trendOf(r.vel);
            const days = rowDaysToZero(r);
            const single = r.variants.length === 1 ? r.variants[0] : null;
            return {
              naziv: r.name,
              sku: single?.sku ?? null,
              varijanti: r.variants.length,
              brend: r.brand,
              van_kataloga: r.outOfCatalog || undefined,
              arhiviran: r.archived || undefined,
              katalog_mp_rsd:
                r.mpMin == null ? null : r.mpMin === r.mpMax ? r.mpMin : [r.mpMin, r.mpMax],
              katalog_marza_procenat: one(
                single ? catalogMarginOf(single.mp, single.vp) : r.catalogMarginPct,
              ),
              prodato: r.stats.qty,
              otkazano: r.stats.cancelledQty,
              promet_rsd: r.stats.revenue,
              zarada_rsd: r.stats.profit,
              marza_procenat: one(realMarginPct(r.stats)),
              popust_vs_katalog_procenat: one(discountPct(r.stats)),
              abc: abc.get(r.key),
              kvadrant: quadrant(r),
              trend:
                tr.dir === "few"
                  ? "malo podataka"
                  : tr.dir === "new"
                    ? "novo"
                    : `${tr.pct > 0 ? "+" : ""}${Math.round(tr.pct)} %`,
              prognoza_30d_komada: one(forecastQty(r.vel)),
              dana_do_nule: days == null ? null : Math.round(days),
              stanje: r.outOfCatalog ? null : r.stock,
            };
          }),
          napomena: [
            "Kataloška marža je po TRENUTNIM cenama; stvarna je iz zamrznutih cena u periodu (posle popusta), bez otkazanih i vraćenih.",
            "Trend, prognoza, dana do nule i mrtva roba gledaju unazad od danas, ne zavise od perioda. Sezona nije uračunata (podaci od 2026-02-02).",
            t.unknownQty > 0
              ? `${t.unknownQty} kom bez unete VP — zarada nepotpuna, marža % ih ne računa.`
              : null,
          ].filter(Boolean),
        };
      },
    ),

    tool(
      "ponude_statistika",
      "Statistika upsell ponuda sa sajta (plugin Sportem Offers) za poslednjih 7, 30 ili 90 dana: prikazi, dodavanja u korpu, stopa dodavanja, porudžbine i prihod po pravilu.",
      z.object({ dana: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }),
      async ({ dana }) => {
        const p = resolveOfferPeriod({ dana: String(dana) });
        const [stats, rules] = await Promise.all([getOfferStats(p), listOfferRules()]);
        const names = new Map(rules.map((r) => [r.id, r]));
        return {
          period: { od: p.fromDate, do: p.toDate },
          pravila: stats
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 30)
            .map((r) => ({
              pravilo: names.get(r.rule_id)?.name ?? r.rule_id,
              aktivno: names.get(r.rule_id)?.active ?? false,
              ponuda: names.get(r.rule_id)?.offer_name ?? null,
              prikazi: r.impressions,
              dodato: r.adds,
              stopa_dodavanja_procenat: Math.round(r.add_rate * 1000) / 10,
              porudzbine: r.orders,
              prihod_rsd: round(r.revenue),
            })),
          napomena: "Otkazane i vraćene porudžbine nisu uračunate u porudžbine i prihod.",
        };
      },
    ),
    tool(
      "reklame_pregled",
      "Meta (Facebook/Instagram) reklame za period: potrošnja (RSD po kursu NBS i USD), klikovi, CTR, kupovine i ROAS po Meta-i, i — ključno — STVARNE porudžbine i zarada sa sajta po kampanji (UTM atribucija), zarada − potrošnja i trošak po porudžbini. Plus raspodela svih porudžbina po izvoru (Meta, ostalo, nepoznato).",
      z.object({
        ...period,
        kampanja: z
          .string()
          .optional()
          .describe("Deo naziva kampanje — vrati samo kampanje čiji naziv sadrži ovaj tekst"),
      }),
      async ({ od, do: doDate, kampanja }) => {
        checkPeriod(od, doDate);
        const [overview, attribution] = await Promise.all([
          getAdsOverview(od, doDate, supabase),
          getAdAttribution(od, doDate, supabase),
        ]);
        const t = overview.totals;
        const ads = adsSiteTotals(attribution);
        const q = kampanja ? normText(kampanja) : null;
        const rows = buildCampaignRows(overview, attribution).filter(
          (r) => !q || normText(r.name).includes(q),
        );
        const site = (s: SiteStats) => ({
          porudzbine: s.realized,
          otkazane_vracene: s.cancelled,
          promet_rsd: s.revenue,
          zarada_rsd: s.profit,
        });
        return {
          period: { od, do: doDate },
          potrosnja_rsd: t.spendRsd,
          potrosnja_usd: t.spendMinor / 100,
          klikovi_na_link: t.linkClicks,
          ctr_procenat: one(ctrPct(t)),
          meta_kupovine: t.metaPurchases,
          meta_roas: one(metaRoas(t)),
          meta_trosak_po_kupovini_rsd: costPerPurchaseRsd(t),
          sajt_porudzbine_sa_oglasa: ads.realized,
          sajt_zarada_sa_oglasa_rsd: ads.profit,
          zarada_minus_potrosnja_rsd: ads.profit - t.spendRsd,
          trosak_po_porudzbini_rsd: ads.realized > 0 ? round(t.spendRsd / ads.realized) : null,
          kampanje: rows.slice(0, 25).map((r) => ({
            naziv: r.name,
            status: r.status,
            potrosnja_rsd: r.spendRsd,
            klikovi: r.linkClicks,
            ctr_procenat: one(r.ctr),
            sajt_porudzbine: r.siteOrders,
            sajt_zarada_rsd: r.siteProfit,
            zarada_minus_potrosnja_rsd: r.net,
            trosak_po_porudzbini_rsd: r.costPerOrder,
            meta_kupovine: r.purchases,
            meta_roas: one(r.roas),
          })),
          izvori_svih_porudzbina: {
            meta_prepoznata_kampanja: site(
              [...attribution.byCampaign.values()].reduce(
                (a, b) => ({
                  orders: a.orders + b.orders,
                  realized: a.realized + b.realized,
                  cancelled: a.cancelled + b.cancelled,
                  revenue: a.revenue + b.revenue,
                  profit: a.profit + b.profit,
                  needsVp: a.needsVp + b.needsVp,
                }),
                { orders: 0, realized: 0, cancelled: 0, revenue: 0, profit: 0, needsVp: 0 },
              ),
            ),
            meta_bez_prepoznate_kampanje: site(attribution.metaUnknown),
            ostali_izvori: site(attribution.other),
            bez_podatka_o_izvoru: site(attribution.none),
            ukupno: site(attribution.total),
          },
          napomena: [
            "„Sajt“ cifre: porudžbina se pripisuje kampanji po UTM-u iz linka oglasa (poslednji klik), bez otkazanih i vraćenih; zarada = MP − VP iz zamrznutih cena (bez poštarine i drugih troškova). Kupac koji je video oglas pa došao drugim putem nije pripisan oglasu.",
            "Meta kupovine i ROAS su po Meta pikselu i njenom modelu pripisivanja — obično precenjeni.",
            ads.needsVp > 0
              ? `${ads.needsVp} porudžbina sa oglasa nema VP — zarada nepotpuna.`
              : null,
            t.missingRsd > 0
              ? "Za neke dane kurs NBS još nije stigao — potrošnja u RSD privremeno manja."
              : null,
          ].filter(Boolean),
        };
      },
    ),
  ];
}
