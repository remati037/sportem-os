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
     * - PWA: service worker (sw.js), Serwist worker (swe-worker-*.js) i manifest
     *   (moraju biti dostupni bez auth-a — inače SW registracija / parsiranje
     *   manifesta padnu na redirect ka /prijava)
     * Auth logika (javne vs. privatne rute) je u updateSession.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|swe-worker-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|woff2?)$).*)",
  ],
};
