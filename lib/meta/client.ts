import "server-only";

/*
 * Klijent Meta Marketing API-ja (Graph API) — SAMO ČITANJE (`ads_read`).
 *
 * App nikad ne pravi, pauzira ni menja kampanje. Token (`META_ACCESS_TOKEN`,
 * System User, bez isteka) je isključivo serverski: nikad se ne loguje, ne vraća
 * klijentu i ne ulazi u poruku greške — poruke nose samo status, Meta kod i
 * putanju. `paging.next` URL sadrži token, pa se ni on nigde ne ispisuje.
 */

/** Verzija Graph API-ja — JEDINO mesto. v23 i starije Meta odbija za Ads API. */
export const GRAPH_API_VERSION = "v25.0";

const TIMEOUT_MS = 20_000; // Vercel serverless — zahtev ne sme da visi
const PAGE_LIMIT = 500;

export type MetaCampaignApi = {
  id: string;
  name: string;
  effective_status?: string;
  objective?: string;
};

export type MetaActionApi = { action_type: string; value: string };

export type MetaInsightApi = {
  campaign_id: string;
  campaign_name: string;
  date_start: string; // YYYY-MM-DD, vremenska zona naloga
  date_stop: string;
  spend?: string; // decimalni string („12.34") — NIKAD parseFloat
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  account_currency?: string;
  actions?: MetaActionApi[];
  action_values?: MetaActionApi[];
};

export type MetaAccountApi = {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
};

type Paged<T> = { data: T[]; paging?: { next?: string } };

/** Da li su env varijable podešene (bez otkrivanja vrednosti). */
export function metaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

/** ID naloga uvek sa prefiksom `act_` (u env-u sme i bez njega). */
export function metaAccountId(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  if (!raw) throw new Error("META_AD_ACCOUNT_ID nije podešen.");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function token(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("META_ACCESS_TOKEN nije podešen.");
  return t;
}

/**
 * GET sa tvrdim timeout-om. `label` je čitljiva putanja za poruke grešaka —
 * pun URL se ne ispisuje (sadrži token).
 */
async function getJson<T>(url: URL, label: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Meta nije odgovorila u ${TIMEOUT_MS / 1000} s (${label}).`);
    }
    throw new Error(`Meta API nije dostupan (${label}).`);
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // ispod se prijavljuje po statusu
  }

  const metaError = (body as { error?: { code?: number; message?: string } } | null)?.error;
  if (!res.ok || metaError) {
    const code = metaError?.code;
    // 190 = token istekao/opozvan · 200/10 = nema dozvole · 17/80004 = limit poziva
    if (code === 190) throw new Error("Meta token je istekao ili opozvan — napravi nov (M0).");
    if (code === 200 || code === 10) {
      throw new Error(
        `Meta odbija pristup (${label}) — token mora imati ads_read i pristup nalogu.`,
      );
    }
    if (code === 17 || code === 80004) {
      throw new Error("Meta privremeno ograničava pozive — sledeći pokušaj će proći.");
    }
    throw new Error(`Meta greška ${res.status}${code ? ` / kod ${code}` : ""} (${label}).`);
  }

  return body as T;
}

function graphUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token());
  return url;
}

/** Sve stranice (prati `paging.next` dok postoji). */
async function getAllPages<T>(first: URL, label: string): Promise<T[]> {
  const out: T[] = [];
  let next: URL | null = first;
  for (let page = 0; next && page < 200; page++) {
    const body: Paged<T> = await getJson<Paged<T>>(next, label);
    out.push(...(body.data ?? []));
    next = body.paging?.next ? new URL(body.paging.next) : null;
  }
  return out;
}

/** Osnovni podaci naloga (valuta, vremenska zona). */
export async function fetchAccount(): Promise<MetaAccountApi> {
  const acct = metaAccountId();
  return getJson<MetaAccountApi>(
    graphUrl(acct, { fields: "id,name,currency,timezone_name" }),
    "nalog",
  );
}

/** Sve kampanje naloga, uključujući pauzirane i arhivirane. */
export async function fetchCampaigns(): Promise<MetaCampaignApi[]> {
  const acct = metaAccountId();
  return getAllPages<MetaCampaignApi>(
    graphUrl(`${acct}/campaigns`, {
      fields: "id,name,effective_status,objective",
      limit: String(PAGE_LIMIT),
      // bez ovoga Meta ne vraća arhivirane/obrisane, a one imaju istorijsku potrošnju
      filtering: JSON.stringify([
        {
          field: "effective_status",
          operator: "IN",
          value: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES"],
        },
      ]),
    }),
    "kampanje",
  );
}

/**
 * Insights po kampanji i danu za [since, until] (oba uključena, dani naloga).
 * Pozivalac deli dug period na mesece — jedan ogroman upit Meta ume da odbije.
 */
export async function fetchCampaignInsights(
  since: string,
  until: string,
): Promise<MetaInsightApi[]> {
  const acct = metaAccountId();
  return getAllPages<MetaInsightApi>(
    graphUrl(`${acct}/insights`, {
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields: [
        "campaign_id",
        "campaign_name",
        "spend",
        "impressions",
        "clicks",
        "inline_link_clicks",
        "account_currency",
        "actions",
        "action_values",
      ].join(","),
      limit: String(PAGE_LIMIT),
    }),
    `insights ${since}–${until}`,
  );
}
