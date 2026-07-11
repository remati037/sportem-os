import * as Sentry from "@sentry/nextjs";

import { todayBelgrade } from "@/lib/date-belgrade";
import { notifyRoles } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_STATUS } from "@/lib/woo";

/*
 * Konsolidovani dnevni cron (Korak 1.9). Vercel Cron ga zove jednom dnevno (UTC);
 * ruta interno računa Beograd datum/dan i bira koje podsetnike da pošalje —
 * jedan cron pokriva sve okidače (Hobby-friendly). Guard: Bearer CRON_SECRET.
 *
 * Ciljanje po roli: Admin+Menadžer sve; Logistika SAMO low stock (zaključana
 * odluka). Dedup: notifyRoles kroz notification_log (type, reference_id) — pa i
 * ponovni poziv istog dana ne šalje duplo.
 */

export const dynamic = "force-dynamic";

const STAFF = ["admin", "manager"] as const;
const ALL = ["admin", "manager", "logistics"] as const;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const today = todayBelgrade(); // „YYYY-MM-DD" u Beogradu
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=ned … 6=sub
    const dayOfMonth = Number(today.slice(8, 10));

    const deliveredId = await deliveredStatusId(supabase);
    const sent: string[] = [];

    // ── Svaki dan: low stock (svi), isporučeno-neuplaćeno (staff) ────────────
    const lowStock = await lowStockCount(supabase);
    if (lowStock > 0) {
      await notifyRoles("low_stock", `low_stock:${today}`, [...ALL], {
        title: "Nisko stanje",
        body: `${lowStock} ${plural(lowStock, "artikal", "artikla", "artikala")} na niskom stanju.`,
        url: "/katalog",
        tag: "low-stock",
      });
      sent.push("low_stock");
    }

    if (deliveredId) {
      const unpaid = await deliveredUnpaidCount(supabase, deliveredId);
      if (unpaid > 0) {
        await notifyRoles("delivered_unpaid", `delivered_unpaid:${today}`, [...STAFF], {
          title: "Isporučeno a neuplaćeno",
          body: `${unpaid} ${plural(unpaid, "porudžbina", "porudžbine", "porudžbina")} čeka uplatu.`,
          url: "/finansije/uplate",
          tag: "delivered-unpaid",
        });
        sent.push("delivered_unpaid");
      }
    }

    // ── Nedelja (0) i sreda (3) uveče: podsetnik za pripremu slanja ──────────
    if (weekday === 0 || weekday === 3) {
      await notifyRoles("prep_reminder", `prep:${today}`, [...STAFF], {
        title: "Priprema slanja",
        body: "Vreme je da se pripremi lista za slanje.",
        url: "/porudzbine",
        tag: "prep-reminder",
      });
      sent.push("prep_reminder");
    }

    // ── 1. i 15. u mesecu (~2 nedelje): podsetnik na fakturu ────────────────
    if ((dayOfMonth === 1 || dayOfMonth === 15) && deliveredId) {
      const candidates = await invoiceCandidateCount(supabase, deliveredId);
      if (candidates > 0) {
        await notifyRoles("invoice_reminder", `invoice:${today}`, [...STAFF], {
          title: "Podsetnik za fakturu",
          body: `${candidates} ${plural(candidates, "porudžbina", "porudžbine", "porudžbina")} za fakturisanje drugu.`,
          url: "/finansije/fakture",
          tag: "invoice-reminder",
        });
        sent.push("invoice_reminder");
      }
    }

    return Response.json({ ok: true, date: today, sent });
  } catch (error) {
    Sentry.captureException(error);
    return new Response(null, { status: 500 });
  }
}

type Admin = ReturnType<typeof createAdminClient>;

/** ID „Isporučeno" statusa po imenu (nikad hardkodovan UUID). */
async function deliveredStatusId(supabase: Admin): Promise<string | null> {
  const { data } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("name", APP_STATUS.delivered)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Broj aktivnih varijanti na niskom stanju (poređenje dve kolone → JS filter). */
async function lowStockCount(supabase: Admin): Promise<number> {
  const { data } = await supabase
    .from("product_variants")
    .select("stock_quantity, low_stock_threshold, archived_at, products(archived_at)")
    .is("archived_at", null);
  const rows =
    (data as
      | {
          stock_quantity: number;
          low_stock_threshold: number;
          products: { archived_at: string | null } | null;
        }[]
      | null) ?? [];
  return rows.filter(
    (r) =>
      r.products != null &&
      r.products.archived_at == null &&
      r.stock_quantity <= r.low_stock_threshold,
  ).length;
}

/** Isporučene, neuplaćene XExpress porudžbine (čekaju uplatu). */
async function deliveredUnpaidCount(supabase: Admin, deliveredId: string): Promise<number> {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "neuplaceno")
    .eq("status_id", deliveredId)
    .not("delivered_at", "is", null);
  return count ?? 0;
}

/** Kandidati za fakturu drugu (isti skup kao „drug mi duguje" u finansijama). */
async function invoiceCandidateCount(supabase: Admin, deliveredId: string): Promise<number> {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_method", "xexpress")
    .eq("payment_status", "uplaceno")
    .eq("status_id", deliveredId)
    .is("invoice_id", null)
    .eq("needs_vp", false);
  return count ?? 0;
}

/** Srpska množina (1 / 2–4 / 5+). */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
