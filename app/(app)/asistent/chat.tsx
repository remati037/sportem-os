"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Database,
  Globe,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  AI_LONG_CONTEXT_TOKENS,
  AI_MODELS,
  getAiModel,
  isAiModelId,
  type AiModelId,
} from "@/lib/ai/models";
import { AI_MESSAGE_MAX } from "@/lib/validation/ai";
import { describeToolCall } from "@/lib/ai/tool-labels";
import type { AiDisplayMessage } from "@/db/ai";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { Markdown } from "./markdown";

/*
 * Chat AI asistenta (Korak A2). Šalje na `/api/asistent/chat` i čita NDJSON
 * stream (v. komentar u ruti). Enter šalje, Shift+Enter je nov red; Stop
 * prekida stream (server sačuva ono što je stiglo).
 */

type Status = "done" | "streaming" | "error" | "stopped";
type ChatMessage = AiDisplayMessage & { status: Status; error?: string };

type StreamEvent =
  | { type: "meta"; conversationId: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | {
      type: "done";
      messageId: string | null;
      model: string;
      contextTokens: number;
      costMicro: number;
    }
  | { type: "title"; title: string }
  | { type: "sources"; sources: { url: string; title: string | null }[] }
  | { type: "tool"; name: string; label: string; input: Record<string, unknown> }
  | { type: "error"; message: string };

const MODEL_STORAGE_KEY = "sportem.asistent.model";

const SUGGESTIONS = [
  "Koji su najprodavaniji artikli ovog meseca?",
  "Uporedi zaradu ovog i prošlog meseca.",
  "Koji artikli su na niskom stanju, a dobro se prodaju?",
  "Ko su nam najbolji kupci ove godine?",
  "Daj mi ideje za vikend akciju na osnovu prodaje.",
];

function readStoredModel(): AiModelId | null {
  try {
    const saved = window.localStorage.getItem(MODEL_STORAGE_KEY);
    return isAiModelId(saved) ? saved : null;
  } catch {
    return null; // privatni prozor / blokiran storage — podrazumevani model
  }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

export function Chat({
  conversationId: initialConversationId,
  initialMessages,
  initialModel,
  initialInput = "",
  onConversationCreated,
  onTitle,
  onActivity,
  onSpent,
  onNew,
  blocked = false,
  initialContextTokens = 0,
}: {
  conversationId: string | null;
  initialMessages: AiDisplayMessage[];
  initialModel: string | null;
  /** Pred-popunjeno pitanje (npr. „Pitaj asistenta" sa porudžbine — `?pitanje=`). */
  initialInput?: string;
  onConversationCreated: (id: string) => void;
  onTitle: (id: string, title: string) => void;
  onActivity: (id: string) => void;
  /** Cena upravo završenog odgovora (mikro-USD) — za potrošnju u zaglavlju. */
  onSpent: (micro: number) => void;
  onNew: () => void;
  /** Mesečni limit je potrošen — slanje je onemogućeno (server ionako odbija). */
  blocked?: boolean;
  initialContextTokens?: number;
}) {
  const [contextSize, setContextSize] = useState(initialContextTokens);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({ ...m, status: "done" as const })),
  );
  const [input, setInput] = useState(initialInput);
  // Web pretraga: isključena podrazumevano; kad ju je razgovor jednom koristio,
  // ostaje uključena i zaključana (server je ionako drži — v. ruta).
  const webLocked =
    initialMessages.some((m) => m.tools.some((t) => t.name === "web_search")) ||
    messages.some((m) => m.tools.some((t) => t.name === "web_search"));
  const [webOn, setWebOn] = useState(false);
  const web = webLocked || webOn;
  // Nov razgovor uzima poslednji izabran model sa ovog uređaja (localStorage);
  // postojeći — model kojim je poslednji put vođen. Na serveru nema storage-a.
  const storedModel = useSyncExternalStore(subscribeStorage, readStoredModel, () => null);
  const [picked, setPicked] = useState<AiModelId | null>(null);
  const model: AiModelId =
    picked ?? (initialConversationId ? null : storedModel) ?? getAiModel(initialModel).id;
  const [streaming, setStreaming] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const conversationRef = useRef<string | null>(initialConversationId);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Prekini stream kad se razgovor napusti.
  useEffect(() => () => abortRef.current?.abort(), []);

  /*
   * Skrol kao u Claude-u: poslednja poruka je uvek uz polje za unos, a
   * korisnik skroluje samo NAGORE kroz istoriju. Dok je „zalepljen" za dno,
   * svaki rast sadržaja (stream, markdown, otvoreno „Razmišljanje") ga drži
   * na dnu; kad odskroluje gore, ništa ga ne vuče nazad dok ne klikne ↓ ili
   * pošalje poruku. Prvi prikaz kreće odmah sa dna (layout effect, bez skoka).
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Polje raste sa tekstom (do ~8 redova).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  function changeModel(value: string) {
    if (!isAiModelId(value)) return;
    setPicked(value);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, value);
    } catch {
      /* nije bitno */
    }
  }

  function patchAssistant(id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));
  }

  async function run(body: Record<string, unknown>, assistantId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    stickToBottom.current = true;
    setAtBottom(true);

    try {
      const res = await fetch("/api/asistent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        patchAssistant(assistantId, () => ({
          status: "error",
          error: data?.error ?? "AI odgovor nije uspeo.",
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentId = assistantId;

      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case "meta":
            if (!conversationRef.current) {
              conversationRef.current = event.conversationId;
              // Bez navigacije (stream bi se prekinuo) — samo URL.
              window.history.replaceState(null, "", `/asistent/${event.conversationId}`);
              onConversationCreated(event.conversationId);
            } else {
              onActivity(event.conversationId);
            }
            break;
          case "text":
            patchAssistant(currentId, (m) => ({ text: m.text + event.delta }));
            break;
          case "tool":
            patchAssistant(currentId, (m) => ({
              tools: [...m.tools, { name: event.name, input: event.input }],
            }));
            break;
          case "sources":
            patchAssistant(currentId, (m) => ({
              sources: [
                ...m.sources,
                ...event.sources.filter((src) => !m.sources.some((x) => x.url === src.url)),
              ],
            }));
            break;
          case "thinking":
            patchAssistant(currentId, (m) => ({ thinking: m.thinking + event.delta }));
            break;
          case "done": {
            setContextSize(event.contextTokens);
            onSpent(event.costMicro);
            const savedId = event.messageId ?? currentId;
            patchAssistant(currentId, () => ({
              id: savedId,
              status: "done",
              model: event.model,
            }));
            currentId = savedId;
            break;
          }
          case "title":
            if (conversationRef.current) onTitle(conversationRef.current, event.title);
            break;
          case "error":
            patchAssistant(currentId, () => ({ status: "error", error: event.message }));
            break;
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handle(JSON.parse(line) as StreamEvent);
          } catch {
            /* nepotpuna linija — preskoči */
          }
        }
      }
      // Stream se zatvorio bez „done" i bez greške → tretiraj kao gotovo.
      setMessages((list) =>
        list.map((m) => (m.status === "streaming" ? { ...m, status: "done" } : m)),
      );
    } catch {
      if (controller.signal.aborted) {
        patchAssistant(assistantId, () => ({ status: "stopped" }));
      } else {
        patchAssistant(assistantId, () => ({
          status: "error",
          error: "Veza je prekinuta — pokušaj ponovo.",
        }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || streaming || blocked) return;
    if (message.length > AI_MESSAGE_MAX) {
      toast.error(`Poruka je predugačka (najviše ${AI_MESSAGE_MAX} znakova).`);
      return;
    }
    const assistantId = localId();
    setMessages((list) => [
      ...list,
      {
        id: localId(),
        role: "user",
        text: message,
        thinking: "",
        model: null,
        tools: [],
        sources: [],
        status: "done",
      },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        thinking: "",
        model,
        tools: [],
        sources: [],
        status: "streaming",
      },
    ]);
    setInput("");
    void run(
      { mode: "send", conversationId: conversationRef.current, model, web, message },
      assistantId,
    );
  }

  function regenerate() {
    if (streaming || blocked || !conversationRef.current) return;
    const assistantId = localId();
    setMessages((list) => {
      const trimmed = list.at(-1)?.role === "assistant" ? list.slice(0, -1) : list;
      return [
        ...trimmed,
        {
          id: assistantId,
          role: "assistant",
          text: "",
          thinking: "",
          model,
          tools: [],
          sources: [],
          status: "streaming",
        },
      ];
    });
    void run(
      { mode: "regenerate", conversationId: conversationRef.current, model, web },
      assistantId,
    );
  }

  async function copy(m: ChatMessage) {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch {
      toast.error("Kopiranje nije uspelo.");
    }
  }

  const last = messages.at(-1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stickToBottom.current = near;
            setAtBottom((prev) => (prev === near ? prev : near));
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        >
          <div
            ref={contentRef}
            className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-4 py-6 md:px-6"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="bg-green-soft text-green-deep rounded-full p-3">
                  <Sparkles className="size-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-ink text-lg font-semibold">Kako mogu da pomognem?</p>
                  <p className="text-ink-soft max-w-md text-sm">
                    Pitaj o prodaji, artiklima, kupcima, zalihama i finansijama — ili traži ideje i
                    tekstove.
                  </p>
                </div>
                <div className="flex w-full max-w-lg flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="border-border bg-surface text-ink hover:bg-surface-2 rounded-lg border px-4 py-2.5 text-left text-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="space-y-6">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <li key={m.id} className="flex justify-end">
                      <div className="bg-green-soft text-ink max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[0.9375rem] break-words whitespace-pre-wrap">
                        {m.text}
                      </div>
                    </li>
                  ) : (
                    <li key={m.id} className="space-y-2">
                      {m.tools.length ? (
                        <ToolsUsed tools={m.tools} live={m.status === "streaming" && !m.text} />
                      ) : null}

                      {m.thinking ? (
                        <details className="text-ink-soft text-sm">
                          <summary className="cursor-pointer select-none">
                            {m.status === "streaming" && !m.text ? "Razmišlja…" : "Razmišljanje"}
                          </summary>
                          <div className="border-border mt-2 border-l-2 pl-3 whitespace-pre-wrap">
                            {m.thinking}
                          </div>
                        </details>
                      ) : null}

                      {m.text ? (
                        <Markdown text={m.text} />
                      ) : m.status === "streaming" && !m.thinking && !m.tools.length ? (
                        <p className="text-ink-faint animate-pulse text-sm">Piše…</p>
                      ) : null}

                      {m.status === "error" ? (
                        <div className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2 text-sm">
                          {m.error}
                        </div>
                      ) : null}
                      {m.sources.length ? (
                        <div className="text-xs">
                          <div className="text-ink-faint mb-1 font-medium">Izvori</div>
                          <ol className="space-y-0.5">
                            {m.sources.slice(0, 10).map((src, i) => (
                              <li key={src.url} className="truncate">
                                <span className="text-ink-faint mr-1">{i + 1}.</span>
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-deep underline underline-offset-2"
                                >
                                  {src.title || new URL(src.url).hostname}
                                </a>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}

                      {m.status === "stopped" ? (
                        <p className="text-ink-faint text-xs">Prekinuto.</p>
                      ) : null}

                      {m.status !== "streaming" ? (
                        <div className="text-ink-faint flex items-center gap-1 text-xs">
                          {m.text ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="border-0 bg-transparent"
                              aria-label="Kopiraj odgovor"
                              onClick={() => copy(m)}
                            >
                              {copied === m.id ? <Check /> : <Copy />}
                            </Button>
                          ) : null}
                          {m === last ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="border-0 bg-transparent"
                              aria-label="Ponovi odgovor"
                              onClick={regenerate}
                              disabled={streaming}
                            >
                              <RotateCcw />
                            </Button>
                          ) : null}
                          {m.model ? (
                            <span className="ml-1">{getAiModel(m.model).label}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </div>

        {!atBottom ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Na poslednju poruku"
            onClick={() => {
              stickToBottom.current = true;
              setAtBottom(true);
              scrollToBottom();
            }}
            className="shadow-lift absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full"
          >
            <ArrowDown />
          </Button>
        ) : null}
      </div>

      <div className="border-border bg-paper border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="mx-auto w-full max-w-3xl px-4 py-3 md:px-6"
        >
          {contextSize > AI_LONG_CONTEXT_TOKENS ? (
            <div className="text-ink-soft mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                Razgovor je dugačak — svaka nova poruka šalje celu istoriju pa je sporija i skuplja.
              </span>
              <button
                type="button"
                onClick={onNew}
                className="text-green-deep shrink-0 font-medium underline underline-offset-2"
              >
                Počni nov razgovor
              </button>
            </div>
          ) : null}
          <div className="border-input bg-surface focus-within:border-green focus-within:ring-green/20 rounded-xl border focus-within:ring-[3px]">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              autoFocus={!!initialInput}
              maxLength={AI_MESSAGE_MAX}
              placeholder="Pitaj asistenta…"
              aria-label="Poruka"
              className="max-h-[220px] min-h-11 resize-none border-0 bg-transparent focus-visible:ring-0"
            />
            <div className="flex items-center gap-1 px-2 pb-2">
              <Select value={model} onValueChange={changeModel}>
                <SelectTrigger
                  className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-sm"
                  aria-label="Model"
                >
                  {/* Samo naziv — opis bi na telefonu gurnuo dugme „Pošalji" van ekrana. */}
                  <SelectValue>{getAiModel(model).label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-medium">{m.label}</span>
                      <span className="text-ink-faint ml-2 text-xs">{m.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={web}
                disabled={webLocked}
                title={
                  webLocked
                    ? "Ovaj razgovor već koristi web pretragu"
                    : "Dozvoli asistentu da pretraži web (cene konkurencije, trendovi, ideje)"
                }
                onClick={() => setWebOn((v) => !v)}
                className={cn(
                  "h-8 gap-1.5 border-0 px-2 text-sm",
                  web ? "bg-green-soft text-green-deep" : "text-ink-soft bg-transparent",
                  webLocked && "disabled:bg-green-soft disabled:text-green-deep",
                )}
              >
                <Globe /> Web
              </Button>

              <div className="flex-1" />

              {streaming ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="dark"
                  aria-label="Zaustavi"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Pošalji"
                  disabled={!input.trim() || blocked}
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
          <p className="text-ink-faint mt-1.5 hidden text-center text-xs md:block">
            Enter šalje · Shift+Enter nov red · AI ume da pogreši — proveri važne cifre.
          </p>
        </form>
      </div>
    </div>
  );
}

/** Kartica „Pogledao…" — koje podatke je asistent pročitao za odgovor. */
function ToolsUsed({
  tools,
  live,
}: {
  tools: { name: string; input: Record<string, unknown> }[];
  live: boolean;
}) {
  const unique = [...new Set(tools.map((t) => describeToolCall(t.name, t.input)))];
  return (
    <div className="border-border bg-surface text-ink-soft rounded-md border px-3 py-2 text-xs">
      <div className="text-ink-faint mb-1 flex items-center gap-1.5 font-medium">
        <Database className="size-3.5" />
        {live ? "Čita podatke…" : "Pogledao"}
      </div>
      <ul className="space-y-0.5">
        {unique.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </div>
  );
}
