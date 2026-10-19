import Link from "next/link";
import { ChevronLeft, ChevronRight, Contact } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { customerFlagMeta } from "@/lib/customers";
import { cn } from "@/lib/utils";
import { datum, num, rsd } from "@/lib/format";
import {
  CUSTOMER_FILTERS,
  CUSTOMER_SORTS,
  CUSTOMERS_PER_PAGE,
  DEFAULT_INACTIVE_MONTHS,
  INACTIVE_MONTH_OPTIONS,
  listCustomers,
  type CustomerFilter,
  type CustomerListRow,
  type CustomerSort,
} from "@/db/customers";
import { Badge } from "@/components/ui/badge";
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

import { CustomersToolbar } from "./customers-toolbar";

export const dynamic = "force-dynamic";

/*
 * Kupci (Korak C1, docs/Sportem-Plan-Kupci.md) — lista kupaca spojenih po
 * telefonu pa e-mailu (db/customers.ts). Pristup: Admin i Menadžer (promet,
 * zarada i PII). Novac iz zamrznutih `order_items`; otkazane/vraćene su u broju
 * porudžbina, ne u prometu i zaradi. Stanje (pretraga, filter, sort, strana) je
 * u URL-u; telefon i e-mail nisu kolone liste — samo pretraga i profil.
 */

const FILTER_LABEL: Record<CustomerFilter, string> = {
  sve: "Svi",
  ponovni: "Ponovni",
  rizicni: "Rizični",
  neaktivni: "Neaktivni",
  oznaka: "Sa oznakom",
};

type Sp = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function KupciPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireRole("admin", "manager");

  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 100);
  const filter = (CUSTOMER_FILTERS as readonly string[]).includes(one(sp.filter) ?? "")
    ? (one(sp.filter) as CustomerFilter)
    : "sve";
  const sort = (CUSTOMER_SORTS as readonly string[]).includes(one(sp.sort) ?? "")
    ? (one(sp.sort) as CustomerSort)
    : "promet";
  const monthsRaw = Number(one(sp.meseci));
  const months = (INACTIVE_MONTH_OPTIONS as readonly number[]).includes(monthsRaw)
    ? monthsRaw
    : DEFAULT_INACTIVE_MONTHS;
  const page = Math.max(1, Math.floor(Number(one(sp.strana))) || 1);

  const { rows, total, counts } = await listCustomers({ q, filter, months, sort, page });
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMERS_PER_PAGE));

  /** Link na isti pogled uz izmenjene parametre (podrazumevane vrednosti se izostavljaju). */
  const hrefWith = (next: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const state: Record<string, string | null> = {
      q: q || null,
      filter: filter === "sve" ? null : filter,
      sort: sort === "promet" ? null : sort,
      meseci: months === DEFAULT_INACTIVE_MONTHS ? null : String(months),
      strana: null,
      ...next,
    };
    for (const [k, v] of Object.entries(state)) if (v) params.set(k, v);
    const query = params.toString();
    return query ? `/kupci?${query}` : "/kupci";
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-1">
        <div className="eyebrow">Prodaja</div>
        <h1 className="text-ink text-xl font-bold">Kupci</h1>
        <p className="text-ink-soft text-sm">
          Porudžbine istog kupca spojene po telefonu, pa po e-mailu. Promet i zarada bez otkazanih i
          vraćenih.
        </p>
      </div>

      <nav
        className="bg-muted mb-4 inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg p-[3px]"
        aria-label="Filter kupaca"
      >
        {CUSTOMER_FILTERS.map((f) => (
          <Link
            key={f}
            href={hrefWith({ filter: f === "sve" ? null : f })}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
              f === filter
                ? "bg-background text-foreground shadow-sm"
                : "text-foreground/60 hover:text-foreground",
            )}
          >
            {FILTER_LABEL[f]}
            <span className="num text-ink-faint text-xs">{num(counts[f])}</span>
          </Link>
        ))}
      </nav>

      <CustomersToolbar sort={sort} months={months} showMonths={filter === "neaktivni"} />

      {filter === "neaktivni" ? (
        <p className="text-ink-faint -mt-2 mb-4 text-xs">
          Kupili su bar jednom, ali ne u poslednjih {months} meseci.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Contact />}
          title={q ? "Nema kupaca za ovu pretragu" : "Nema kupaca za ovaj filter"}
          description={q ? "Probaj deo imena, broj telefona ili e-mail." : undefined}
        />
      ) : (
        <>
          <DesktopTable rows={rows} />
          <MobileCards rows={rows} />
        </>
      )}

      {total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-ink-soft text-sm">
            <span className="num">{num((page - 1) * CUSTOMERS_PER_PAGE + 1)}</span>–
            <span className="num">{num(Math.min(page * CUSTOMERS_PER_PAGE, total))}</span> od{" "}
            <span className="num text-ink font-medium">{num(total)}</span> kupaca
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-soft mr-1 text-sm">
              Strana{" "}
              <span className="num text-ink font-medium">{num(Math.min(page, totalPages))}</span> /{" "}
              <span className="num">{num(totalPages)}</span>
            </span>
            <PageLink
              href={
                page > 1 ? hrefWith({ strana: page - 1 === 1 ? null : String(page - 1) }) : null
              }
              label="Prethodna strana"
            >
              <ChevronLeft className="size-4" />
            </PageLink>
            <PageLink
              href={page < totalPages ? hrefWith({ strana: String(page + 1) }) : null}
              label="Sledeća strana"
            >
              <ChevronRight className="size-4" />
            </PageLink>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PageLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const cls = "inline-flex size-8 items-center justify-center rounded-md";
  if (!href) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(cls, "text-ink-faint opacity-50")}
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(cls, "text-ink hover:bg-muted")}>
      {children}
    </Link>
  );
}

function CustomerBadges({ row }: { row: CustomerListRow }) {
  if (!row.risky && !row.repeat && row.flags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {row.repeat ? <Badge variant="success">Ponovni</Badge> : null}
      {row.risky ? <Badge variant="danger">Rizičan</Badge> : null}
      {row.flags.map((f) => {
        const meta = customerFlagMeta(f);
        return (
          <Badge key={f} variant={meta.variant}>
            {meta.label}
          </Badge>
        );
      })}
    </span>
  );
}

function OrdersCount({ row }: { row: CustomerListRow }) {
  return (
    <span className="num">
      {num(row.orderCount)}
      {row.cancelledCount > 0 ? (
        <span className="text-danger text-xs"> ({num(row.cancelledCount)} otk.)</span>
      ) : null}
    </span>
  );
}

function Profit({ row }: { row: CustomerListRow }) {
  return (
    <span
      className="num"
      title={row.needsVpCount > 0 ? "Zarada nepotpuna — porudžbine bez VP" : undefined}
    >
      {rsd(row.profit)}
      {row.needsVpCount > 0 ? <span className="text-warning">*</span> : null}
    </span>
  );
}

function DesktopTable({ rows }: { rows: CustomerListRow[] }) {
  return (
    <div className="border-border bg-surface shadow-soft hidden overflow-hidden rounded-lg border md:block">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead>Kupac</TableHead>
            <TableHead>Grad</TableHead>
            <TableHead className="text-right">Porudžbine</TableHead>
            <TableHead className="text-right">Promet</TableHead>
            <TableHead className="text-right">Zarada</TableHead>
            <TableHead className="text-right">Poslednja</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.repId} className="border-border">
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/kupci/${r.repId}`}
                    className="text-ink hover:text-green font-medium break-words"
                  >
                    {r.name ?? "(bez imena)"}
                  </Link>
                  <CustomerBadges row={r} />
                </div>
              </TableCell>
              <TableCell className="text-ink-soft">{r.city ?? "—"}</TableCell>
              <TableCell className="text-right">
                <OrdersCount row={r} />
              </TableCell>
              <TableCell className="num text-right">{rsd(r.revenue)}</TableCell>
              <TableCell className="text-ink text-right font-semibold">
                <Profit row={r} />
              </TableCell>
              <TableCell className="num text-ink-soft text-right">{datum(r.lastOrderAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MobileCards({ rows }: { rows: CustomerListRow[] }) {
  return (
    <MobileCardList>
      {rows.map((r) => (
        <MobileCard key={r.repId} href={`/kupci/${r.repId}`} ariaLabel={r.name ?? "Kupac"}>
          <MobileCardHeader
            title={<span className="break-words">{r.name ?? "(bez imena)"}</span>}
            subtitle={r.city ?? undefined}
            trailing={<CustomerBadges row={r} />}
          />
          <div className="mt-3 space-y-1.5">
            <MobileCardField label="Porudžbine">
              <OrdersCount row={r} />
            </MobileCardField>
            <MobileCardField label="Promet">
              <span className="num">{rsd(r.revenue)}</span>
            </MobileCardField>
            <MobileCardField label="Zarada">
              <span className="font-semibold">
                <Profit row={r} />
              </span>
            </MobileCardField>
            <MobileCardField label="Poslednja kupovina">
              <span className="num">{datum(r.lastOrderAt)}</span>
            </MobileCardField>
          </div>
        </MobileCard>
      ))}
    </MobileCardList>
  );
}
