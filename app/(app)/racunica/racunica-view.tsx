"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { num, rsd } from "@/lib/format";
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import {
  DEFAULT_DEAD_DAYS,
  DEAD_DAYS_OPTIONS,
  QUADRANTS,
  VIEW_KEYS,
  SOON_DAYS,
  classifyAbc,
  rowDaysToZero,
  isQuadrant,
  medianQty,
  quadrantOf,
  type AbcClass,
  type Quadrant,
  type ViewKey,
  DEFAULT_SORT,
  DEFAULT_TARGET_PCT,
  RACUNICA_SORTS,
  avgPrice,
  cancelRatePct,
  catalogMarginOf,
  compareRows,
  discountPct,
  effectiveMarginPct,
  hasActivity,
  isRacunicaSort,
  normText,
  pct,
  profitPerUnit,
  realMarginPct,
  type RacunicaData,
  type RacunicaRow,
  type RacunicaSort,
  type RacunicaVariant,
} from "@/lib/racunica";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { daysToZero, forecastQty, trendOf } from "@/lib/sales-velocity";

import { PriceCalculator, canSimulate, type CalcTarget } from "./kalkulator";
import { RacunicaAi, type AiState } from "./analiza";
import { DaysToZero, MonthForecastCard, TrendValue, forecastLabel } from "./prognoza";
import { ABC_VARIANT, AbcCard, DeadStockCard, MatrixCard, ViewToggles } from "./razvrstavanje";

/*
 * Računica — prikaz (P1). Podaci za ceo period stižu jednom sa servera; pretraga,
 * filteri, sortiranje i otvorene varijante rade se ovde i upisuju u URL kroz
 * history.replaceState (deljiv link, bez ponovnog učitavanja podataka).
 * URL: ?q=&kategorija=&brend=&cilj=30&ispod=1&prodaja=sa|bez&arhiva=1&sort=&smer=
 *      &pogledi=abc,matrica,mrtva&abc=A|B|C&kvadrant=…&mrtva=60|90   (P2)
 *      &trend=raste|pada|nestaje                                        (P3)
 * Pogledi (ABC / Matrica / Mrtva roba): URL ima prednost, pa izbor sa ovog
 * uređaja (localStorage), pa svi uključeni.
 */

type SalesFilter = "" | "sa" | "bez";
type TrendFilter = "" | "raste" | "pada" | "nestaje";
type Dir = "asc" | "desc";

type State = {
  q: string;
  kategorija: string;
  brend: string;
  cilj: number;
  ispod: boolean;
  prodaja: SalesFilter;
  trend: TrendFilter;
  arhiva: boolean;
  sort: RacunicaSort;
  smer: Dir;
  /** null = nije zadato u URL-u (važi izbor sa uređaja ili svi). */
  views: ViewKey[] | null;
  abc: AbcClass | "";
  kvadrant: Quadrant | "";
  mrtva: number;
};

const VIEWS_STORAGE_KEY = "sportem.racunica.pogledi";
const NO_VIEWS = "-";

function parseViews(raw: string | null): ViewKey[] | null {
  if (raw == null) return null;
  if (raw === NO_VIEWS) return [];
  const list = raw.split(",").filter((v): v is ViewKey => (VIEW_KEYS as string[]).includes(v));
  return list.length > 0 ? list : null;
}

const serializeViews = (v: ViewKey[]) =>
  v.length === 0 ? NO_VIEWS : VIEW_KEYS.filter((k) => v.includes(k)).join(",");

function readStoredViews(): string | null {
  try {
    return window.localStorage.getItem(VIEWS_STORAGE_KEY);
  } catch {
    return null; // privatni prozor / blokiran storage — svi pogledi
  }
}

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

const ALL = "__sve";

function readState(params: URLSearchParams): State {
  const cilj = Number(params.get("cilj"));
  const prodaja = params.get("prodaja");
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    kategorija: params.get("kategorija") ?? "",
    brend: params.get("brend") ?? "",
    cilj: Number.isFinite(cilj) && cilj > 0 && cilj < 100 ? cilj : DEFAULT_TARGET_PCT,
    ispod: params.get("ispod") === "1",
    prodaja: prodaja === "sa" || prodaja === "bez" ? prodaja : "",
    trend: (["raste", "pada", "nestaje"] as const).find((t) => t === params.get("trend")) ?? "",
    arhiva: params.get("arhiva") === "1",
    sort: isRacunicaSort(sort) ? sort : DEFAULT_SORT,
    smer: params.get("smer") === "asc" ? "asc" : "desc",
    views: parseViews(params.get("pogledi")),
    abc: (["A", "B", "C"] as const).find((c) => c === params.get("abc")) ?? "",
    kvadrant: isQuadrant(params.get("kvadrant")) ? (params.get("kvadrant") as Quadrant) : "",
    mrtva: (DEAD_DAYS_OPTIONS as readonly number[]).includes(Number(params.get("mrtva")))
      ? Number(params.get("mrtva"))
      : DEFAULT_DEAD_DAYS,
  };
}

/** Upis stanja u URL (podrazumevane vrednosti se izostavljaju; od/do ostaju). */
function writeState(pathname: string, current: URLSearchParams, s: State) {
  const sp = new URLSearchParams();
  for (const k of ["od", "do"]) {
    const v = current.get(k);
    if (v) sp.set(k, v);
  }
  if (s.q.trim()) sp.set("q", s.q.trim());
  if (s.kategorija) sp.set("kategorija", s.kategorija);
  if (s.brend) sp.set("brend", s.brend);
  if (s.cilj !== DEFAULT_TARGET_PCT) sp.set("cilj", String(s.cilj));
  if (s.ispod) sp.set("ispod", "1");
  if (s.prodaja) sp.set("prodaja", s.prodaja);
  if (s.trend) sp.set("trend", s.trend);
  if (s.arhiva) sp.set("arhiva", "1");
  if (s.sort !== DEFAULT_SORT) sp.set("sort", s.sort);
  if (s.smer !== "desc") sp.set("smer", s.smer);
  if (s.views && s.views.length !== VIEW_KEYS.length) sp.set("pogledi", serializeViews(s.views));
  if (s.abc) sp.set("abc", s.abc);
  if (s.kvadrant) sp.set("kvadrant", s.kvadrant);
  if (s.mrtva !== DEFAULT_DEAD_DAYS) sp.set("mrtva", String(s.mrtva));
  const query = sp.toString();
  const url = query ? `${pathname}?${query}` : pathname;
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, "", url);
  }
}

const variantVisible = (v: RacunicaVariant, arhiva: boolean) =>
  arhiva || !v.archived || hasActivity(v.stats);

export function RacunicaView({
  data,
  periodLabel,
  ai,
}: {
  data: RacunicaData;
  periodLabel: string;
  ai: AiState;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<State>(() => readState(new URLSearchParams(params.toString())));
  const [search, setSearch] = useState(state.q);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [calc, setCalc] = useState<CalcTarget | null>(null);

  const update = useCallback((next: Partial<State>) => setState((s) => ({ ...s, ...next })), []);

  // Pogledi: URL → izbor sa uređaja → svi.
  const storedViews = useSyncExternalStore(subscribeStorage, readStoredViews, () => null);
  const views: ViewKey[] = state.views ?? parseViews(storedViews) ?? VIEW_KEYS;
  const abcOn = views.includes("abc");
  const matrixOn = views.includes("matrica");
  const deadOn = views.includes("mrtva");

  function toggleView(key: ViewKey) {
    const next = views.includes(key) ? views.filter((v) => v !== key) : [...views, key];
    update({
      views: next,
      ...(key === "abc" && !next.includes("abc") ? { abc: "" as const } : {}),
      ...(key === "matrica" && !next.includes("matrica") ? { kvadrant: "" as const } : {}),
    });
    try {
      window.localStorage.setItem(VIEWS_STORAGE_KEY, serializeViews(next));
    } catch {
      /* nije bitno — izbor ostaje u URL-u */
    }
  }

  // Osnovni skup za razvrstavanje: svi redovi perioda po pravilu vidljivosti
  // (arhivirano bez prodaje se ne računa), BEZ filtera tabele — klasa i
  // kvadrant artikla ne smeju da se menjaju kad se suzi pretraga.
  const baseRows = useMemo(
    () => data.rows.filter((r) => !r.archived || hasActivity(r.stats)),
    [data.rows],
  );
  const abcMap = useMemo(() => classifyAbc(baseRows), [baseRows]);
  const median = useMemo(() => medianQty(baseRows), [baseRows]);
  const quadrantFor = useCallback(
    (r: RacunicaRow) => quadrantOf(r, median, state.cilj),
    [median, state.cilj],
  );

  useEffect(() => {
    writeState(pathname, new URLSearchParams(window.location.search), state);
  }, [pathname, state]);

  // Debounce pretrage.
  useEffect(() => {
    if (search === state.q) return;
    const t = setTimeout(() => update({ q: search }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const rows = useMemo(() => {
    const q = normText(state.q.trim());
    const out = data.rows.filter((r) => {
      if (r.archived && !state.arhiva && !hasActivity(r.stats)) return false;
      if (state.kategorija && r.categoryId !== state.kategorija) return false;
      if (state.brend && r.brand !== state.brend) return false;
      if (state.prodaja === "sa" && r.stats.qty === 0) return false;
      if (state.prodaja === "bez" && r.stats.qty > 0) return false;
      if (state.trend === "raste" || state.trend === "pada") {
        const t = trendOf(r.vel);
        const want = state.trend === "raste" ? "up" : "down";
        if (t.dir !== want && !(want === "up" && t.dir === "new")) return false;
      }
      if (state.trend === "nestaje") {
        const d = rowDaysToZero(r);
        if (d == null || d >= SOON_DAYS) return false;
      }
      if (state.ispod) {
        const m = effectiveMarginPct(r);
        if (m == null || m >= state.cilj) return false;
      }
      if (abcOn && state.abc && abcMap.get(r.key) !== state.abc) return false;
      if (matrixOn && state.kvadrant && quadrantFor(r) !== state.kvadrant) return false;
      if (q) {
        const hay = [r.name, r.brand ?? "", ...r.variants.flatMap((v) => [v.sku, v.label])];
        if (!hay.some((h) => normText(h).includes(q))) return false;
      }
      return true;
    });
    out.sort((a, b) => compareRows(a, b, state.sort, state.smer));
    return out;
  }, [data.rows, state, abcOn, matrixOn, abcMap, quadrantFor]);

  const below = useMemo(
    () =>
      data.rows.filter((r) => {
        if (r.archived && !hasActivity(r.stats)) return false; // isto pravilo kao lista
        const m = effectiveMarginPct(r);
        return m != null && m < state.cilj;
      }).length,
    [data.rows, state.cilj],
  );

  const filtered = useMemo(() => {
    let profit = 0;
    let revenue = 0;
    for (const r of rows) {
      profit += r.stats.profit;
      revenue += r.stats.revenue;
    }
    return { profit, revenue };
  }, [rows]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sortBy = (key: RacunicaSort) =>
    update(
      state.sort === key
        ? { smer: state.smer === "desc" ? "asc" : "desc" }
        : { sort: key, smer: key === "naziv" || key === "do_nule" ? "asc" : "desc" },
    );

  function exportCsv() {
    const flat = rows.flatMap((r) =>
      r.variants.filter((v) => variantVisible(v, state.arhiva)).map((v) => ({ r, v })),
    );
    const columns: CsvColumn<{ r: RacunicaRow; v: RacunicaVariant }>[] = [
      { header: "Proizvod", value: ({ r }) => r.name },
      { header: "Varijanta", value: ({ r, v }) => (r.outOfCatalog || v.label === "—" ? "" : v.label) },
      { header: "SKU", value: ({ v }) => v.sku },
      { header: "Naziv u porudžbini", value: ({ r, v }) => (r.outOfCatalog ? v.label : "") },
      { header: "Brend", value: ({ r }) => r.brand },
      { header: "Kategorija", value: ({ r }) => r.categoryName },
      { header: "Katalog MP", value: ({ v }) => v.mp, kind: "rsd" },
      { header: "Katalog VP", value: ({ v }) => v.vp, kind: "rsd" },
      {
        header: "Katalog marža RSD",
        value: ({ v }) => (v.mp != null && v.vp != null ? v.mp - v.vp : null),
        kind: "rsd",
      },
      { header: "Katalog marža %", value: ({ v }) => catalogMarginOf(v.mp, v.vp), kind: "pct" },
      { header: "Prodato kom", value: ({ v }) => v.stats.qty, kind: "int" },
      { header: "Otkazano/vraćeno kom", value: ({ v }) => v.stats.cancelledQty, kind: "int" },
      { header: "Promet", value: ({ v }) => v.stats.revenue, kind: "rsd" },
      { header: "Prosečna prodajna cena", value: ({ v }) => avgPrice(v.stats), kind: "rsd" },
      { header: "Popust vs katalog %", value: ({ v }) => discountPct(v.stats), kind: "pct" },
      { header: "Stvarna zarada", value: ({ v }) => v.stats.profit, kind: "rsd" },
      { header: "Stvarna marža %", value: ({ v }) => realMarginPct(v.stats), kind: "pct" },
      { header: "Zarada po komadu", value: ({ v }) => profitPerUnit(v.stats), kind: "rsd" },
      { header: "Komada bez VP", value: ({ v }) => v.stats.qty - v.stats.knownQty, kind: "int" },
      { header: "Prodato 30 d (od danas)", value: ({ v }) => v.vel.q30, kind: "int" },
      { header: "Prodato prethodnih 30 d", value: ({ v }) => v.vel.qPrev30, kind: "int" },
      {
        header: "Trend %",
        value: ({ v }) => {
          const t = trendOf(v.vel);
          return t.dir === "few" ? "malo podataka" : t.dir === "new" ? "novo" : t.pct;
        },
        kind: "pct",
      },
      {
        header: "Prognoza 30 d kom",
        value: ({ v }) => forecastQty(v.vel).toFixed(1).replace(".", ","),
      },
      {
        header: "Dana do nule",
        value: ({ v }) => {
          const d = daysToZero(v.stock, v.counted, v.vel);
          return d == null ? null : Math.round(d);
        },
        kind: "int",
      },
      { header: "Stanje", value: ({ v }) => v.stock, kind: "int" },
      { header: "Popisano", value: ({ r, v }) => (r.outOfCatalog ? "" : v.counted ? "da" : "ne") },
      {
        header: "Stanje po VP",
        value: ({ v }) => (v.counted && (v.stock ?? 0) > 0 ? (v.stock ?? 0) * (v.vp ?? 0) : null),
        kind: "rsd",
      },
      { header: "Arhivirano", value: ({ v }) => (v.archived ? "da" : "") },
    ];
    if (abcOn) columns.push({ header: "ABC (proizvod)", value: ({ r }) => abcMap.get(r.key) ?? "" });
    if (matrixOn) {
      columns.push({
        header: "Kvadrant (proizvod)",
        value: ({ r }) => {
          const q = quadrantFor(r);
          return q ? (QUADRANTS.find((x) => x.key === q)?.label ?? "") : "";
        },
      });
    }
    if (deadOn) {
      columns.push({ header: "Poslednja prodaja", value: ({ v }) => v.lastSoldDay, kind: "date" });
    }
    downloadCsv(`racunica-${data.from}-${data.to}.csv`, toCsv(columns, flat));
  }

  const t = data.totals;
  const realMargin = t.knownRevenue > 0 ? (t.knownProfit / t.knownRevenue) * 100 : null;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Stvarna zarada"
          value={rsd(t.profit)}
          hint={
            t.unknownQty > 0
              ? `${num(t.unknownQty)} kom bez VP — zarada nepotpuna`
              : `promet ${rsd(t.revenue)}`
          }
          warn={t.unknownQty > 0}
        />
        <Stat
          label="Stvarna marža"
          value={pct(realMargin)}
          hint={`${num(t.qty)} kom prodato`}
          warn={realMargin != null && realMargin < state.cilj}
        />
        <Stat
          label={`Ispod cilja ${num(state.cilj)} %`}
          value={num(below)}
          hint="artikala ispod ciljne marže"
          warn={below > 0}
        />
        <Stat label="Stanje po VP" value={rsd(t.stockValueVp)} hint="roba u magacinu (popisano × VP)" />
      </div>

      <MonthForecastCard month={data.month} />

      <RacunicaAi from={data.from} to={data.to} periodLabel={periodLabel} goal={state.cilj} ai={ai} />

      <ViewToggles views={views} onToggle={toggleView} />

      {abcOn || matrixOn ? (
        <div
          className={cn(
            "mb-6 grid gap-4",
            abcOn && matrixOn && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
          )}
        >
          {matrixOn ? (
            <MatrixCard
              rows={baseRows}
              quadrantOf={quadrantFor}
              median={median}
              target={state.cilj}
              selected={state.kvadrant}
              onSelect={(kvadrant) => update({ kvadrant })}
              onPick={(r) => {
                setSearch(r.name);
                update({ q: r.name, kvadrant: "", abc: "" });
                document.getElementById("racunica-tabela")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          ) : null}
          {abcOn ? (
            <AbcCard
              rows={baseRows}
              abc={abcMap}
              selected={state.abc}
              onSelect={(abc) => update({ abc })}
            />
          ) : null}
        </div>
      ) : null}

      <Toolbar
        state={state}
        search={search}
        setSearch={setSearch}
        update={update}
        categories={data.categories}
        brands={data.brands}
        onExport={exportCsv}
        canExport={rows.length > 0}
      />

      <div
        id="racunica-tabela"
        className="text-ink-soft mb-3 flex scroll-mt-4 flex-wrap items-center gap-x-4 gap-y-1 text-sm"
      >
        <span>
          <span className="num text-ink font-medium">{num(rows.length)}</span> artikala
        </span>
        <span>
          Za ovaj filter: zarada <span className="num text-ink font-medium">{rsd(filtered.profit)}</span>{" "}
          · promet <span className="num">{rsd(filtered.revenue)}</span>
        </span>
        {abcOn && state.abc ? (
          <FilterChip onClear={() => update({ abc: "" })}>ABC: {state.abc}</FilterChip>
        ) : null}
        {matrixOn && state.kvadrant ? (
          <FilterChip onClear={() => update({ kvadrant: "" })}>
            {QUADRANTS.find((q) => q.key === state.kvadrant)?.label}
          </FilterChip>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Calculator />}
          title={
            data.rows.some((r) => hasActivity(r.stats)) || state.q || state.kategorija || state.brend
              ? "Nema artikala za ove filtere"
              : "Nema prodaje u ovom periodu"
          }
          description={`Period: ${periodLabel}.`}
        />
      ) : (
        <>
          <DesktopTable
            rows={rows}
            abcOf={abcOn ? (key) => abcMap.get(key) : undefined}
            state={state}
            open={open}
            toggle={toggle}
            sortBy={sortBy}
            onCalc={setCalc}
          />
          <MobileCards
            rows={rows}
            abcOf={abcOn ? (key) => abcMap.get(key) : undefined}
            state={state}
            open={open}
            toggle={toggle}
            onCalc={setCalc}
          />
        </>
      )}

      <PriceCalculator
        target={calc}
        onClose={() => setCalc(null)}
        goal={state.cilj}
        period={{ from: data.from, to: data.to }}
        askEnabled={ai.ready}
      />

      {deadOn ? (
        <DeadStockCard
          rows={data.rows}
          today={data.today}
          days={state.mrtva}
          onDays={(mrtva) => update({ mrtva })}
        />
      ) : null}

      <div className="text-ink-faint mt-4 space-y-1 text-xs">
        <p>
          <b>Katalog</b> = trenutne cene (MP − VP); <b>stvarno</b> = zamrznute cene iz porudžbina u
          periodu, bez otkazanih i vraćenih. Marža % je od MP cene.
        </p>
        <p>
          Stvarna marža % računa samo stavke sa unetom VP; zarada u RSD broji ih kao 0 (isto kao
          Dashboard). „Ispod cilja“ gleda stvarnu maržu, a katalošku kad nema prodaje.
        </p>
      </div>
    </>
  );
}

/* ───────────────────────── delovi ───────────────────────── */

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="border-green/30 bg-green-soft text-green-deep inline-flex h-7 items-center gap-1 rounded-pill border pr-1 pl-2.5 text-xs font-medium">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Ukloni filter"
        className="hover:bg-green/10 rounded-full p-0.5"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function CalcButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Šta ako — kalkulator cene"
      aria-label="Šta ako — kalkulator cene"
      className="text-ink-faint hover:text-green hover:bg-green-soft rounded p-1 transition-colors"
    >
      <Calculator className="size-3.5" />
    </button>
  );
}

function AbcBadge({ cls }: { cls: AbcClass | undefined }) {
  if (!cls) return null;
  return (
    <Badge variant={ABC_VARIANT[cls]} title={`ABC klasa ${cls}`}>
      {cls}
    </Badge>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="border-border bg-surface shadow-soft min-w-0 rounded-lg border px-4 py-4">
      <div className="eyebrow truncate">{label}</div>
      <div
        className={cn(
          "num mt-1 text-lg leading-tight font-bold sm:text-xl xl:text-2xl",
          warn ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </div>
      {hint ? <p className="text-ink-soft mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

function Toolbar({
  state,
  search,
  setSearch,
  update,
  categories,
  brands,
  onExport,
  canExport,
}: {
  state: State;
  search: string;
  setSearch: (v: string) => void;
  update: (s: Partial<State>) => void;
  categories: { id: string; name: string }[];
  brands: string[];
  onExport: () => void;
  canExport: boolean;
}) {
  const [cilj, setCilj] = useState(String(state.cilj));

  const commitCilj = () => {
    const n = Math.round(Number(cilj.replace(",", ".")));
    if (Number.isFinite(n) && n > 0 && n < 100) update({ cilj: n });
    else setCilj(String(state.cilj));
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Naziv, brend ili SKU…"
          aria-label="Pretraga artikala"
          className="min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto"
        />

        {categories.length > 0 ? (
          <Select
            value={state.kategorija || ALL}
            onValueChange={(v) => update({ kategorija: v === ALL ? "" : v })}
          >
            <SelectTrigger className="h-10 w-44" aria-label="Kategorija">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Sve kategorije</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {brands.length > 0 ? (
          <Select value={state.brend || ALL} onValueChange={(v) => update({ brend: v === ALL ? "" : v })}>
            <SelectTrigger className="h-10 w-40" aria-label="Brend">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Svi brendovi</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={state.prodaja || ALL}
          onValueChange={(v) => update({ prodaja: v === ALL ? "" : (v as SalesFilter) })}
        >
          <SelectTrigger className="h-10 w-40" aria-label="Prodaja">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Sa i bez prodaje</SelectItem>
            <SelectItem value="sa">Sa prodajom</SelectItem>
            <SelectItem value="bez">Bez prodaje</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={state.trend || ALL}
          onValueChange={(v) => update({ trend: v === ALL ? "" : (v as TrendFilter) })}
        >
          <SelectTrigger className="h-10 w-48" aria-label="Trend">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Svaki trend</SelectItem>
            <SelectItem value="raste">Raste (30 vs 30 d)</SelectItem>
            <SelectItem value="pada">Pada (30 vs 30 d)</SelectItem>
            <SelectItem value="nestaje">Nestaje za &lt; {SOON_DAYS} dana</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-ink-soft flex items-center gap-2 text-sm">
          Cilj marže
          <span className="relative">
            <Input
              value={cilj}
              onChange={(e) => setCilj(e.target.value)}
              onBlur={commitCilj}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCilj();
              }}
              inputMode="numeric"
              aria-label="Ciljna marža u procentima"
              className="num h-8 w-16 pr-6 text-right"
            />
            <span className="text-ink-faint pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
              %
            </span>
          </span>
        </label>

        <Check checked={state.ispod} onChange={(v) => update({ ispod: v })}>
          Ispod cilja
        </Check>
        <Check checked={state.arhiva} onChange={(v) => update({ arhiva: v })}>
          Prikaži arhivirane
        </Check>

        <div className="flex items-center gap-1.5 md:hidden">
          <Select value={state.sort} onValueChange={(v) => update({ sort: v as RacunicaSort })}>
            <SelectTrigger className="h-8 w-48" aria-label="Sortiranje">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RACUNICA_SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  Sort: {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => update({ smer: state.smer === "desc" ? "asc" : "desc" })}
            aria-label={state.smer === "desc" ? "Opadajuće" : "Rastuće"}
          >
            {state.smer === "desc" ? <ArrowDown /> : <ArrowUp />}
          </Button>
        </div>

        <Button variant="ghost" size="sm" className="ml-auto" onClick={onExport} disabled={!canExport}>
          <Download /> Izvezi CSV
        </Button>
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-ink flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-green size-4"
      />
      {children}
    </label>
  );
}

/* ── vrednosti ćelija ─────────────────────────────────────────── */

function rangeRsd(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  return min === max ? rsd(min) : `${num(min)}–${rsd(max)}`;
}

/** Stvarna marža sa oznakom ispod cilja (ikona + boja, čitljivo i bez boje). */
function MarginValue({ value, target }: { value: number | null; target: number }) {
  if (value == null) return <span className="text-ink-faint">—</span>;
  const low = value < target;
  return (
    <span
      className={cn("num inline-flex items-center gap-1", low ? "text-danger" : "text-success")}
      title={low ? `Ispod cilja ${num(target)} %` : undefined}
    >
      {low ? <AlertTriangle className="size-3.5" aria-label="Ispod cilja" /> : null}
      {pct(value)}
    </span>
  );
}

function ProfitValue({ stats }: { stats: RacunicaRow["stats"] }) {
  if (!hasActivity(stats)) return <span className="text-ink-faint">—</span>;
  const missing = stats.qty - stats.knownQty;
  return (
    <span className="num" title={missing > 0 ? `${num(missing)} kom bez VP — zarada nepotpuna` : undefined}>
      {rsd(stats.profit)}
      {missing > 0 ? <span className="text-warning">*</span> : null}
    </span>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="text-ink-faint num text-xs">{children}</div>;
}

function StockValue({
  stock,
  uncounted,
  outOfCatalog,
}: {
  stock: number | null;
  uncounted?: number;
  outOfCatalog: boolean;
}) {
  if (outOfCatalog || stock == null) return <span className="text-ink-faint">—</span>;
  return (
    <span className={cn("num", stock < 0 && "text-danger")}>
      {num(stock)}
      {uncounted ? (
        <span className="text-info text-xs" title={`${num(uncounted)} varijanti bez popisa`}>
          {" "}
          ?
        </span>
      ) : null}
    </span>
  );
}

/* ── desktop ─────────────────────────────────────────────────── */

const HEADERS: { key: RacunicaSort; label: string; sub?: string; right?: boolean }[] = [
  { key: "naziv", label: "Artikal" },
  { key: "katalog", label: "Katalog", sub: "MP · marža", right: true },
  { key: "prodato", label: "Prodato", sub: "otkazano", right: true },
  { key: "promet", label: "Promet", sub: "prosečna cena", right: true },
  { key: "popust", label: "Popust", sub: "vs katalog", right: true },
  { key: "zarada", label: "Zarada", sub: "po komadu", right: true },
  { key: "marza", label: "Marža", sub: "stvarna", right: true },
  { key: "trend", label: "Trend", sub: "30/30 d", right: true },
  { key: "prognoza", label: "Prognoza", sub: "30 d · nula", right: true },
  { key: "stanje", label: "Stanje", sub: "vrednost po VP", right: true },
];

function DesktopTable({
  rows,
  abcOf,
  state,
  open,
  toggle,
  sortBy,
  onCalc,
}: {
  rows: RacunicaRow[];
  abcOf?: (key: string) => AbcClass | undefined;
  state: State;
  open: Set<string>;
  toggle: (key: string) => void;
  sortBy: (key: RacunicaSort) => void;
  onCalc: (t: CalcTarget) => void;
}) {
  return (
    <div className="border-border bg-surface shadow-soft hidden overflow-x-auto rounded-lg border md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            {HEADERS.map((h) => {
              const active = state.sort === h.key;
              return (
                <th
                  key={h.key}
                  scope="col"
                  aria-sort={active ? (state.smer === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "px-2.5 py-2 align-bottom font-medium",
                    h.right ? "text-right" : "text-left",
                    // Naziv ostaje vidljiv kad se tabela skroluje vodoravno.
                    h.key === "naziv" && "bg-surface sticky left-0 z-[1]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(h.key)}
                    className={cn(
                      "hover:text-ink inline-flex flex-col gap-0.5",
                      h.right ? "items-end" : "items-start",
                      active ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {h.label}
                      {active ? (
                        state.smer === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : null}
                    </span>
                    {h.sub ? <span className="text-ink-faint text-xs font-normal">{h.sub}</span> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            const variants = r.variants.filter((v) => variantVisible(v, state.arhiva));
            const expandable = variants.length > 1 || r.outOfCatalog;
            return (
              <Fragment key={r.key}>
                <tr className={cn("border-border border-b", isOpen && "bg-surface-2/60")}>
                  <td className="bg-surface sticky left-0 z-[1] min-w-48 px-2.5 py-2.5">
                    <div className="flex items-start gap-1.5">
                      {expandable ? (
                        <button
                          type="button"
                          onClick={() => toggle(r.key)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Sakrij varijante" : "Prikaži varijante"}
                          className="text-ink-soft hover:text-ink hover:bg-surface-2 mt-0.5 rounded p-0.5"
                        >
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.productId ? (
                            <Link
                              href={`/katalog/${r.productId}`}
                              className="text-ink hover:text-green font-medium break-words"
                            >
                              {r.name}
                            </Link>
                          ) : (
                            <span className="text-ink font-medium">{r.name}</span>
                          )}
                          {abcOf ? <AbcBadge cls={abcOf(r.key)} /> : null}
                          {r.archived ? <Badge variant="warning">Arhiviran</Badge> : null}
                          {canSimulate(r) ? (
                            <CalcButton onClick={() => onCalc({ row: r, sku: null })} />
                          ) : null}
                        </div>
                        <div className="text-ink-faint text-xs">
                          {r.outOfCatalog
                            ? `${num(variants.length)} SKU koji nisu u katalogu`
                            : [
                                r.brand,
                                r.categoryName,
                                variants.length > 1
                                  ? `${num(variants.length)} varijanti`
                                  : variants[0]?.sku,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                    <div className="num">{rangeRsd(r.mpMin, r.mpMax)}</div>
                    <Sub>
                      {r.outOfCatalog
                        ? "—"
                        : r.catalogProfitMin === r.catalogProfitMax
                          ? `${rangeRsd(r.catalogProfitMin, r.catalogProfitMax)} · ${pct(r.catalogMarginPct)}`
                          : `prosek ${pct(r.catalogMarginPct)}`}
                    </Sub>
                  </td>
                  <SalesCells stats={r.stats} target={state.cilj} />
                  <VelocityCells vel={r.vel} days={r.outOfCatalog ? null : rowDaysToZero(r)} />
                  <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
                    <StockValue stock={r.stock} uncounted={r.uncounted} outOfCatalog={r.outOfCatalog} />
                    <Sub>{r.outOfCatalog || r.stockValueVp === 0 ? "—" : rsd(r.stockValueVp)}</Sub>
                  </td>
                </tr>
                {isOpen
                  ? variants.map((v) => (
                      <tr key={v.sku} className="border-border bg-surface-2/40 border-b">
                        <td className="bg-surface-2 sticky left-0 z-[1] py-2 pr-3 pl-10">
                          <div className="text-ink flex flex-wrap items-center gap-1.5 text-sm break-words">
                            {v.label}
                            {v.archived ? <Badge variant="warning">Arhivirana</Badge> : null}
                            {!v.archived && v.mp != null ? (
                              <CalcButton onClick={() => onCalc({ row: r, sku: v.sku })} />
                            ) : null}
                          </div>
                          <div className="text-ink-faint font-mono text-xs">{v.sku}</div>
                        </td>
                        <td className="px-2.5 py-2 text-right whitespace-nowrap">
                          <div className="num">{v.mp != null ? rsd(v.mp) : "—"}</div>
                          <Sub>
                            {v.mp != null && v.vp != null
                              ? `VP ${num(v.vp)} · ${pct(catalogMarginOf(v.mp, v.vp))}`
                              : "—"}
                          </Sub>
                        </td>
                        <SalesCells stats={v.stats} target={state.cilj} />
                        <VelocityCells
                          vel={v.vel}
                          days={v.archived ? null : daysToZero(v.stock, v.counted, v.vel)}
                        />
                        <td className="px-2.5 py-2 text-right whitespace-nowrap">
                          <StockValue stock={v.stock} outOfCatalog={v.variantId == null} />
                          <Sub>
                            {v.variantId == null
                              ? "—"
                              : !v.counted
                                ? "nije popisano"
                                : (v.stock ?? 0) > 0
                                  ? rsd((v.stock ?? 0) * (v.vp ?? 0))
                                  : "—"}
                          </Sub>
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Trend i prognoza (od danas, ne zavise od perioda). */
function VelocityCells({ vel, days }: { vel: RacunicaRow["vel"]; days: number | null }) {
  return (
    <>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <TrendValue vel={vel} />
      </td>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <div className="num">{forecastLabel(vel)}</div>
        <Sub>
          <DaysToZero days={days} />
        </Sub>
      </td>
    </>
  );
}

/** Ćelije prodaje (iste za proizvod i varijantu). */
function SalesCells({ stats, target }: { stats: RacunicaRow["stats"]; target: number }) {
  const active = hasActivity(stats);
  const avg = avgPrice(stats);
  const disc = discountPct(stats);
  const cancel = cancelRatePct(stats);
  const ppu = profitPerUnit(stats);
  return (
    <>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <div className="num">{active ? num(stats.qty) : <span className="text-ink-faint">—</span>}</div>
        <Sub>
          {stats.cancelledQty > 0 ? (
            <span className="text-danger">
              {num(stats.cancelledQty)} ({pct(cancel)})
            </span>
          ) : (
            "—"
          )}
        </Sub>
      </td>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <div className="num">{active ? rsd(stats.revenue) : <span className="text-ink-faint">—</span>}</div>
        <Sub>{avg != null ? rsd(Math.round(avg)) : "—"}</Sub>
      </td>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <span className={cn("num", disc != null && disc >= 0.5 && "text-warning")}>{pct(disc)}</span>
      </td>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <div className="text-ink font-semibold">
          <ProfitValue stats={stats} />
        </div>
        <Sub>{ppu != null ? rsd(Math.round(ppu)) : "—"}</Sub>
      </td>
      <td className="px-2.5 py-2.5 text-right whitespace-nowrap">
        <MarginValue value={realMarginPct(stats)} target={target} />
      </td>
    </>
  );
}

/* ── mobilno ─────────────────────────────────────────────────── */

function MobileCards({
  rows,
  abcOf,
  state,
  open,
  toggle,
  onCalc,
}: {
  rows: RacunicaRow[];
  abcOf?: (key: string) => AbcClass | undefined;
  state: State;
  open: Set<string>;
  toggle: (key: string) => void;
  onCalc: (t: CalcTarget) => void;
}) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((r) => {
        const variants = r.variants.filter((v) => variantVisible(v, state.arhiva));
        const isOpen = open.has(r.key);
        return (
          <div key={r.key} className="border-border bg-surface shadow-soft rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {r.productId ? (
                  <Link
                    href={`/katalog/${r.productId}`}
                    className="text-ink hover:text-green font-medium break-words"
                  >
                    {r.name}
                  </Link>
                ) : (
                  <span className="text-ink font-medium">{r.name}</span>
                )}
                <div className="text-ink-faint text-xs">
                  {[r.brand, r.categoryName].filter(Boolean).join(" · ") || " "}
                </div>
              </div>
              <span className="flex shrink-0 gap-1">
                {abcOf ? <AbcBadge cls={abcOf(r.key)} /> : null}
                {r.archived ? <Badge variant="warning">Arhiviran</Badge> : null}
                {canSimulate(r) ? <CalcButton onClick={() => onCalc({ row: r, sku: null })} /> : null}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <Field label="Stvarna zarada">
                <span className="font-semibold">
                  <ProfitValue stats={r.stats} />
                </span>
              </Field>
              <Field label="Stvarna marža">
                <MarginValue value={realMarginPct(r.stats)} target={state.cilj} />
              </Field>
              <Field label="Katalog marža">
                <span className="num">{pct(r.catalogMarginPct)}</span>
              </Field>
              <Field label="Prodato">
                <span className="num">
                  {num(r.stats.qty)}
                  {r.stats.cancelledQty > 0 ? (
                    <span className="text-danger text-xs"> ({num(r.stats.cancelledQty)} otk.)</span>
                  ) : null}
                </span>
              </Field>
              <Field label="Promet">
                <span className="num">{rsd(r.stats.revenue)}</span>
              </Field>
              <Field label="Stanje">
                <StockValue stock={r.stock} uncounted={r.uncounted} outOfCatalog={r.outOfCatalog} />
              </Field>
              <Field label="Trend (30 vs 30 d)">
                <TrendValue vel={r.vel} />
              </Field>
              <Field label="Prognoza 30 d">
                <span className="num">{forecastLabel(r.vel)}</span>
                <span className="text-ink-faint block text-xs">
                  <DaysToZero days={r.outOfCatalog ? null : rowDaysToZero(r)} />
                </span>
              </Field>
            </dl>

            {variants.length > 1 || r.outOfCatalog ? (
              <>
                <button
                  type="button"
                  onClick={() => toggle(r.key)}
                  aria-expanded={isOpen}
                  className="text-green mt-3 inline-flex items-center gap-1 text-sm font-medium"
                >
                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  {r.outOfCatalog ? "SKU" : "Varijante"} ({num(variants.length)})
                </button>
                {isOpen ? (
                  <ul className="border-border mt-2 divide-y divide-[var(--border)] border-t">
                    {variants.map((v) => (
                      <li key={v.sku} className="py-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-ink break-words">{v.label}</div>
                            <div className="text-ink-faint font-mono text-xs break-all">{v.sku}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold">
                              <ProfitValue stats={v.stats} />
                            </div>
                            <MarginValue value={realMarginPct(v.stats)} target={state.cilj} />
                          </div>
                        </div>
                        <div className="text-ink-faint num mt-0.5 text-xs">
                          {num(v.stats.qty)} kom
                          {v.mp != null ? ` · MP ${num(v.mp)} · katalog ${pct(catalogMarginOf(v.mp, v.vp))}` : ""}
                          {v.stock != null ? ` · stanje ${num(v.stock)}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
