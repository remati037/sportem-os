import Link from "next/link";
import { AlertTriangle, Target } from "lucide-react";

import { datum, datumVreme, num, rsd } from "@/lib/format";
import { daysBetween, pct, roas, usd } from "@/lib/meta/labels";
import type { RangePeriod } from "@/lib/period";
import {
  costPerPurchaseRsd,
  cpcRsd,
  ctrPct,
  metaRoas,
  type AdExpenseMonth,
  type AdsOverview,
  type MetaSyncState,
} from "@/db/ads";
import { DailyBars } from "@/components/charts/daily-bars";
import { EmptyState } from "@/components/patterns/empty-state";
import { RangeFilter } from "@/components/patterns/range-filter";

import { CampaignsTable, type CampaignRowView } from "./campaigns-table";
import { MetaSyncButton } from "./meta-sync-button";

/*
 * Reklame (Meta Ads) — plan Reklame, M2. SAMO ČITANJE sa Meta-e.
 *
 * Pristup: Admin i Menadžer (potrošnja je finansija; Logistika nema ni RLS
 * politiku na ad_*). Potrošnja je u RSD po srednjem kursu NBS na dan potrošnje.
 * Kupovine i ROAS su PO META-I (piksel + njen model pripisivanja) — obeležene
 * zvezdicom; stvarne porudžbine po kampanji dolaze u M3 (UTM atribucija).
 *
 * Samo prikaz — podatke učitava `page.tsx` (kapija + RLS klijent).
 */

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-lg font-bold sm:text-xl">{value}</div>
      {hint ? <div className="text-ink-faint mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat("sr-Latn-RS", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = (m: string) => MONTH_LABEL.format(new Date(`${m}-01T00:00:00Z`));
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

/** Ručno uneto vs automatski, po mesecu (odluka D11). */
function ExpenseComparison({ months }: { months: AdExpenseMonth[] }) {
  if (months.length === 0) return null;
  const doubled = months.filter((m) => m.autoRsd != null && m.manualMeta.length > 0);

  return (
    <section className="mt-10">
      <h2 className="text-ink mb-1 text-base font-semibold">Troškovi reklama po mesecu</h2>
      <p className="text-ink-faint mb-4 text-xs">
        „Automatski“ je red koji pravi sinhronizacija (potrošnja po danu × kurs NBS). „Ručno — Meta“
        su tvoji redovi kategorije Reklame čiji opis pominje Meta/Facebook (naplate kartice).
        Razlika je normalna: naplata kod praga prelazi iz meseca u mesec, a banka ima svoj kurs.
      </p>

      {doubled.length > 0 ? (
        <div className="border-warning bg-warning-soft text-warning mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Mogući dupli trošak reklama</p>
            <p className="mt-0.5 break-words">
              {doubled.map((m) => monthLabel(m.month)).join(", ")} — postoje i automatski red i
              ručni „Meta“ redovi. Kad potvrdiš cifre, obriši ručne Meta redove u{" "}
              <Link href="/troskovi" className="underline">
                Troškovima
              </Link>
              ; ostale reklame (koje nisu Meta) ostaju.
            </p>
          </div>
        </div>
      ) : null}

      <div className="border-border bg-surface shadow-soft overflow-x-auto rounded-lg border">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-surface-2 text-ink-soft text-left">
              <th className="eyebrow h-9 px-3 sm:px-4">Mesec</th>
              <th className="eyebrow h-9 px-3 text-right sm:px-4">Automatski</th>
              <th className="eyebrow h-9 px-3 text-right sm:px-4">Ručno — Meta</th>
              <th className="eyebrow hidden h-9 px-3 text-right sm:table-cell sm:px-4">
                Ostale reklame
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const dup = m.autoRsd != null && m.manualMeta.length > 0;
              return (
                <tr key={m.month} className="border-border border-t align-top">
                  <td className="text-ink px-3 py-2.5 font-medium whitespace-nowrap capitalize sm:px-4">
                    {monthLabel(m.month)}
                  </td>
                  <td className="num text-ink px-3 py-2.5 text-right font-semibold whitespace-nowrap sm:px-4">
                    {m.autoRsd == null ? "—" : rsd(m.autoRsd)}
                  </td>
                  <td
                    className={
                      "num px-3 py-2.5 text-right whitespace-nowrap sm:px-4 " +
                      (dup ? "text-warning font-medium" : "")
                    }
                    title={m.manualMeta
                      .map((x) => `${datum(x.date)} ${rsd(x.amount)} ${x.description ?? ""}`)
                      .join("\n")}
                  >
                    {m.manualMeta.length === 0 ? (
                      "—"
                    ) : (
                      <>
                        {rsd(sum(m.manualMeta))}
                        <div className="text-ink-faint text-xs font-normal">
                          {m.manualMeta.length}{" "}
                          {m.manualMeta.length === 1
                            ? "naplata"
                            : m.manualMeta.length < 5
                              ? "naplate"
                              : "naplata"}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="num text-ink-soft hidden px-3 py-2.5 text-right whitespace-nowrap sm:table-cell sm:px-4">
                    {m.manualOther.length === 0 ? "—" : rsd(sum(m.manualOther))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReklameView({
  overview,
  months,
  syncState,
  period,
  today,
  isAdmin,
}: {
  overview: AdsOverview;
  months: AdExpenseMonth[];
  syncState: MetaSyncState | null;
  period: RangePeriod;
  today: string;
  isAdmin: boolean;
}) {
  const { totals, campaigns, daily } = overview;

  const rows: CampaignRowView[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    spendRsd: c.spendRsd,
    impressions: c.impressions,
    linkClicks: c.linkClicks,
    ctr: ctrPct(c),
    cpc: cpcRsd(c),
    purchases: c.metaPurchases,
    costPerPurchase: costPerPurchaseRsd(c),
    roas: metaRoas(c),
  }));

  // Grafikon: svaki dan perioda (i bez potrošnje), ali ne posle danas.
  const days = daysBetween(period.from, period.to < today ? period.to : today);
  const byDay = new Map(daily.map((d) => [d.date, d]));
  const query = new URLSearchParams({ od: period.from, do: period.to }).toString();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Novac</div>
          <h1 className="text-ink text-xl font-bold">Reklame</h1>
        </div>
        {isAdmin ? <MetaSyncButton /> : null}
      </div>

      <RangeFilter period={period} today={today} basePath="/reklame" />

      <p className="text-ink-faint mb-4 text-xs">
        {syncState?.lastSyncedAt
          ? `Poslednja sinhronizacija: ${datumVreme(syncState.lastSyncedAt)}. Sinhronizacija se pokreće svako jutro.`
          : "Još nije bilo uspešne sinhronizacije."}
      </p>

      {syncState?.lastError ? (
        <div className="border-danger bg-danger-soft text-danger mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Poslednja sinhronizacija ima problem</p>
            <p className="mt-0.5 break-words">{syncState.lastError}</p>
          </div>
        </div>
      ) : null}

      {!overview.hasAnyData ? (
        <EmptyState
          icon={<Target />}
          title="Još nema podataka sa Meta-e."
          description={
            isAdmin
              ? "Pokreni „Sinhronizuj Meta“ ili sačekaj jutarnju sinhronizaciju."
              : "Podaci stižu jutarnjom sinhronizacijom."
          }
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Potrošnja"
              value={rsd(totals.spendRsd)}
              hint={`${usd(totals.spendMinor)} · kurs NBS po danu`}
            />
            <Kpi
              label="Klikovi na link"
              value={num(totals.linkClicks)}
              hint={`CTR ${pct(ctrPct(totals))} · ${num(totals.impressions)} prikaza`}
            />
            <Kpi label="Cena klika" value={cpcRsd(totals) == null ? "—" : rsd(cpcRsd(totals)!)} />
            <Kpi
              label="Kupovine po Meta-i"
              value={num(totals.metaPurchases)}
              hint={`ROAS ${roas(metaRoas(totals))}${costPerPurchaseRsd(totals) != null ? ` · ${rsd(costPerPurchaseRsd(totals)!)} po kupovini` : ""}`}
            />
          </div>

          {totals.missingRsd > 0 ? (
            <p className="text-warning mb-4 text-xs">
              Za neke dane kurs NBS još nije stigao — potrošnja u RSD je privremeno manja (dopuniće
              se sledećom sinhronizacijom).
            </p>
          ) : null}

          <div className="border-border bg-surface shadow-soft mb-6 space-y-4 rounded-lg border px-4 py-4">
            <DailyBars
              panel={{
                label: "Potrošnja po danu",
                values: days.map((d) => byDay.get(d)?.spendRsd ?? 0),
                format: rsd,
                color: "var(--info)",
              }}
              days={days}
              showAxis={false}
            />
            <DailyBars
              panel={{
                label: "Kupovine po Meta-i",
                values: days.map((d) => byDay.get(d)?.metaPurchases ?? 0),
                format: num,
                color: "var(--green)",
              }}
              days={days}
              showAxis
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="Nema potrošnje u periodu."
              description="Izaberi drugi period."
            />
          ) : (
            <CampaignsTable rows={rows} query={query} />
          )}

          <p className="text-ink-faint mt-4 text-xs">
            * Po Meta-i: kupovine beleži Meta piksel po svom modelu pripisivanja i obično ih
            precenjuje. Stvarne porudžbine i zarada po kampanji (preko UTM-a sa sajta) dolaze
            sledeće.
          </p>
        </>
      )}

      <ExpenseComparison months={months} />
    </main>
  );
}
