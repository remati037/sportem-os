import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShoppingBasket } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { num, rsd } from "@/lib/format";
import { contentLabel } from "@/lib/email/labels";
import { getCampaignDetail } from "@/lib/email/overview";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { EmptyState } from "@/components/patterns/empty-state";

import { CampaignStatus, campaignWhen, EmailOrders, ErrorBox, Kpi, ratio } from "../parts";

export const dynamic = "force-dynamic";

/*
 * Detalj kampanje: levak (poslato → otvorilo → kliknulo → poručilo), klikovi
 * po dugmetu i po stranici, i porudžbine iz te kampanje (`utm_campaign`), od
 * dana slanja do danas. Ništa se ne uređuje — kampanja se menja u Brevu.
 */

function Bars({
  rows,
  total,
}: {
  rows: { label: string; value: number; hint?: string }[];
  total: number;
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink min-w-0 break-words">{r.label}</span>
            <span className="num text-ink shrink-0 font-medium">
              {num(r.value)}
              {r.hint ? (
                <span className="text-ink-faint ml-1.5 text-xs font-normal">{r.hint}</span>
              ) : null}
            </span>
          </div>
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-green h-full rounded-full"
              style={{ width: `${total > 0 ? (r.value / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function MejlDetaljPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) notFound();

  const period = resolveOfferPeriod(await searchParams);
  const back = `/ponude/mejlovi?dana=${period.days}`;
  const d = await getCampaignDetail(campaignId);
  const c = d.campaign;

  const backLink = (
    <Link
      href={back}
      className="text-ink-soft hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
    >
      <ChevronLeft className="size-4" /> Mejlovi
    </Link>
  );

  if (!c) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {backLink}
        <ErrorBox title="Kampanja se ne može učitati" message={d.error ?? "Nepoznata greška."} />
      </main>
    );
  }

  const s = c.stats;
  const clickTotal = d.linkGroups.reduce((a, g) => a + g.clicks, 0);
  const pageTotal = d.topLinks[0]?.clicks ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      {backLink}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="eyebrow">Kampanja</div>
          <h1 className="text-ink text-xl font-bold break-words">{c.name}</h1>
          <p className="text-ink-soft text-sm break-words">
            {campaignWhen(c)}
            {c.utmCampaign ? (
              <span className="text-ink-faint"> · utm_campaign={c.utmCampaign}</span>
            ) : null}
          </p>
        </div>
        <CampaignStatus status={c.status} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Poslato" value={num(s.sent)} hint={`${num(s.delivered)} isporučeno`} />
        <Kpi
          label="Otvorilo"
          value={ratio(s.uniqueViews, s.sent)}
          hint={`${num(s.uniqueViews)} primalaca`}
        />
        <Kpi
          label="Kliknulo"
          value={ratio(s.clickers, s.sent)}
          hint={`${ratio(s.clickers, s.uniqueViews)} od otvorenih`}
        />
        <Kpi
          label="Odjave / spam"
          value={`${num(s.unsubscriptions)} / ${num(s.complaints)}`}
          hint={`odbijeno: ${num(s.hardBounces + s.softBounces)}`}
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Porudžbine"
          value={num(d.totals.orders)}
          hint={`${ratio(d.totals.orders, s.clickers)} od kliknulih`}
        />
        <Kpi label="Roba" value={rsd(d.totals.revenue)} />
        <Kpi label="Zarada" value={rsd(d.totals.profit)} />
        <Kpi
          label="Zarada po mejlu"
          value={s.sent > 0 ? rsd(Math.round(d.totals.profit / s.sent)) : "—"}
          hint="zarada ÷ poslato"
        />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section className="border-border bg-surface shadow-soft rounded-lg border px-5 py-4">
          <h2 className="text-ink mb-3 text-base font-bold">Klikovi po dugmetu</h2>
          {d.linkGroups.length === 0 ? (
            <p className="text-ink-faint text-sm">Još nema klikova.</p>
          ) : (
            <Bars
              total={d.linkGroups[0].clicks}
              rows={d.linkGroups.map((g) => ({
                label: contentLabel(g.key),
                value: g.clicks,
                hint: ratio(g.clicks, clickTotal),
              }))}
            />
          )}
          {d.contentGroups.length > 0 ? (
            <>
              <h3 className="text-ink mt-5 mb-2 text-sm font-bold">Porudžbine po dugmetu</h3>
              <Bars
                total={d.contentGroups[0].revenue}
                rows={d.contentGroups.map((g) => ({
                  label: contentLabel(g.key),
                  value: g.revenue,
                  hint: `${num(g.orders)} por.`,
                }))}
              />
            </>
          ) : null}
        </section>

        <section className="border-border bg-surface shadow-soft rounded-lg border px-5 py-4">
          <h2 className="text-ink mb-3 text-base font-bold">Najkliknutije stranice</h2>
          {d.topLinks.length === 0 ? (
            <p className="text-ink-faint text-sm">Još nema klikova.</p>
          ) : (
            <Bars
              total={pageTotal}
              rows={d.topLinks.map((g) => ({
                label: g.key.replace(/^sportem\.rs/, "") || "/",
                value: g.clicks,
              }))}
            />
          )}
        </section>
      </div>

      <h2 className="text-ink mb-1 text-base font-bold">Porudžbine iz ove kampanje</h2>
      <p className="text-ink-faint mb-3 text-xs">
        Iz aplikacije, od dana slanja. Otkazane i vraćene su prikazane, ali nisu u zbiru.
      </p>

      {d.ordersError ? (
        <ErrorBox title="Porudžbine se ne mogu učitati" message={d.ordersError} />
      ) : null}

      {!d.ordersError && d.orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBasket />}
          title={
            c.status === "sent"
              ? "Još nema porudžbina iz ove kampanje."
              : "Kampanja još nije poslata."
          }
          description="Porudžbina se pojavljuje ovde kad kupac dođe na sajt preko linka iz mejla i poruči."
        />
      ) : null}

      {d.orders.length > 0 ? <EmailOrders orders={d.orders} showCampaign={false} /> : null}
    </main>
  );
}
