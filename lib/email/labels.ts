/* Nazivi za prikaz: statusi Brevo kampanja i `utm_content` dugmad iz mejlova. */

import type { BrevoCampaignStatus } from "@/lib/email/brevo";

export function campaignStatusLabel(s: BrevoCampaignStatus): string {
  switch (s) {
    case "sent":
      return "Poslato";
    case "queued":
      return "Zakazano";
    case "inProcess":
      return "Šalje se";
    case "suspended":
      return "Pauzirano";
    case "archive":
      return "Arhivirano";
    default:
      return "Nacrt";
  }
}

/**
 * `utm_content` iz linkova (novembar/email/build.mjs) → čitljiv naziv dugmeta.
 * Nepoznate vrednosti se prikazuju kakve jesu.
 */
export function contentLabel(key: string | null): string {
  if (!key || key === "ostalo") return "Ostalo";
  if (key === "hero") return "Glavna ponuda";
  const dopuna = key.match(/^dopuna-(\d)$/);
  if (dopuna) return `Dopuni opremu ${dopuna[1]}`;
  if (key === "svi-paketi" || key.endsWith("-svi")) return "Svi paketi";
  if (key.startsWith("gmail-karusel")) return "Gmail karusel";
  if (key === "logo") return "Logo";
  if (key === "footer") return "Podnožje";
  if (key.endsWith("-dodaci")) return "Dodaci do −25%";
  if (key.endsWith("-paketi")) return "Paketi";
  if (/-hero$/.test(key)) return "Glavna ponuda";
  if (/^(rani|cp|zadnji)-\d$/.test(key)) return `Ponuda ${key.split("-")[1]}`;
  return key;
}
