import "server-only";

/*
 * Slanje poruka na Telegram (dnevni izveštaj o reklamama).
 *
 * `TELEGRAM_BOT_TOKEN` (od @BotFather) i `TELEGRAM_CHAT_ID` (više ID-jeva
 * razdvojeno zarezom) su isključivo serverski — token se ne loguje i ne ulazi
 * u poruku greške. Bez njih `telegramConfigured()` je false i pozivalac javlja
 * „nije podešeno" (isti obrazac kao Resend / VAPID / Anthropic).
 */

const LIMIT = 4000; // Telegram dozvoljava 4096 znakova po poruci

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Escape za `parse_mode: HTML`. */
export function tgEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Deli dug tekst po redovima da nijedan deo ne pređe limit. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > LIMIT) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** Šalje HTML poruku svim chat ID-jevima. Baca grešku sa Telegram opisom (bez tokena). */
export async function sendTelegram(html: string): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) throw new Error("Telegram nije podešen.");

  let sent = 0;
  for (const chat_id of chatIds) {
    for (const text of chunks(html)) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!res.ok || !body?.ok) throw new Error(`Telegram greška ${res.status}: ${body?.description ?? "bez opisa"}`);
      sent++;
    }
  }
  return sent;
}
