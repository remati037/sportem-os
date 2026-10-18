import type { Role } from "@/lib/auth";
import type { AiBudget } from "@/lib/ai/usage";

/*
 * Šta od potrošnje ide na klijent (A5). Ukupnu potrošnju naloga i iznos
 * limita vidi samo Admin; Menadžer vidi svoju potrošnju i STANJE limita
 * (upozorenje / potrošeno), bez iznosa tuđe potrošnje.
 */
export type AiBudgetView = {
  mineMicro: number;
  totalMicro: number | null;
  limitMicro: number | null;
  ratio: number;
  blocked: boolean;
};

export function toBudgetView(b: AiBudget, role: Role): AiBudgetView {
  const admin = role === "admin";
  return {
    mineMicro: b.mineMicro,
    totalMicro: admin ? b.totalMicro : null,
    limitMicro: admin ? b.limitMicro : null,
    ratio: b.ratio,
    blocked: b.blocked,
  };
}
