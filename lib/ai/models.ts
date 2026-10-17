/*
 * AI Asistent — spisak modela koje korisnik bira u chatu.
 *
 * BEZ `server-only`: izbor modela se renderuje i na klijentu. Ovde nema
 * ključeva ni poziva API-ja — to je u `lib/ai/client.ts`.
 *
 * Cene su u MILIONITIM DELOVIMA USD po milion tokena (integer, bez float-a —
 * CLAUDE.md §5): 4_000_000 = 4 $ / MTok. Služe za prikaz potrošnje i mesečni
 * limit (A5); stvarni račun je na console.anthropic.com.
 */

export type AiModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

export type AiModel = {
  id: AiModelId;
  label: string;
  description: string;
  /** Dubina razmišljanja (`output_config.effort`). */
  effort: "low" | "medium" | "high";
  price: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export const AI_MODELS: AiModel[] = [
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    description: "Najpametniji — za analize i složena pitanja",
    effort: "medium",
    price: { input: 4_000_000, output: 20_000_000, cacheRead: 200_000, cacheWrite: 5_000_000 },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    description: "Balans brzine i kvaliteta",
    effort: "medium",
    price: { input: 2_000_000, output: 10_000_000, cacheRead: 200_000, cacheWrite: 2_500_000 },
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    description: "Najbrži i najjeftiniji — za kratka pitanja",
    effort: "low",
    price: { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
  },
];

export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-5-5";

/** Model za sporedne kratke pozive (npr. auto-naslov razgovora). */
export const AI_TITLE_MODEL: AiModelId = "claude-haiku-5-5";

export function getAiModel(id: string | null | undefined): AiModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS.find((m) => m.id === DEFAULT_AI_MODEL)!;
}

export function isAiModelId(id: unknown): id is AiModelId {
  return typeof id === "string" && AI_MODELS.some((m) => m.id === id);
}

export type AiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Cena jednog odgovora u milionitim delovima USD (integer). */
export function costMicroUsd(modelId: string, usage: AiUsage): number {
  const { price } = getAiModel(modelId);
  const total =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite;
  return Math.round(total / 1_000_000);
}
