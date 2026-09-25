// ============================================================================
// Sportem OS — merenje brzine dohvata podataka (Korak K1 iz
// docs/Sportem-Plan-Optimizacija.md)
//
// Sonda po stranici ponavlja TAČAN niz upita koji ta stranica danas radi kroz
// `db/` sloj (isti filteri, isti redosled, ista paralelizacija kroz Promise.all).
// Cilj je broj koji se može uporediti posle svakog koraka optimizacije.
//
// Meri se dva puta:
//   (a) ulogovan kao Admin kroz ANON ključ  → RLS je aktivan (prava cena)
//   (b) kroz SERVICE-ROLE ključ             → RLS zaobiđen
//   razlika = „RLS overhead"
// Bez Admin kredencijala (.env.test.local) radi samo (b), uz upozorenje.
//
// Za svaki upit se prijavljuje: trajanje, broj redova i UPOZORENJE ako je
// `error != null` ILI ako je vraćeno TAČNO 1000 redova (tihi PostgREST cap —
// app to danas guta, v. docs/backlog.md #0).
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete/rpc koji piše.
//
// Pokretanje:
//   npm run perf                 (sve sonde, 3 pokretanja → medijana)
//   npm run perf -- --runs=1     (jedno pokretanje; brže, ali šumnije)
//   npm run perf -- --only=porudzbine,dashboard
//   npm run perf -- --list       (spisak sondi)
//   npm run perf > docs/perf/2026-09-25-perf-baseline.txt
//
// Zašto medijana: prvo pokretanje plaća hladnu konekciju (DNS/TLS) i hladan
// Postgres keš, pa je za 3–4× sporije od narednih. Poređenje „pre/posle koraka"
// ima smisla samo nad medijanom više pokretanja.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY, RLS_TEST_ADMIN_EMAIL, RLS_TEST_ADMIN_PASSWORD
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.RLS_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.RLS_TEST_ADMIN_PASSWORD;

/* ── Konstante prepisane iz app koda (skripta je .mjs, ne može TS import) ──
   Ako se promene u lib/db sloju, promeni ih i ovde — sonda mora da prati kod. */
const APP_STATUS = {
  created: "Kreirano",
  sent: "Poslato",
  delivered: "Isporučeno",
  cancelled: "Otkazano",
  returned: "Vraćeno",
}; // lib/woo.ts
const CANCELLED_STATUS_NAMES = [APP_STATUS.cancelled, APP_STATUS.returned];

const PAGE_SIZE = 1000; // lib/supabase/paginate.ts PAGE_SIZE
const IN_CHUNK = 200; // lib/supabase/paginate.ts IN_CHUNK (jedina konstanta te veličine)
const ORDERS_PER_PAGE = 25; // db/orders.ts DEFAULT_PER_PAGE
const TICKET_SCAN_CAP = 2000; // db/tickets.ts SCAN_CAP
const LINKED_TICKETS_LIMIT = 20; // db/tickets.ts
const PDV_RATE = 20; // db/finance.ts XEXPRESS_VAT_RATE

const ORDER_LIST_COLS =
  "id, woo_order_id, ordered_at, goods_total, needs_vp, needs_review, ship_name, ship_phone, status:order_statuses(name, color), customer:customers(name, phone, email)";
const ORDER_DETAIL_COLS = `id, woo_order_id, customer_id, delivery_method, payment_status, invoice_id, needs_vp, needs_review,
   review_reason, woo_status, ship_name, ship_phone, ship_address, ship_city,
   ship_postal_code, ship_note, goods_total, shipping_charged, shipping_actual,
   weight_grams, package_count, cod_amount,
   ordered_at, shipped_at, delivered_at, paid_at, cancelled_at,
   status:order_statuses(name, color),
   customer:customers(name, phone, email),
   items:order_items(id, variant_id, sku, product_name, quantity, mp_at_sale, vp_at_sale, profit_at_sale)`;
const PRODUCT_COLS =
  "id, name, description, brand, image, category_id, attribute_names, archived_at, updated_at";
const VARIANT_STAFF_COLS =
  "id, product_id, sku, variant_name, stock_quantity, low_stock_threshold, supplier_sku, weight_grams, image, archived_at, attributes, stock_counted_at, mp_price, vp_price, profit";
const TICKET_COLS = `id, code, title, description, column_id, priority_id, position, due_date,
  estimate_minutes, completed_at, source, created_at, blocked_by_ticket_id,
  order_id, variant_id, customer_id, created_by,
  priority:ticket_priorities(id, name, color, level)`;

/* ── Belgrade datumi (prepis iz lib/date-belgrade.ts + lib/period.ts) ────── */

function belgradeDate(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function todayBelgrade() {
  return belgradeDate(new Date().toISOString());
}

/** Tekući mesec (podrazumevani period Dashboarda) — inkluzivne granice. */
function currentMonthPeriod() {
  const today = todayBelgrade();
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${today.slice(0, 7)}-01`,
    to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`,
  };
}

/** lib/period.ts rangeToUtcPrefilter */
function rangeToUtcPrefilter(from, to) {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return {
    gteUtc: new Date(fromMs - 86_400_000).toISOString(),
    ltUtc: new Date(toMs + 2 * 86_400_000).toISOString(),
  };
}

/* ── Merenje ─────────────────────────────────────────────────────────────── */

/**
 * Snimač upita. `run(label, build)` startuje štopericu, čeka PostgREST builder
 * (lazy — request kreće tek na await) i beleži trajanje/redove/upozorenja.
 * Greška se hvata i upisuje, nikad ne obara sondu (fetch failed je nalaz).
 */
function makeRecorder() {
  const queries = [];
  return {
    queries,
    /**
     * `paged: true` = strana iz `paginated()` petlje. Tada pun blok od 1000
     * redova NIJE nalaz (petlja nastavlja na sledeću stranu); upozorenje ostaje
     * samo za upite koji čitaju „jednim potezom" i tiho bi bili odsečeni.
     */
    async run(label, build, { paged = false } = {}) {
      const t0 = performance.now();
      let res;
      try {
        res = await build();
      } catch (err) {
        res = { data: null, count: null, error: { message: String(err?.message ?? err) } };
      }
      const ms = performance.now() - t0;
      const data = res?.data ?? null;
      const rows =
        res?.count != null ? res.count : Array.isArray(data) ? data.length : data ? 1 : 0;

      const warnings = [];
      if (res?.error) warnings.push(`GREŠKA: ${res.error.message}`);
      if (!paged && Array.isArray(data) && data.length === 1000) {
        warnings.push("TAČNO 1000 REDOVA — tihi PostgREST cap?");
      }
      queries.push({ label, ms, rows, warnings });
      return res;
    },
  };
}

/* ── Mirror lib/supabase/paginate.ts (sonda mora da radi isto što i app) ─── */

/** `chunked(ids, IN_CHUNK)` iz lib/supabase/paginate.ts. */
function chunks(ids, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * `selectAll()` iz lib/supabase/paginate.ts: `.range()` petlja dok stiže pun
 * blok. Svaka strana se meri zasebno (round-tripovi su ono što merimo).
 */
async function paginated(rec, label, build, { maxRows } = {}) {
  const limit = maxRows ?? Number.POSITIVE_INFINITY;
  const rows = [];
  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, limit - offset);
    const suffix = offset === 0 ? "" : ` (strana ${offset / PAGE_SIZE + 1})`;
    const res = await rec.run(`${label}${suffix}`, () => build().range(offset, offset + size - 1), {
      paged: true,
    });
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}

/** `selectAllIn()`: parčad po IN_CHUNK, svako paginirano. */
async function paginatedIn(rec, label, ids, build) {
  const rows = [];
  const parts = chunks(ids);
  for (let i = 0; i < parts.length; i += 1) {
    rows.push(
      ...(await paginated(rec, `${label} .in(${parts[i].length}) [${i + 1}/${parts.length}]`, () =>
        build(parts[i]),
      )),
    );
  }
  return rows;
}

/* ── Sonde: tačan niz upita po stranici ──────────────────────────────────── */

/**
 * db/metrics.ts → computePeriodMetrics (Dashboard metrike + Finansije neto).
 * Paginacija po 1000 + `.in(order_id, …)` po 200.
 */
async function computePeriodMetrics(ctx, { from, to }, prefix) {
  const { rec, c } = ctx;
  const cancel = await rec.run(`${prefix} order_statuses (Otkazano/Vraćeno)`, () =>
    c.from("order_statuses").select("id").in("name", CANCELLED_STATUS_NAMES),
  );
  const excluded = new Set((cancel.data ?? []).map((s) => s.id));

  const { gteUtc, ltUtc } = rangeToUtcPrefilter(from, to);
  const orderRows = await paginated(rec, `${prefix} orders u periodu`, () =>
    c
      .from("orders")
      .select("id, ordered_at, status_id")
      .not("ordered_at", "is", null)
      .gte("ordered_at", gteUtc)
      .lt("ordered_at", ltUtc)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  const inRange = orderRows.filter((o) => {
    const d = belgradeDate(o.ordered_at);
    return d >= from && d <= to;
  });
  const realized = inRange.filter((o) => !excluded.has(o.status_id));

  await paginatedIn(
    rec,
    `${prefix} order_items`,
    realized.map((o) => o.id),
    (chunk) =>
      c
        .from("order_items")
        .select("quantity, mp_at_sale, profit_at_sale")
        .in("order_id", chunk)
        .order("id", { ascending: true }),
  );

  await paginated(rec, `${prefix} expenses u periodu`, () =>
    c
      .from("expenses")
      .select("amount")
      .gte("date", from)
      .lte("date", to)
      .order("id", { ascending: true }),
  );
}

/** db/finance.ts → getUnpaidDeliveredXexpress (status lookup + porudžbine). */
async function getUnpaidDeliveredXexpress(ctx, prefix) {
  const { rec, c } = ctx;
  const delivered = await rec.run(`${prefix} order_statuses (Isporučeno)`, () =>
    c.from("order_statuses").select("id").eq("name", APP_STATUS.delivered).maybeSingle(),
  );
  const id = delivered.data?.id;
  if (!id) return [];
  return await paginated(rec, `${prefix} orders isporučeno+neuplaćeno`, () =>
    c
      .from("orders")
      .select("id, woo_order_id, ship_name, goods_total, shipping_charged, delivered_at")
      .eq("delivery_method", "xexpress")
      .eq("payment_status", "neuplaceno")
      .eq("status_id", id)
      .is("payout_id", null)
      .order("delivered_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );
}

/** db/customer-risk.ts → buildCancellationIndex (sve otkazane/vraćene). */
async function buildCancellationIndex(ctx, prefix) {
  const { rec, c } = ctx;
  return await paginated(rec, `${prefix} orders otkazane (indeks rizika)`, () =>
    c
      .from("orders")
      .select("id, woo_order_id, ordered_at, ship_phone, customer:customers(phone, email)")
      .not("cancelled_at", "is", null)
      .order("id", { ascending: true }),
  );
}

/** db/profiles.ts → listStaffProfiles: UVEK kroz service-role (i u RLS režimu). */
async function listStaffProfiles(ctx, prefix) {
  const { rec, admin, c } = ctx;
  const client = admin ?? c;
  return await paginated(rec, `${prefix} profiles (service-role)`, () =>
    client
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["admin", "manager"])
      .order("full_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );
}

/** db/tickets.ts → hydrateTickets (7 paralelnih dopuna, bez N+1). */
async function hydrateTickets(ctx, raw, prefix) {
  const { rec, c } = ctx;
  const ids = raw.map((t) => t.id);
  if (ids.length === 0) return;
  const orderIds = [...new Set(raw.map((t) => t.order_id).filter(Boolean))];
  const variantIds = [...new Set(raw.map((t) => t.variant_id).filter(Boolean))];
  const customerIds = [...new Set(raw.map((t) => t.customer_id).filter(Boolean))];
  const blockerIds = [...new Set(raw.map((t) => t.blocked_by_ticket_id).filter(Boolean))];

  await Promise.all([
    paginatedIn(rec, `${prefix} ticket_assignees`, ids, (chunk) =>
      c
        .from("ticket_assignees")
        .select("ticket_id, user_id")
        .in("ticket_id", chunk)
        .order("ticket_id", { ascending: true })
        .order("user_id", { ascending: true }),
    ),
    paginatedIn(rec, `${prefix} ticket_tag_links`, ids, (chunk) =>
      c
        .from("ticket_tag_links")
        .select("ticket_id, tag:ticket_tags(id, name, color, sort_order)")
        .in("ticket_id", chunk)
        .order("ticket_id", { ascending: true })
        .order("tag_id", { ascending: true }),
    ),
    listStaffProfiles(ctx, prefix),
    paginatedIn(rec, `${prefix} vezane porudžbine`, orderIds, (chunk) =>
      c
        .from("orders")
        .select("id, woo_order_id, ship_name")
        .in("id", chunk)
        .order("id", { ascending: true }),
    ),
    paginatedIn(rec, `${prefix} vezane varijante`, variantIds, (chunk) =>
      c
        .from("product_variants")
        .select("id, sku, variant_name, product:products(name)")
        .in("id", chunk)
        .order("id", { ascending: true }),
    ),
    paginatedIn(rec, `${prefix} vezani kupci`, customerIds, (chunk) =>
      c
        .from("customers")
        .select("id, name, phone")
        .in("id", chunk)
        .order("id", { ascending: true }),
    ),
    paginatedIn(rec, `${prefix} blokirajući tiketi`, blockerIds, (chunk) =>
      c
        .from("tickets")
        .select("id, code, title, completed_at")
        .in("id", chunk)
        .order("id", { ascending: true }),
    ),
  ]);
}

/** lib/auth.ts → getProfile: `profiles` red ulogovanog korisnika (svaka strana). */
async function getProfileQuery(ctx) {
  if (!ctx.userId) return; // bez sesije (samo service-role režim) — nema šta da se čita
  await ctx.rec.run("getProfile → profiles (sesija)", () =>
    ctx.c.from("profiles").select("id, full_name, role").eq("id", ctx.userId).single(),
  );
}

const PROBES = [
  {
    key: "dashboard",
    name: "Dashboard  (app/(app)/page.tsx)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);
      const period = currentMonthPeriod();

      await Promise.all([
        // getDashboardMetrics → computePeriodMetrics
        computePeriodMetrics(ctx, period, "metrike:"),
        // getWaitingOrders
        (async () => {
          const created = await rec.run("čeka: order_statuses (Kreirano)", () =>
            c.from("order_statuses").select("id").eq("name", APP_STATUS.created).maybeSingle(),
          );
          await Promise.all([
            rec.run("čeka: orders count needs_vp", () =>
              c.from("orders").select("id", { count: "exact", head: true }).eq("needs_vp", true),
            ),
            created.data?.id
              ? rec.run("čeka: orders count Kreirano", () =>
                  c
                    .from("orders")
                    .select("id", { count: "exact", head: true })
                    .eq("status_id", created.data.id),
                )
              : Promise.resolve(),
            getUnpaidDeliveredXexpress(ctx, "čeka:"),
            rec.run("čeka: orders count needs_review", () =>
              c
                .from("orders")
                .select("id", { count: "exact", head: true })
                .eq("needs_review", true),
            ),
          ]);
        })(),
        // getLowStockVariants
        paginated(rec, "nisko stanje: product_variants + products", () =>
          c
            .from("product_variants")
            .select(
              "id, product_id, sku, variant_name, stock_quantity, low_stock_threshold, archived_at, products(name, archived_at)",
            )
            .is("archived_at", null)
            .not("stock_counted_at", "is", null)
            .order("id", { ascending: true }),
        ),
        // getUncountedVariantCount
        paginated(rec, "fali količina: product_variants", () =>
          c
            .from("product_variants")
            .select("id, products(archived_at)")
            .is("archived_at", null)
            .is("stock_counted_at", null)
            .order("id", { ascending: true }),
        ),
        // getMyTicketsSummary
        (async () => {
          const [open] = await Promise.all([
            paginated(
              rec,
              "moji tiketi: tickets otvoreni",
              () =>
                c
                  .from("tickets")
                  .select("id, due_date, column_id")
                  .is("completed_at", null)
                  .order("id", { ascending: true }),
              { maxRows: TICKET_SCAN_CAP },
            ),
            paginated(rec, "moji tiketi: ticket_columns", () =>
              c
                .from("ticket_columns")
                .select("id, name, color, sort_order, is_done, wip_limit")
                .order("sort_order", { ascending: true })
                .order("name", { ascending: true })
                .order("id", { ascending: true }),
            ),
          ]);
          if (open.length > 0) {
            // Bez sesije (service-role režim) nema „mog" korisnika — upit se ipak
            // izvrši da round-tripovi ostanu isti, ali label to kaže naglas.
            const label = ctx.userId
              ? "moji tiketi: ticket_assignees"
              : "moji tiketi: ticket_assignees (bez sesije — prazan user_id)";
            await paginated(rec, label, () =>
              c
                .from("ticket_assignees")
                .select("ticket_id")
                .eq("user_id", ctx.userId ?? ZERO_UUID)
                .order("ticket_id", { ascending: true }),
            );
          }
        })(),
      ]);
    },
  },

  {
    key: "porudzbine",
    name: "Porudžbine — lista  (app/(app)/porudzbine/page.tsx)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);

      await Promise.all([
        // getOrders (bez filtera, strana 1)
        (async () => {
          await buildCancellationIndex(ctx, "lista:");
          await rec.run(`lista: orders strana 1 (${ORDERS_PER_PAGE} po strani, count exact)`, () =>
            c
              .from("orders")
              .select(ORDER_LIST_COLS, { count: "exact" })
              .order("ordered_at", { ascending: false, nullsFirst: false })
              .order("id", { ascending: true })
              .range(0, ORDERS_PER_PAGE - 1),
          );
        })(),
        // getOrderStatuses
        rec.run("lista: order_statuses", () =>
          c
            .from("order_statuses")
            .select("id, name, sort_order, color")
            .order("sort_order", { ascending: true }),
        ),
        // getOrdersSummary — „Za ovaj filter" (paginirano + parčad po IN_CHUNK)
        (async () => {
          const scanned = await paginated(rec, "zbir: orders scan", () =>
            c
              .from("orders")
              .select("id, status_id, ship_phone, customer:customers(phone, email)")
              .order("id", { ascending: true }),
          );
          const cancel = await rec.run("zbir: order_statuses (Otkazano/Vraćeno)", () =>
            c.from("order_statuses").select("id").in("name", CANCELLED_STATUS_NAMES),
          );
          const excluded = new Set((cancel.data ?? []).map((s) => s.id));
          const ids = scanned.filter((r) => !excluded.has(r.status_id)).map((r) => r.id);
          await paginatedIn(rec, "zbir: order_items", ids, (chunk) =>
            c
              .from("order_items")
              .select("quantity, mp_at_sale, profit_at_sale")
              .in("order_id", chunk)
              .order("id", { ascending: true }),
          );
        })(),
      ]);
    },
  },

  {
    key: "porudzbina",
    name: "Detalj porudžbine  (app/(app)/porudzbine/[id]/page.tsx)",
    async run(ctx) {
      const { rec, c, sample } = ctx;
      await getProfileQuery(ctx);

      const param = sample.wooOrderId != null ? String(sample.wooOrderId) : sample.orderId;
      if (!param) {
        rec.queries.push({
          label: "nema nijedne porudžbine u bazi",
          ms: 0,
          rows: 0,
          warnings: ["preskočeno"],
        });
        return;
      }

      const detailRes = await rec.run(`detalj: orders + stavke (#${param})`, () => {
        const query = c.from("orders").select(ORDER_DETAIL_COLS);
        return (
          /^\d+$/.test(param) ? query.eq("woo_order_id", Number(param)) : query.eq("id", param)
        ).maybeSingle();
      });
      const order = detailRes.data;
      if (!order) return;

      await Promise.all([
        rec.run("detalj: order_statuses", () =>
          c
            .from("order_statuses")
            .select("id, name, sort_order, color")
            .order("sort_order", { ascending: true }),
        ),
        paginated(rec, "detalj: order_status_history", () =>
          c
            .from("order_status_history")
            .select(
              "id, note, created_at, to_status:order_statuses!to_status_id(name, color), changed_by:profiles(full_name)",
            )
            .eq("order_id", order.id)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
        ),
        // getActiveVariantOptions — samo Admin i samo dok porudžbina nije fakturisana
        order.invoice_id
          ? Promise.resolve()
          : paginated(rec, "detalj: product_variants (izbor za „Dodaj stavku“)", () =>
              c
                .from("product_variants")
                .select("id, sku, variant_name, mp_price, vp_price, product:products(name)")
                .is("archived_at", null)
                .order("sku", { ascending: true })
                .order("id", { ascending: true }),
            ),
        // getOrderCancellationHistory
        buildCancellationIndex(ctx, "detalj:"),
        // listTicketsForOrder
        (async () => {
          const res = await rec.run("detalj: tickets vezani za porudžbinu", () =>
            c
              .from("tickets")
              .select(TICKET_COLS)
              .eq("order_id", order.id)
              .order("code", { ascending: false })
              .range(0, LINKED_TICKETS_LIMIT - 1),
          );
          await hydrateTickets(ctx, res.data ?? [], "detalj:");
        })(),
      ]);
    },
  },

  {
    key: "katalog",
    name: "Katalog  (app/(app)/katalog/page.tsx, rola Admin)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);

      const categoriesQuery = () =>
        c
          .from("categories")
          .select("id, name, sort_order")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
          .order("id", { ascending: true });

      await Promise.all([
        // getCatalog
        (async () => {
          const [products] = await Promise.all([
            paginated(rec, "katalog: products", () =>
              c
                .from("products")
                .select(PRODUCT_COLS)
                .is("archived_at", null)
                .order("name", { ascending: true })
                .order("id", { ascending: true }),
            ),
            paginated(rec, "katalog: categories (iz getCatalog)", categoriesQuery),
          ]);
          const ids = products.map((p) => p.id);
          if (ids.length === 0) return;
          await paginatedIn(rec, "katalog: product_variants", ids, (chunk) =>
            c
              .from("product_variants")
              .select(VARIANT_STAFF_COLS)
              .in("product_id", chunk)
              .order("sku", { ascending: true })
              .order("id", { ascending: true }),
          );
        })(),
        // getCategories (drugi put — strana ga zove zasebno)
        paginated(rec, "katalog: categories (iz strane)", categoriesQuery),
      ]);
    },
  },

  {
    key: "uplate",
    name: "Finansije → Uplate  (app/(app)/finansije/uplate/page.tsx)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);

      await Promise.all([
        // listPayouts
        (async () => {
          const rows = await paginated(rec, "uplate: payouts + vezane porudžbine", () =>
            c
              .from("payouts")
              .select(
                "id, amount, payout_date, delivery_date, notes, invoice_id, orders(id, goods_total, shipping_charged)",
              )
              .order("payout_date", { ascending: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: true }),
          );
          const orderIds = rows.flatMap((p) => (p.orders ?? []).map((o) => o.id));
          await paginatedIn(rec, "uplate: order_profit", orderIds, (chunk) =>
            c
              .from("order_profit")
              .select("order_id, profit")
              .in("order_id", chunk)
              .order("order_id", { ascending: true }),
          );
        })(),
        // getUnpaidDeliveredXexpress (samo Admin)
        getUnpaidDeliveredXexpress(ctx, "uplate:"),
      ]);
    },
  },

  {
    key: "postarina",
    name: "Finansije → Poštarina  (app/(app)/finansije/postarina/page.tsx)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);

      await Promise.all([
        // getSaldoPostarine
        (async () => {
          await paginated(rec, "saldo: orders sa unetom poštarinom", () =>
            c
              .from("orders")
              .select("shipping_charged, shipping_actual")
              .not("shipping_charged", "is", null)
              .not("shipping_actual", "is", null)
              .not("xexpress_invoice_id", "is", null)
              .order("id", { ascending: true }),
          );
          await paginated(rec, "saldo: postage_settlements (zbir)", () =>
            c.from("postage_settlements").select("amount").order("id", { ascending: true }),
          );
        })(),
        // listPostageSettlements
        paginated(rec, "poravnanja: postage_settlements", () =>
          c
            .from("postage_settlements")
            .select("id, amount, settled_at, balance_before, notes")
            .order("settled_at", { ascending: false })
            .order("created_at", { ascending: false })
            .order("id", { ascending: true }),
        ),
        // listXexpressInvoices
        (async () => {
          const list = await paginated(rec, "xexpress: fakture", () =>
            c
              .from("xexpress_invoices")
              .select("id, invoice_number, invoice_date, period_from, period_to, vat_rate")
              .order("invoice_date", { ascending: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: true }),
          );
          await paginatedIn(
            rec,
            `xexpress: orders — P&L (PDV ${PDV_RATE}%)`,
            list.map((i) => i.id),
            (chunk) =>
              c
                .from("orders")
                .select("xexpress_invoice_id, shipping_charged, shipping_actual")
                .in("xexpress_invoice_id", chunk)
                .order("id", { ascending: true }),
          );
        })(),
      ]);
    },
  },

  {
    key: "tiketi",
    name: "Tiketi — board  (app/(app)/tiketi/page.tsx)",
    async run(ctx) {
      const { rec, c } = ctx;
      await getProfileQuery(ctx);

      await Promise.all([
        // listTickets (bez filtera)
        (async () => {
          await paginated(rec, "board: ticket_columns", () =>
            c
              .from("ticket_columns")
              .select("id, name, color, sort_order, is_done, wip_limit")
              .order("sort_order", { ascending: true })
              .order("name", { ascending: true })
              .order("id", { ascending: true }),
          );
          const raw = await paginated(
            rec,
            "board: tickets",
            () =>
              c
                .from("tickets")
                .select(TICKET_COLS)
                .order("position", { ascending: true })
                .order("code", { ascending: true }),
            { maxRows: TICKET_SCAN_CAP },
          );
          await hydrateTickets(ctx, raw, "board:");
        })(),
        paginated(rec, "board: ticket_priorities", () =>
          c
            .from("ticket_priorities")
            .select("id, name, color, level, is_default, sort_order")
            .order("sort_order", { ascending: true })
            .order("level", { ascending: true })
            .order("id", { ascending: true }),
        ),
        paginated(rec, "board: ticket_tags", () =>
          c
            .from("ticket_tags")
            .select("id, name, color, sort_order, archived_at")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .is("archived_at", null),
        ),
        listStaffProfiles(ctx, "board:"),
      ]);
    },
  },
];

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/* ── Ispis ───────────────────────────────────────────────────────────────── */

const ms = (n) => `${n.toFixed(0)} ms`;
const pad = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);

function printProbe(name, result, allTotals) {
  console.log(`\n${name}`);
  console.log("─".repeat(96));
  console.log(`  ${pad("#", 4)}${pad("upit", 62)}${padS("trajanje", 11)}${padS("redova", 9)}`);
  result.queries.forEach((q, i) => {
    const label = q.label.length > 60 ? `${q.label.slice(0, 57)}…` : q.label;
    console.log(`  ${pad(i + 1, 4)}${pad(label, 62)}${padS(ms(q.ms), 11)}${padS(q.rows, 9)}`);
    for (const w of q.warnings) console.log(`  ${" ".repeat(4)}⚠ ${w}`);
  });
  console.log("─".repeat(96));
  console.log(
    `  UKUPNO: ${ms(result.totalMs)} (zbir upita ${ms(result.sumMs)}) · ${result.queries.length} round-tripova` +
      (result.warnings > 0 ? ` · ⚠ ${result.warnings} upozorenja` : ""),
  );
  if (allTotals && allTotals.length > 1) {
    console.log(
      `  po pokretanju: ${allTotals.map((t) => t.toFixed(0)).join(" / ")} ms → medijana ${ms(result.totalMs)} (tabela iznad je to pokretanje)`,
    );
  }
}

/* ── Pokretanje ──────────────────────────────────────────────────────────── */

async function runProbes(client, admin, userId, sample, only) {
  const results = [];
  for (const probe of PROBES) {
    if (only && !only.includes(probe.key)) continue;
    const rec = makeRecorder();
    const ctx = { rec, c: client, admin, userId, sample };
    const t0 = performance.now();
    try {
      await probe.run(ctx);
    } catch (err) {
      rec.queries.push({
        label: "sonda je pukla",
        ms: 0,
        rows: 0,
        warnings: [String(err?.message ?? err)],
      });
    }
    const totalMs = performance.now() - t0;
    results.push({
      key: probe.key,
      name: probe.name,
      queries: rec.queries,
      totalMs,
      sumMs: rec.queries.reduce((s, q) => s + q.ms, 0),
      warnings: rec.queries.reduce((s, q) => s + q.warnings.length, 0),
    });
  }
  return results;
}

/**
 * N pokretanja svih sondi → po sondi se zadržava MEDIJANA (i njena detaljna
 * tabela). Hladna konekcija pravi razliku u redu veličine, pa je medijana
 * jedini broj koji se sme porediti između koraka plana.
 */
async function runAllPasses(client, admin, userId, sample, only, runs) {
  const passes = [];
  for (let i = 0; i < runs; i++) {
    if (runs > 1) console.log(`\n  … pokretanje ${i + 1}/${runs}`);
    passes.push(await runProbes(client, admin, userId, sample, only));
  }

  return passes[0].map((probe) => {
    const all = passes.map((pass) => pass.find((r) => r.key === probe.key));
    const totals = all.map((r) => r.totalMs);
    const sorted = [...totals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const representative = all.find((r) => r.totalMs === median) ?? all[0];
    return { ...representative, allTotals: totals };
  });
}

/** Najnovija porudžbina — parametar za sondu „Detalj porudžbine". */
async function pickSampleOrder(client) {
  const { data } = await client
    .from("orders")
    .select("id, woo_order_id")
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return { orderId: data?.id ?? null, wooOrderId: data?.woo_order_id ?? null };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    console.log("Sonde:");
    for (const p of PROBES) console.log(`  ${pad(p.key, 14)}${p.name}`);
    return;
  }
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg
    ? onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
    : null;
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = Math.max(1, Number(runsArg?.slice("--runs=".length)) || 3);

  if (!URL || !ANON) {
    console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    process.exit(2);
  }

  console.log("Sportem OS — merenje brzine dohvata (Korak K1)");
  console.log(`Vreme: ${new Date().toISOString()}  ·  Beograd: ${todayBelgrade()}`);
  console.log(`Baza:  ${URL}`);
  console.log(
    `Pokretanja po režimu: ${runs}${runs > 1 ? " (u tabelama je MEDIJANA)" : " (--runs=N za medijanu)"}`,
  );
  console.log("Skripta SAMO ČITA — nijedan upis u bazu.");

  const warnings = [];

  // (a) Admin kroz anon ključ — RLS aktivan.
  let rlsClient = null;
  let userId = null;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    if (error) {
      warnings.push(
        `Prijava kao Admin nije uspela (${error.message}) — „RLS overhead" se preskače.`,
      );
    } else {
      rlsClient = c;
      userId = data.user?.id ?? null;
    }
  } else {
    warnings.push(
      'Nema RLS_TEST_ADMIN_EMAIL / RLS_TEST_ADMIN_PASSWORD (.env.test.local) — merenje ide SAMO kroz service-role, kolona „RLS overhead" se preskače. To je merenje BEZ RLS-a, dakle optimističnije od onoga što app stvarno plaća.',
    );
  }

  // (b) service-role — RLS zaobiđen.
  const serviceClient = SERVICE
    ? createClient(URL, SERVICE, { auth: { persistSession: false } })
    : null;
  if (!serviceClient)
    warnings.push("Nema SUPABASE_SERVICE_ROLE_KEY — service-role merenje se preskače.");

  if (!rlsClient && !serviceClient) {
    console.error("\nNema nijednog upotrebljivog ključa. Prekidam.");
    process.exit(2);
  }

  for (const w of warnings) console.log(`\n⚠ ${w}`);

  const sample = await pickSampleOrder(rlsClient ?? serviceClient);

  let rlsResults = null;
  if (rlsClient) {
    console.log(
      "\n\n════════════════════════════════════════════════════════════════════════════════",
    );
    console.log("(a) ADMIN kroz ANON ključ — RLS AKTIVAN (prava cena)");
    console.log("════════════════════════════════════════════════════════════════════════════════");
    rlsResults = await runAllPasses(rlsClient, serviceClient, userId, sample, only, runs);
    for (const r of rlsResults) printProbe(r.name, r, r.allTotals);
  }

  let serviceResults = null;
  if (serviceClient) {
    console.log(
      "\n\n════════════════════════════════════════════════════════════════════════════════",
    );
    console.log("(b) SERVICE-ROLE ključ — RLS ZAOBIĐEN");
    console.log("════════════════════════════════════════════════════════════════════════════════");
    serviceResults = await runAllPasses(serviceClient, serviceClient, userId, sample, only, runs);
    for (const r of serviceResults) printProbe(r.name, r, r.allTotals);
  }

  // ── Zbirna tabela ──────────────────────────────────────────────────────
  console.log(
    "\n\n════════════════════════════════════════════════════════════════════════════════",
  );
  console.log(runs > 1 ? `ZBIRNO (medijana od ${runs} pokretanja)` : "ZBIRNO (jedno pokretanje)");
  console.log("════════════════════════════════════════════════════════════════════════════════");
  const head = `  ${pad("stranica", 26)}${padS("RLS (a)", 12)}${padS("service (b)", 13)}${padS("RLS overhead", 14)}${padS("round-trip", 12)}${padS("⚠", 4)}`;
  console.log(head);
  console.log("  " + "─".repeat(94));

  const base = rlsResults ?? serviceResults;
  let totalRls = 0;
  let totalService = 0;
  let totalTrips = 0;
  let totalWarnings = 0;

  for (const r of base) {
    const a = rlsResults?.find((x) => x.key === r.key) ?? null;
    const b = serviceResults?.find((x) => x.key === r.key) ?? null;
    const overhead = a && b ? `${(a.totalMs - b.totalMs).toFixed(0)} ms` : "—";
    if (a) totalRls += a.totalMs;
    if (b) totalService += b.totalMs;
    totalTrips += r.queries.length;
    totalWarnings += (a?.warnings ?? 0) + (b?.warnings ?? 0);
    console.log(
      `  ${pad(r.key, 26)}${padS(a ? ms(a.totalMs) : "—", 12)}${padS(b ? ms(b.totalMs) : "—", 13)}${padS(overhead, 14)}${padS(r.queries.length, 12)}${padS((a?.warnings ?? 0) + (b?.warnings ?? 0), 4)}`,
    );
  }
  console.log("  " + "─".repeat(94));
  console.log(
    `  ${pad("UKUPNO", 26)}${padS(rlsResults ? ms(totalRls) : "—", 12)}${padS(serviceResults ? ms(totalService) : "—", 13)}${padS(rlsResults && serviceResults ? `${(totalRls - totalService).toFixed(0)} ms` : "—", 14)}${padS(totalTrips, 12)}${padS(totalWarnings, 4)}`,
  );

  if (!rlsResults) {
    console.log(
      '\n⚠ Kolona „RLS overhead" je prazna — nema Admin kredencijala. Kad se dodaju u\n' +
        "  .env.test.local (RLS_TEST_ADMIN_EMAIL / _PASSWORD), isto merenje daje i pravu cenu RLS-a.",
    );
  }

  // Upozorenja na jednom mestu (da se ne izgube u tabelama).
  const allWarnings = [];
  for (const [mode, results] of [
    ["RLS", rlsResults],
    ["service", serviceResults],
  ]) {
    for (const r of results ?? []) {
      for (const q of r.queries) {
        for (const w of q.warnings) allWarnings.push(`  [${mode}] ${r.key} → ${q.label}: ${w}`);
      }
    }
  }
  console.log("\nUPOZORENJA");
  console.log("  " + "─".repeat(94));
  console.log(allWarnings.length === 0 ? "  nijedno" : allWarnings.join("\n"));
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
