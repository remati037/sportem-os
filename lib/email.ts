import "server-only";

import { Resend } from "resend";
import * as Sentry from "@sentry/nextjs";

/*
 * Email slanje (Korak 1.9) preko Resend-a. Kao i push: bez `RESEND_API_KEY`
 * tiho je no-op (ne obara pozivaoca). Koristi se samo za obaveštenja koja je
 * korisnik izričito prebacio na email kanal.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

/** Da li je email kanal uopšte konfigurisan (za notifyRoles grananje). */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

const FROM = process.env.EMAIL_FROM || "Sportem <obavestenja@sportem.rs>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Minimalni brend-neutralan HTML: naslov, tekst, opciono dugme ka app-u. */
function renderHtml(title: string, body: string, url?: string): string {
  const link = url ? `${APP_URL}${url}` : APP_URL;
  return `<!doctype html><html lang="sr"><body style="margin:0;background:#F5F7F5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr><td style="background:#1B7A45;padding:16px 24px;color:#fff;font-weight:700;font-size:15px">Sportem</td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0 0 8px;font-size:18px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#4b5563">${escapeHtml(body)}</p>
        <a href="${link}" style="display:inline-block;background:#1B7A45;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Otvori Sportem</a>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Isključi email obaveštenja na stranici „Obaveštenja“ u aplikaciji.</p>
  </td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pošalji jedan email (best-effort). Vraća false na grešku/no-op. */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  url?: string,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html: renderHtml(subject, body, url),
    });
    if (error) {
      Sentry.captureException(error);
      return false;
    }
    return true;
  } catch (err) {
    Sentry.captureException(err);
    return false;
  }
}
