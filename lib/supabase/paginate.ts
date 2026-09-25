/*
 * Paginacija i provera grešaka za PostgREST upite (Korak K2 iz
 * docs/Sportem-Plan-Optimizacija.md; isto je korak R0 iz Plana Izveštaja).
 *
 * TRI PROBLEMA KOJA OVAJ FAJL ZATVARA:
 *
 * 1. **Tvrd cap od 1000 redova.** PostgREST u ovom projektu vraća najviše 1000
 *    redova po zahtevu — ni `.range(0, 19999)` ni `.limit(5000)` ga ne zaobilaze.
 *    Upit koji to ne zna tiho vrati deo podataka, pa cifra bude umanjena bez
 *    ijedne poruke. `selectAll` vrti `.range()` petlju dok stiže pun blok.
 *
 * 2. **Predugačak URL na `.in(...)`.** Izmereno nad pravom bazom: 200 UUID
 *    prolazi, 350 prolazi, 400 puca, 500 puca (`TypeError: fetch failed`).
 *    Zato je `IN_CHUNK = 200` — **jedina konstanta te veličine u projektu**
 *    i nigde se ne prepisuje lokalno.
 *
 * 3. **Progutana greška.** Obrazac `const { data } = await supabase…` na grešku
 *    daje `data = null`, što u finansijama znači „0 RSD" umesto poruke. `must()`
 *    baca čitljivu grešku. Pravilo: **app sme da pukne, ne sme da slaže.**
 *
 * VAŽNO — REDOSLED: `.range()` paginacija je tačna samo ako upit ima
 * deterministički `order`. Bez njega Postgres ne garantuje isti redosled između
 * dva zahteva, pa se red može ponoviti ili preskočiti. Svaki poziv `selectAll`
 * mora da ima `order` koji je jedinstven (ili da se završava jedinstvenom
 * kolonom kao `id` — „tiebreaker").
 *
 * Fajl NE zna ništa o poslovnim pravilima: ne dira filtere, ne dira zamrznute
 * cene, ne menja ni jedan uslov. Samo dohvat i prijava greške.
 */

/** Veličina strane pri `.range()` paginaciji — PostgREST tvrdi cap. */
export const PAGE_SIZE = 1000;

/**
 * Bezbedna veličina parčeta za `.in(kolona, [...])`. Izmereno: 400+ UUID-jeva
 * u jednom URL-u obori zahtev. Ne menjati bez novog merenja.
 */
export const IN_CHUNK = 200;

/** Minimalan oblik PostgREST greške (bez zavisnosti od generisanih tipova). */
type QueryError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

/** Minimalan oblik PostgREST odgovora (bilo koji upit, pa i `rpc`). */
type AnyResult = { data: unknown; error: QueryError | null };

/**
 * Upit kojem se može zadati `.range()` i koji se može čekati (`await`).
 *
 * Tip reda je namerno `unknown`: bez generisanih Supabase tipova (`supabase gen
 * types`) parser `select` stringa izvodi svoj oblik reda, koji se ne poklapa sa
 * ručno pisanim tipovima u `db/` sloju. Pozivalac zadaje `Row` kao tip argument
 * i time preuzima odgovornost — isti obrazac kao postojeće `as unknown as`
 * kroz ceo `db/` sloj. (Kad projekat dobije generisane tipove, ovde se `unknown`
 * menja u pravi tip i sve se proverava.)
 */
type RangeableQuery = {
  range(from: number, to: number): PromiseLike<AnyResult>;
};

/**
 * Baci čitljivu grešku ako je PostgREST vratio `error`, inače vrati `data`.
 * Zamena za `const { data } = await …`, koji na grešku tiho vrati prazno.
 *
 * `label` ide u poruku (i u Sentry) — piši ga tako da se iz njega vidi KOJI je
 * upit pao, npr. „zbir porudžbina: order_items".
 */
export function must<T>(res: { data: T; error: QueryError | null }, label: string): T {
  if (res.error) {
    const code = res.error.code ? ` [${res.error.code}]` : "";
    const details = res.error.details ? ` — ${res.error.details}` : "";
    throw new Error(`${label}${code}: ${res.error.message}${details}`);
  }
  return res.data;
}

/**
 * Isti posao kao `must`, za listu: `null` postaje prazan niz POSLE provere
 * greške, tako da prazno više ne može da znači „pao je upit".
 */
export function mustRows<Row>(res: AnyResult, label: string): Row[] {
  must(res, label);
  return (res.data as Row[] | null) ?? [];
}

/** Isti posao kao `must`, za `.maybeSingle()` / `.single()` — jedan red ili `null`. */
export function mustOne<Row>(res: AnyResult, label: string): Row | null {
  must(res, label);
  return (res.data as Row | null) ?? null;
}

/**
 * Podeli listu id-jeva na parčad za `.in(...)` (podrazumevano po `IN_CHUNK`).
 * Prazna lista → prazan niz parčadi (pozivalac ne radi ni jedan upit).
 */
export function chunked<T>(items: readonly T[], size: number = IN_CHUNK): T[][] {
  if (size < 1) throw new Error("chunked: veličina parčeta mora biti ≥ 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Dohvati SVE redove upita kroz `.range()` petlju, sa obaveznom proverom greške.
 *
 * `build` vraća upit za tekuću stranu. Sme da vrati i isti builder svaki put:
 * `.range()` u supabase-js prepisuje `offset`/`limit` (`searchParams.set`) i
 * `await` svaki put šalje nov `fetch`, pa je recikliranje builder-a bezbedno —
 * zato se zatvorenica koristi i kad je upit sklopljen uz uslovne filtere.
 *
 * `maxRows` je gornja granica skeniranja za ekrane koji je namerno imaju
 * (npr. board tiketa); bez nje se čita do kraja.
 */
export async function selectAll<Row>(
  label: string,
  build: () => RangeableQuery,
  { maxRows }: { maxRows?: number } = {},
): Promise<Row[]> {
  const limit = maxRows ?? Number.POSITIVE_INFINITY;
  const rows: Row[] = [];

  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, limit - offset);
    const page = mustRows<Row>(await build().range(offset, offset + size - 1), label);
    rows.push(...page);
    // Nepun blok = nema više redova. (Pun blok na tačno granici → još jedan
    // prazan zahtev, što je jedan round-trip više ali nikad izgubljen red.)
    if (page.length < size) break;
  }

  return rows;
}

/**
 * `selectAll` nad listom id-jeva: parčad po `IN_CHUNK`, a svako parče
 * paginirano (200 porudžbina ume da ima više od 1000 stavki).
 *
 * `build(chunk)` dobija jedno parče i vraća upit sa `.in(kolona, chunk)`.
 */
export async function selectAllIn<Row, Id>(
  label: string,
  ids: readonly Id[],
  build: (chunk: Id[]) => RangeableQuery,
): Promise<Row[]> {
  const rows: Row[] = [];
  const parts = chunked(ids);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    rows.push(
      ...(await selectAll<Row>(`${label} [parče ${i + 1}/${parts.length}]`, () => build(part))),
    );
  }
  return rows;
}
