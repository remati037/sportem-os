import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { isUuid } from "@/lib/validation/uuid";
import { getAiConversation, listAiConversations, listAiMessages, toDisplayMessages } from "@/db/ai";

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
  await requireRole("admin", "manager");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [conversation, conversations] = await Promise.all([
    getAiConversation(id),
    listAiConversations(),
  ]);
  if (!conversation) notFound();

  const messages = toDisplayMessages(await listAiMessages(id));

  return (
    <AsistentShell
      key={conversation.id}
      conversations={conversations}
      conversation={conversation}
      initialMessages={messages}
      configured={aiConfigured()}
    />
  );
}
