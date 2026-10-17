import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";

import { getAiSession } from "@/lib/ai/access";
import { getAnthropic } from "@/lib/ai/client";
import { AI_TITLE_MODEL, costMicroUsd, getAiModel, type AiModel } from "@/lib/ai/models";
import { SYSTEM_PROMPT, userContextBlock } from "@/lib/ai/system-prompt";
import { todayBelgrade } from "@/lib/date-belgrade";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mustOne } from "@/lib/supabase/paginate";
import { chatRequestSchema } from "@/lib/validation/ai";
import { AI_DEFAULT_TITLE, getAiConversation, listAiMessages } from "@/db/ai";

/*
 * POST /api/asistent/chat (Korak A2) — JEDINA ruta koja zove Anthropic.
 *
 * Pristup: Admin + Menadžer (`getAiSession`, JSON 401/403 umesto redirecta);
 * istorija je lična kroz RLS (`ai_*_own`). Upisi idu RLS klijentom korisnika —
 * jedini izuzetak je brisanje poslednjeg odgovora kod „Ponovi" (poruke nemaju
 * delete politiku, append-only), koje ide kroz service role TEK POSLE provere
 * vlasništva preko RLS-a.
 *
 * Odgovor je NDJSON stream (jedan JSON događaj po liniji):
 *   {type:"meta", conversationId}      — razgovor (nov ili postojeći)
 *   {type:"thinking", delta}           — sažetak razmišljanja (sklopivo u UI-ju)
 *   {type:"text", delta}               — tekst odgovora
 *   {type:"done", messageId, model}    — odgovor upisan
 *   {type:"title", title}              — auto-naslov (samo prvi odgovor)
 *   {type:"error", message}            — srpska poruka, bez detalja servera
 *
 * Istorija se šalje API-ju kao CEO niz content blokova (append-only — Opus/
 * Sonnet 5.5 odbijaju prepravljenu istoriju). Datum ide u poruku korisnika,
 * ne u system prompt (keš prefiksa).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_TOKENS = 32_000;

type Event =
  | { type: "meta"; conversationId: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "done"; messageId: string | null; model: string }
  | { type: "title"; title: string }
  | { type: "error"; message: string };

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Srpska poruka za grešku API-ja — bez detalja (ključ, telo zahteva) ka klijentu. */
function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "AI ključ na serveru nije ispravan.";
  if (err instanceof Anthropic.PermissionDeniedError) return "AI nalog nema dozvolu za ovaj model.";
  if (err instanceof Anthropic.RateLimitError)
    return "Previše zahteva ka AI servisu — pokušaj ponovo za minut.";
  if (err instanceof Anthropic.BadRequestError) return "AI servis je odbio zahtev.";
  if (err instanceof Anthropic.APIConnectionError) return "Nema veze sa AI servisom.";
  if (err instanceof Anthropic.APIError && err.status === 529)
    return "AI servis je trenutno preopterećen — pokušaj ponovo.";
  return "AI odgovor nije uspeo.";
}

/** Opus/Sonnet 5.5 imaju server-side fallback na odbijanje; Haiku ga nema. */
function fallbackParams(model: AiModel) {
  if (model.id === "claude-haiku-5-5") return {};
  return {
    betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
    fallbacks: "default" as const,
  };
}

/** Kratak naslov razgovora (Haiku). Best-effort: null na bilo kakav problem. */
async function generateTitle(client: Anthropic, question: string, answer: string) {
  try {
    const res = await client.messages.create({
      model: AI_TITLE_MODEL,
      max_tokens: 1000,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `Napiši kratak naslov (najviše 6 reči, srpski latinicom, bez navodnika i tačke) za razgovor koji počinje ovako.\n\nPitanje: ${question.slice(0, 1500)}\n\nOdgovor: ${answer.slice(0, 1500)}\n\nVrati SAMO naslov.`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .replace(/["„“”*#]/g, "")
      .trim()
      .split("\n")[0]
      ?.trim();
    return text ? text.slice(0, 120) : null;
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "ai-title" } });
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getAiSession();
  if (!session) return jsonError("Nemaš pristup asistentu.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Neispravno telo zahteva.", 400);
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Neispravan unos.", 400);
  const req = parsed.data;

  const client = getAnthropic();
  if (!client) return jsonError("AI asistent nije podešen (nedostaje ključ na serveru).", 503);

  const model = getAiModel(req.model);
  const supabase = await createClient();

  // ── Razgovor: postojeći (samo sopstveni — RLS) ili nov ────────────────────
  let conversation = req.conversationId ? await getAiConversation(req.conversationId) : null;
  if (req.conversationId && !conversation) return jsonError("Razgovor nije pronađen.", 404);

  if (!conversation) {
    try {
      conversation = mustOne(
        await supabase
          .from("ai_conversations")
          .insert({ user_id: session.userId, model: model.id })
          .select("id, title, model, updated_at")
          .single(),
        "ai_conversations: insert",
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { area: "ai-chat" } });
      return jsonError("Razgovor nije sačuvan.", 500);
    }
    if (!conversation) return jsonError("Razgovor nije sačuvan.", 500);
  }
  const conversationId = conversation.id;

  // ── Istorija + nova poruka ────────────────────────────────────────────────
  let history = await listAiMessages(conversationId);
  let questionText: string;

  if (req.mode === "regenerate") {
    const last = history.at(-1);
    if (last?.role === "assistant") {
      // Vlasništvo je dokazano gore (getAiConversation ide kroz RLS).
      const { error } = await createAdminClient()
        .from("ai_messages")
        .delete()
        .eq("id", last.id)
        .eq("conversation_id", conversationId);
      if (error) {
        Sentry.captureException(error, { tags: { area: "ai-chat" } });
        return jsonError("Prethodni odgovor nije obrisan.", 500);
      }
      history = history.slice(0, -1);
    }
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (!lastUser) return jsonError("Nema pitanja na koje bi se odgovorilo ponovo.", 400);
    const first = Array.isArray(lastUser.content) ? lastUser.content[0] : null;
    questionText = typeof first?.text === "string" ? first.text : "";
  } else {
    questionText = req.message;
    const content: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: req.message },
      { type: "text", text: userContextBlock(todayBelgrade(), session.profile.full_name) },
    ];
    const { data: inserted, error } = await supabase
      .from("ai_messages")
      .insert({ conversation_id: conversationId, role: "user", content })
      .select("id, role, content, model, created_at")
      .single();
    if (error || !inserted) {
      Sentry.captureException(error, { tags: { area: "ai-chat" } });
      return jsonError("Poruka nije sačuvana.", 500);
    }
    history = [...history, inserted];
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content as Anthropic.Beta.BetaContentBlockParam[],
  }));
  const isFirstAnswer = !history.some((m) => m.role === "assistant");
  const needsTitle = conversation.title === AI_DEFAULT_TITLE && isFirstAnswer;

  // ── Stream ────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true; // klijent je otišao — upis u bazu i dalje ide do kraja
        }
      };

      send({ type: "meta", conversationId });

      let partialText = "";
      let answer = "";
      let messageId: string | null = null;

      try {
        const apiStream = client.beta.messages.stream(
          {
            model: model.id,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: model.effort },
            messages,
            ...fallbackParams(model),
          },
          { signal: abort.signal },
        );

        for await (const event of apiStream) {
          if (event.type !== "content_block_delta") continue;
          if (event.delta.type === "text_delta") {
            partialText += event.delta.text;
            send({ type: "text", delta: event.delta.text });
          } else if (event.delta.type === "thinking_delta") {
            send({ type: "thinking", delta: event.delta.thinking });
          }
        }

        const final = await apiStream.finalMessage();
        const content: unknown[] = [...final.content];
        if (final.stop_reason === "refusal") {
          const note = "\n\n_Model je odbio da odgovori na ovo pitanje._";
          send({ type: "text", delta: note });
          content.push({ type: "text", text: note.trim() });
        } else if (final.stop_reason === "max_tokens") {
          const note = "\n\n_Odgovor je prekinut jer je predugačak._";
          send({ type: "text", delta: note });
        }
        answer = partialText;

        const { data: saved, error } = await supabase
          .from("ai_messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content,
            model: final.model ?? model.id,
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            cache_read_tokens: final.usage.cache_read_input_tokens ?? 0,
            cache_write_tokens: final.usage.cache_creation_input_tokens ?? 0,
            cost_micro_usd: costMicroUsd(model.id, final.usage),
          })
          .select("id")
          .single();
        if (error) throw error;
        messageId = saved?.id ?? null;
      } catch (err) {
        const aborted = abort.signal.aborted || err instanceof Anthropic.APIUserAbortError;
        if (aborted) {
          // Stop: sačuvaj ono što je stiglo (samo tekst — nepotpuni thinking
          // blokovi bez potpisa ne smeju nazad u API). Tokeni nisu poznati.
          if (partialText.trim()) {
            const { data: saved } = await supabase
              .from("ai_messages")
              .insert({
                conversation_id: conversationId,
                role: "assistant",
                content: [{ type: "text", text: `${partialText}\n\n_(prekinuto)_` }],
                model: model.id,
              })
              .select("id")
              .single();
            messageId = saved?.id ?? null;
            answer = partialText;
          }
        } else {
          Sentry.captureException(err, { tags: { area: "ai-chat" }, extra: { model: model.id } });
          send({ type: "error", message: errorMessage(err) });
        }
      }

      // Razgovor ide na vrh liste + pamti poslednji model.
      await supabase
        .from("ai_conversations")
        .update({ model: model.id, updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      if (messageId) send({ type: "done", messageId, model: model.id });

      if (needsTitle && answer && !abort.signal.aborted) {
        const title = await generateTitle(client, questionText, answer);
        if (title) {
          await supabase.from("ai_conversations").update({ title }).eq("id", conversationId);
          send({ type: "title", title });
        }
      }

      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
