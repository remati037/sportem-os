"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Check, Copy, RotateCcw, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

import { AI_MODELS, getAiModel, isAiModelId, type AiModelId } from "@/lib/ai/models";
import { AI_MESSAGE_MAX } from "@/lib/validation/ai";
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
  | { type: "done"; messageId: string | null; model: string }
  | { type: "title"; title: string }
  | { type: "error"; message: string };

const MODEL_STORAGE_KEY = "sportem.asistent.model";

const SUGGESTIONS = [
  "Kako da povećam prosečnu vrednost korpe na sajtu?",
  "Napiši tekst za Meta reklamu za fudbalske kopačke.",
  "Daj mi ideje za vikend akciju pred početak sezone.",
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
  onConversationCreated,
  onTitle,
  onActivity,
}: {
  conversationId: string | null;
  initialMessages: AiDisplayMessage[];
  initialModel: string | null;
  onConversationCreated: (id: string) => void;
  onTitle: (id: string, title: string) => void;
  onActivity: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({ ...m, status: "done" as const })),
  );
  const [input, setInput] = useState("");
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

  // Auto-skrol dok korisnik sam ne odskroluje gore.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
          case "thinking":
            patchAssistant(currentId, (m) => ({ thinking: m.thinking + event.delta }));
            break;
          case "done": {
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
    if (!message || streaming) return;
    if (message.length > AI_MESSAGE_MAX) {
      toast.error(`Poruka je predugačka (najviše ${AI_MESSAGE_MAX} znakova).`);
      return;
    }
    const assistantId = localId();
    setMessages((list) => [
      ...list,
      { id: localId(), role: "user", text: message, thinking: "", model: null, status: "done" },
      { id: assistantId, role: "assistant", text: "", thinking: "", model, status: "streaming" },
    ]);
    setInput("");
    void run(
      { mode: "send", conversationId: conversationRef.current, model, message },
      assistantId,
    );
  }

  function regenerate() {
    if (streaming || !conversationRef.current) return;
    const assistantId = localId();
    setMessages((list) => {
      const trimmed = list.at(-1)?.role === "assistant" ? list.slice(0, -1) : list;
      return [
        ...trimmed,
        { id: assistantId, role: "assistant", text: "", thinking: "", model, status: "streaming" },
      ];
    });
    void run({ mode: "regenerate", conversationId: conversationRef.current, model }, assistantId);
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
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="bg-green-soft text-green-deep rounded-full p-3">
                <Sparkles className="size-6" />
              </div>
              <div className="space-y-1">
                <p className="text-ink text-lg font-semibold">Kako mogu da pomognem?</p>
                <p className="text-ink-soft max-w-md text-sm">
                  Predlozi, ideje, tekstovi i analize. Pristup podacima aplikacije (prodaja,
                  artikli, kupci) stiže u sledećoj verziji.
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
                    ) : m.status === "streaming" && !m.thinking ? (
                      <p className="text-ink-faint animate-pulse text-sm">Piše…</p>
                    ) : null}

                    {m.status === "error" ? (
                      <div className="border-danger bg-danger-soft text-danger rounded-md border px-3 py-2 text-sm">
                        {m.error}
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
                        {m.model ? <span className="ml-1">{getAiModel(m.model).label}</span> : null}
                      </div>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="border-border bg-paper border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="mx-auto w-full max-w-3xl px-4 py-3 md:px-6"
        >
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
              maxLength={AI_MESSAGE_MAX}
              placeholder="Pitaj asistenta…"
              aria-label="Poruka"
              className="max-h-[220px] min-h-11 resize-none border-0 bg-transparent focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <Select value={model} onValueChange={changeModel}>
                <SelectTrigger
                  className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-sm"
                  aria-label="Model"
                >
                  <SelectValue />
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
                <Button type="submit" size="icon-sm" aria-label="Pošalji" disabled={!input.trim()}>
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
