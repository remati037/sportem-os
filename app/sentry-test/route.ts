// Test-endpoint za dokaz Sentry integracije (Korak 0.6).
// GET /sentry-test namerno baca grešku na serveru — treba da se pojavi
// event u Sentry dashboard-u. Ukloniti ili zaključati posle verifikacije.
export const dynamic = "force-dynamic";

export function GET() {
  throw new Error("Sentry test — Korak 0.6 (server route)");
}
