import "server-only";

import { belgradeLocalToUtc, todayBelgrade } from "@/lib/date-belgrade";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/paginate";

/*
 * Potrošnja i mesečni limit AI asistenta (Korak A5).
 *
 * Cena svake poruke je već upisana u `ai_messages.cost_micro_usd` (integer,
 * mikro-USD — bez float-a u finansijama). Ovde se sabira za TEKUĆI kalendarski
 * mesec po Beogradu.
 *
 * Čita se kroz SERVICE ROLE: limit važi za ceo nalog (oba korisnika zajedno),
 * a RLS svakome pokazuje samo sopstvene poruke. Pozivaoci su iza kapije
 * (`requireRole` / `getAiSession`), a ka klijentu ide samo zbir — nikad tuđe
 * poruke. Ukupan zbir vidi samo Admin (v. strana).
 *
 * Limit: `AI_MONTHLY_LIMIT_USD` (env, npr. „20"). Prazno = bez limita u app-u
 * (spending limit na console.anthropic.com i dalje važi).
 */

export type AiBudget = {
  /** Potrošnja ulogovanog korisnika ovog meseca (mikro-USD). */
  mineMicro: number;
  /** Ukupna potrošnja naloga ovog meseca (mikro-USD). */
  totalMicro: number;
  /** Mesečni limit (mikro-USD) ili null kad nije podešen. */
  limitMicro: number | null;
  /** totalMicro / limitMicro (0 kad nema limita). */
  ratio: number;
  /** Limit je potrošen — nove poruke se odbijaju. */
  blocked: boolean;
};

/** Mesečni limit iz env-a u mikro-USD (integer) ili null. */
export function aiLimitMicro(): number | null {
  const raw = process.env.AI_MONTHLY_LIMIT_USD?.trim();
  if (!raw) return null;
  const usd = Number(raw.replace(",", "."));
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1_000_000) : null;
}

/** Početak tekućeg meseca po Beogradu, kao ISO UTC. */
function monthStartUtc(): string {
  const month = todayBelgrade().slice(0, 7);
  return belgradeLocalToUtc(`${month}-01 00:00:00`) ?? `${month}-01T00:00:00.000Z`;
}

export async function getAiBudget(userId: string): Promise<AiBudget> {
  const supabase = createAdminClient();
  const rows = await selectAll<{
    cost_micro_usd: number;
    conversation: { user_id: string } | null;
  }>("AI potrošnja meseca", () =>
    supabase
      .from("ai_messages")
      .select("cost_micro_usd, conversation:ai_conversations(user_id)")
      .eq("role", "assistant")
      .gt("cost_micro_usd", 0)
      .gte("created_at", monthStartUtc())
      .order("id", { ascending: true }),
  );

  let totalMicro = 0;
  let mineMicro = 0;
  for (const r of rows) {
    // bigint ume da stigne kao string kroz PostgREST.
    const cost = Number(r.cost_micro_usd) || 0;
    totalMicro += cost;
    if (r.conversation?.user_id === userId) mineMicro += cost;
  }

  const limitMicro = aiLimitMicro();
  const ratio = limitMicro ? totalMicro / limitMicro : 0;
  return { mineMicro, totalMicro, limitMicro, ratio, blocked: limitMicro != null && ratio >= 1 };
}
