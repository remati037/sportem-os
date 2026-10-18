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
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Poruka za prikaz u chatu (bez tool/thinking sirovine). */
export type AiDisplayMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  model: string | null;
  /** Alati koje je asistent pozvao za ovaj odgovor (kartica „Pogledao…"). */
  tools: { name: string; input: Record<string, unknown> }[];
  /** Izvori sa weba (citati iz web pretrage, A4). */
  sources: AiSource[];
};

export type AiSource = { url: string; title: string | null };

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
      .select(
        "id, role, content, model, created_at, input_tokens, cache_read_tokens, cache_write_tokens",
      )
      .eq("conversation_id", conversationId)
      .order("created_at")
      .order("id"),
  );
}

type Block = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  citations?: unknown;
};

/** Jedinstveni web izvori iz citata u tekst blokovima (redosled pojavljivanja). */
export function sourcesOf(content: unknown): AiSource[] {
  const seen = new Map<string, AiSource>();
  for (const b of blocks(content)) {
    if (b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const c of b.citations as { type?: string; url?: unknown; title?: unknown }[]) {
      if (c.type !== "web_search_result_location" || typeof c.url !== "string") continue;
      if (!seen.has(c.url))
        seen.set(c.url, { url: c.url, title: typeof c.title === "string" ? c.title : null });
    }
  }
  return [...seen.values()];
}

/** Da li je razgovor već koristio web pretragu (tada ostaje uključena — v. ruta). */
export function usesWebSearch(rows: Pick<AiMessageRow, "content">[]): boolean {
  return rows.some((r) =>
    blocks(r.content).some((b) => b.type === "server_tool_use" && b.name === "web_search"),
  );
}

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

/** Poruka korisnika koju je on stvarno napisao (ne red sa rezultatima alata). */
export function isTypedUserMessage(row: Pick<AiMessageRow, "role" | "content">): boolean {
  return row.role === "user" && blocks(row.content).some((b) => b.type === "text");
}

/**
 * Redovi → poruke za prikaz. Jedan odgovor asistenta sa alatima je u bazi više
 * redova (asistent: tool_use → korisnik: tool_result → asistent: tekst…), pa
 * se uzastopni redovi asistenta spajaju u JEDNU poruku, a redovi sa samo
 * rezultatima alata se ne prikazuju. Kod korisnika se prikazuje PRVI tekst
 * blok (ostali su kontekst koji server dopisuje, npr. današnji datum).
 */
export function toDisplayMessages(rows: AiMessageRow[]): AiDisplayMessage[] {
  const out: AiDisplayMessage[] = [];
  for (const row of rows) {
    const list = blocks(row.content);
    if (row.role === "user") {
      if (!isTypedUserMessage(row)) continue;
      const first = list.find((b) => b.type === "text" && typeof b.text === "string");
      out.push({
        id: row.id,
        role: "user",
        text: (first?.text as string) ?? "",
        thinking: "",
        model: null,
        tools: [],
        sources: [],
      });
      continue;
    }

    const text = list
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n\n");
    const thinking = list
      .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking as string)
      .filter(Boolean)
      .join("\n\n");
    const tools = list
      .filter(
        (b) =>
          (b.type === "tool_use" || b.type === "server_tool_use") && typeof b.name === "string",
      )
      .map((b) => ({ name: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }));

    const sources = sourcesOf(row.content);

    const prev = out.at(-1);
    if (prev?.role === "assistant") {
      prev.id = row.id;
      prev.text = [prev.text, text].filter(Boolean).join("\n\n");
      prev.thinking = [prev.thinking, thinking].filter(Boolean).join("\n\n");
      prev.tools.push(...tools);
      for (const src of sources)
        if (!prev.sources.some((p) => p.url === src.url)) prev.sources.push(src);
      prev.model = row.model ?? prev.model;
    } else {
      out.push({ id: row.id, role: "assistant", text, thinking, model: row.model, tools, sources });
    }
  }
  return out;
}

/** Veličina konteksta poslednjeg odgovora (tokeni) — za napomenu o dugom razgovoru. */
export function lastContextTokens(rows: AiMessageRow[]): number {
  const last = [...rows].reverse().find((r) => r.role === "assistant" && r.input_tokens > 0);
  return last ? last.input_tokens + last.cache_read_tokens + last.cache_write_tokens : 0;
}
