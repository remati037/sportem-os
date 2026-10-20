import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft, ExternalLink } from "lucide-react";

import { datum, datumVreme, num, rsd } from "@/lib/format";
import { requireRole } from "@/lib/auth";
import { rate } from "@/lib/offers/labels";
import { getPackagesOverview } from "@/lib/offers/packages";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { Badge } from "@/components/ui/badge";

import { PeriodTabs } from "../../period-tabs";
import { statusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

/*
 * Detalj paketa: levak (pregled → dodavanje → porudžbina), dopune i pokloni,
 * i sastav paketa kako je zapisan u pluginu. Ništa se ne uređuje — paket se
 * menja na sajtu, a ovde se vidi pri sledećem otvaranju (čita se uživo).
 */

const GROUP_MODE: Record<string, string> = {
  all: "Sve stavke ulaze u paket",
  any: "Kupac bira",
  upsell: "Opciona dopuna",
};

const GIFT_TYPE: Record<string, string> = {
  ebook: "E-knjiga",
  product: "Proizvod",
  shipping: "Besplatna dostava",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-xl font-bold break-words">{value}</div>
      {hint ? <div className="text-ink-faint mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="num text-ink font-medium">{value}</span>
    </div>
  );
}

export default async function PaketDetaljPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const { id } = await params;
  const packageId = Number(id);
  if (!Number.isInteger(packageId)) notFound();

  const period = resolveOfferPeriod(await searchParams);
  const overview = await getPackagesOverview(period.days);
  const back = `/ponude/paketi?dana=${period.days}`;

  if (overview.error) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link
          href={back}
          className="text-ink-soft hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Paketi
        </Link>
        <div className="border-danger bg-danger-soft text-danger flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="break-words">{overview.error}</p>
        </div>
      </main>
    );
  }

  const row = overview.rows.find((r) => r.id === packageId);
  if (!row) notFound();

  const { pkg } = row;
  const giftsWindow =
    pkg?.gifts_from || pkg?.gifts_to
      ? `${pkg.gifts_from ? datum(pkg.gifts_from) : "…"} – ${pkg.gifts_to ? datum(pkg.gifts_to) : "…"}`
      : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Link
        href={back}
        className="text-ink-soft hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" /> Paketi
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="eyebrow">Paket</div>
          <h1 className="text-ink text-xl font-bold break-words">{row.title}</h1>
          {pkg?.excerpt ? <p className="text-ink-soft text-sm break-words">{pkg.excerpt}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(pkg?.status ?? null)}
          <PeriodTabs active={period.days} basePath={`/ponude/paketi/${packageId}`} />
        </div>
      </div>

      {/* Glavne cifre */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Pregledi" value={num(row.viewSessions)} hint={`${num(row.views)} učitavanja`} />
        <Kpi
          label="Dodaje u korpu"
          value={rate(row.addRate)}
          hint={`${num(row.addSessions)} posetilaca`}
        />
        <Kpi
          label="Porudžbine"
          value={num(row.orders)}
          hint={`${rate(row.orderRate)} od pregleda`}
        />
        <Kpi label="Prihod od paketa" value={rsd(Math.round(row.revenue))} />
        <Kpi
          label="Prosečna porudžbina"
          value={row.orders === 0 ? "—" : rsd(Math.round(row.aov))}
          hint="cela porudžbina sa ovim paketom"
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {/* Levak */}
        <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
          <h2 className="text-ink mb-1 font-semibold">Put do kupovine</h2>
          <div className="divide-border divide-y">
            <Row label="Klik na karticu paketa" value={num(row.cardClicks)} />
            <Row label="Pregled stranice paketa" value={num(row.views)} />
            <Row label="Dodat ceo paket" value={num(row.addAll)} />
            <Row label="Pokušao ceo paket, nije uspelo" value={num(row.addAllBlocked)} />
            <Row label="Dodata pojedinačna stavka" value={num(row.addItem)} />
            <Row label="Otključao poklon (posetilaca)" value={num(row.unlockSessions)} />
            <Row label="Izabrao poklon" value={num(row.giftChoice)} />
            <Row label="Porudžbine sa celim paketom" value={num(row.orders)} />
            <Row label="Kupljeno paketa (komada)" value={num(row.times)} />
            <Row
              label="Delimične porudžbine"
              value={`${num(row.partialOrders)} · ${rsd(Math.round(row.partialRevenue))}`}
            />
          </div>
        </div>

        {/* Dopune i pokloni */}
        <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
          <h2 className="text-ink mb-1 font-semibold">Dopune i pokloni</h2>
          <div className="divide-border divide-y">
            <Row label="Opciona stavka dodata" value={num(row.optionalAdd)} />
            <Row label="Dopuna prikazana" value={num(row.upsellViews)} />
            <Row label="Dopuna dodata" value={num(row.upsellAdds)} />
            <Row
              label="Dopuna kupljena"
              value={`${num(row.upsellOrders)} · ${rsd(Math.round(row.upsellRevenue))}`}
            />
            <Row label="Poslata e-knjiga" value={num(row.ebookSent)} />
          </div>
        </div>
      </div>

      {/* Sastav */}
      {pkg ? (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-ink font-semibold">Sastav paketa</h2>
            <div className="text-ink-soft flex flex-wrap items-center gap-3 text-sm">
              {pkg.from_price !== null ? (
                <span>
                  Cena od <span className="num text-ink font-semibold">{rsd(pkg.from_price)}</span>
                </span>
              ) : null}
              {pkg.url ? (
                <a
                  href={pkg.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink inline-flex items-center gap-1"
                >
                  Na sajtu <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
          </div>

          <div className="mb-6 space-y-3">
            {pkg.groups.map((g) => (
              <div
                key={g.id}
                className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-ink font-medium">{g.title || "Stavke"}</span>
                  <Badge variant={g.mode === "upsell" ? "sent" : "info"}>
                    {GROUP_MODE[g.mode] ?? g.mode}
                  </Badge>
                </div>
                <ul className="divide-border divide-y">
                  {g.items.map((it) => {
                    const p = it.product;
                    const missing = !p || p.missing || !p.id;
                    return (
                      <li
                        key={it.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="text-ink break-words">{it.label || p?.name || "—"}</span>
                          {p?.sku ? <span className="text-ink-faint"> · {p.sku}</span> : null}
                          {it.qty > 1 ? (
                            <span className="num text-ink-soft"> × {it.qty}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {missing ? (
                            <Badge variant="danger">Proizvod ne postoji na sajtu</Badge>
                          ) : p?.in_stock === false ? (
                            <Badge variant="warning">Nema na stanju</Badge>
                          ) : null}
                          <span className="num text-ink">
                            {it.min_price === null ? "—" : rsd(it.min_price)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-ink font-semibold">Pokloni</h2>
            {giftsWindow ? (
              <Badge variant={pkg.gifts_active ? "success" : "warning"}>
                {pkg.gifts_active ? "Aktivni" : "Neaktivni"} · {giftsWindow}
              </Badge>
            ) : null}
          </div>
          {pkg.gifts.length === 0 ? (
            <p className="text-ink-soft mb-6 text-sm">Paket nema poklone.</p>
          ) : (
            <ul className="border-border bg-surface shadow-soft divide-border mb-6 divide-y rounded-lg border px-4">
              {pkg.gifts.map((gift) => (
                <li
                  key={gift.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-ink break-words">
                      {gift.title || gift.product?.name || GIFT_TYPE[gift.type] || gift.type}
                    </span>
                    {gift.product?.sku ? (
                      <span className="text-ink-faint"> · {gift.product.sku}</span>
                    ) : null}
                    {gift.qty > 1 ? <span className="num text-ink-soft"> × {gift.qty}</span> : null}
                  </div>
                  <Badge variant="info">{GIFT_TYPE[gift.type] ?? gift.type}</Badge>
                </li>
              ))}
            </ul>
          )}

          {pkg.modified ? (
            <p className="text-ink-faint text-xs">Izmenjeno na sajtu: {datumVreme(pkg.modified)}</p>
          ) : null}
        </>
      ) : (
        <div className="border-border bg-surface-2 text-ink-soft rounded-lg border border-dashed px-4 py-3 text-sm">
          Ovog paketa više nema na sajtu, pa sastav i pokloni ne mogu da se prikažu. Statistika iz
          plugina je sačuvana.
        </div>
      )}
    </main>
  );
}
