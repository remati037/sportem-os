import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { getAiBudget } from "@/lib/ai/usage";
import { toBudgetView } from "../budget";
import { isUuid } from "@/lib/validation/uuid";
import {
  getAiConversation,
  listAiConversations,
  listAiMessages,
  lastContextTokens,
  toDisplayMessages,
} from "@/db/ai";

import { AsistentShell } from "../asistent-shell";

export const dynamic = "force-dynamic";

/*
 * AI Asistent — postojeći razgovor. RLS pušta samo vlasnika, pa tuđi id
 * (ili obrisan razgovor) daje 404, ne tuđe poruke.
 */
export default async function AsistentConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("admin", "manager");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [conversation, conversations, budget] = await Promise.all([
    getAiConversation(id),
    listAiConversations(),
    getAiBudget(session.userId),
  ]);
  if (!conversation) notFound();

  const rows = await listAiMessages(id);
  const messages = toDisplayMessages(rows);

  return (
    <AsistentShell
      key={conversation.id}
      conversations={conversations}
      conversation={conversation}
      initialMessages={messages}
      configured={aiConfigured()}
      budget={toBudgetView(budget, session.profile.role)}
      initialContextTokens={lastContextTokens(rows)}
    />
  );
}
