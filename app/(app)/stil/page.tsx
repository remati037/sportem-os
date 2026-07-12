import type { Metadata } from "next";
import Link from "next/link";
import { rsd, num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";

export const metadata: Metadata = {
  title: "Sportem — Dizajn sistem",
  description: "Vizuelna potvrda brend tokena i komponenti (Korak 0.2 / 0.3)",
};

/* Pomoćni prikazi (samo za ovu test stranicu) --------------------------- */

function Swatch({ name, varName, hex }: { name: string; varName: string; hex: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="border-border h-10 w-10 shrink-0 rounded-md border"
        style={{ background: `var(${varName})` }}
      />
      <div className="min-w-0">
        <div className="text-ink truncate text-sm font-medium">{name}</div>
        <div className="text-ink-faint num font-mono text-xs">{hex}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-ink text-[1.375rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/* Demo podaci za tabelu ------------------------------------------------- */

const rows = [
  { sku: "SM021-4", naziv: "Rukavice za trening — M", mp: 2490, vp: 1450, stanje: 24 },
  { sku: "SM021-5", naziv: "Rukavice za trening — L", mp: 2490, vp: 1450, stanje: 3 },
  { sku: "PT100", naziv: "Protein 1kg — čokolada", mp: 3990, vp: 2600, stanje: 0 },
];

function stanjeBadge(n: number, prag = 5) {
  if (n === 0) return <Badge variant="danger">Nema</Badge>;
  if (n <= prag) return <Badge variant="warning">Pri kraju</Badge>;
  return <Badge variant="success">Na stanju</Badge>;
}

/* Stranica -------------------------------------------------------------- */

export default function StilPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-6 py-12">
      <header className="space-y-2">
        <div className="eyebrow">Korak 0.2 · Dizajn sistem</div>
        <h1 className="text-ink text-[1.75rem] font-bold">Sportem — tokeni i komponente</h1>
        <p className="text-ink-soft text-[0.9375rem]">
          Vizuelna potvrda: light · clean · premium. Zelena = akcija; brojevi tabularni i desno
          poravnati.
        </p>
        <Button asChild variant="subtle" size="sm">
          <Link href="/stil/komponente">Interaktivne komponente (0.3) →</Link>
        </Button>
      </header>

      {/* Paleta */}
      <Section title="Paleta boja">
        <div className="space-y-6">
          <div>
            <div className="eyebrow mb-3">Neutralni</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Swatch name="paper" varName="--paper" hex="#F5F7F5" />
              <Swatch name="surface" varName="--surface" hex="#FFFFFF" />
              <Swatch name="surface-2" varName="--surface-2" hex="#FAFBFA" />
              <Swatch name="ink" varName="--ink" hex="#15211B" />
              <Swatch name="ink-soft" varName="--ink-soft" hex="#5A6B62" />
              <Swatch name="ink-faint" varName="--ink-faint" hex="#8A988F" />
              <Swatch name="border" varName="--border" hex="#E4E9E5" />
              <Swatch name="border-strong" varName="--border-strong" hex="#D2DAD4" />
            </div>
          </div>
          <div>
            <div className="eyebrow mb-3">Brend zelena</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Swatch name="green" varName="--green" hex="#1B7A45" />
              <Swatch name="green-deep" varName="--green-deep" hex="#145C34" />
              <Swatch name="green-bright" varName="--green-bright" hex="#2E9E5B" />
              <Swatch name="green-soft" varName="--green-soft" hex="#E7F2EB" />
            </div>
          </div>
          <div>
            <div className="eyebrow mb-3">Statusi (jaka / soft)</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Swatch name="info" varName="--info" hex="#3D6B8C" />
              <Swatch name="sent" varName="--sent" hex="#0E7C86" />
              <Swatch name="success" varName="--success" hex="#1B7A45" />
              <Swatch name="warning" varName="--warning" hex="#A86A12" />
              <Swatch name="danger" varName="--danger" hex="#B23B30" />
              <Swatch name="info-soft" varName="--info-soft" hex="#E9EFF4" />
              <Swatch name="sent-soft" varName="--sent-soft" hex="#E1F1F2" />
              <Swatch name="success-soft" varName="--success-soft" hex="#E7F2EB" />
              <Swatch name="warning-soft" varName="--warning-soft" hex="#FBF1DD" />
              <Swatch name="danger-soft" varName="--danger-soft" hex="#FBEAE8" />
            </div>
          </div>
        </div>
      </Section>

      {/* Tipografija */}
      <Section title="Tipografija">
        <Card className="gap-3 p-5">
          <div className="num text-ink text-[2.25rem] leading-[1.1] font-bold">
            display — {rsd(128500)}
          </div>
          <div className="text-ink text-[1.75rem] font-bold">h1 — Naslov ekrana</div>
          <div className="text-ink text-[1.375rem] font-semibold">h2 — Sekcija</div>
          <div className="text-ink text-[1.125rem] font-semibold">h3 — Podsekcija</div>
          <div className="text-ink text-[0.9375rem]">
            body — osnovni tekst, tabele i opisi (čćšžđ radi ispravno).
          </div>
          <div className="text-ink text-[0.8125rem] font-medium">label — labela forme</div>
          <div className="text-ink-faint text-xs font-medium">caption — pomoćni tekst</div>
          <div className="eyebrow">eyebrow — nadnaslov</div>
          <div className="text-ink-soft font-mono text-sm">mono — SKU / ID: SM021-4</div>
        </Card>
      </Section>

      {/* Dugmad */}
      <Section title="Dugmad">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Sačuvaj</Button>
          <Button variant="dark">Detalji</Button>
          <Button variant="ghost">Otkaži</Button>
          <Button variant="subtle">Označi za slanje</Button>
          <Button variant="danger">Obriši</Button>
          <Button disabled>Onemogućeno</Button>
        </div>
      </Section>

      {/* Kartice / stat */}
      <Section title="Kartice i stat kartice">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="gap-1 p-5">
            <div className="eyebrow">Zarada (nedelja)</div>
            <div className="stat-value text-ink text-[2.25rem] leading-[1.1] font-bold">
              {rsd(184300)}
            </div>
            <div className="text-success text-sm font-medium">▲ 12% u odnosu na prošlu</div>
          </Card>
          <Card className="gap-1 p-5">
            <div className="eyebrow">Neto profit</div>
            <div className="stat-value text-ink text-[2.25rem] leading-[1.1] font-bold">
              {rsd(96750)}
            </div>
            <div className="text-danger text-sm font-medium">▼ 4% u odnosu na prošlu</div>
          </Card>
          <Card className="gap-1 p-5">
            <div className="eyebrow">Porudžbine</div>
            <div className="stat-value text-ink text-[2.25rem] leading-[1.1] font-bold">
              {num(37)}
            </div>
            <div className="text-ink-soft text-sm">prosečna marža 41%</div>
          </Card>
        </div>
      </Section>

      {/* Status pilule */}
      <Section title="Status pilule (Badge)">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Kreirano</Badge>
            <Badge variant="sent">Poslato</Badge>
            <Badge variant="success">Isporučeno</Badge>
            <Badge variant="danger">Otkazano</Badge>
            <Badge variant="warning">Vraćeno</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">Uplaćeno</Badge>
            <Badge variant="warning">Neuplaćeno</Badge>
            <Badge variant="success">Keš / Isplaćeno</Badge>
            <Badge variant="warning">Treba VP</Badge>
          </div>
        </div>
      </Section>

      {/* Input / Select */}
      <Section title="Input i Select">
        <div className="grid max-w-md gap-4">
          <div className="space-y-1.5">
            <label htmlFor="naziv" className="text-ink block text-[0.8125rem] font-medium">
              Naziv proizvoda
            </label>
            <Input id="naziv" placeholder="npr. Rukavice za trening" />
            <p className="text-ink-faint text-xs">Fokusiraj (Tab) da vidiš zeleni prsten.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="sku" className="text-ink block text-[0.8125rem] font-medium">
              SKU
            </label>
            <Input id="sku" aria-invalid placeholder="SM021-4" />
            <p className="text-danger text-xs">SKU je obavezan.</p>
          </div>
        </div>
      </Section>

      {/* Tabela */}
      <Section title="Tabela (katalog)">
        <div className="border-border bg-surface shadow-soft overflow-hidden rounded-lg border">
          <div className="max-h-80 overflow-auto">
            <table className="w-full border-collapse text-[0.9375rem]">
              <thead className="bg-surface-2 sticky top-0 z-10">
                <tr>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-left">SKU</th>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-left">Naziv</th>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-right">MP</th>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-right">VP</th>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-right">Zarada</th>
                  <th className="eyebrow border-border border-b px-4 py-2.5 text-right">Stanje</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const selected = i === 0;
                  return (
                    <tr
                      key={r.sku}
                      className={
                        "border-border hover:bg-green-soft border-b transition-colors " +
                        (selected ? "bg-green-soft relative" : "")
                      }
                    >
                      <td className="text-ink-soft relative px-4 py-2.5 font-mono text-sm">
                        {selected && (
                          <span className="bg-green absolute top-0 bottom-0 left-0 w-[3px]" />
                        )}
                        {r.sku}
                      </td>
                      <td className="text-ink px-4 py-2.5">{r.naziv}</td>
                      <td className="num text-ink px-4 py-2.5 text-right">{rsd(r.mp)}</td>
                      <td className="num text-ink-soft px-4 py-2.5 text-right">{rsd(r.vp)}</td>
                      <td className="num text-success px-4 py-2.5 text-right font-medium">
                        {rsd(r.mp - r.vp)}
                      </td>
                      <td className="px-4 py-2.5 text-right">{stanjeBadge(r.stanje)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Prazno stanje */}
        <div className="mt-4">
          <EmptyState title="Nema porudžbina za ovaj period." />
        </div>
      </Section>
    </main>
  );
}
