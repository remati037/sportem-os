import { z } from "zod";

import { isAiModelId } from "@/lib/ai/models";
import { uuid } from "@/lib/validation/uuid";

/* Validacija modula AI Asistent (Korak A2). */

export const AI_MESSAGE_MAX = 8000;
export const AI_TITLE_MAX = 120;

const modelField = z.string().refine(isAiModelId, "Nepoznat model.");
/** Prekidač „Pretraži web" (A4). Isključen podrazumevano — trošak + privatnost. */
const webField = z.boolean().default(false);

/** Telo POST /api/asistent/chat. Bez `conversationId` → nov razgovor. */
export const chatRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("send"),
    conversationId: uuid("Neispravan razgovor.").nullable(),
    model: modelField,
    web: webField,
    message: z
      .string()
      .trim()
      .min(1, "Poruka je prazna.")
      .max(AI_MESSAGE_MAX, `Poruka je predugačka (najviše ${AI_MESSAGE_MAX} znakova).`),
  }),
  z.object({
    // Ponovi poslednji odgovor: briše poslednju poruku asistenta i odgovara ponovo.
    mode: z.literal("regenerate"),
    conversationId: uuid("Neispravan razgovor."),
    model: modelField,
    web: webField,
  }),
]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const renameConversationSchema = z.object({
  id: uuid("Neispravan razgovor."),
  title: z
    .string()
    .trim()
    .min(1, "Naslov je prazan.")
    .max(AI_TITLE_MAX, `Naslov je predugačak (najviše ${AI_TITLE_MAX} znakova).`),
});

export const conversationIdSchema = z.object({ id: uuid("Neispravan razgovor.") });
