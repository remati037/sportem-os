import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Javne rute — dostupne bez sesije (prijava + prihvat invite-a + webhookovi +
 * cron). `/api/webhooks` i `/api/cron` se sami autentifikuju (HMAC / CRON_SECRET),
 * pa ne smeju biti redirektovani na /prijava. Push subscribe/unsubscribe NISU
 * javni — traže sesiju (svaki korisnik svoje uređaje).
 */
const PUBLIC_PATHS = ["/prijava", "/postavi-lozinku", "/auth", "/api/webhooks", "/api/cron"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refresh Supabase sesije na svakom zahtevu + zaštita ruta.
 * Neulogovan na privatnoj ruti → /prijava; ulogovan na /prijava → /.
 *
 * VAŽNO: vraća se baš ovaj `response` (sa osveženim kolačićima), inače se
 * sesija gubi između zahteva (@supabase/ssr konvencija).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims verifikuje JWT lokalno (bez poziva ka Auth serveru) i pritom
  // refreshuje istekli token — dužnost middleware-a ostaje očuvana.
  const { data } = await supabase.auth.getClaims();
  const isAuthed = Boolean(data?.claims);

  const { pathname } = request.nextUrl;

  if (!isAuthed && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/prijava";
    return NextResponse.redirect(url);
  }

  if (isAuthed && pathname === "/prijava") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
