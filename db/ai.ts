import "server-only";

import { createClient } from "@/lib/supabase/server";
import { mustOne, mustRows, selectAll } from "@/lib/supabase/paginate";

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

/** Sirov red poruke — `content` je niz Anthropic content blokova (jsonb). */
export type AiMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  model: string | null;
  created_at: string;
};

/** Poruka za prikaz u chatu (bez tool/thinking sirovine). */
export type AiDisplayMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  model: string | null;
};

/** Default naslov iz migracije — po njemu se zna da auto-naslov još nije odrađen. */
export const AI_DEFAULT_TITLE = "Nov razgovor";

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

/** Jedan razgovor (samo sopstveni — RLS) ili null. */
export async function getAiConversation(id: string): Promise<AiConversationRow | null> {
  const supabase = await createClient();
  const res = await supabase
    .from("ai_conversations")
    .select("id, title, model, updated_at")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  return mustOne<AiConversationRow>(res, "ai_conversations: jedan");
}

/** Sve poruke razgovora hronološki (paginirano — dug razgovor ume da pređe 1000 redova). */
export async function listAiMessages(conversationId: string): Promise<AiMessageRow[]> {
  const supabase = await createClient();
  return selectAll<AiMessageRow>("ai_messages", () =>
    supabase
      .from("ai_messages")
      .select("id, role, content, model, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .order("id"),
  );
}

type Block = { type?: unknown; text?: unknown; thinking?: unknown };

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

/**
 * Tekst za prikaz. Kod korisnika je to PRVI tekst blok (ostali su kontekst
 * koji server dopisuje, npr. današnji datum); kod asistenta svi tekst blokovi.
 */
export function toDisplayMessage(row: AiMessageRow): AiDisplayMessage {
  const list = blocks(row.content);
  const texts = list
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
  const thinking = list
    .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking as string)
    .filter(Boolean)
    .join("\n\n");

  return {
    id: row.id,
    role: row.role,
    text: row.role === "user" ? (texts[0] ?? "") : texts.join("\n\n"),
    thinking: row.role === "assistant" ? thinking : "",
    model: row.model,
  };
}
