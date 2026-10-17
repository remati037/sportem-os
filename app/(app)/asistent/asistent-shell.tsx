"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, PanelLeft } from "lucide-react";

import type { AiDisplayMessage } from "@/db/ai";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { Chat } from "./chat";
import { ConversationList, type ConversationItem } from "./conversation-list";

/*
 * Okvir asistenta: lista razgovora (desktop levo, telefon u Sheet-u) + chat.
 * Lista je lokalno stanje — nov razgovor, auto-naslov i pomeranje na vrh se
 * vide odmah. „Nov razgovor" ne navigira (URL se menja kroz replaceState),
 * nego remontira chat novim ključem.
 */
export function AsistentShell({
  conversations,
  conversation,
  initialMessages,
  configured,
}: {
  conversations: ConversationItem[];
  conversation: { id: string; title: string; model: string } | null;
  initialMessages: AiDisplayMessage[];
  configured: boolean;
}) {
  const [items, setItems] = useState(conversations);
  const [activeId, setActiveId] = useState<string | null>(conversation?.id ?? null);
  const [chatKey, setChatKey] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Strana se ne skroluje — skroluje se samo lista poruka (polje za unos
  // stoji na dnu ekrana). Bez ovoga mobilni pregledač ume da pomeri celu
  // stranu (adresna traka, tastatura) pa dno „pobegne".
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  const title = activeId
    ? (items.find((c) => c.id === activeId)?.title ?? conversation?.title ?? "Razgovor")
    : "Nov razgovor";

  function startNew() {
    setActiveId(null);
    setFresh(true);
    setChatKey((k) => k + 1);
    setSheetOpen(false);
    window.history.replaceState(null, "", "/asistent");
  }

  function toTop(id: string, patch?: Partial<ConversationItem>) {
    setItems((list) => {
      const existing = list.find((c) => c.id === id);
      const item: ConversationItem = {
        id,
        title: existing?.title ?? "Nov razgovor",
        updated_at: new Date().toISOString(),
        ...patch,
      };
      return [item, ...list.filter((c) => c.id !== id)];
    });
  }

  const list = (
    <ConversationList
      items={items}
      activeId={activeId}
      onNew={startNew}
      onNavigate={() => setSheetOpen(false)}
      onRenamed={(id, t) => setItems((l) => l.map((c) => (c.id === id ? { ...c, title: t } : c)))}
      onDeleted={(id) => {
        setItems((l) => l.filter((c) => c.id !== id));
        if (id === activeId) startNew();
      }}
    />
  );

  return (
    <main className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] min-h-0 flex-1 overflow-hidden md:h-dvh">
      <aside className="border-border bg-surface hidden w-64 shrink-0 flex-col border-r p-3 md:flex">
        {list}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-paper flex items-center gap-2 border-b px-4 py-2.5 md:px-6">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Razgovori"
              >
                <PanelLeft />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] gap-3 pt-12">
              <SheetTitle className="sr-only">Razgovori</SheetTitle>
              {list}
            </SheetContent>
          </Sheet>
          <div className="min-w-0">
            <div className="eyebrow">Asistent</div>
            <h1 className="text-ink truncate text-[0.9375rem] font-semibold">{title}</h1>
          </div>
        </header>

        {!configured ? (
          <div className="border-warning bg-warning-soft text-warning mx-4 mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm md:mx-6">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>AI asistent nije podešen — nedostaje ANTHROPIC_API_KEY na serveru.</p>
          </div>
        ) : null}

        <Chat
          key={chatKey}
          conversationId={fresh ? null : (conversation?.id ?? null)}
          initialMessages={fresh ? [] : initialMessages}
          initialModel={fresh ? null : (conversation?.model ?? null)}
          onConversationCreated={(id) => {
            setActiveId(id);
            toTop(id, { title: "Nov razgovor" });
          }}
          onTitle={(id, t) => toTop(id, { title: t })}
          onActivity={(id) => toTop(id)}
        />
      </section>
    </main>
  );
}
