import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { datumVreme, num, rsd } from "@/lib/format";
import { placementLabel, rate } from "@/lib/offers/labels";
import { resolveOfferPeriod } from "@/lib/offers/period";
import { getOfferRuleDetail } from "@/db/offers";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MobileCard,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/patterns/mobile-card-list";

import { OffersChart } from "../offers-chart";
import { PeriodTabs } from "../period-tabs";

export const dynamic = "force-dynamic";

/*
 * Detalj jednog pravila ponude: uslovi iz plugina (kako su zapisani), cena u
 * ponudi, cifre perioda, podela po mestu prikaza i dnevna serija.
 *
 * Pravilo je „ogledalo" plugina — ovde se ništa ne uređuje; izmene idu na sajtu
 * i stignu sledećom sinhronizacijom.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="text-ink mt-1 text-sm break-words">{children}</div>
    </div>
  );
}

export default async function PonudaDetaljPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "manager");

  const { id } = await params;
  const ruleId = decodeURIComponent(id);
  const period = resolveOfferPeriod(await searchParams);

  const detail = await getOfferRuleDetail(ruleId, period);
  if (!detail) notFound();

  const { rule, stats, placements, daily } = detail;
  const title = rule?.name ?? ruleId;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Link
        href={`/ponude?dana=${period.days}`}
        className="text-ink-soft hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" /> Ponude
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="eyebrow">Pravilo ponude</div>
          <h1 className="text-ink text-xl font-bold break-words">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rule ? (
            <Badge variant={rule.active ? "success" : "warning"}>
              {rule.active ? "Aktivno" : "Pauzirano"}
            </Badge>
          ) : (
            <Badge variant="warning">Pravila više nema u pluginu</Badge>
          )}
          <PeriodTabs active={period.days} basePath={`/ponude/${encodeURIComponent(ruleId)}`} />
        </div>
      </div>

      {/* Cifre perioda */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Prikazi" value={num(stats.impressions)} />
        <Kpi label="Dodato" value={num(stats.adds)} />
        <Kpi label="Stopa dodavanja" value={rate(stats.add_rate)} hint="dodato / prikazi" />
        <Kpi label="Porudžbine" value={num(stats.orders)} hint="bez otkazanih" />
        <Kpi label="Prihod" value={rsd(Math.round(stats.revenue))} />
      </div>

      {/* Podaci iz plugina */}
      {rule ? (
        <div className="border-border bg-surface shadow-soft mb-6 space-y-4 rounded-lg border px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ponuđeni proizvod">
              {rule.offer_name ?? "—"}
              {rule.offer_sku ? <span className="text-ink-faint"> · {rule.offer_sku}</span> : null}
            </Field>
            <Field label="Cena u ponudi">{rule.price_rule ?? "—"}</Field>
            <Field label="Mesta prikaza">
              {rule.placements.length > 0 ? rule.placements.map(placementLabel).join(" · ") : "—"}
            </Field>
            <Field label="Prioritet">
              <span className="num">{rule.priority}</span>
            </Field>
          </div>

          <div>
            <div className="eyebrow mb-1">Uslovi</div>
            <pre className="border-border bg-surface-2 text-ink overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {rule.conditions?.trim() || "—"}
            </pre>
          </div>

          {rule.wp_updated_at ? (
            <p className="text-ink-faint text-xs">
              Izmenjeno na sajtu: {datumVreme(rule.wp_updated_at)}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border-border bg-surface-2 text-ink-soft mb-6 rounded-lg border border-dashed px-4 py-3 text-sm">
          Ovo pravilo više ne postoji u pluginu, pa se njegovi podaci (uslovi, cena, mesta) ne mogu
          prikazati. Istorija događaja je sačuvana.
        </div>
      )}

      {/* Podela po mestu prikaza */}
      <h2 className="text-ink mb-3 font-semibold">Po mestu prikaza</h2>
      {placements.length === 0 ? (
        <p className="text-ink-soft mb-6 text-sm">Nema događaja za ovaj period.</p>
      ) : (
        <>
          <div className="border-border bg-surface shadow-soft mb-6 hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mesto</TableHead>
                  <TableHead className="text-right">Prikazi</TableHead>
                  <TableHead className="text-right">Dodato</TableHead>
                  <TableHead className="text-right">Stopa</TableHead>
                  <TableHead className="text-right">Porudžbine</TableHead>
                  <TableHead className="text-right">Prihod</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {placements.map((p) => (
                  <TableRow key={p.placement}>
                    <TableCell className="text-ink font-medium">
                      {placementLabel(p.placement)}
                    </TableCell>
                    <TableCell className="num text-right">{num(p.impressions)}</TableCell>
                    <TableCell className="num text-right">{num(p.adds)}</TableCell>
                    <TableCell className="num text-right">
                      {rate(p.impressions === 0 ? 0 : p.adds / p.impressions)}
                    </TableCell>
                    <TableCell className="num text-right">{num(p.orders)}</TableCell>
                    <TableCell className="num text-ink text-right font-semibold">
                      {rsd(Math.round(p.revenue))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCardList className="mb-6">
            {placements.map((p) => (
              <MobileCard key={p.placement}>
                <MobileCardHeader title={placementLabel(p.placement)} />
                <div className="mt-3 space-y-1.5">
                  <MobileCardField label="Prikazi">
                    <span className="num">{num(p.impressions)}</span>
                  </MobileCardField>
                  <MobileCardField label="Dodato">
                    <span className="num">
                      {num(p.adds)}{" "}
                      <span className="text-ink-faint">
                        ({rate(p.impressions === 0 ? 0 : p.adds / p.impressions)})
                      </span>
                    </span>
                  </MobileCardField>
                  <MobileCardField label="Porudžbine">
                    <span className="num">{num(p.orders)}</span>
                  </MobileCardField>
                  <MobileCardField label="Prihod">
                    <span className="num font-semibold">{rsd(Math.round(p.revenue))}</span>
                  </MobileCardField>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}

      {/* Dnevna serija */}
      <h2 className="text-ink mb-3 font-semibold">Po danima</h2>
      <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-4">
        <OffersChart daily={daily} period={period} />
      </div>
    </main>
  );
}
