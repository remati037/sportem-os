"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ExternalLink, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import {
  mpForTarget,
  pct,
  shopPrice,
  simulate,
  type RacunicaRow,
  type RacunicaVariant,
} from "@/lib/racunica";
import { Button } from "@/components/ui/button";
import { AskAssistantButton } from "@/app/(app)/asistent/ask-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/*
 * Računica P4 — kalkulator „šta ako". SAMO RAČUNA, NIŠTA NE UPISUJE (odluka D11):
 * cena se i dalje menja u Katalogu, a WooCommerce ručno. Radi na nivou
 * VARIJANTE (cena živi tamo); sa reda proizvoda se bira varijanta, podrazumevano
 * najprodavanija. Sve u celim RSD (§5).
 */

export type CalcTarget = { row: RacunicaRow; sku: string | null };

/** Aktivne varijante sa cenom (van kataloga nema cenu → nema simulacije). */
export function priceableVariants(row: RacunicaRow): RacunicaVariant[] {
  return row.variants.filter((v) => !v.archived && v.mp != null && v.vp != null);
}

export function canSimulate(row: RacunicaRow): boolean {
  return priceableVariants(row).length > 0;
}

type Period = { from: string; to: string };

export function PriceCalculator({
  target,
  onClose,
  goal,
  period,
  askEnabled,
}: {
  target: CalcTarget | null;
  onClose: () => void;
  goal: number;
  period: Period;
  askEnabled: boolean;
}) {
  return (
    <Sheet open={target != null} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="responsive" className="max-h-[92dvh] overflow-y-auto md:max-h-none">
        {target ? (
          <CalculatorBody target={target} goal={goal} period={period} askEnabled={askEnabled} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CalculatorBody({
  target,
  goal,
  period,
  askEnabled,
}: {
  target: CalcTarget;
  goal: number;
  period: Period;
  askEnabled: boolean;
}) {
  const variants = priceableVariants(target.row);
  const initial =
    variants.find((v) => v.sku === target.sku) ??
    [...variants].sort((a, b) => b.stats.qty - a.stats.qty)[0];
  const [sku, setSku] = useState(initial?.sku ?? "");
  const variant = variants.find((v) => v.sku === sku) ?? initial;

  return (
    <>
      <SheetHeader className="pr-8">
        <SheetTitle className="break-words">Šta ako — {target.row.name}</SheetTitle>
        <SheetDescription>
          Samo računa, ništa ne upisuje. Cenu menjaš u Katalogu, a na sajtu ručno.
        </SheetDescription>
      </SheetHeader>

      {variants.length > 1 ? (
        <Select value={sku} onValueChange={setSku}>
          <SelectTrigger className="h-10 w-full" aria-label="Varijanta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.sku} value={v.sku}>
                {v.label === "—" ? v.sku : `${v.label} · ${v.sku}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {/* Ključ po SKU: promena varijante vraća polja na njene cene. */}
      {variant ? (
        <Form
          key={variant.sku}
          variant={variant}
          productName={target.row.name}
          productId={target.row.productId}
          goal={goal}
          period={period}
          askEnabled={askEnabled}
        />
      ) : null}
    </>
  );
}

/** „4.290", „4290 RSD" → 4290; prazno/neispravno → null. */
function parseRsd(s: string): number | null {
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

function Form({
  variant,
  productName,
  productId,
  goal,
  period,
  askEnabled,
}: {
  variant: RacunicaVariant;
  productName: string;
  productId: string | null;
  goal: number;
  period: Period;
  askEnabled: boolean;
}) {
  const mp = variant.mp ?? 0;
  const vp = variant.vp ?? 0;
  const [mpText, setMpText] = useState(String(mp));
  const [discText, setDiscText] = useState("0");
  const [vpText, setVpText] = useState(String(vp));

  const newMp = parseRsd(mpText) ?? mp;
  const newVp = parseRsd(vpText) ?? vp;
  const sim = simulate({
    mp,
    vp,
    newMp,
    newVp,
    qty: variant.stats.qty,
  });
  const exact = mpForTarget(newVp, goal);
  const rounded = exact != null ? shopPrice(exact) : null;

  function onMp(text: string) {
    setMpText(text);
    const n = parseRsd(text);
    if (n != null && mp > 0) setDiscText(formatDisc((1 - n / mp) * 100));
  }
  function onDisc(text: string) {
    setDiscText(text);
    const d = Number(text.replace(",", "."));
    if (Number.isFinite(d) && d > -100 && d < 100) setMpText(String(Math.round(mp * (1 - d / 100))));
  }
  function setMp(n: number) {
    onMp(String(n));
  }
  function reset() {
    setMpText(String(mp));
    setDiscText("0");
    setVpText(String(vp));
  }

  return (
    <div className="space-y-5">
      <section className="bg-surface-2 border-border rounded-lg border p-3 text-sm">
        <div className="eyebrow mb-2">Sada (katalog)</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <Row label="MP">{rsd(mp)}</Row>
          <Row label="VP">{rsd(vp)}</Row>
          <Row label="Marža po komadu">{rsd(sim.currentPerUnit)}</Row>
          <Row label="Marža %">{pct(sim.currentMarginPct)}</Row>
          <Row label="Prodato u periodu">{num(variant.stats.qty)} kom</Row>
          <Row label="Stvarna zarada">{rsd(variant.stats.profit)}</Row>
        </dl>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Field label="Nova MP (RSD)">
          <Input value={mpText} onChange={(e) => onMp(e.target.value)} inputMode="numeric" className="num text-right" />
        </Field>
        <Field label="Popust od MP (%)">
          <Input value={discText} onChange={(e) => onDisc(e.target.value)} inputMode="decimal" className="num text-right" />
        </Field>
        <Field label="Nova VP (RSD)" hint="npr. posle pregovora sa drugom">
          <Input value={vpText} onChange={(e) => setVpText(e.target.value)} inputMode="numeric" className="num text-right" />
        </Field>
        <div className="flex items-end">
          <Button variant="ghost" size="sm" onClick={reset} className="w-full">
            <RotateCcw /> Vrati na sadašnje
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="eyebrow">Posle promene</div>
        <div className="grid grid-cols-2 gap-3">
          <Result label="Marža po komadu" value={rsd(sim.profitPerUnit)} delta={sim.deltaPerUnit} fmt={(n) => rsd(Math.abs(n))} />
          <Result
            label="Marža %"
            value={pct(sim.marginPct)}
            delta={sim.deltaMarginPp}
            fmt={(n) => `${num(Math.round(Math.abs(n) * 10) / 10)} p.p.`}
            low={sim.marginPct != null && sim.marginPct < goal}
          />
        </div>

        {sim.profitPerUnit <= 0 ? (
          <p className="bg-danger-soft text-danger flex items-start gap-2 rounded-md p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Po ovoj ceni se prodaje {sim.profitPerUnit < 0 ? "sa gubitkom" : "bez zarade"} (
            {rsd(sim.profitPerUnit)} po komadu).
          </p>
        ) : (
          <div className="border-border space-y-1.5 rounded-md border p-3 text-sm">
            <div className="text-ink font-medium">Prag isplativosti</div>
            {sim.extraQtyPct != null && Math.abs(sim.extraQtyPct) >= 0.05 ? (
              <p className="text-ink-soft">
                Za istu zaradu treba prodati{" "}
                <b className={cn("num", sim.extraQtyPct > 0 ? "text-warning" : "text-success")}>
                  {num(Math.round(Math.abs(sim.extraQtyPct) * 10) / 10)} %
                </b>{" "}
                komada {sim.extraQtyPct > 0 ? "više" : "manje"}.
              </p>
            ) : (
              <p className="text-ink-soft">Zarada po komadu je ista kao sada.</p>
            )}
          </div>
        )}

        {variant.stats.qty > 0 ? (
          <p className="text-ink-soft text-sm">
            Na <span className="num">{num(variant.stats.qty)}</span> kom iz perioda: zarada{" "}
            <span className="num">{rsd(sim.periodNow)}</span> po sadašnjoj ceni →{" "}
            <b className={cn("num", sim.periodNew < sim.periodNow ? "text-danger" : "text-ink")}>
              {rsd(sim.periodNew)}
            </b>{" "}
            po novoj (pre popusta u porudžbinama).
          </p>
        ) : (
          <p className="text-ink-faint text-xs">U izabranom periodu nije bilo prodaje.</p>
        )}
      </section>

      {exact != null && rounded != null ? (
        <section className="border-border rounded-md border p-3 text-sm">
          <div className="text-ink font-medium">
            MP za ciljnu maržu <span className="num">{num(goal)}</span> %
          </div>
          <p className="text-ink-soft mt-1">
            Uz VP <span className="num">{rsd(newVp)}</span>: tačno{" "}
            <span className="num">{rsd(exact)}</span>, kao cena na sajtu{" "}
            <b className="num text-ink">{rsd(rounded)}</b>{" "}
            <span className="text-ink-faint">({pct(((rounded - newVp) / rounded) * 100)})</span>.
          </p>
          <Button variant="subtle" size="sm" className="mt-2" onClick={() => setMp(rounded)}>
            Isprobaj {rsd(rounded)}
          </Button>
        </section>
      ) : null}

      <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-3">
        {askEnabled ? (
          <AskAssistantButton
            question={askQuestion({ productName, variant, newMp, newVp, goal, period })}
          />
        ) : null}
        {productId ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/katalog/${productId}`}>
              <ExternalLink /> Otvori u Katalogu
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Pitanje za Asistenta sa svim brojevima iz kalkulatora (samo se pred-popuni). */
function askQuestion({
  productName,
  variant,
  newMp,
  newVp,
  goal,
  period,
}: {
  productName: string;
  variant: RacunicaVariant;
  newMp: number;
  newVp: number;
  goal: number;
  period: Period;
}): string {
  const name = variant.label === "—" ? productName : `${productName} · ${variant.label}`;
  const changed = newMp !== variant.mp || newVp !== variant.vp;
  return [
    `Artikal ${name} (SKU ${variant.sku}): sada MP ${num(variant.mp ?? 0)} RSD, VP ${num(variant.vp ?? 0)} RSD.`,
    changed ? `Razmišljam o MP ${num(newMp)} RSD i VP ${num(newVp)} RSD.` : null,
    `Ciljna marža ${goal} %, period ${period.from} – ${period.to}.`,
    changed
      ? "Da li se ta promena isplati, s obzirom na prodaju, trend i ostale artikle iz Računice?"
      : "Da li treba menjati cenu, s obzirom na prodaju, trend i ostale artikle iz Računice?",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatDisc(d: number): string {
  if (!Number.isFinite(d)) return "";
  const r = Math.round(d * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r).replace(".", ",");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="num text-ink text-right font-medium">{children}</dd>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-ink-soft text-xs">{label}</span>
      {children}
      {hint ? <span className="text-ink-faint block text-xs">{hint}</span> : null}
    </label>
  );
}

function Result({
  label,
  value,
  delta,
  fmt,
  low,
}: {
  label: string;
  value: string;
  delta: number | null;
  fmt: (n: number) => string;
  low?: boolean;
}) {
  const up = delta != null && delta > 0.0001;
  const down = delta != null && delta < -0.0001;
  return (
    <div className="border-border rounded-md border p-3">
      <div className="text-ink-soft text-xs">{label}</div>
      <div className={cn("num text-xl font-bold", low ? "text-danger" : "text-ink")}>{value}</div>
      <div
        className={cn(
          "num inline-flex items-center gap-0.5 text-xs",
          up && "text-success",
          down && "text-danger",
          !up && !down && "text-ink-faint",
        )}
      >
        {up ? <ArrowUpRight className="size-3.5" aria-label="više" /> : null}
        {down ? <ArrowDownRight className="size-3.5" aria-label="manje" /> : null}
        {up || down ? `${up ? "+" : "−"}${fmt(delta!)} prema sada` : "isto kao sada"}
      </div>
    </div>
  );
}
