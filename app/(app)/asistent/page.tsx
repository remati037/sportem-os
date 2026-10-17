import { AlertTriangle, MessageSquare, Sparkles } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { datumVreme } from "@/lib/format";
import { aiConfigured } from "@/lib/ai/client";
import { AI_MODELS, getAiModel } from "@/lib/ai/models";
import { listAiConversations } from "@/db/ai";
import { EmptyState } from "@/components/patterns/empty-state";

export const dynamic = "force-dynamic";

/*
 * AI Asistent — skelet (Korak A1, docs/Sportem-Plan-AI-Asistent.md).
 *
 * Pristup: Admin i Menadžer (asistent vidi zaradu; Logistika nema ni RLS
 * politiku na ai_* tabelama). Istorija je lična — lista ispod pokazuje samo
 * razgovore ulogovanog korisnika (RLS). Sam chat dolazi u A2.
 */
export default async function AsistentPage() {
  await requireRole("admin", "manager");

  const conversations = await listAiConversations();
  const configured = aiConfigured();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Analitika</div>
        <h1 className="text-ink text-xl font-bold">Asistent</h1>
        <p className="text-ink-soft text-sm">
          Pitaj o prodaji, artiklima, kupcima i finansijama, ili traži predloge i ideje.
        </p>
      </div>

      {!configured ? (
        <div className="border-warning bg-warning-soft text-warning mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>AI asistent nije podešen — nedostaje ANTHROPIC_API_KEY na serveru.</p>
        </div>
      ) : null}

      <div className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-3">
        <div className="eyebrow mb-2">Modeli</div>
        <ul className="space-y-1 text-sm">
          {AI_MODELS.map((m) => (
            <li key={m.id} className="flex flex-wrap gap-x-2">
              <span className="text-ink font-medium">{m.label}</span>
              <span className="text-ink-soft">— {m.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title="Još nema razgovora."
          description="Chat stiže u sledećem koraku."
        />
      ) : (
        <ul className="border-border bg-surface divide-border divide-y rounded-lg border">
          {conversations.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <MessageSquare className="text-ink-faint size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-ink truncate text-sm font-medium">{c.title}</p>
                <p className="text-ink-faint text-xs">
                  {getAiModel(c.model).label} · {datumVreme(c.updated_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
