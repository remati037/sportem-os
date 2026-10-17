import { requireRole } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { listAiConversations } from "@/db/ai";

import { AsistentShell } from "./asistent-shell";

export const dynamic = "force-dynamic";

/*
 * AI Asistent — nov razgovor (docs/Sportem-Plan-AI-Asistent.md).
 *
 * Pristup: Admin i Menadžer (asistent vidi zaradu; Logistika nema ni RLS
 * politiku na ai_* tabelama). Istorija je lična — lista pokazuje samo
 * razgovore ulogovanog korisnika (RLS).
 */
export default async function AsistentPage() {
  await requireRole("admin", "manager");
  const conversations = await listAiConversations();

  return (
    <AsistentShell
      key="new"
      conversations={conversations}
      conversation={null}
      initialMessages={[]}
      configured={aiConfigured()}
    />
  );
}
