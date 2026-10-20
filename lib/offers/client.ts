import "server-only";

/*
 * REST klijent plugina „Sportem Offers" (WordPress → app).
 *
 * Plugin prikazuje upsell ponude u side cartu/korpi i order bump na checkoutu,
 * i beleži događaje. App ih samo ČITA — ništa se na WordPress strani ne menja.
 *
 * Ključ (`SPORTEM_OFFERS_API_KEY`) je isključivo serverski: nikad se ne loguje,
 * ne vraća klijentu i ne ulazi u poruku greške (poruke nose samo status i telo
 * odgovora). `server-only` obara build ako se fajl uveze u klijentski bundle.
 */

const TIMEOUT_MS = 15_000; // Vercel serverless — zahtev ne sme da visi

export type OfferPlacement = "sidecart" | "cart" | "checkout";
export type OfferEventKind = "impression" | "add" | "remove" | "order";

export type OfferRuleApi = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  placements: OfferPlacement[];
  offer_product: number;
  offer_sku: string;
  offer_name: string;
  price_rule: string;
  conditions: string;
  /** „YYYY-MM-DD HH:MM:SS" — LOKALNO vreme sajta (Europe/Belgrade), ne UTC. */
  updated: string;
};

export type OfferEventApi = {
  id: number;
  /** ISO UTC („…Z"). */
  created_at: string;
  event: OfferEventKind;
  rule_id: string;
  placement: OfferPlacement;
  product_id: number;
  order_id: number;
  value: number;
};

export type OfferEventsPage = {
  events: OfferEventApi[];
  last_id: number;
};

export type OfferStatsApi = {
  days: number;
  rules: {
    rule_id: string;
    name: string;
    impressions: number;
    adds: number;
    removes: number;
    orders: number;
    revenue: number;
    add_rate: number;
  }[];
};

/** Da li su env varijable za plugin podešene (bez otkrivanja vrednosti). */
export function offersConfigured(): boolean {
  return Boolean(process.env.SPORTEM_WP_URL && process.env.SPORTEM_OFFERS_API_KEY);
}

function baseUrl(): string {
  const url = process.env.SPORTEM_WP_URL;
  if (!url) throw new Error("SPORTEM_WP_URL nije podešen.");
  return `${url.replace(/\/$/, "")}/wp-json/sportem-offers/v1`;
}

/**
 * GET ka pluginu sa ključem u header-u i tvrdim timeout-om.
 * Greške su razdvojene po uzroku, da se na stranici vidi šta treba popraviti:
 *   401/403 → pogrešan ključ · 404 → plugin/ruta ne postoji · 5xx → sajt
 */
async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const key = process.env.SPORTEM_OFFERS_API_KEY;
  if (!key) throw new Error("SPORTEM_OFFERS_API_KEY nije podešen.");

  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Sportem-Key": key, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Sajt nije odgovorio u ${TIMEOUT_MS / 1000} s (${path}).`);
    }
    throw new Error(`Sajt nije dostupan (${path}).`);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Pristup odbijen (401) — proveri SPORTEM_OFFERS_API_KEY.");
  }
  if (res.status === 404) {
    throw new Error(`Ruta ${path} ne postoji — proveri da li je plugin aktivan.`);
  }
  if (res.status >= 500) {
    throw new Error(`Greška na sajtu (${res.status}) na ${path}.`);
  }
  if (!res.ok) {
    throw new Error(`Neočekivan odgovor ${res.status} na ${path}.`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Odgovor na ${path} nije validan JSON.`);
  }
}

/** Sva pravila ponuda. */
export async function fetchRules(): Promise<OfferRuleApi[]> {
  const data = await get<OfferRuleApi[]>("/rules");
  if (!Array.isArray(data)) throw new Error("Odgovor /rules nije niz.");
  return data;
}

/** Stranica događaja posle `afterId` (paginacija ide dok niz ne stigne prazan). */
export async function fetchEvents(afterId: number, limit = 1000): Promise<OfferEventsPage> {
  const data = await get<OfferEventsPage>("/events", { after_id: afterId, limit });
  if (!data || !Array.isArray(data.events)) throw new Error("Odgovor /events nema niz „events“.");
  return data;
}

/**
 * Zbirna statistika iz samog plugina. Koristi se SAMO kao kontrolna provera
 * (poređenje sa onim što je sinhronizovano) — izvor istine za app su događaji.
 */
export async function fetchStats(days = 30): Promise<OfferStatsApi> {
  return get<OfferStatsApi>("/stats", { days });
}

/* ── Paketi (setovi) ──────────────────────────────────────────────────────────
 * Isti plugin, isti ključ. Paketi se NE sinhronizuju u Supabase — stranica
 * `/ponude/paketi` čita `/packages` i `/packages/stats` uživo (12-ak paketa,
 * dva poziva). Statistika je pluginova (sesije, AOV sa/bez paketa) i ne može
 * se pošteno rekonstruisati iz sirovih događaja bez id-ja sesije.
 */

export type PackageProductApi = {
  id: number;
  parent?: number;
  sku?: string;
  name?: string;
  price?: number;
  in_stock?: boolean;
  /** Proizvod iz paketa je obrisan/nedostupan na sajtu. */
  missing?: boolean;
};

export type PackageItemApi = {
  id: string;
  label: string;
  product: PackageProductApi | null;
  qty: number;
  option?: number;
  price_rule?: string;
  min_price: number | null;
};

export type PackageGroupApi = {
  id: string;
  title: string;
  /** all = sve stavke ulaze · any = kupac bira · upsell = opciona dopuna */
  mode: string;
  items: PackageItemApi[];
};

export type PackageGiftApi = {
  id: string;
  /** ebook | product | shipping */
  type: string;
  title: string;
  product: PackageProductApi | null;
  qty: number;
  value: number;
  file?: string;
};

export type PackageApi = {
  id: number;
  feed_id?: string;
  title: string;
  slug?: string;
  /** publish | draft | … (WordPress status) */
  status: string;
  order?: number;
  url?: string;
  image?: string;
  excerpt?: string;
  from_price: number | null;
  required?: number;
  gifts_from?: string | null;
  gifts_to?: string | null;
  gifts_active?: boolean;
  groups: PackageGroupApi[];
  gifts: PackageGiftApi[];
  /** ISO UTC ili `false` kad paket nikad nije menjan. */
  modified?: string | false;
};

export type PackagesApi = {
  mode?: string;
  archive?: string;
  packages: PackageApi[];
};

/** Brojači jednog paketa iz `/packages/stats` (sve cifre su brojevi). */
export type PackageStatsApi = {
  package_id: number;
  title: string;
} & Partial<
  Record<
    | "archive_view"
    | "card_click"
    | "view"
    | "select"
    | "add_item"
    | "add_all"
    | "add_all_blocked"
    | "optional_add"
    | "upsell_view"
    | "upsell_add"
    | "unlock"
    | "gift_choice"
    | "cartbox_click"
    | "order"
    | "order_partial"
    | "upsell_order"
    | "ebook_sent"
    | "view_sessions"
    | "add_sessions"
    | "unlock_sessions"
    | "orders"
    | "times"
    | "revenue"
    | "order_total"
    | "partial_orders"
    | "partial_revenue"
    | "upsell_revenue"
    | "upsell_orders"
    | "add_value",
    number
  >
>;

export type PackagesStatsApi = {
  days: number;
  archive?: { views?: number };
  /** Prosečna porudžbina sa paketom i bez njega u istom periodu. */
  aov?: { with_orders?: number; with_aov?: number; without_orders?: number; without_aov?: number };
  packages: PackageStatsApi[];
};

/** Svi paketi sa sastavom, cenama i poklonima. */
export async function fetchPackages(): Promise<PackagesApi> {
  const data = await get<PackagesApi>("/packages");
  if (!data || !Array.isArray(data.packages)) {
    throw new Error("Odgovor /packages nema niz „packages“.");
  }
  return data;
}

/** Zbirna statistika po paketu za poslednjih `days` dana. */
export async function fetchPackageStats(days: number): Promise<PackagesStatsApi> {
  const data = await get<PackagesStatsApi>("/packages/stats", { days });
  if (!data || !Array.isArray(data.packages)) {
    throw new Error("Odgovor /packages/stats nema niz „packages“.");
  }
  return data;
}
