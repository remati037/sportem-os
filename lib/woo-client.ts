import "server-only";

/*
 * Woo REST klijent (app → Woo). Do sada je Woo bio samo izvor webhook-a
 * (Woo → app); ovo je prvi write ka Woo-u. Basic auth (consumer key/secret),
 * isti obrazac kao GET u `scripts/woo-backfill.mjs`. Pozivalac (server akcija)
 * tretira svaku grešku kao soft-fail — app ostaje izvor istine.
 */

/** PUT status jedne Woo porudžbine. Baca grešku na bilo koji problem
 *  (nedostaje env, mreža, timeout, ne-2xx odgovor). */
export async function updateWooOrderStatus(wooOrderId: number, wooStatus: string): Promise<void> {
  const base = process.env.WOO_API_URL;
  const key = process.env.WOO_CONSUMER_KEY;
  const secret = process.env.WOO_CONSUMER_SECRET;
  if (!base || !key || !secret) throw new Error("Woo REST env nije konfigurisan.");

  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const url = `${base.replace(/\/$/, "")}/orders/${wooOrderId}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // Vercel serverless — ne visi
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status: wooStatus }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Woo API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
