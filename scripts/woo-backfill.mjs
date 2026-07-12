// ============================================================================
// Sportem OS — Backfill istorijskih porudžbina (Korak 1.3)
//
// PRIMARNI IZVOR: docs/backfill/porudzbine.csv (finalni Sheets izvoz sa
// istorijskim cenama I zaradom po stavci). WooCommerce se koristi samo za
// poređenje (--reconcile) jer Woo NE nosi VP/zaradu.
//
// Zamrznute cene (ustav): mp_at_sale = Cena (po komadu), vp_at_sale =
// round(Cena − Zarada/Količina). profit_at_sale je GENERATED u bazi. Prazna
// Zarada → vp null + needs_vp. NIKAD iz današnjeg kataloga.
//
// Idempotentnost: preskače porudžbine čiji woo_order_id već postoji.
// Izolacija: istorijski zatvorene (xexpress+Completed+plaćeno) dobiju
// sintetičku fakturu ISTORIJA-BACKFILL da ne uđu u nove finansije. Keš je
// 'kes' bez fakture. Otvorene (Processing/Poslato) teku dalje u živi app.
//
// Režimi:
//   node scripts/woo-backfill.mjs                 # dry-run CSV (bez upisa)
//   node scripts/woo-backfill.mjs --apply         # upis iz CSV-a
//   node scripts/woo-backfill.mjs --reconcile     # uporedi sa Woo (bez upisa)
//   node scripts/woo-backfill.mjs --reconcile --apply-gap  # + uvezi najnovije iz Woo-a
//   opciono: --csv=putanja/do.csv
//
// Preduslovi: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY u .env.local.
// Za --reconcile još: WOO_API_URL + WOO_CONSUMER_KEY + WOO_CONSUMER_SECRET.
//
// Pokretanje: npm run backfill  |  npm run backfill:apply
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

/* ── Flag-ovi i env ────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RECONCILE = args.includes("--reconcile");
const APPLY_GAP = args.includes("--apply-gap");
const CSV_PATH =
  args.find((a) => a.startsWith("--csv="))?.slice("--csv=".length) ??
  "docs/backfill/porudzbine.csv";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error(
    "Nedostaje NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (vidi .env.local).",
  );
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const INVOICE_NUMBER = "ISTORIJA-BACKFILL";

/* ── Mapiranja (mirror lib/woo.ts + odluke plana) ──────────────────────── */

const STATUS_MAP = {
  Completed: "Isporučeno",
  Poslato: "Poslato",
  Processing: "Kreirano",
  Returned: "Vraćeno",
  Cancelled: "Otkazano",
};
const CANCELLED_RAW = new Set(["Returned", "Cancelled"]);
const LICNO_DELIVERY = new Set(["Miša", "Marko", "Vozač"]);
// BEX / X Express / prazno → xexpress

/**
 * RSD iznos → integer. CSV meša formate po kolonama:
 *   - srpske hiljade: "3.000", "16.610" (tacka + grupe od 3)  -> 3000 / 16610
 *   - decimale:       "4990.00", "12,5"  (jedna tacka/zarez + 1-2 cifre) -> 4990 / 13
 *   - prosto:         "4990"                                   -> 4990
 * Prazno/nevalidno -> null.
 */
function parseRsd(value) {
  if (value == null) return null;
  let s = String(value).trim().replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    // Evropski decimalni zapis: tacke = hiljade, zarez = decimala.
    s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const dot = s.indexOf(".");
  if (dot !== -1) {
    const tail = s.slice(dot + 1);
    // Jedna tacka + 1-2 cifre = decimala; inace grupe od 3 = hiljade.
    if (!s.includes(".", dot + 1) && tail.length <= 2) {
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    s = s.replace(/\./g, "");
  }
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** Telefon u kanonski "0..." oblik za dedup (mirror lib/woo.normalizePhone). */
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00381")) d = `0${d.slice(5)}`;
  else if (d.startsWith("381")) d = `0${d.slice(3)}`;
  if (d.length < 6) return null;
  return d;
}

/** Offset zone (ms) u datom UTC trenutku — preko Intl (CET/CEST automatski). */
function tzOffsetMs(tz, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asLocal - utcMs;
}

/** "HH:MM:SS DD.MM.YYYY" (Europe/Belgrade) → ISO UTC string. Nevalidno → null. */
function parseSerbianDate(value) {
  const m = String(value ?? "")
    .trim()
    .match(/^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, hh, mi, ss, dd, mo, yyyy] = m.map(Number);
  const guess = Date.UTC(yyyy, mo - 1, dd, hh, mi, ss);
  const off = tzOffsetMs("Europe/Belgrade", guess);
  return new Date(guess - off).toISOString();
}

function deliveryMethod(dostava) {
  return LICNO_DELIVERY.has((dostava ?? "").trim()) ? "licno" : "xexpress";
}

/* ── Parsiranje CSV-a → porudžbine + stavke ────────────────────────────── */

function loadCsvOrders() {
  const raw = readFileSync(path.resolve(process.cwd(), CSV_PATH), "utf8");
  const { data, errors } = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  if (errors.length) {
    console.warn(`CSV parse upozorenja: ${errors.length} (prvo: ${errors[0]?.message}).`);
  }

  // Grupiši redove po ID (jedan ID = jedna porudžbina, više stavki).
  const byId = new Map();
  for (const r of data) {
    const id = (r["ID"] ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(r);
  }

  const orders = [];
  for (const [id, rows] of byId) {
    const head = rows[0];
    const rawStatus = (head["Status"] ?? "").trim();
    const statusName = STATUS_MAP[rawStatus] ?? "Kreirano";
    const delivery = deliveryMethod(head["Dostava"]);
    const isPaid = (head["Isplaćeno"] ?? "").trim() === "Da";
    const orderedAt = parseSerbianDate(head["Datum"]);

    const items = rows.map((r) => {
      const cena = parseRsd(r["Cena"]);
      const qtyRaw = parseInt((r["Količina"] ?? "").trim(), 10);
      const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const zarada = parseRsd(r["Zarada po proizvodu"]); // po stavci (već ×kol)
      const mp = cena ?? 0;
      const vp = zarada == null ? null : Math.round(mp - zarada / quantity);
      return {
        sku: (r["Šifra proizvoda"] ?? "").trim() || "NEPOZNAT",
        product_name: (r["Naziv proizvoda"] ?? "").trim() || "Nepoznat artikal",
        quantity,
        mp_at_sale: mp,
        vp_at_sale: vp,
        _zarada_csv: zarada, // za kontrolni zbir (ne upisuje se)
      };
    });

    const needsVp = items.some((i) => i.vp_at_sale == null);
    const goodsTotal = items.reduce((s, i) => s + i.mp_at_sale * i.quantity, 0);
    const declaredTotal = parseRsd(head["Ukupna cena porudžbine"]);

    // Datumi životnog ciklusa (CSV nema tačan datum isporuke → ≈ ordered_at).
    const isCancelled = CANCELLED_RAW.has(rawStatus);
    const dates = {
      ordered_at: orderedAt,
      shipped_at: rawStatus === "Completed" || rawStatus === "Poslato" ? orderedAt : null,
      delivered_at: rawStatus === "Completed" ? orderedAt : null,
      cancelled_at: isCancelled ? orderedAt : null,
      paid_at: null,
    };

    // Payment status + izolacija (tri toka novca — odluka 5 plana).
    let paymentStatus = "neuplaceno";
    let isolated = false; // dobija sintetičku fakturu
    if (isPaid && !isCancelled) {
      dates.paid_at = orderedAt;
      if (delivery === "licno") {
        paymentStatus = "kes";
      } else {
        paymentStatus = "uplaceno";
        if (rawStatus === "Completed") isolated = true;
      }
    }

    orders.push({
      woo_order_id: Number(id),
      raw_status: rawStatus,
      status_name: statusName,
      delivery_method: delivery,
      payment_status: paymentStatus,
      isolated,
      needs_vp: needsVp,
      goods_total: goodsTotal,
      declared_total: declaredTotal,
      customer: {
        name: (head["Ime i prezime"] ?? "").trim() || null,
        phone: normalizePhone(head["Broj telefona"]),
        email: (head["Email"] ?? "").trim() || null,
        address: (head["Adresa"] ?? "").trim() || null,
        city: (head["Grad"] ?? "").trim() || null,
        postal_code: (head["Poštanski broj"] ?? "").trim() || null,
      },
      ship: {
        ship_name: (head["Ime i prezime"] ?? "").trim() || null,
        ship_phone: normalizePhone(head["Broj telefona"]),
        ship_address: (head["Adresa"] ?? "").trim() || null,
        ship_city: (head["Grad"] ?? "").trim() || null,
        ship_postal_code: (head["Poštanski broj"] ?? "").trim() || null,
        ship_note: (head["Dodatna napomena"] ?? "").trim() || null,
      },
      ...dates,
      items,
    });
  }
  return orders;
}

/* ── DB pomoćnici ──────────────────────────────────────────────────────── */

async function loadStatusIds() {
  const { data, error } = await db.from("order_statuses").select("id, name");
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.name, s.id]));
}

async function loadExistingWooIds() {
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("orders")
      .select("woo_order_id")
      .not("woo_order_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) ids.add(Number(r.woo_order_id));
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

async function loadVariantIdBySku() {
  const map = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("product_variants")
      .select("id, sku")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const v of data ?? []) map.set(v.sku, v.id);
    if (!data || data.length < PAGE) break;
  }
  return map;
}

/** Sintetička istorijska faktura — kreira se/nalazi po broju. */
async function ensureBackfillInvoice(periodFrom, periodTo) {
  const { data: found } = await db
    .from("invoices")
    .select("id")
    .eq("invoice_number", INVOICE_NUMBER)
    .maybeSingle();
  if (found) return found.id;
  const { data, error } = await db
    .from("invoices")
    .insert({
      invoice_number: INVOICE_NUMBER,
      period_from: periodFrom,
      period_to: periodTo,
      total_amount: 0,
      status: "placeno",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Upsert kupca po telefonu (dedup); bez telefona → nov red. Kešira po telefonu. */
async function upsertCustomer(customer, cache) {
  if (customer.phone && cache.has(customer.phone)) return cache.get(customer.phone);
  const row = {
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    postal_code: customer.postal_code,
  };
  if (customer.phone) {
    const { data, error } = await db
      .from("customers")
      .upsert(row, { onConflict: "phone" })
      .select("id")
      .single();
    if (error) throw error;
    cache.set(customer.phone, data.id);
    return data.id;
  }
  const { data, error } = await db.from("customers").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/* ── Izveštaj (dry-run i pre apply-a) ──────────────────────────────────── */

function report(orders, existing) {
  const neworders = orders.filter((o) => !existing.has(o.woo_order_id));
  const skip = orders.length - neworders.length;

  const byStatus = {};
  const byDelivery = {};
  let itemCount = 0;
  let needsVpOrders = 0;
  let needsVpItems = 0;
  let isolated = 0;
  let kes = 0;
  let open = 0;
  let cancelled = 0;
  let profitApp = 0; // Σ (mp-vp)*qty gde je vp poznat
  let profitCsv = 0; // Σ Zarada po proizvodu iz CSV-a
  const mismatches = [];

  for (const o of neworders) {
    byStatus[o.status_name] = (byStatus[o.status_name] ?? 0) + 1;
    byDelivery[o.delivery_method] = (byDelivery[o.delivery_method] ?? 0) + 1;
    itemCount += o.items.length;
    if (o.needs_vp) needsVpOrders++;
    if (o.isolated) isolated++;
    else if (o.payment_status === "kes") kes++;
    else if (CANCELLED_RAW.has(o.raw_status)) cancelled++;
    else open++;
    for (const it of o.items) {
      if (it.vp_at_sale == null) needsVpItems++;
      else profitApp += (it.mp_at_sale - it.vp_at_sale) * it.quantity;
      if (it._zarada_csv != null) profitCsv += it._zarada_csv;
    }
    if (o.declared_total != null && o.declared_total !== o.goods_total) {
      mismatches.push(`#${o.woo_order_id} (Σstavke ${o.goods_total} ≠ CSV ${o.declared_total})`);
    }
  }

  const money = (n) => n.toLocaleString("sr-RS");
  console.log("\n════════ BACKFILL IZVEŠTAJ ════════");
  console.log(`CSV: ${CSV_PATH}`);
  console.log(
    `Porudžbina u CSV-u: ${orders.length}  |  novih: ${neworders.length}  |  već postoji (preskačem): ${skip}`,
  );
  console.log(`Stavki (nove): ${itemCount}`);
  console.log(`Status:   ${JSON.stringify(byStatus)}`);
  console.log(`Dostava:  ${JSON.stringify(byDelivery)}`);
  console.log(
    `Kategorije novca → izolovano (faktura): ${isolated} · keš: ${kes} · otvoreno (živo): ${open} · otkazano: ${cancelled}`,
  );
  console.log(`needs_vp: ${needsVpOrders} porudžbina / ${needsVpItems} stavki`);
  console.log(`\nKONTROLNI ZBIR ZARADE (samo gde je VP poznat):`);
  console.log(`  Iz app-mapiranja: ${money(profitApp)} RSD`);
  console.log(`  Iz CSV „Zarada":  ${money(profitCsv)} RSD`);
  console.log(
    `  Razlika:          ${money(profitApp - profitCsv)} RSD  ${profitApp === profitCsv ? "✓" : "✗ PROVERI"}`,
  );
  if (mismatches.length) {
    console.log(
      `\ngoods_total ≠ CSV „Ukupna cena" na ${mismatches.length} porudžbina (informativno; čuvamo Σstavke):`,
    );
    console.log("  " + mismatches.slice(0, 20).join(", ") + (mismatches.length > 20 ? " …" : ""));
  }
  console.log("═══════════════════════════════════\n");
  return { neworders };
}

/* ── Apply (CSV → baza) ────────────────────────────────────────────────── */

async function apply(neworders, statusIds, variantBySku) {
  if (neworders.length === 0) {
    console.log("Nema novih porudžbina za upis.");
    return;
  }
  const dated = neworders
    .map((o) => o.ordered_at)
    .filter(Boolean)
    .sort();
  const periodFrom = dated[0]?.slice(0, 10) ?? null;
  const periodTo = dated[dated.length - 1]?.slice(0, 10) ?? null;
  const invoiceId = await ensureBackfillInvoice(periodFrom, periodTo);

  const custCache = new Map();
  let inserted = 0;
  let failed = 0;

  for (const o of neworders) {
    const statusId = statusIds.get(o.status_name);
    if (!statusId) {
      console.error(`  ✗ #${o.woo_order_id}: nepoznat status „${o.status_name}" — preskačem.`);
      failed++;
      continue;
    }
    let customerId = null;
    try {
      customerId = await upsertCustomer(o.customer, custCache);
    } catch (e) {
      console.error(`  ✗ #${o.woo_order_id}: kupac — ${e.message}`);
      failed++;
      continue;
    }

    const { data: created, error: orderErr } = await db
      .from("orders")
      .insert({
        woo_order_id: o.woo_order_id,
        customer_id: customerId,
        status_id: statusId,
        invoice_id: o.isolated ? invoiceId : null,
        delivery_method: o.delivery_method,
        payment_status: o.payment_status,
        ...o.ship,
        goods_total: o.goods_total,
        needs_vp: o.needs_vp,
        ordered_at: o.ordered_at,
        shipped_at: o.shipped_at,
        delivered_at: o.delivered_at,
        paid_at: o.paid_at,
        cancelled_at: o.cancelled_at,
        woo_status: o.raw_status,
      })
      .select("id")
      .single();
    if (orderErr) {
      if (orderErr.code === "23505") continue; // idempotentno: neko ga je upisao
      console.error(`  ✗ #${o.woo_order_id}: order — ${orderErr.message}`);
      failed++;
      continue;
    }

    const itemsRows = o.items.map((i) => ({
      order_id: created.id,
      variant_id: variantBySku.get(i.sku) ?? null,
      sku: i.sku,
      product_name: i.product_name,
      quantity: i.quantity,
      mp_at_sale: i.mp_at_sale,
      vp_at_sale: i.vp_at_sale,
    }));
    const { error: itemsErr } = await db.from("order_items").insert(itemsRows);
    if (itemsErr) {
      await db.from("orders").delete().eq("id", created.id); // ručni rollback
      console.error(`  ✗ #${o.woo_order_id}: stavke — ${itemsErr.message}`);
      failed++;
      continue;
    }
    inserted++;
    if (inserted % 100 === 0) console.log(`  … upisano ${inserted}`);
  }

  // Sintetička faktura: total = Σ profit_at_sale izolovanih porudžbina.
  const { data: invOrders } = await db.from("orders").select("id").eq("invoice_id", invoiceId);
  const orderIds = (invOrders ?? []).map((r) => r.id);
  let invoiceTotal = 0;
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const { data: its } = await db
      .from("order_items")
      .select("profit_at_sale")
      .in("order_id", chunk);
    for (const it of its ?? []) invoiceTotal += it.profit_at_sale ?? 0;
  }
  await db.from("invoices").update({ total_amount: invoiceTotal }).eq("id", invoiceId);

  console.log(`\n✅ Upisano ${inserted} porudžbina (${failed} grešaka).`);
  console.log(
    `   Sintetička faktura ${INVOICE_NUMBER}: total_amount = ${invoiceTotal.toLocaleString("sr-RS")} RSD.`,
  );
}

/* ── Reconcile sa Woo REST API ─────────────────────────────────────────── */

async function fetchWooOrders() {
  const base = process.env.WOO_API_URL;
  const key = process.env.WOO_CONSUMER_KEY;
  const secret = process.env.WOO_CONSUMER_SECRET;
  if (!base || !key || !secret) {
    console.error("Za --reconcile treba WOO_API_URL / WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET.");
    process.exit(2);
  }
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const all = [];
  for (let page = 1; ; page++) {
    const url = `${base.replace(/\/$/, "")}/orders?per_page=100&page=${page}&status=any&orderby=id&order=asc`;
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) {
      console.error(`Woo API ${res.status} na strani ${page}: ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    const batch = await res.json();
    all.push(...batch);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages || batch.length === 0) break;
  }
  return all;
}

async function reconcile(existing) {
  console.log("\nPovlačim porudžbine iz WooCommerce-a…");
  const woo = await fetchWooOrders();
  const wooIds = new Set(woo.map((o) => Number(o.id)));
  const missingInDb = woo.filter((o) => !existing.has(Number(o.id)));
  const inDbNotWoo = [...existing].filter((id) => !wooIds.has(id));

  console.log(`\n════════ WOO RECONCILE ════════`);
  console.log(`Woo porudžbina ukupno: ${woo.length}`);
  console.log(`U bazi (woo_order_id): ${existing.size}`);
  console.log(`Woo, a NEMA u bazi (fale — najverovatnije najnovije): ${missingInDb.length}`);
  if (missingInDb.length) {
    console.log(
      "  " +
        missingInDb
          .map((o) => `#${o.id}(${o.status})`)
          .slice(0, 40)
          .join(", ") +
        (missingInDb.length > 40 ? " …" : ""),
    );
  }
  console.log(`U bazi, a NEMA u Woo-u: ${inDbNotWoo.length}`);
  if (inDbNotWoo.length)
    console.log("  " + inDbNotWoo.slice(0, 40).join(", ") + (inDbNotWoo.length > 40 ? " …" : ""));
  console.log("════════════════════════════════\n");

  if (APPLY_GAP && missingInDb.length) {
    console.log(`--apply-gap: uvozim ${missingInDb.length} porudžbina iz Woo-a (VP iz kataloga)…`);
    await applyGap(missingInDb);
  } else if (missingInDb.length) {
    console.log("Za uvoz najnovijih iz Woo-a pokreni ponovo sa: --reconcile --apply-gap");
  }
}

/** Gap-fill: Woo porudžbine kojih nema u bazi → webhook-stil (VP iz kataloga). */
async function applyGap(wooOrders) {
  const statusIds = await loadStatusIds();
  const custCache = new Map();
  // Katalog: sku → {id, vp_price} (VP iz kataloga jer su ove porudžbine skorašnje).
  const variants = new Map();
  {
    const { data } = await db.from("product_variants").select("id, sku, vp_price");
    for (const v of data ?? []) variants.set(v.sku, v);
  }
  const createdName = "Kreirano";
  const cancelledName = "Otkazano";
  const CANCEL = new Set(["cancelled", "refunded", "failed", "trash"]);
  let inserted = 0;

  for (const o of wooOrders) {
    const phone = normalizePhone(o.billing?.phone || o.shipping?.phone);
    const custId = await upsertCustomer(
      {
        name: `${o.billing?.first_name ?? ""} ${o.billing?.last_name ?? ""}`.trim() || null,
        phone,
        email: o.billing?.email?.trim() || null,
        address: (o.shipping?.address_1 || o.billing?.address_1 || "").trim() || null,
        city: (o.shipping?.city || o.billing?.city || "").trim() || null,
        postal_code: (o.shipping?.postcode || o.billing?.postcode || "").trim() || null,
      },
      custCache,
    );

    const items = (o.line_items ?? []).map((li) => {
      const sku = (li.sku ?? "").trim();
      const v = sku ? variants.get(sku) : undefined;
      const qty = Number(li.quantity) || 1;
      const lineTotal = parseRsd(li.total);
      const mp = lineTotal != null ? Math.round(lineTotal / qty) : (parseRsd(li.price) ?? 0);
      return {
        variant_id: v?.id ?? null,
        sku: sku || "NEPOZNAT",
        product_name: (li.name ?? "").trim() || "Nepoznat artikal",
        quantity: qty,
        mp_at_sale: mp,
        vp_at_sale: v?.vp_price ?? null,
      };
    });
    const cancelled = CANCEL.has(o.status);
    const statusId = statusIds.get(cancelled ? cancelledName : createdName);
    const goodsTotal = items.reduce((s, i) => s + i.mp_at_sale * i.quantity, 0);
    const orderedAt = o.date_created_gmt ? `${o.date_created_gmt}Z` : null;

    const { data: created, error } = await db
      .from("orders")
      .insert({
        woo_order_id: Number(o.id),
        customer_id: custId,
        status_id: statusId,
        delivery_method: "xexpress",
        payment_status: "neuplaceno",
        ship_name: `${o.shipping?.first_name ?? ""} ${o.shipping?.last_name ?? ""}`.trim() || null,
        ship_phone: normalizePhone(o.shipping?.phone || o.billing?.phone),
        ship_address: (o.shipping?.address_1 || o.billing?.address_1 || "").trim() || null,
        ship_city: (o.shipping?.city || o.billing?.city || "").trim() || null,
        ship_postal_code: (o.shipping?.postcode || o.billing?.postcode || "").trim() || null,
        ship_note: o.customer_note?.trim() || null,
        goods_total: goodsTotal,
        needs_vp: items.some((i) => i.vp_at_sale == null),
        ordered_at: orderedAt,
        cancelled_at: cancelled ? new Date().toISOString() : null,
        woo_status: o.status,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") continue;
      console.error(`  ✗ #${o.id}: ${error.message}`);
      continue;
    }
    if (items.length) {
      const { error: iErr } = await db
        .from("order_items")
        .insert(items.map((i) => ({ ...i, order_id: created.id })));
      if (iErr) {
        await db.from("orders").delete().eq("id", created.id);
        console.error(`  ✗ #${o.id}: stavke — ${iErr.message}`);
        continue;
      }
    }
    inserted++;
  }
  console.log(`✅ Gap-fill: upisano ${inserted} porudžbina iz Woo-a.`);
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  const existing = await loadExistingWooIds();

  if (RECONCILE) {
    await reconcile(existing);
    return;
  }

  const orders = loadCsvOrders();
  const { neworders } = report(orders, existing);

  if (!APPLY) {
    console.log("DRY-RUN — ništa nije upisano. Za upis pokreni: npm run backfill:apply");
    return;
  }
  const statusIds = await loadStatusIds();
  const variantBySku = await loadVariantIdBySku();
  await apply(neworders, statusIds, variantBySku);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
