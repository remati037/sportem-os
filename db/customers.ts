import "server-only";

import * as Sentry from "@sentry/nextjs";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { mustRows, selectAll, selectAllByIdShards, selectAllIn } from "@/lib/supabase/paginate";
import { CUSTOMER_FLAGS, type CustomerFlag } from "@/lib/customers";
import { listStaffProfiles } from "@/db/profiles";
import { isUuid } from "@/lib/validation/uuid";
import { belgradeDate, todayBelgrade } from "@/lib/date-belgrade";
import { CANCELLED_STATUS_NAMES } from "@/lib/woo";
import { normEmail } from "@/db/customer-risk";

/*
 * Kupci (Korak C1, docs/Sportem-Plan-Kupci.md) — ko je „jedan kupac".
 *
 * `customer_id` je nepouzdan: kupac bez telefona dobija nov `customers` red pri
 * svakoj porudžbini. Zato je kupac GRUPA porudžbina spojenih (union-find) po:
 *   1. normalizovanom telefonu — `orders.ship_phone_norm` i `customers.phone_norm`
 *      (generisane kolone iz K4, doslovna kopija `normalizePhone`),
 *   2. e-mailu (`lower(trim)`, bez naših internih adresa — `normEmail` iz rizika),
 *   3. istom `customers` redu.
 * Tako „isti telefon, drugi mejl" i „isti mejl, drugi telefon" završe zajedno.
 *
 * Novac ISKLJUČIVO iz zamrznutih `order_items` (§4). Otkazano/Vraćeno se
 * razrešava po IMENU: ulazi u broj porudžbina, ne ulazi u promet ni zaradu —
 * ista pravila kao `computePeriodMetrics`. Sve kroz `selectAll` (cap 1000).
 *
 * Ključ grupe (`key`) je interni identitet (beleške u C3) i NIKAD ne ide na
 * klijent ni u URL — URL profila je `repId` (customers.id najnovije porudžbine).
 */

export type CustomerKey = `p:${string}` | `e:${string}` | `c:${string}`;

export type CustomerGroup = {
  key: CustomerKey;
  repId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  /** Svi normalizovani telefoni i e-mailovi grupe (pretraga + kandidat-ključevi u C3). */
  phones: string[];
  emails: string[];
  customerIds: string[];
  orderIds: string[];
  orderCount: number; // svi statusi
  cancelledCount: number; // Otkazano + Vraćeno
  realizedCount: number; // orderCount − cancelledCount
  revenue: number; // Σ mp_at_sale × kol, bez otkazanih/vraćenih
  profit: number; // Σ profit_at_sale, bez otkazanih/vraćenih
  units: number; // komada, bez otkazanih/vraćenih
  needsVpCount: number; // realizovane bez VP → zarada nepotpuna
  firstOrderAt: string;
  lastOrderAt: string;
  /** Svi nazivi i gradovi grupe (pretraga). */
  searchText: string;
};

/** Sirov red porudžbine potreban za spajanje. */
export type CustomerOrderRow = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  created_at: string;
  status_id: string;
  needs_vp: boolean;
  customer_id: string;
  ship_name: string | null;
  ship_city: string | null;
  ship_phone: string | null;
  ship_phone_norm: string | null;
  customer: {
    name: string | null;
    phone: string | null;
    phone_norm: string | null;
    email: string | null;
    city: string | null;
  } | null;
};

export type CustomerItemRow = {
  order_id: string;
  quantity: number;
  mp_at_sale: number;
  profit_at_sale: number | null;
};

const ORDER_COLUMNS =
  "id, woo_order_id, ordered_at, created_at, status_id, needs_vp, customer_id, ship_name, ship_city, ship_phone, ship_phone_norm, customer:customers(name, phone, phone_norm, email, city)";

/** Dohvat sirovih podataka (statusi + porudžbine + stavke, sve paralelno). Prima klijent: RLS za UI, service-role za skripte. */
export async function fetchCustomerSources(supabase: SupabaseClient): Promise<{
  orders: CustomerOrderRow[];
  items: CustomerItemRow[];
  cancelledStatusIds: Set<string>;
}> {
  const [statuses, orders, items] = await Promise.all([
    supabase.from("order_statuses").select("id").in("name", CANCELLED_STATUS_NAMES),
    selectAllByIdShards<CustomerOrderRow>("kupci: orders", (lo, hi) => {
      const q = supabase.from("orders").select(ORDER_COLUMNS).gte("id", lo);
      return (hi ? q.lt("id", hi) : q).order("id", { ascending: true });
    }),
    // Cela tabela stavki (~2.300 redova) je jeftinija od 8 parčadi `.in()`.
    selectAllByIdShards<CustomerItemRow>("kupci: order_items", (lo, hi) => {
      const q = supabase
        .from("order_items")
        .select("order_id, quantity, mp_at_sale, profit_at_sale")
        .gte("id", lo);
      return (hi ? q.lt("id", hi) : q).order("id", { ascending: true });
    }),
  ]);
  const cancelledStatusIds = new Set(
    mustRows<{ id: string }>(statuses, "kupci: statusi Otkazano/Vraćeno").map((s) => s.id),
  );
  return { orders, items, cancelledStatusIds };
}

/** Datum porudžbine za redosled (stare porudžbine bez `ordered_at` padaju na `created_at`). */
function orderTime(o: CustomerOrderRow): string {
  return o.ordered_at ?? o.created_at;
}

/** Spajanje porudžbina u kupce — čista funkcija (union-find, deterministički). */
export function groupCustomerOrders({
  orders,
  items,
  cancelledStatusIds,
}: {
  orders: CustomerOrderRow[];
  items: CustomerItemRow[];
  cancelledStatusIds: Set<string>;
}): CustomerGroup[] {
  // ── union-find nad indeksima porudžbina ──
  const parent = orders.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const owner = new Map<string, number>();
  const link = (key: string | null, i: number) => {
    if (!key) return;
    const prev = owner.get(key);
    if (prev === undefined) owner.set(key, i);
    else union(prev, i);
  };

  const phonesOf = (o: CustomerOrderRow) =>
    [o.ship_phone_norm, o.customer?.phone_norm].filter((p): p is string => !!p);

  orders.forEach((o, i) => {
    for (const p of phonesOf(o)) link(`p:${p}`, i);
    const em = normEmail(o.customer?.email);
    link(em ? `e:${em}` : null, i);
    link(`c:${o.customer_id}`, i);
  });

  // ── zbir stavki po porudžbini (zamrznute cene) ──
  const money = new Map<string, { revenue: number; profit: number; units: number }>();
  for (const it of items) {
    const m = money.get(it.order_id) ?? { revenue: 0, profit: 0, units: 0 };
    m.revenue += it.mp_at_sale * it.quantity;
    m.profit += it.profit_at_sale ?? 0;
    m.units += it.quantity;
    money.set(it.order_id, m);
  }

  // ── članovi po korenu ──
  const members = new Map<number, CustomerOrderRow[]>();
  orders.forEach((o, i) => {
    const r = find(i);
    const list = members.get(r);
    if (list) list.push(o);
    else members.set(r, [o]);
  });

  const groups: CustomerGroup[] = [];
  for (const list of members.values()) {
    // Najnovije prvo (izjednačeno → id, da bude deterministički).
    list.sort((a, b) => orderTime(b).localeCompare(orderTime(a)) || a.id.localeCompare(b.id));
    const newest = list[0];
    const oldest = list[list.length - 1];

    const phones = new Set<string>();
    const emails = new Set<string>();
    const customerIds = new Set<string>();
    const texts = new Set<string>();
    let cancelledCount = 0;
    let revenue = 0;
    let profit = 0;
    let units = 0;
    let needsVpCount = 0;

    for (const o of list) {
      for (const p of phonesOf(o)) phones.add(p);
      const em = normEmail(o.customer?.email);
      if (em) emails.add(em);
      customerIds.add(o.customer_id);
      for (const t of [o.ship_name, o.customer?.name, o.ship_city, o.customer?.city]) {
        if (t?.trim()) texts.add(t.trim());
      }
      if (cancelledStatusIds.has(o.status_id)) {
        cancelledCount += 1;
        continue;
      }
      const m = money.get(o.id);
      if (m) {
        revenue += m.revenue;
        profit += m.profit;
        units += m.units;
      }
      if (o.needs_vp) needsVpCount += 1;
    }

    const sortedPhones = [...phones].sort();
    const sortedEmails = [...emails].sort();
    const key: CustomerKey = sortedPhones[0]
      ? `p:${sortedPhones[0]}`
      : sortedEmails[0]
        ? `e:${sortedEmails[0]}`
        : `c:${oldest.customer_id}`;

    const firstEmail =
      list.map((o) => normEmail(o.customer?.email)).find((e): e is string => !!e) ?? null;

    groups.push({
      key,
      repId: newest.customer_id,
      name: newest.ship_name?.trim() || newest.customer?.name?.trim() || null,
      phone: newest.ship_phone?.trim() || newest.customer?.phone?.trim() || null,
      email: firstEmail,
      city: newest.ship_city?.trim() || newest.customer?.city?.trim() || null,
      phones: sortedPhones,
      emails: sortedEmails,
      customerIds: [...customerIds],
      orderIds: list.map((o) => o.id),
      orderCount: list.length,
      cancelledCount,
      realizedCount: list.length - cancelledCount,
      revenue,
      profit,
      units,
      needsVpCount,
      firstOrderAt: orderTime(oldest),
      lastOrderAt: orderTime(newest),
      searchText: foldText([...texts, ...sortedEmails].join(" ")),
    });
  }

  return groups;
}

/** Svi kupci, jednom po zahtevu (RLS klijent korisnika). */
export const loadCustomerGroups = cache(async (): Promise<CustomerGroup[]> => {
  const supabase = await createClient();
  return groupCustomerOrders(await fetchCustomerSources(supabase));
});

/* ── Lista /kupci ─────────────────────────────────────────────────────────── */

export const CUSTOMER_FILTERS = ["sve", "ponovni", "rizicni", "neaktivni", "oznaka"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

export const CUSTOMER_SORTS = ["promet", "zarada", "porudzbine", "poslednja"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const INACTIVE_MONTH_OPTIONS = [3, 6, 12] as const;
export const DEFAULT_INACTIVE_MONTHS = 3;
export const CUSTOMERS_PER_PAGE = 25;

/** Red liste — bez telefona, e-maila i ključa grupe (manje PII na ekranu). */
export type CustomerListRow = {
  repId: string;
  name: string | null;
  city: string | null;
  orderCount: number;
  cancelledCount: number;
  revenue: number;
  profit: number;
  needsVpCount: number;
  lastOrderAt: string;
  risky: boolean;
  repeat: boolean;
  flags: CustomerFlag[];
};

/** „Ponovni" = bar dve realizovane porudžbine; „rizičan" = bar jedna otkazana/vraćena. */
export const isRepeatCustomer = (g: CustomerGroup) => g.realizedCount >= 2;
export const isRiskyCustomer = (g: CustomerGroup) => g.cancelledCount >= 1;

/** Dan pre kog je poslednja kupovina „neaktivna" (Belgrade kalendar, N meseci unazad). */
function inactiveCutoff(months: number): string {
  const d = new Date(`${todayBelgrade()}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Pretraga bez obzira na velika slova i dijakritike: „sasa" nalazi „Saša",
 * a „đ" se upisuje i kao „d" i kao „dj" („djordjevic" i „dordevic").
 */
function foldText(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `${base.replace(/đ/g, "d")} ${base.replace(/đ/g, "dj")}`;
}

/** Varijante unetih cifara koje se traže među normalizovanim telefonima (0…). */
function phoneQueries(q: string): string[] {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const out = new Set([digits]);
  if (digits.startsWith("00381")) out.add(`0${digits.slice(5)}`);
  else if (digits.startsWith("381")) out.add(`0${digits.slice(3)}`);
  return [...out];
}

function matchesSearch(g: CustomerGroup, q: string): boolean {
  const term = q.trim();
  if (!term) return true;
  const phones = phoneQueries(term);
  // Pretežno cifre → telefon; inače tekst (ime, grad, e-mail).
  if (phones.length > 0 && /^[\d\s+()/-]+$/.test(term)) {
    return g.phones.some((p) => phones.some((d) => p.includes(d)));
  }
  const needle = foldText(term).split(" ")[0];
  return g.searchText.includes(needle);
}

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number; // posle filtera i pretrage
  counts: Record<CustomerFilter, number>; // po filteru, posle pretrage
};

export async function listCustomers({
  q,
  filter,
  months,
  sort,
  page,
}: {
  q: string;
  filter: CustomerFilter;
  months: number;
  sort: CustomerSort;
  page: number;
}): Promise<CustomerListResult> {
  const [groups, flagIndex] = await Promise.all([loadCustomerGroups(), loadFlagIndex()]);
  const flagsOf = (g: CustomerGroup) => groupFlags(g, flagIndex);
  const cutoff = inactiveCutoff(months);

  const searched = groups.filter((g) => matchesSearch(g, q));
  const byFilter: Record<CustomerFilter, (g: CustomerGroup) => boolean> = {
    sve: () => true,
    ponovni: isRepeatCustomer,
    rizicni: isRiskyCustomer,
    // Neaktivan = kupio je bar jednom, ali ne od pre N meseci.
    neaktivni: (g) => g.realizedCount >= 1 && belgradeDate(g.lastOrderAt) < cutoff,
    oznaka: (g) => flagsOf(g).length > 0,
  };

  const counts = Object.fromEntries(
    CUSTOMER_FILTERS.map((f) => [f, searched.filter(byFilter[f]).length]),
  ) as Record<CustomerFilter, number>;

  const sortValue: Record<CustomerSort, (g: CustomerGroup) => number | string> = {
    promet: (g) => g.revenue,
    zarada: (g) => g.profit,
    porudzbine: (g) => g.orderCount,
    poslednja: (g) => g.lastOrderAt,
  };
  const value = sortValue[sort];

  const filtered = searched.filter(byFilter[filter]).sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const cmp =
      typeof av === "string" && typeof bv === "string"
        ? bv.localeCompare(av)
        : Number(bv) - Number(av);
    return cmp || b.lastOrderAt.localeCompare(a.lastOrderAt) || a.repId.localeCompare(b.repId);
  });

  const start = (page - 1) * CUSTOMERS_PER_PAGE;
  const rows = filtered.slice(start, start + CUSTOMERS_PER_PAGE).map((g): CustomerListRow => ({
    repId: g.repId,
    name: g.name,
    city: g.city,
    orderCount: g.orderCount,
    cancelledCount: g.cancelledCount,
    revenue: g.revenue,
    profit: g.profit,
    needsVpCount: g.needsVpCount,
    lastOrderAt: g.lastOrderAt,
    risky: isRiskyCustomer(g),
    repeat: isRepeatCustomer(g),
    flags: flagsOf(g),
  }));

  return { rows, total: filtered.length, counts };
}

/* ── Profil /kupci/[id] (Korak C2) ───────────────────────────────────────── */

export type CustomerProfileOrder = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string;
  status: { name: string; color: string | null } | null;
  cancelled: boolean;
  needs_vp: boolean;
  revenue: number; // vrednost stavki (zamrznuto), i za otkazane — prikaz
  profit: number | null; // null dok neka stavka nema VP
};

export type CustomerProfileArticle = {
  sku: string;
  name: string | null; // product_name snapshot sa najnovije stavke
  units: number;
  orders: number;
};

export type CustomerCancellation = {
  orderId: string;
  woo_order_id: number | null;
  ordered_at: string;
  status: string | null;
  reason: string | null; // poslednja napomena pri prelasku u Otkazano/Vraćeno
};

export type CustomerProfile = {
  group: CustomerGroup;
  address: string | null; // sa najnovije porudžbine: ulica, poštanski broj grad
  orders: CustomerProfileOrder[];
  articles: CustomerProfileArticle[];
  cancellations: CustomerCancellation[];
};

type ProfileOrderRow = {
  id: string;
  woo_order_id: number | null;
  ordered_at: string | null;
  created_at: string;
  status_id: string;
  needs_vp: boolean;
  ship_address: string | null;
  ship_postal_code: string | null;
  ship_city: string | null;
  status: { name: string; color: string | null } | null;
};

type ProfileItemRow = {
  order_id: string;
  sku: string | null;
  product_name: string | null;
  quantity: number;
  mp_at_sale: number;
  profit_at_sale: number | null;
};

/** Grupa kojoj pripada `customers.id` (bilo koji red grupe, ne samo repId). */
export async function findCustomerGroup(customerId: string): Promise<CustomerGroup | null> {
  if (!isUuid(customerId)) return null;
  const groups = await loadCustomerGroups();
  return groups.find((g) => g.customerIds.includes(customerId)) ?? null;
}

/**
 * Sve o jednom kupcu: porudžbine (najnovije prvo), artikli po `sku`, razlozi
 * otkazivanja. Zbirovi (promet/zarada) su iz grupe — iste cifre kao lista.
 * Novac isključivo iz zamrznutih `order_items`; katalog se ne čita.
 */
export async function getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  const group = await findCustomerGroup(customerId);
  if (!group) return null;

  const supabase = await createClient();
  const [orderRows, itemRows, statuses] = await Promise.all([
    selectAllIn<ProfileOrderRow, string>("profil kupca: orders", group.orderIds, (chunk) =>
      supabase
        .from("orders")
        .select(
          "id, woo_order_id, ordered_at, created_at, status_id, needs_vp, ship_address, ship_postal_code, ship_city, status:order_statuses(name, color)",
        )
        .in("id", chunk)
        .order("id", { ascending: true }),
    ),
    selectAllIn<ProfileItemRow, string>("profil kupca: order_items", group.orderIds, (chunk) =>
      supabase
        .from("order_items")
        .select("order_id, sku, product_name, quantity, mp_at_sale, profit_at_sale")
        .in("order_id", chunk)
        .order("id", { ascending: true }),
    ),
    supabase.from("order_statuses").select("id").in("name", CANCELLED_STATUS_NAMES),
  ]);
  const cancelledIds = new Set(
    mustRows<{ id: string }>(statuses, "profil kupca: statusi Otkazano/Vraćeno").map((s) => s.id),
  );

  const time = (o: ProfileOrderRow) => o.ordered_at ?? o.created_at;
  orderRows.sort((a, b) => time(b).localeCompare(time(a)) || a.id.localeCompare(b.id));

  // ── novac po porudžbini ──
  const money = new Map<string, { revenue: number; profit: number; missingVp: boolean }>();
  for (const it of itemRows) {
    const m = money.get(it.order_id) ?? { revenue: 0, profit: 0, missingVp: false };
    m.revenue += it.mp_at_sale * it.quantity;
    if (it.profit_at_sale == null) m.missingVp = true;
    else m.profit += it.profit_at_sale;
    money.set(it.order_id, m);
  }

  const orders: CustomerProfileOrder[] = orderRows.map((o) => {
    const m = money.get(o.id);
    return {
      id: o.id,
      woo_order_id: o.woo_order_id,
      ordered_at: time(o),
      status: o.status,
      cancelled: cancelledIds.has(o.status_id),
      needs_vp: o.needs_vp,
      revenue: m?.revenue ?? 0,
      profit: m?.missingVp ? null : (m?.profit ?? 0),
    };
  });

  // ── artikli po SKU (samo realizovane porudžbine) ──
  const realized = new Set(orders.filter((o) => !o.cancelled).map((o) => o.id));
  const orderTimeById = new Map(orders.map((o) => [o.id, o.ordered_at]));
  const bySku = new Map<
    string,
    { name: string | null; nameAt: string; units: number; orders: Set<string> }
  >();
  for (const it of itemRows) {
    if (!realized.has(it.order_id)) continue;
    const sku = it.sku?.trim() || "(bez SKU)";
    const at = orderTimeById.get(it.order_id) ?? "";
    const a = bySku.get(sku) ?? { name: null, nameAt: "", units: 0, orders: new Set<string>() };
    a.units += it.quantity;
    a.orders.add(it.order_id);
    if (it.product_name && at >= a.nameAt) {
      a.name = it.product_name;
      a.nameAt = at;
    }
    bySku.set(sku, a);
  }
  const articles = [...bySku.entries()]
    .map(([sku, a]) => ({ sku, name: a.name, units: a.units, orders: a.orders.size }))
    .sort((x, y) => y.units - x.units || x.sku.localeCompare(y.sku));

  // ── razlozi otkazivanja (order_status_history.note) ──
  const cancelledOrders = orders.filter((o) => o.cancelled);
  const reasons = new Map<string, string>();
  if (cancelledOrders.length > 0) {
    const notes = await selectAllIn<
      { order_id: string; to_status_id: string; note: string | null; created_at: string },
      string
    >(
      "profil kupca: razlozi otkazivanja",
      cancelledOrders.map((o) => o.id),
      (chunk) =>
        supabase
          .from("order_status_history")
          .select("order_id, to_status_id, note, created_at")
          .in("order_id", chunk)
          .not("note", "is", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true }),
    );
    // Najnovija napomena pri prelasku u otkazni status pobeđuje.
    for (const n of notes) {
      if (!cancelledIds.has(n.to_status_id) || !n.note?.trim()) continue;
      if (!reasons.has(n.order_id)) reasons.set(n.order_id, n.note.trim());
    }
  }
  const cancellations: CustomerCancellation[] = cancelledOrders.map((o) => ({
    orderId: o.id,
    woo_order_id: o.woo_order_id,
    ordered_at: o.ordered_at,
    status: o.status?.name ?? null,
    reason: reasons.get(o.id) ?? null,
  }));

  const newest = orderRows[0];
  const street = newest?.ship_address?.trim();
  const place = [newest?.ship_postal_code?.trim(), newest?.ship_city?.trim()]
    .filter(Boolean)
    .join(" ");
  const address = [street, place].filter(Boolean).join(", ") || null;

  return { group, address, orders, articles, cancellations };
}

/* ── Beleške i oznake (Korak C3) ─────────────────────────────────────────── */

/*
 * Ključ beleške/oznake je ključ GRUPE (`p:` / `e:` / `c:`), ne `customers.id`.
 * Kandidat-ključevi su svi telefoni, e-mailovi i `customers` redovi grupe: kad
 * nova porudžbina spoji dve grupe, beleške obe stare grupe se i dalje nalaze.
 * Ključevi NIKAD ne idu na klijent — akcije primaju repId i same razrešavaju.
 */
export function customerCandidateKeys(g: CustomerGroup): string[] {
  return [
    ...g.phones.map((p) => `p:${p}`),
    ...g.emails.map((e) => `e:${e}`),
    ...g.customerIds.map((c) => `c:${c}`),
  ];
}

/** Ključevi jedne porudžbine (isti oblik kao kandidat-ključevi grupe). */
export function orderCustomerKeys(o: {
  customer_id: string | null;
  ship_phone_norm?: string | null;
  customer?: { phone_norm?: string | null; email?: string | null } | null;
}): string[] {
  const keys = new Set<string>();
  if (o.customer_id) keys.add(`c:${o.customer_id}`);
  for (const p of [o.ship_phone_norm, o.customer?.phone_norm]) if (p) keys.add(`p:${p}`);
  const em = normEmail(o.customer?.email);
  if (em) keys.add(`e:${em}`);
  return [...keys];
}

/** Redosled oznaka uvek kao u fiksnoj listi. */
function sortFlags(flags: Iterable<string>): CustomerFlag[] {
  const set = new Set(flags);
  return CUSTOMER_FLAGS.map((f) => f.value).filter((v) => set.has(v));
}

/** Sve oznake (tabela je mala) → ključ → oznake. Jednom po zahtevu. */
const loadFlagIndex = cache(async (): Promise<Map<string, string[]>> => {
  const supabase = await createClient();
  const rows = await selectAll<{ customer_key: string; flag: string }>("kupci: oznake", () =>
    supabase
      .from("customer_flags")
      .select("customer_key, flag")
      .order("customer_key", { ascending: true })
      .order("flag", { ascending: true }),
  );
  const index = new Map<string, string[]>();
  for (const r of rows) {
    const list = index.get(r.customer_key);
    if (list) list.push(r.flag);
    else index.set(r.customer_key, [r.flag]);
  }
  return index;
});

function groupFlags(g: CustomerGroup, index: Map<string, string[]>): CustomerFlag[] {
  if (index.size === 0) return [];
  return sortFlags(customerCandidateKeys(g).flatMap((k) => index.get(k) ?? []));
}

/** Oznake jednog kupca (unija preko svih kandidat-ključeva). */
export async function getCustomerFlags(g: CustomerGroup): Promise<CustomerFlag[]> {
  const supabase = await createClient();
  const rows = await selectAllIn<{ flag: string }, string>(
    "kupac: oznake",
    customerCandidateKeys(g),
    (chunk) =>
      supabase
        .from("customer_flags")
        .select("flag")
        .in("customer_key", chunk)
        .order("customer_key", { ascending: true })
        .order("flag", { ascending: true }),
  );
  return sortFlags(rows.map((r) => r.flag));
}

export type CustomerNote = {
  id: string;
  body: string;
  created_by: string | null;
  authorName: string | null;
  created_at: string;
  updated_at: string;
};

/** Beleške jednog kupca (svi kandidat-ključevi), najnovije prvo. */
export async function getCustomerNotes(g: CustomerGroup): Promise<CustomerNote[]> {
  const supabase = await createClient();
  const [rows, staff] = await Promise.all([
    selectAllIn<Omit<CustomerNote, "authorName">, string>(
      "kupac: beleške",
      customerCandidateKeys(g),
      (chunk) =>
        supabase
          .from("customer_notes")
          .select("id, body, created_by, created_at, updated_at")
          .in("customer_key", chunk)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true }),
    ),
    listStaffProfiles(),
  ]);
  const names = new Map(staff.map((p) => [p.id, p.full_name]));
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({ ...r, authorName: r.created_by ? (names.get(r.created_by) ?? null) : null }));
}

/**
 * Za listu porudžbina: koje porudžbine pripadaju kupcu sa oznakom „zvati pre
 * slanja". Oznaka je upisana pod SVIM ključevima grupe, pa je dovoljno
 * poklapanje po ključevima same porudžbine — bez učitavanja svih grupa.
 */
export async function ordersWithFlag(
  orders: (Parameters<typeof orderCustomerKeys>[0] & { id: string })[],
  flag: CustomerFlag,
): Promise<Set<string>> {
  const keysByOrder = new Map(orders.map((o) => [o.id, orderCustomerKeys(o)]));
  const allKeys = [...new Set([...keysByOrder.values()].flat())];
  if (allKeys.length === 0) return new Set();

  const supabase = await createClient();
  const rows = await selectAllIn<{ customer_key: string }, string>(
    "porudžbine: oznaka kupca",
    allKeys,
    (chunk) =>
      supabase
        .from("customer_flags")
        .select("customer_key")
        .eq("flag", flag)
        .in("customer_key", chunk)
        .order("customer_key", { ascending: true }),
  );
  const flagged = new Set(rows.map((r) => r.customer_key));
  const out = new Set<string>();
  for (const [id, keys] of keysByOrder) if (keys.some((k) => flagged.has(k))) out.add(id);
  return out;
}

export type OrderCustomerContext = {
  repId: string;
  flags: CustomerFlag[];
  latestNote: CustomerNote | null;
  noteCount: number;
};

/** Detalj porudžbine: oznake + poslednja beleška kupca + link na profil (C3). */
export async function getOrderCustomerContext(
  customerId: string | null,
): Promise<OrderCustomerContext | null> {
  if (!customerId) return null;
  const group = await findCustomerGroup(customerId);
  if (!group) return null;
  // Best-effort: beleške/oznake su pomoć na detalju porudžbine — ako tabele još
  // nema (migracija nije primenjena), detalj ostaje ceo, samo bez njih.
  try {
    const [flags, notes] = await Promise.all([getCustomerFlags(group), getCustomerNotes(group)]);
    return { repId: group.repId, flags, latestNote: notes[0] ?? null, noteCount: notes.length };
  } catch (err) {
    Sentry.captureException(err);
    return { repId: group.repId, flags: [], latestNote: null, noteCount: 0 };
  }
}
