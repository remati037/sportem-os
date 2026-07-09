import { renderToBuffer } from "@react-pdf/renderer";

import { getProfile } from "@/lib/auth";
import { getOrdersForShipping } from "@/db/orders";

import { ShippingListDocument } from "./shipping-pdf";

/*
 * PDF „lista za slanje" (Korak 1.5) — Admin + Menadžer. Logistika nema pristup
 * porudžbinama (RLS), pa je i ruta zatvorena za nju (403). getProfile umesto
 * requireRole jer requireRole radi redirect() (baca u route handleru).
 * runtime=nodejs: @react-pdf čita font sa diska (fs), ne radi na Edge-u.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await getProfile();
  if (!session) return new Response(null, { status: 401 });
  if (session.profile.role === "logistics") return new Response(null, { status: 403 });

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, 200);

  if (ids.length === 0) {
    return new Response("Nijedna porudžbina nije izabrana.", { status: 400 });
  }

  const orders = await getOrdersForShipping(ids);
  if (orders.length === 0) {
    return new Response("Porudžbine nisu pronađene.", { status: 404 });
  }

  const printedAtIso = new Date().toISOString();
  const buffer = await renderToBuffer(
    <ShippingListDocument orders={orders} printedAtIso={printedAtIso} />,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="lista-za-slanje.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
