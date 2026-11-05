import Link from "next/link";
import { Mail, ShoppingBasket } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { num, rsd } from "@/lib/format";
import { getEmailOverview } from "@/lib/email/overview";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { EmptyState } from "@/components/patterns/empty-state";
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

import { OffersTabs } from "../offers-tabs";
import { PeriodTabs } from "../period-tabs";
import { CampaignStatus, campaignWhen, EmailOrders, ErrorBox, Kpi, ratio } from "./parts";

export const dynamic = "force-dynamic";

/*
 * Ponude → Mejlovi: kampanje kupcima iz Brevoa (E1, podsetnik, Crni petak…).
 * Brojke o mejlovima se čitaju uživo iz Brevoa; porudžbine i zarada su iz
 * Supabase-a (`utm_source=email`, `utm_medium=email`), sa pravim statusom.
 *
 * Pristup: Admin i Menadžer (prihod i zarada). Ključ Brevoa ostaje na serveru.
 */
export default async function MejloviPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const period = resolveOfferPeriod(await searchParams);
  const o = await getEmailOverview(period);
  const t = o.totals;
  const detail = (id: number) => `/ponude/mejlovi/${id}?dana=${period.days}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Prodaja</div>
          <h1 className="text-ink text-xl font-bold">Ponude</h1>
        </div>
        <PeriodTabs active={period.days} basePath="/ponude/mejlovi" />
      </div>

      <OffersTabs days={period.days} />

      {o.error ? (
        <ErrorBox title="Kampanje se ne mogu učitati iz Brevoa" message={o.error} />
      ) : null}

      <p className="text-ink-faint mb-4 text-xs">
        Mejlovi kupcima · brojke o mejlovima uživo iz Brevoa, porudžbine iz aplikacije · poslednjih{" "}
        {period.days} dana
      </p>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Poslato" value={num(t.sent)} hint={`${num(o.campaigns.length)} kampanja`} />
        <Kpi label="Otvorilo" value={ratio(t.opened, t.sent)} hint={`${num(t.opened)} primalaca`} />
        <Kpi
          label="Kliknulo"
          value={ratio(t.clicked, t.sent)}
          hint={`${num(t.clicked)} primalaca`}
        />
        <Kpi
          label="Odjave / spam"
          value={`${num(t.unsub)} / ${num(t.complaints)}`}
          hint="spam prijave treba da budu 0"
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Porudžbine iz mejla" value={num(t.orders)} hint="bez otkazanih i vraćenih" />
        <Kpi label="Roba" value={rsd(t.revenue)} />
        <Kpi label="Zarada" value={rsd(t.profit)} hint="MP − VP stavki" />
        <Kpi
          label="Zarada po mejlu"
          value={t.sent > 0 ? rsd(Math.round(t.profit / t.sent)) : "—"}
          hint="zarada ÷ poslato"
        />
      </div>

      <h2 className="text-ink mb-3 text-base font-bold">Kampanje</h2>

      {!o.error && o.campaigns.length === 0 ? (
        <EmptyState
          icon={<Mail />}
          title="Nema poslatih ni zakazanih kampanja u ovom periodu."
          description="Kampanje se prave i zakazuju u Brevu. Čim se neka zakaže, pojavljuje se ovde."
          className="mb-8"
        />
      ) : null}

      {o.campaigns.length > 0 ? (
        <div className="mb-8">
          <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kampanja</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slanje</TableHead>
                  <TableHead className="text-right">Poslato</TableHead>
                  <TableHead className="text-right">Otvorilo</TableHead>
                  <TableHead className="text-right">Kliknulo</TableHead>
                  <TableHead className="text-right">Odjave</TableHead>
                  <TableHead className="text-right">Porudžbine</TableHead>
                  <TableHead className="text-right">Roba</TableHead>
                  <TableHead className="text-right">Zarada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={detail(c.id)} className="text-ink hover:text-green font-medium">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <CampaignStatus status={c.status} />
                    </TableCell>
                    <TableCell className="num">{campaignWhen(c)}</TableCell>
                    <TableCell className="num text-right">{num(c.stats.sent)}</TableCell>
                    <TableCell className="num text-right">
                      {ratio(c.stats.uniqueViews, c.stats.sent)}
                    </TableCell>
                    <TableCell className="num text-right">
                      {ratio(c.stats.clickers, c.stats.sent)}
                    </TableCell>
                    <TableCell className="num text-right">{num(c.stats.unsubscriptions)}</TableCell>
                    <TableCell className="num text-right">{num(c.orders)}</TableCell>
                    <TableCell className="num text-right font-semibold">{rsd(c.revenue)}</TableCell>
                    <TableCell className="num text-right">{rsd(c.profit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCardList>
            {o.campaigns.map((c) => (
              <MobileCard key={c.id} href={detail(c.id)} ariaLabel={c.name}>
                <MobileCardHeader
                  title={c.name}
                  subtitle={campaignWhen(c)}
                  trailing={<CampaignStatus status={c.status} />}
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Poslato">
                    <span className="num">{num(c.stats.sent)}</span>
                  </MobileCardField>
                  <MobileCardField label="Otvorilo / kliknulo">
                    <span className="num">
                      {ratio(c.stats.uniqueViews, c.stats.sent)} /{" "}
                      {ratio(c.stats.clickers, c.stats.sent)}
                    </span>
                  </MobileCardField>
                  <MobileCardField label="Porudžbine">
                    <span className="num">{num(c.orders)}</span>
                  </MobileCardField>
                  <MobileCardField label="Roba / zarada">
                    <span className="num font-semibold">
                      {rsd(c.revenue)} / {rsd(c.profit)}
                    </span>
                  </MobileCardField>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </div>
      ) : null}

      <h2 className="text-ink mb-1 text-base font-bold">Porudžbine sa linka iz mejla</h2>
      <p className="text-ink-faint mb-3 text-xs">
        Iz aplikacije, poslednjih {period.days} dana. Otkazane i vraćene su prikazane, ali nisu u
        zbiru.
      </p>

      {o.ordersError ? (
        <ErrorBox title="Porudžbine se ne mogu učitati" message={o.ordersError} />
      ) : null}

      {!o.ordersError && o.orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBasket />}
          title="Još nema porudžbina sa linka iz mejla."
          description="Kad kupac klikne na dugme u mejlu i poruči, porudžbina se pojavljuje ovde."
        />
      ) : null}

      {o.orders.length > 0 ? <EmailOrders orders={o.orders} showCampaign /> : null}

      <p className="text-ink-faint mt-4 text-xs">
        „Otvorilo“ uključuje i automatska otvaranja na Apple uređajima, pa je malo veće od stvarnog.
        Porudžbina se računa mejlu kad je kupac došao na sajt preko linka iz mejla i poručio u toj
        poseti.
      </p>
    </main>
  );
}
