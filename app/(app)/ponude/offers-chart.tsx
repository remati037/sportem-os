import { DailyBars } from "@/components/charts/daily-bars";
import { num, rsd } from "@/lib/format";
import { periodDays, type OfferPeriod } from "@/lib/offers/period";
import type { OfferDailyRow } from "@/db/offers";

/*
 * Dnevna serija: dodavanja i prihod.
 *
 * DVA panela sa zajedničkom x-osom, ne jedan grafikon sa dve y-ose: dodavanja
 * (komadi) i prihod (RSD) su različite veličine, pa bi zajednička slika pravila
 * lažne odnose („linija preseca stubiće" ne znači ništa). Svaki panel ima jednu
 * seriju, pa mu naslov nosi identitet i legenda nije potrebna.
 *
 * Čist inline SVG (bez biblioteke): skalira se kroz viewBox, pa radi i na 360px.
 * Svaki stubić nosi <title> → tap/hover daje tačnu cifru za taj dan.
 */

export function OffersChart({ daily, period }: { daily: OfferDailyRow[]; period: OfferPeriod }) {
  // Svi dani perioda, i oni bez ijednog događaja — inače bi praznine nestale
  // i grafikon bi lagao o gustini.
  const days = periodDays(period);
  const byDay = new Map(daily.map((r) => [r.dan, r]));

  const adds = days.map((d) => byDay.get(d)?.adds ?? 0);
  const revenue = days.map((d) => Math.round(byDay.get(d)?.revenue ?? 0));

  return (
    <div className="space-y-4">
      <DailyBars
        panel={{ label: "Dodato u korpu", values: adds, format: num, color: "var(--green)" }}
        days={days}
        showAxis={false}
      />
      <DailyBars
        panel={{ label: "Prihod od ponuda", values: revenue, format: rsd, color: "var(--info)" }}
        days={days}
        showAxis
      />
    </div>
  );
}
