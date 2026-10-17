import "server-only";

import { createClient } from "@/lib/supabase/server";
import { mustRows } from "@/lib/supabase/paginate";

/*
 * Upiti modula AI Asistent. Čitaju kroz RLS klijent: politika
 * `ai_conversations_own` pušta samo VLASNIKA (Admin/Menadžer) — istorija je
 * lična, pa ovde nema filtera po korisniku koji bi bio jedina zaštita.
 */

export type AiConversationRow = {
  id: string;
  title: string;
  model: string;
  updated_at: string;
};

/** Poslednji razgovori korisnika (najnoviji prvi). Lista je kratka — limit umesto paginacije. */
export async function listAiConversations(limit = 100): Promise<AiConversationRow[]> {
  const supabase = await createClient();
  const res = await supabase
    .from("ai_conversations")
    .select("id, title, model, updated_at")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .order("id")
    .limit(limit);
  return mustRows<AiConversationRow>(res, "ai_conversations");
}
