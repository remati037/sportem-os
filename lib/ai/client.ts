import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/*
 * AI Asistent — Anthropic klijent (Korak A1).
 *
 * Ključ (`ANTHROPIC_API_KEY`) živi ISKLJUČIVO ovde: modul je `server-only`,
 * ključ se ne loguje, ne vraća klijentu i ne ulazi u poruke grešaka. Bez
 * ključa `getAnthropic()` vraća null i pozivalac javlja „nije podešeno"
 * (isti obrazac kao Resend / VAPID).
 */

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // Timeout u ms (TS SDK); dva ponovna pokušaja za 429/5xx su podrazumevana.
  if (!client) client = new Anthropic({ apiKey, timeout: 120_000 });
  return client;
}
