import "server-only";

/*
 * REST klijent za Brevo (mejlovi kupcima: novembarske kampanje, Crni petak…).
 *
 * App samo ČITA kampanje i njihovu statistiku — kampanje se prave i zakazuju
 * skriptom `scripts/brevo-novembar.mjs`, ne iz aplikacije.
 *
 * Ključ (`BREVO_API_KEY`) je isključivo serverski: nikad se ne loguje, ne vraća
 * klijentu i ne ulazi u poruku greške. `server-only` obara build ako se fajl
 * uveze u klijentski bundle.
 */

const API = "https://api.brevo.com/v3";
const TIMEOUT_MS = 15_000; // Vercel serverless — zahtev ne sme da visi

/** Statusi kampanje u Brevu. „draft" se u aplikaciji ne prikazuje. */
export type BrevoCampaignStatus =
  "draft" | "sent" | "archive" | "queued" | "suspended" | "inProcess";

export type BrevoGlobalStats = {
  sent: number;
  delivered: number;
  /** Jedinstvena otvaranja (uključuje Apple MPP automatska otvaranja). */
  uniqueViews: number;
  /** Jedinstveni klikovi po primaocu. */
  clickers: number;
  uniqueClicks: number;
  unsubscriptions: number;
  complaints: number;
  hardBounces: number;
  softBounces: number;
  appleMppOpens: number;
};

export type BrevoCampaign = {
  id: number;
  name: string;
  subject: string;
  status: BrevoCampaignStatus;
  /** ISO; postoji kad je kampanja zakazana. */
  scheduledAt: string | null;
  /** ISO; postoji kad je kampanja poslata. */
  sentDate: string | null;
  /** `utm_campaign` iz linkova u mejlu — veza sa porudžbinama u aplikaciji. */
  utmCampaign: string | null;
  stats: BrevoGlobalStats;
  /** Samo u detalju: broj klikova po URL-u. */
  links?: Record<string, number>;
};

type RawCampaign = {
  id: number;
  name: string;
  subject: string;
  status: BrevoCampaignStatus;
  scheduledAt?: string;
  sentDate?: string;
  htmlContent?: string;
  statistics?: { globalStats?: Partial<BrevoGlobalStats>; linksStats?: Record<string, number> };
};

/** Da li je ključ podešen (bez otkrivanja vrednosti). */
export function brevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

async function get<T>(
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY nije podešen.");

  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "api-key": key, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Brevo nije odgovorio u ${TIMEOUT_MS / 1000} s.`);
    }
    throw new Error("Brevo nije dostupan.");
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Brevo je odbio pristup — proveri BREVO_API_KEY i dozvole ključa.");
  }
  if (res.status === 404) throw new Error("Kampanja ne postoji u Brevu.");
  if (!res.ok) throw new Error(`Neočekivan odgovor Brevoa (${res.status}).`);

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("Odgovor Brevoa nije validan JSON.");
  }
}

const UTM_RE = /utm_campaign=([\w-]+)/;

function toCampaign(r: RawCampaign): BrevoCampaign {
  const s = r.statistics?.globalStats ?? {};
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    status: r.status,
    scheduledAt: r.scheduledAt ?? null,
    sentDate: r.sentDate ?? null,
    utmCampaign: r.htmlContent?.match(UTM_RE)?.[1] ?? null,
    stats: {
      sent: s.sent ?? 0,
      delivered: s.delivered ?? 0,
      uniqueViews: s.uniqueViews ?? 0,
      clickers: s.clickers ?? 0,
      uniqueClicks: s.uniqueClicks ?? 0,
      unsubscriptions: s.unsubscriptions ?? 0,
      complaints: s.complaints ?? 0,
      hardBounces: s.hardBounces ?? 0,
      softBounces: s.softBounces ?? 0,
      appleMppOpens: s.appleMppOpens ?? 0,
    },
    links: r.statistics?.linksStats,
  };
}

/**
 * Sve kampanje osim nacrta, najnovije prve. HTML se povlači samo da bi se iz
 * linkova pročitao `utm_campaign`; ne vraća se dalje.
 */
export async function fetchCampaigns(): Promise<BrevoCampaign[]> {
  const out: BrevoCampaign[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await get<{ campaigns?: RawCampaign[]; count?: number }>("/emailCampaigns", {
      type: "classic",
      statistics: "globalStats",
      limit: 50,
      offset,
      sort: "desc",
    });
    const list = page.campaigns ?? [];
    out.push(...list.filter((c) => c.status !== "draft").map(toCampaign));
    if (list.length < 50) break;
  }
  return out;
}

/** Jedna kampanja sa klikovima po linku (`linksStats` vraća i `globalStats`). */
export async function fetchCampaign(id: number): Promise<BrevoCampaign> {
  return toCampaign(await get<RawCampaign>(`/emailCampaigns/${id}`, { statistics: "linksStats" }));
}
