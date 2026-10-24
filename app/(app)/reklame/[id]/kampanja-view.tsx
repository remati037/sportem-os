import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { datum, num, rsd } from "@/lib/format";
import { campaignStatus, daysBetween, pct, roas, usd } from "@/lib/meta/labels";
import type { RangePeriod } from "@/lib/period";
import { cpcRsd, ctrPct, metaRoas, type AdCampaignDetail } from "@/db/ads";
import { DailyBars } from "@/components/charts/daily-bars";
import { EmptyState } from "@/components/patterns/empty-state";
import { RangeFilter } from "@/components/patterns/range-filter";
import { Badge } from "@/components/ui/badge";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/*
 * Jedna Meta kampanja po danima (plan Reklame, M2). Isti period kao lista
 * (?od&do). Kupovine i ROAS su po Meta-i (*). Samo prikaz — podatke učitava page.tsx.
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

export function KampanjaView({
  detail,
  period,
  today,
}: {
  detail: AdCampaignDetail;
  period: RangePeriod;
  today: string;
}) {
  const { campaign, totals, days: rows } = detail;
  const st = campaignStatus(campaign.status);

  const days = daysBetween(period.from, period.to < today ? period.to : today);
  const byDay = new Map(rows.map((r) => [r.date, r]));
  const back = `/reklame?${new URLSearchParams({ od: period.from, do: period.to }).toString()}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <Link
        href={back}
        className="text-ink-faint hover:text-ink mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" /> Reklame
      </Link>
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Meta kampanja</div>
        <h1 className="text-ink text-xl font-bold break-words">{campaign.name}</h1>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      <RangeFilter
        period={period}
        today={today}
        basePath={`/reklame/${encodeURIComponent(campaign.id)}`}
      />

      {rows.length === 0 ? (
        <EmptyState title="Nema potrošnje u periodu." description="Izaberi drugi period." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Potrošnja" value={rsd(totals.spendRsd)} hint={usd(totals.spendMinor)} />
            <Kpi
              label="Klikovi na link"
              value={num(totals.linkClicks)}
              hint={`CTR ${pct(ctrPct(totals))} · ${num(totals.impressions)} prikaza`}
            />
            <Kpi label="Cena klika" value={cpcRsd(totals) == null ? "—" : rsd(cpcRsd(totals)!)} />
            <Kpi
              label="Kupovine po Meta-i"
              value={num(totals.metaPurchases)}
              hint={`ROAS ${roas(metaRoas(totals))}`}
            />
          </div>

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

          {/* desktop */}
          <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Dan</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                    Potrošnja
                  </TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                    Prikazi
                  </TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                    Klikovi
                  </TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">CTR</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">
                    Kupovine*
                  </TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4 text-right">ROAS*</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.date} className="border-border">
                    <TableCell className="num text-ink px-4 py-2.5 font-medium">
                      {datum(r.date)}
                    </TableCell>
                    <TableCell className="num text-ink px-4 py-2.5 text-right font-semibold">
                      {rsd(r.spendRsd)}
                      <div className="text-ink-faint text-xs font-normal">{usd(r.spendMinor)}</div>
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">
                      {num(r.impressions)}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">
                      {num(r.linkClicks)}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">{pct(ctrPct(r))}</TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">
                      {num(r.metaPurchases)}
                    </TableCell>
                    <TableCell className="num px-4 py-2.5 text-right">
                      {roas(metaRoas(r))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* telefon */}
          <MobileCardList>
            {rows.map((r) => (
              <MobileCard key={r.date} ariaLabel={`Dan ${datum(r.date)}`}>
                <MobileCardHeader
                  title={<span className="num">{datum(r.date)}</span>}
                  trailing={<span className="num font-semibold">{rsd(r.spendRsd)}</span>}
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Klikovi">
                    <span className="num">
                      {num(r.linkClicks)} <span className="text-ink-faint">({pct(ctrPct(r))})</span>
                    </span>
                  </MobileCardField>
                  <MobileCardField label="Kupovine*">
                    <span className="num">{num(r.metaPurchases)}</span>
                  </MobileCardField>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>

          <p className="text-ink-faint mt-4 text-xs">
            * Po Meta-i (piksel i njen model pripisivanja) — obično precenjeno.
          </p>
        </>
      )}
    </main>
  );
}
