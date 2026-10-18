import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";

import { getAiSession } from "@/lib/ai/access";
import { getAnthropic } from "@/lib/ai/client";
import {
  AI_TITLE_MODEL,
  contextTokens,
  costMicroUsd,
  getAiModel,
  usd,
  type AiModel,
} from "@/lib/ai/models";
import { getAiBudget } from "@/lib/ai/usage";
import { SYSTEM_PROMPT, userContextBlock } from "@/lib/ai/system-prompt";
import { createAiTools } from "@/lib/ai/tools";
import { todayBelgrade } from "@/lib/date-belgrade";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mustOne } from "@/lib/supabase/paginate";
import { chatRequestSchema } from "@/lib/validation/ai";
import {
  AI_DEFAULT_TITLE,
  getAiConversation,
  isTypedUserMessage,
  listAiMessages,
  sourcesOf,
  usesWebSearch,
  type AiSource,
} from "@/db/ai";

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
 *   {type:"tool", name, label, input}  — asistent čita podatke (A3)
 *   {type:"done", messageId, model}    — odgovor upisan
 *   {type:"sources", sources}          — izvori sa weba (A4)
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
/** Gornja granica krugova „odgovor → alat → odgovor" po pitanju (trošak). */
const MAX_ITERATIONS = 8;
/** Najviše web pretraga po jednom odgovoru (svaka se plaća posebno). */
const WEB_MAX_USES = 5;

type Event =
  | { type: "meta"; conversationId: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; label: string; input: Record<string, unknown> }
  | {
      type: "done";
      messageId: string | null;
      model: string;
      /** Veličina konteksta poslednjeg poziva (za „razgovor je predugačak"). */
      contextTokens: number;
      /** Cena ovog odgovora (mikro-USD) — UI dopisuje na mesečnu potrošnju. */
      costMicro: number;
    }
  | { type: "title"; title: string }
  | { type: "sources"; sources: AiSource[] }
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

  // Mesečni limit (A5) — proverava se PRE svakog poziva, za ceo nalog.
  try {
    const budget = await getAiBudget(session.userId);
    if (budget.blocked && budget.limitMicro != null) {
      return jsonError(
        `Mesečni limit AI asistenta je potrošen (${usd(budget.totalMicro)} od ${usd(budget.limitMicro)}). Limit se resetuje 1. u mesecu.`,
        429,
      );
    }
  } catch (err) {
    // Neuspelo merenje ne sme da ugasi asistenta — spending limit na
    // Anthropic nalogu i dalje važi kao poslednja brana.
    Sentry.captureException(err, { tags: { area: "ai-budget" } });
  }

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
    // Ponovi: sve posle poslednje poruke koju je korisnik napisao (odgovor +
    // eventualni tool_use/tool_result redovi) se briše, pa se odgovara ponovo.
    const lastTyped = history.findLastIndex((m) => isTypedUserMessage(m));
    if (lastTyped < 0) return jsonError("Nema pitanja na koje bi se odgovorilo ponovo.", 400);
    const staleIds = history.slice(lastTyped + 1).map((m) => m.id);
    if (staleIds.length) {
      // Vlasništvo je dokazano gore (getAiConversation ide kroz RLS).
      const { error } = await createAdminClient()
        .from("ai_messages")
        .delete()
        .in("id", staleIds)
        .eq("conversation_id", conversationId);
      if (error) {
        Sentry.captureException(error, { tags: { area: "ai-chat" } });
        return jsonError("Prethodni odgovor nije obrisan.", 500);
      }
    }
    history = history.slice(0, lastTyped + 1);
    const first = (history[lastTyped].content as { type?: string; text?: string }[])[0];
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
      .select(
        "id, role, content, model, created_at, input_tokens, cache_read_tokens, cache_write_tokens",
      )
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
  const startLen = messages.length;
  const webEnabled = req.web || usesWebSearch(history);
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

      const dataTools = createAiTools(supabase, (call) =>
        send({ type: "tool", name: call.name, label: call.label, input: call.input }),
      );
      // Web pretraga (Anthropic server alat) — samo na prekidač. Kad ju je
      // razgovor jednom koristio, ostaje uključena: istorija tada nosi
      // web_search blokove, a skup alata ne menjamo ispod već postojeće istorije.
      const tools = webEnabled
        ? [
            ...dataTools,
            {
              type: "web_search_20260209" as const,
              name: "web_search" as const,
              max_uses: WEB_MAX_USES,
              user_location: {
                type: "approximate" as const,
                country: "RS",
                city: "Belgrade",
                timezone: "Europe/Belgrade",
              },
            },
          ]
        : dataTools;
      const runner = client.beta.messages.toolRunner(
        {
          model: model.id,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: model.effort },
          messages,
          tools,
          max_iterations: MAX_ITERATIONS,
          stream: true,
          ...fallbackParams(model),
        },
        { signal: abort.signal },
      );

      let answer = ""; // sav tekst odgovora (za auto-naslov)
      let iterationText = ""; // tekst tekućeg poziva (za čuvanje pri Stop-u)
      const finals: Anthropic.Beta.BetaMessage[] = [];
      let failed = false;

      try {
        for await (const messageStream of runner) {
          iterationText = "";
          for await (const event of messageStream) {
            if (event.type !== "content_block_delta") continue;
            if (event.delta.type === "text_delta") {
              // Odvoji tekst posle alata od teksta pre njega.
              const delta = !iterationText && answer ? `\n\n${event.delta.text}` : event.delta.text;
              iterationText += delta;
              answer += delta;
              send({ type: "text", delta });
            } else if (event.delta.type === "thinking_delta") {
              send({ type: "thinking", delta: event.delta.thinking });
            }
          }
          const final = await messageStream.finalMessage();
          finals.push(final);
          for (const block of final.content) {
            if (block.type === "server_tool_use" && block.name === "web_search") {
              const input = (block.input ?? {}) as Record<string, unknown>;
              send({ type: "tool", name: "web_search", label: "Web pretraga", input });
            }
          }
          const sources = sourcesOf(final.content);
          if (sources.length) send({ type: "sources", sources });
          if (final.stop_reason === "refusal") {
            send({ type: "text", delta: "\n\n_Model je odbio da odgovori na ovo pitanje._" });
            break;
          }
          if (final.stop_reason === "max_tokens") {
            send({ type: "text", delta: "\n\n_Odgovor je prekinut jer je predugačak._" });
            break;
          }
        }
      } catch (err) {
        if (!(abort.signal.aborted || err instanceof Anthropic.APIUserAbortError)) {
          failed = true;
          Sentry.captureException(err, { tags: { area: "ai-chat" }, extra: { model: model.id } });
          send({ type: "error", message: errorMessage(err) });
        }
      }

      // ── Upis: sve nove poruke ovog odgovora, redom ────────────────────────
      // runner.params.messages = istorija + (asistent → rezultati alata)* →
      // asistent. Pri grešci se ne čuva ništa (Ponovi kreće od pitanja).
      let messageId: string | null = null;
      if (!failed) {
        const added = runner.params.messages.slice(startLen);
        const aborted = abort.signal.aborted;
        // `break` (odbijanje / predugačak odgovor) izlazi iz runner-a pre nego
        // što on sam doda poslednji odgovor u istoriju — dodaj ga ovde.
        const assistantCount = added.filter((m) => m.role === "assistant").length;
        const lastFinal = finals.at(-1);
        if (!aborted && lastFinal && finals.length > assistantCount) {
          added.push({
            role: "assistant",
            content: lastFinal.content as Anthropic.Beta.BetaContentBlockParam[],
          });
        }
        if (aborted) {
          // Poslednji asistent sa tool_use bez rezultata ne sme u istoriju.
          const last = added.at(-1);
          const lastContent = Array.isArray(last?.content) ? last.content : [];
          if (last?.role === "assistant" && lastContent.some((b) => b.type === "tool_use")) {
            added.pop();
            finals.splice(added.filter((m) => m.role === "assistant").length);
          }
          // Prekinut tekst tekućeg poziva — samo tekst (nepotpuni thinking
          // blokovi ne smeju nazad u API). Tokeni za njega nisu poznati.
          const finishedText = added.at(-1)?.role === "assistant";
          if (iterationText.trim() && !finishedText) {
            added.push({
              role: "assistant",
              content: [{ type: "text", text: `${iterationText.trim()}\n\n_(prekinuto)_` }],
            });
          }
        }

        let assistantIndex = 0;
        const base = Date.now();
        const rows = added.map((m, i) => {
          const final = m.role === "assistant" ? finals[assistantIndex++] : undefined;
          return {
            conversation_id: conversationId,
            role: m.role,
            content: m.content,
            model: m.role === "assistant" ? (final?.model ?? model.id) : null,
            input_tokens: final?.usage.input_tokens ?? 0,
            output_tokens: final?.usage.output_tokens ?? 0,
            cache_read_tokens: final?.usage.cache_read_input_tokens ?? 0,
            cache_write_tokens: final?.usage.cache_creation_input_tokens ?? 0,
            cost_micro_usd: final ? costMicroUsd(final.model ?? model.id, final.usage) : 0,
            // Isti `now()` za ceo batch bi pomešao redosled — eksplicitno +1 ms.
            created_at: new Date(base + i).toISOString(),
          };
        });

        if (rows.length) {
          const { data: saved, error } = await supabase
            .from("ai_messages")
            .insert(rows)
            .select("id, created_at");
          if (error) {
            Sentry.captureException(error, { tags: { area: "ai-chat" } });
            send({ type: "error", message: "Odgovor nije sačuvan u istoriju." });
          } else {
            const sorted = [...(saved ?? [])].sort((a, b) =>
              a.created_at.localeCompare(b.created_at),
            );
            messageId = sorted.at(-1)?.id ?? null;
          }
        }
      }

      // Razgovor ide na vrh liste + pamti poslednji model.
      await supabase
        .from("ai_conversations")
        .update({ model: model.id, updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      if (messageId) {
        const lastFinal = finals.at(-1);
        send({
          type: "done",
          messageId,
          model: model.id,
          contextTokens: lastFinal ? contextTokens(lastFinal.usage) : 0,
          costMicro: finals.reduce((sum, f) => sum + costMicroUsd(f.model ?? model.id, f.usage), 0),
        });
      }

      if (needsTitle && answer.trim() && !abort.signal.aborted) {
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
