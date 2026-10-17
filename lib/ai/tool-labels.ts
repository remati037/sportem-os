/*
 * Srpski nazivi alata AI asistenta — za karticu „Pogledao…" u chatu.
 * BEZ `server-only`: koristi se i na klijentu (alati su u `lib/ai/tools`).
 */
export const AI_TOOL_LABELS: Record<string, string> = {
  prodaja_pregled: "Pregled prodaje",
  top_artikli: "Najprodavaniji artikli",
  artikal_prodaja: "Prodaja artikla",
  prodaja_po_vremenu: "Prodaja kroz vreme",
  kupci_top: "Kupci",
  porudzbine_pretraga: "Porudžbine",
  porudzbina_detalj: "Detalj porudžbine",
  zalihe: "Zalihe",
  finansije_stanje: "Stanje finansija",
  troskovi: "Troškovi",
  otkazivanja: "Otkazivanja i vraćanja",
  ponude_statistika: "Ponude na sajtu",
};

/** Kratak opis poziva alata: naziv + period/pretraga (npr. „Najprodavaniji artikli · 01.09–30.09"). */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  const label = AI_TOOL_LABELS[name] ?? name;
  const parts: string[] = [];
  const fmt = (d: unknown) =>
    typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`
      : null;
  const od = fmt(input.od);
  const dd = fmt(input.do);
  if (od && dd) parts.push(od === dd ? od : `${od}–${dd}`);
  if (typeof input.dana === "number") parts.push(`${input.dana} dana`);
  for (const key of ["pretraga", "kupac_ili_grad", "status"]) {
    if (typeof input[key] === "string" && input[key]) parts.push(`„${input[key] as string}“`);
  }
  if (typeof input.broj === "number") parts.push(`#${input.broj}`);
  if (typeof input.vrsta === "string") parts.push(input.vrsta);
  return parts.length ? `${label} · ${parts.join(" · ")}` : label;
}
