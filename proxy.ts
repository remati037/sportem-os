import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Next 16 „proxy" konvencija (bivši middleware): refresh sesije + zaštita ruta.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Sve rute osim:
     * - _next/static, _next/image (Next asseti)
     * - favicon i statičke slike/fontovi
     * Auth logika (javne vs. privatne rute) je u updateSession.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
