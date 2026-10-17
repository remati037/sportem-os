import { requireRole } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { listAiConversations } from "@/db/ai";
import { AI_MESSAGE_MAX } from "@/lib/validation/ai";

import { AsistentShell } from "./asistent-shell";

export const dynamic = "force-dynamic";

/*
 * AI Asistent — nov razgovor (docs/Sportem-Plan-AI-Asistent.md).
 *
 * Pristup: Admin i Menadžer (asistent vidi zaradu; Logistika nema ni RLS
 * politiku na ai_* tabelama). Istorija je lična — lista pokazuje samo
 * razgovore ulogovanog korisnika (RLS).
 */
export default async function AsistentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");
  // „Pitaj asistenta" sa porudžbine/proizvoda — pitanje se samo pred-popuni.
  const sp = await searchParams;
  const question = typeof sp.pitanje === "string" ? sp.pitanje.slice(0, AI_MESSAGE_MAX) : "";
  const conversations = await listAiConversations();

  return (
    <AsistentShell
      key="new"
      conversations={conversations}
      conversation={null}
      initialMessages={[]}
      configured={aiConfigured()}
      initialInput={question}
    />
  );
}
