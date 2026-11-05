import type { PdvTurnover } from "@/db/pdv";
import { datum, rsd } from "@/lib/format";
import { PDV_THRESHOLD_RSD, PDV_WARN_RSD, pdvLevel } from "@/lib/pdv";

/*
 * Kartica „PDV prag" na Dashboardu — promet poslednjih 12 meseci (klizno) prema
 * pragu od 8M RSD, sa oznakom upozorenja na 7,5M. Nezavisna od filtera perioda.
 * Glavna traka prati cifru koja se poredi sa pragom (stvaran promet u prozoru);
 * dok istorija nema punu godinu, ispod stoji i procena na 12 meseci.
 */

const TONE = {
  ok: { bar: "bg-green", text: "text-ink", badge: "bg-green-soft text-green-deep", label: "Ispod praga" },
  warn: { bar: "bg-warning", text: "text-warning", badge: "bg-warning-soft text-warning", label: "Blizu praga" },
  over: { bar: "bg-danger", text: "text-danger", badge: "bg-danger-soft text-danger", label: "Preko praga" },
} as const;

function pct(n: number): number {
  return Math.min(100, Math.max(0, (n / PDV_THRESHOLD_RSD) * 100));
}

export function PdvCard({ data }: { data: PdvTurnover }) {
  // Nivo se računa po najgoroj od cifara: stvaran promet ili procena na godinu.
  const projected = Math.max(data.total, data.annualized ?? 0, data.pace90);
  const level = pdvLevel(projected);
  const tone = TONE[level];
  const room = PDV_THRESHOLD_RSD - data.total;

  return (
    <section className="border-border bg-surface shadow-soft mb-6 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="eyebrow">PDV prag · poslednjih 12 meseci</div>
          <div className={"num mt-1 text-2xl font-bold " + tone.text}>
            {rsd(data.total)} <span className="text-ink-faint text-sm font-medium">/ {rsd(PDV_THRESHOLD_RSD)}</span>
          </div>
        </div>
        <span className={"rounded px-2 py-0.5 text-xs font-semibold " + tone.badge}>{tone.label}</span>
      </div>

      <div
        className="bg-surface-2 relative mt-3 h-2.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={PDV_THRESHOLD_RSD}
        aria-valuenow={data.total}
        aria-label="Promet u odnosu na PDV prag"
      >
        <div className={"h-full rounded-full " + tone.bar} style={{ width: `${pct(data.total)}%` }} />
        <div
          className="bg-ink-faint absolute top-0 h-full w-px"
          style={{ left: `${pct(PDV_WARN_RSD)}%` }}
          title={`Upozorenje: ${rsd(PDV_WARN_RSD)}`}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-ink-faint">Roba</dt>
          <dd className="num text-ink font-semibold">{rsd(data.goods)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">Naplaćena poštarina</dt>
          <dd className="num text-ink font-semibold">{rsd(data.shipping)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{data.annualized !== null ? "Procena za 12 meseci" : "Do praga"}</dt>
          <dd className="num text-ink font-semibold">
            {data.annualized !== null ? rsd(data.annualized) : room > 0 ? rsd(room) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">Tempo poslednjih 90 dana</dt>
          <dd className="num text-ink font-semibold">{rsd(data.pace90)} / god</dd>
        </div>
      </dl>

      <p className="text-ink-soft mt-3 text-xs">
        Prozor {datum(data.from)} – {datum(data.to)}
        {data.annualized !== null ? ` (${data.daysCovered} dana podataka — procena je preračun na godinu)` : ""}.
        Bez otkazanih i vraćenih. Poštarina koju kupac plaća direktno kuriru ne ulazi u promet.
        {level === "warn" ? " Blizu praga: smanji reklame ili preusmeri deo porudžbina." : ""}
        {level === "over" ? " Procena je preko praga — sa sopstvenom firmom ovo znači ulazak u PDV." : ""}
      </p>
    </section>
  );
}
