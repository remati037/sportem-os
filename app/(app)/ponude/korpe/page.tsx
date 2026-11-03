import Link from "next/link";
import { AlertTriangle, ShoppingBasket } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { datumVreme, num, rsd } from "@/lib/format";
import { rate } from "@/lib/offers/labels";
import { getCartsOverview } from "@/lib/offers/carts";
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

import { StatusPill } from "../../porudzbine/status-pill";
import { OffersTabs } from "../offers-tabs";
import { PeriodTabs } from "../period-tabs";

export const dynamic = "force-dynamic";

/*
 * Ponude → Korpe: podsetnici za napuštene korpe (plugin „Sportem Korpa").
 * Brojke o mejlovima se čitaju uživo iz plugina; porudžbine sa linka su iz
 * Supabase-a (`utm_medium=abandoned_cart`), sa pravim statusom.
 *
 * Pristup: Admin i Menadžer (prihod). Ključ plugina ostaje na serveru.
 */

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num text-ink mt-1 text-xl font-bold break-words">{value}</div>
      {hint ? <div className="text-ink-faint mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
}

function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div className="border-danger bg-danger-soft text-danger mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 break-words">{message}</p>
      </div>
    </div>
  );
}

const ratio = (a: number, b: number) => (b > 0 ? rate(a / b) : "—");

function campaignLabel(c: string | null): string {
  if (c === "podsetnik_1") return "Mejl 1";
  if (c === "podsetnik_2") return "Mejl 2";
  return c ?? "—";
}

export default async function KorpePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const period = resolveOfferPeriod(await searchParams);
  const o = await getCartsOverview(period);
  const s = o.stats;
  const orderHref = (r: (typeof o.orders)[number]) => `/porudzbine/${r.wooOrderId ?? r.id}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="eyebrow">Prodaja</div>
          <h1 className="text-ink text-xl font-bold">Ponude</h1>
        </div>
        <PeriodTabs active={period.days} basePath="/ponude/korpe" />
      </div>

      <OffersTabs days={period.days} />

      {o.error ? (
        <ErrorBox title="Statistika podsetnika se ne može učitati sa sajta" message={o.error} />
      ) : null}

      {s ? (
        <>
          <p className="text-ink-faint mb-4 text-xs">
            Podsetnici za napuštene korpe · podaci uživo sa sajta, poslednjih {o.pluginDays} dana
            {o.pluginDays < period.days ? " (plugin čuva korpe 60 dana)" : ""} · bez test korpi
          </p>

          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Uhvaćene korpe"
              value={num(s.captured)}
              hint={`${num(s.ordered_before)} poručilo pre podsetnika`}
            />
            <Kpi label="Poslato" value={num(s.sent1)} hint={`mejl 2: ${num(s.sent2)}`} />
            <Kpi
              label="Otvoreno"
              value={ratio(s.opened, s.sent1)}
              hint={`${num(s.opened)} od poslatih`}
            />
            <Kpi
              label="Kliknuto"
              value={ratio(s.clicked, s.sent1)}
              hint={`${num(s.clicked)} od poslatih`}
            />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Vraćeno preko linka"
              value={num(s.recovered_link)}
              hint={`${rsd(Math.round(s.revenue_link))} · ${ratio(s.recovered_link, s.sent1)} od poslatih`}
            />
            <Kpi
              label="Poručili posle mejla"
              value={num(s.recovered_posle)}
              hint={`${rsd(Math.round(s.revenue_posle))} · bez klika na link`}
            />
            <Kpi label="Odjave" value={num(s.unsub)} />
            <Kpi
              label="Odbijeni / spam"
              value={`${num(s.bounce)} / ${num(s.complaint)}`}
              hint="spam prijave treba da budu 0"
            />
          </div>
        </>
      ) : null}

      <h2 className="text-ink mb-1 text-base font-bold">Porudžbine sa linka iz mejla</h2>
      <p className="text-ink-faint mb-3 text-xs">
        Iz aplikacije, poslednjih {period.days} dana: {num(o.ordersValid)} porudžbina,{" "}
        {rsd(o.revenueValid)} robe. Otkazane i vraćene su prikazane, ali nisu u zbiru.
      </p>

      {o.ordersError ? (
        <ErrorBox title="Porudžbine se ne mogu učitati" message={o.ordersError} />
      ) : null}

      {!o.ordersError && o.orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBasket />}
          title="Još nema porudžbina sa linka iz mejla."
          description="Kad kupac klikne na „Završi porudžbinu“ u podsetniku i poruči, porudžbina se pojavljuje ovde."
        />
      ) : null}

      {o.orders.length > 0 ? (
        <>
          <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Porudžbina</TableHead>
                  <TableHead>Kupac</TableHead>
                  <TableHead>Vreme</TableHead>
                  <TableHead>Mejl</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Roba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.orders.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={orderHref(r)}
                        className="text-ink hover:text-green num font-medium"
                      >
                        #{r.wooOrderId ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="break-words">{r.name ?? "—"}</TableCell>
                    <TableCell className="num">{datumVreme(r.orderedAt)}</TableCell>
                    <TableCell>{campaignLabel(r.campaign)}</TableCell>
                    <TableCell>
                      {r.statusName ? (
                        <StatusPill name={r.statusName} color={r.statusColor} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell
                      className={`num text-right ${r.cancelled ? "text-ink-faint line-through" : "text-ink font-semibold"}`}
                    >
                      {rsd(r.goodsTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCardList>
            {o.orders.map((r) => (
              <MobileCard
                key={r.id}
                href={orderHref(r)}
                ariaLabel={`Porudžbina ${r.wooOrderId ?? ""}`}
              >
                <MobileCardHeader
                  title={<span className="num">#{r.wooOrderId ?? "—"}</span>}
                  subtitle={r.name ?? undefined}
                  trailing={
                    r.statusName ? <StatusPill name={r.statusName} color={r.statusColor} /> : null
                  }
                />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Vreme">
                    <span className="num">{datumVreme(r.orderedAt)}</span>
                  </MobileCardField>
                  <MobileCardField label="Mejl">{campaignLabel(r.campaign)}</MobileCardField>
                  <MobileCardField label="Roba">
                    <span className={`num ${r.cancelled ? "line-through" : "font-semibold"}`}>
                      {rsd(r.goodsTotal)}
                    </span>
                  </MobileCardField>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      ) : null}

      <p className="text-ink-faint mt-4 text-xs">
        „Vraćeno preko linka“ broji plugin u trenutku porudžbine. Spisak iznad je iz aplikacije i
        pokazuje pravi status, pa se otkazane vide. „Poručili posle mejla“ su kupci koji su dobili
        podsetnik i poručili istom adresom ili telefonom bez klika — mejl je možda pomogao, ali to
        nije sigurno.
      </p>
    </main>
  );
}
