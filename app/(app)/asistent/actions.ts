"use server";

import { revalidatePath } from "next/cache";

import { firstZodError, type ActionState } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { conversationIdSchema, renameConversationSchema } from "@/lib/validation/ai";

/*
 * Akcije nad razgovorima AI asistenta (Korak A2). RLS klijent: politika
 * `ai_conversations_own` dozvoljava izmenu/brisanje SAMO sopstvenog
 * razgovora, pa tuđi id prosto ne pogodi nijedan red. Poruke se brišu
 * kaskadno sa razgovorom.
 */

export async function renameConversation(id: string, title: string): Promise<ActionState> {
  await requireRole("admin", "manager");
  const parsed = renameConversationSchema.safeParse({ id, title });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { error: "Naslov nije sačuvan." };
  if (!data?.length) return { error: "Razgovor nije pronađen." };

  revalidatePath("/asistent", "layout");
  return { error: null };
}

export async function deleteConversation(id: string): Promise<ActionState> {
  await requireRole("admin", "manager");
  const parsed = conversationIdSchema.safeParse({ id });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { error: "Razgovor nije obrisan." };
  if (!data?.length) return { error: "Razgovor nije pronađen." };

  revalidatePath("/asistent", "layout");
  return { error: null };
}
