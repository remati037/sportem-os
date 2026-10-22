"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Loader2, Sparkles, Square } from "lucide-react";

import { num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/charts/core";
import { AskAssistantButton } from "@/app/(app)/asistent/ask-button";
import { Markdown } from "@/app/(app)/asistent/markdown";

/*
 * Računica P5 — „Analiziraj" (AI sažetak na klik, nikad automatski — trošak).
 *
 * Zove POSTOJEĆU rutu /api/asistent/chat (nov razgovor, Sonnet, bez weba) i
 * prikazuje odgovor dok stiže. Razgovor se tako sam upisuje u Asistent: cena
 * ide u `ai_messages.cost_micro_usd`, važi mesečni limit (A5), a korisnik može
 * da nastavi pitanja („Nastavi u Asistentu"). Nema druge AI rute ni tabele.
 */

const ANALYSIS_MODEL = "claude-sonnet-5-5";

export type AiState = { ready: true } | { ready: false; reason: string };

function analysisPrompt(from: string, to: string, goal: number): string {
  return [
    `Analiziraj isplativost artikala u Računici za period ${from} – ${to}, ciljna marža ${goal} %.`,
    "Pozovi alat isplativost_artikala (ako treba, više puta: sortirano po zaradi, pa samo ispod cilja, kandidati, pada i nestaje).",
    "Napiši 5–6 kratkih zaključaka, svaki sa konkretnim artiklima (naziv, SKU kad postoji) i ciframa iz alata:",
    "1) šta nosi zaradu (A klasa / zvezde), 2) šta se dobro prodaje a marža je ispod cilja — kandidati za poskupljenje i za koliko (MP za ciljnu maržu),",
    "3) kandidati za izbacivanje ili akciju, 4) mrtva roba i koliko je robe po VP, 5) šta raste a šta pada i šta uskoro nestaje,",
    "6) procena zarade do kraja meseca.",
    "Na kraju jedna rečenica: koje 2–3 stvari bih uradio prvo. Bez uvoda, Markdown sa podnaslovima.",
  ].join("\n");
}

export function RacunicaAi({
  from,
  to,
  periodLabel,
  goal,
  ai,
}: {
  from: string;
  to: string;
  periodLabel: string;
  goal: number;
  ai: AiState;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    const abort = new AbortController();
    abortRef.current = abort;
    setText("");
    setError(null);
    setReading(null);
    setConversationId(null);
    setStatus("running");
    try {
      const res = await fetch("/api/asistent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "send",
          conversationId: null,
          model: ANALYSIS_MODEL,
          web: false,
          message: analysisPrompt(from, to, goal),
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Analiza nije uspela.");
      }
      // Istekla sesija: proxy preusmeri na /prijava i stigne HTML umesto toka.
      if (!res.headers.get("content-type")?.includes("ndjson")) {
        throw new Error("Sesija je istekla — osveži stranu i prijavi se ponovo.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed: string | null = null;
      let received = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; [k: string]: unknown };
          if (ev.type === "meta") setConversationId(ev.conversationId as string);
          else if (ev.type === "text") {
            received = true;
            setReading(null);
            setText((t) => t + (ev.delta as string));
          } else if (ev.type === "tool") setReading((ev.label as string) ?? "podaci");
          else if (ev.type === "error") failed = ev.message as string;
        }
      }
      if (failed) throw new Error(failed);
      if (!received && !abort.signal.aborted) throw new Error("Asistent nije vratio odgovor.");
      setStatus("done");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus("done");
        return;
      }
      setError(err instanceof Error ? err.message : "Analiza nije uspela.");
      setStatus("error");
    } finally {
      setReading(null);
      abortRef.current = null;
    }
  }

  const askQuestion = `U Računici, za period ${periodLabel} (${from} – ${to}) i ciljnu maržu ${goal} %: `;

  return (
    <ChartCard
      title="AI analiza"
      subtitle={
        ai.ready
          ? "Na klik: 5–6 zaključaka iz Računice. Čuva se kao razgovor u Asistentu i ulazi u mesečni AI limit."
          : ai.reason
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <AskAssistantButton question={askQuestion} />
          {status === "running" ? (
            <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
              <Square /> Zaustavi
            </Button>
          ) : (
            <Button variant="subtle" size="sm" onClick={run} disabled={!ai.ready}>
              <Sparkles /> {status === "idle" ? "Analiziraj" : "Analiziraj ponovo"}
            </Button>
          )}
        </div>
      }
      className="mb-6"
    >
      {status === "idle" ? (
        <p className="text-ink-faint text-sm">
          Asistent čita iste cifre kao ova strana (period, cilj <span className="num">{num(goal)}</span>{" "}
          %) i predlaže šta poskupeti, šta izbaciti i na šta paziti.
        </p>
      ) : (
        <div className="space-y-3">
          {status === "running" && !text ? (
            <p className="text-ink-soft inline-flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {reading ? `Čita: ${reading}…` : "Asistent razmišlja…"}
            </p>
          ) : null}
          {text ? (
            <div className="text-sm">
              <Markdown text={text} />
            </div>
          ) : null}
          {status === "running" && text && reading ? (
            <p className="text-ink-faint inline-flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> Čita: {reading}…
            </p>
          ) : null}
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          {conversationId && status !== "running" ? (
            <Link
              href={`/asistent/${conversationId}`}
              className="text-green inline-flex items-center gap-1 text-sm font-medium"
            >
              Nastavi u Asistentu <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </div>
      )}
    </ChartCard>
  );
}
