// ============================================================================
// Sportem OS — provera koraka C1 (`npm run provera:c1`)
//
// Poredi spajanje kupaca iz `db/customers.ts` (groupCustomerOrders) sa ručnim
// izvozom ponovnih kupaca (`ponovni-kupci-2026-09-08.csv`, van repoa — PII).
// Porudžbine se seku na dan izvoza (`--do=`, Beograd), pa se za svakog kupca iz
// CSV-a traži grupa koja sadrži njegove porudžbine i porede se: skup porudžbina,
// broj, promet, zarada i komadi. Na kraju: da li je skup „ponovnih" isti.
//
// Razlika NE znači nužno grešku spajanja: porudžbina je od izvoza mogla da
// promeni status ili stavke (edit popusta). Takve se ispisuju po broju.
//
// ⚠ SKRIPTA SAMO ČITA. Nijedan insert/update/delete.
//
// Pokretanje: npm run provera:c1 [-- --csv=putanja --do=YYYY-MM-DD]
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { belgradeDate } from "@/lib/date-belgrade";
import { fetchCustomerSources, groupCustomerOrders, isRepeatCustomer } from "@/db/customers";

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const CSV = arg("csv", "../sportem-izvestaji/ponovni-kupci-2026-09-08.csv");
const UNTIL = arg("do", "2026-09-07");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("Nedostaje NEXT_PUBLIC_SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const supabase = createClient(URL, SERVICE, { auth: { persistSession: false } });

type CsvRow = {
  name: string;
  count: number;
  revenue: number;
  profit: number;
  units: number;
  woo: number[];
};

function readCsv(path: string): CsvRow[] {
  const lines = readFileSync(path, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const c = line.split(";");
    return {
      name: c[0],
      count: Number(c[2]),
      revenue: Number(c[3]),
      profit: Number(c[4]),
      units: Number(c[5]),
      woo: c[8].split(",").map((s) => Number(s.trim())),
    };
  });
}

type Group = ReturnType<typeof groupCustomerOrders>[number];

async function main() {
  console.log(`Provera C1 — spajanje kupaca vs ${CSV} (porudžbine do ${UNTIL}, Beograd)`);
  const csv = readCsv(CSV);

  const src = await fetchCustomerSources(supabase);
  const orders = src.orders.filter((o) => belgradeDate(o.ordered_at ?? o.created_at) <= UNTIL);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const orderByWoo = new Map(orders.map((o) => [o.woo_order_id, o]));
  const phonesOfWoo = (w: number) => {
    const o = orderByWoo.get(w);
    return [o?.ship_phone_norm, o?.customer?.phone_norm].filter((p): p is string => !!p);
  };
  const isCancelled = (w: number) => {
    const o = orderByWoo.get(w);
    return !!o && src.cancelledStatusIds.has(o.status_id);
  };

  /*
   * Porede se dva prolaza:
   *  (A) SAMO TELEFON — e-mailovi isključeni, kao što je CSV pravljen
   *      („Spojeno po: telefon"). Sme da odstupa SAMO porudžbina koja je posle
   *      izvoza otkazana/vraćena (ona više nije u prometu).
   *  (B) PRAVO PRAVILO (D1) — telefon, pa e-mail. Sme da odstupa još i
   *      porudžbina sa DRUGIM telefonom (spojena po e-mailu/kupcu).
   * Svako drugo odstupanje je greška.
   */
  function compare(label: string, groups: Group[], allowEmail: boolean): boolean {
    const groupByWoo = new Map<number, Group>();
    for (const g of groups) {
      for (const id of g.orderIds) {
        const w = orderById.get(id)?.woo_order_id;
        if (w != null) groupByWoo.set(w, g);
      }
    }
    const realizedWoo = (g: Group) =>
      g.orderIds
        .map((id) => orderById.get(id)!)
        .filter((o) => !src.cancelledStatusIds.has(o.status_id))
        .map((o) => o.woo_order_id)
        .filter((w): w is number => w != null)
        .sort((a, b) => a - b);

    /** Razlog odstupanja ili `null` kad razlog nije dozvoljen. */
    const reason = (w: number, ref: Set<string>): string | null => {
      if (isCancelled(w)) return "sada otkazana/vraćena";
      if (allowEmail && !phonesOfWoo(w).some((p) => ref.has(p)))
        return "drugi telefon → spojeno po e-mailu";
      return null;
    };

    let exact = 0;
    let explained = 0;
    const bad: string[] = [];
    const notes: string[] = [];
    const matched = new Set<string>();

    for (const row of csv) {
      const gs = new Set(row.woo.map((w) => groupByWoo.get(w)).filter((g): g is Group => !!g));
      if (gs.size !== 1) {
        bad.push(`✗ ${row.name}: porudžbine ${row.woo.join(", ")} su u ${gs.size} grupa`);
        continue;
      }
      const g = [...gs][0];
      matched.add(g.key);
      const ours = realizedWoo(g);
      const theirs = [...row.woo].sort((a, b) => a - b);
      const sameOrders = ours.join(",") === theirs.join(",");
      if (
        sameOrders &&
        g.revenue === row.revenue &&
        g.profit === row.profit &&
        g.units === row.units
      ) {
        exact += 1;
        continue;
      }
      const ref = new Set(theirs.flatMap(phonesOfWoo));
      const changed = [
        ...ours.filter((w) => !theirs.includes(w)),
        ...theirs.filter((w) => !ours.includes(w)),
      ];
      const reasons = changed.map((w) => ({ w, r: reason(w, ref) }));
      const line =
        `${row.name}: CSV [${theirs.join(", ")}] / app [${ours.join(", ")}]` +
        ` · promet ${row.revenue} / ${g.revenue} · zarada ${row.profit} / ${g.profit}` +
        reasons.map(({ w, r }) => `\n      #${w}: ${r ?? "NEOBJAŠNJENO"}`).join("");
      // Iste porudžbine, a druga cifra = zamrznute cene se ne poklapaju → greška.
      if (sameOrders || reasons.some((x) => !x.r)) bad.push(`✗ ${line}`);
      else {
        explained += 1;
        notes.push(`△ ${line}`);
      }
    }

    const extra = groups.filter(isRepeatCustomer).filter((g) => !matched.has(g.key));
    for (const g of extra) {
      const ws = realizedWoo(g);
      const ref = new Set(phonesOfWoo(ws[0]));
      const reasons = ws.slice(1).map((w) => ({ w, r: reason(w, ref) }));
      const line =
        `+ ${g.name ?? "(bez imena)"} · ${ws.join(", ")}` +
        reasons.map(({ w, r }) => `\n      #${w}: ${r ?? "NEOBJAŠNJENO"}`).join("");
      if (reasons.every((x) => x.r)) notes.push(line);
      else bad.push(line);
    }

    console.log(`\n── ${label} ──`);
    console.log(
      `Kupaca (grupa): ${groups.length} · ponovnih: ${groups.filter(isRepeatCustomer).length} · u CSV-u: ${csv.length}`,
    );
    console.log(
      `Tačno (porudžbine + promet + zarada + komadi, 0 RSD): ${exact}/${csv.length} · objašnjeno: ${explained} · novih ponovnih: ${extra.length}`,
    );
    for (const n of notes) console.log(`  ${n}`);
    for (const b of bad) console.log(`  ${b}`);
    console.log(
      bad.length === 0
        ? "  ✓ nema neobjašnjenih razlika"
        : `  ✗ ${bad.length} neobjašnjenih razlika`,
    );
    return bad.length === 0;
  }

  const phoneOnly = groupCustomerOrders({
    ...src,
    orders: orders.map((o) => ({
      ...o,
      customer: o.customer ? { ...o.customer, email: null } : null,
    })),
  });
  const okA = compare("(A) samo telefon — kao CSV", phoneOnly, false);
  const okB = compare(
    "(B) telefon + e-mail — pravilo D1",
    groupCustomerOrders({ ...src, orders }),
    true,
  );

  const ok = okA && okB;
  console.log(
    ok
      ? "\n✅ PASS — sve razlike su otkazivanja posle izvoza ili spajanje po e-mailu; zamrznute cene 0 RSD.\n"
      : "\n❌ FAIL — ima neobjašnjenih razlika.\n",
  );
  process.exit(ok ? 0 : 1);
}

main();
