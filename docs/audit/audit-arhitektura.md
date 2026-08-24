# Sportem OS — Audit arhitekture, performansi i tehničkog duga

**Datum:** 2026-07-31 · **Grana:** `main` @ `9c3c4c9` · **Obim:** `app/**`, `db/**`, `lib/**`, `components/**`, `supabase/migrations/**`, konfiguracija, zavisnosti

**Veličina kodbaze:** ~18.400 linija TS/TSX (app 13.658 · components 2.713 · db 1.900 · lib 1.767) + 956 linija SQL migracija + 1.193 linije `.mjs` skripti. 80 commit-ova.

**Legenda:** `[POTVRĐENO]` = pročitano u kodu i reprodukovano · `[SUMNJA]` = jaka indicija, treba jednominutna provera

---

## Ukratko

Kod je **disciplinovaniji nego što je tipično** za projekat ove veličine: nula `any`, `server-only` na pravim mestima, `requireRole` na svih 54 server akcije, RLS bez rupa, svi iznosi `int`, zod svuda, komentari koji objašnjavaju *zašto*. Ustav zamrznutih cena se poštuje u kodu.

Problem nije nemar — problem je da **nema nijednog mehanizma koji bi ga održao**. Nula testova, nula CI-ja, nula generisanih tipova, i sistematsko neproveravanje grešaka baze. Zbog toga se greške ne vide dok neko ručno ne primeti da je cifra čudna — što se već desilo bar dvaput (zarada=0 na širokom periodu, `goods_total` drift).

**Osam kritičnih nalaza, tri direktno na novcu:**
- `order_profit` view sumira preko NULL-ova → **faktura može biti tiho umanjena** (K7)
- Tihi 1000-row cap na 9 mesta → saldo poštarine, zarada uplata, P&L XExpress faktura mogu podbaciti (K2, K3)
- Skidanje zaliha ima dve trke koje duplo skidaju robu (K8)

**Prvih 5 poteza, redom:**
1. `npm i next@16.2.12` — gasi 5 „high" ranjivosti jednom patch verzijom (O7)
2. Popravi `order_profit` view + tvrdo blokiraj `needs_vp` u `issueInvoice` (K7)
3. Vitest + testovi čistih novčanih funkcija — 4 h rada, 60% vrednosti (K1)
4. `supabase gen types` → briše 23 `as unknown as` casta (O1)
5. `selectAll()` helper + `dbFail()` helper → gasi K2 i K4 mehanički

---

## KRITIČNO

### K1. Nula automatizovanih testova nad kodom aplikacije `[POTVRĐENO]`

Ne postoji test framework, ni `.test.ts`/`.spec.ts` fajl, ni `test` skripta u `package.json`, ni `.github/workflows/`. Jedino što postoji:

| Fajl | Šta radi | Ograničenje |
|---|---|---|
| `scripts/rls-test.mjs` (117 l., 13 provera) | Loguje se kao Logistika/Admin, proverava RLS | Traži živu bazu + učitane dev-fixtures + test naloge; ručno pokretanje |
| `scripts/woo-webhook-test.mjs` (257 l., 45 provera) | Šalje potpisane payload-e na `localhost:3000` | Traži `npm run dev` + piše u pravu bazu (99xxxx ID-jevi) |
| `scripts/woo-backfill.mjs` (687 l.) | Migracija podataka, ima dry-run | Nije test |

Ovo su **integracioni smoke skriptovi vezani za živu bazu**, ne test suite. Posledice:
- Nijedna čista funkcija koja računa novac (`otkupOf`, `withPdv`, `pnlFrom`, `computePeriodMetrics`, `belgradeDate`, `previousWorkingDay`, `parseRsd`) nema test.
- Refaktor `db/finance.ts` ili `db/metrics.ts` nema mrežu — a to je tačno mesto gde se cifre zarade računaju.
- Istorija to potvrđuje: bug „Zarada/Marža = 0 na širokom periodu" (CLAUDE.md) je stigao u produkciju i otkriven ručno.

**Predlog:** ceo plan je u sekciji [Plan testiranja](#plan-testiranja).

### K2. Tihi 1000-row cap PostgREST-a pogađa novčane cifre na više mesta `[POTVRĐENO za mehanizam, SUMNJA za tačan prag]`

Supabase PostgREST ima podrazumevani `db_max_rows` (Dashboard → Settings → API → „Max rows", default **1000**). Kodbaza to zna na jednom mestu (`db/metrics.ts:26` — „default cap je 1000", paginacija po 1000) ali **ne i na ostalim**. Nijedan od upita ispod ne proverava `error`, pa se odsecanje ne vidi.

| Mesto | Upit | Posledica kad skup pređe cap |
|---|---|---|
| `db/orders.ts:198-199` | `RISK_SCAN_CAP = 5000`, `.range(0, 4999)` | Filter „rizičan kupac" gleda samo prvih 1000 porudžbina |
| `db/orders.ts:274-275` | `SUMMARY_SCAN_CAP = 20000`, `.range(0, 19999)` | **Zbir zarade iznad liste porudžbina podbacuje** kad filter pogađa >1000 porudžbina |
| `db/customer-risk.ts:64-67` | sve porudžbine `cancelled_at not null`, bez limita | Rizik-indeks nekompletan; poziva se na **svakom** renderu liste i na **svakoj novoj porudžbini** u webhooku (`route.ts:274`) |
| `db/finance.ts:488-493` | `getSaldoPostarine` — sve porudžbine sa `shipping_actual` | **Saldo poštarine pogrešan** kad broj fakturisanih pošiljki pređe cap |
| `db/finance.ts:650-656` | `listXexpressInvoices` — `.in(xexpress_invoice_id, …)` bez paginacije | **P&L XExpress faktura podbacuje** |
| `db/finance.ts:272-279` | `profitByOrder(orderIds)` — `.in()` bez chunk-a; pozvano sa `rows.flatMap(...)` iz `listPayouts` (`:113`) | **Zarada uplata = 0/podbačaj**; pri velikom broju i HTTP 414 (URL predugačak) |
| `db/finance.ts:56-67` | `getUnpaidDeliveredXexpress` bez limita | Kandidati za uplatu odsečeni; ista funkcija hrani Dashboard karticu |
| `db/catalog.ts:42-51` | `fetchVariants` — `.in("product_id", [≤1000 UUID])` | Varijante nestaju iz kataloga + URL 414 rizik |
| `db/catalog.ts:113-121` / `app/api/cron/notifikacije/route.ts:112-117` | sve varijante, JS filter | Nisko stanje podbacuje (i u push obaveštenju) |

**Zašto je kritično:** ovo su cifre po kojima se izdaje faktura drugu i računa saldo. Odsecanje je **tiho** — nema greške, nema Sentry događaja, samo manji broj.

**Provera (1 min):** Supabase Dashboard → Settings → API → „Max rows". Ili `curl "$URL/rest/v1/orders?select=id&limit=5000"` sa service ključem i prebroj vraćene redove.

**Predlog:**
1. Uvesti jedan helper `selectAll(query)` u `lib/supabase/paginate.ts` koji radi `.range()` petlju po 1000 dok `rows.length === PAGE`, uz obaveznu `error` proveru (isti obrazac kao `db/metrics.ts:50-63`) — i zameniti **svih 9** mesta gore.
2. `profitByOrder` i sve `.in()` pozive obaviti helperom `chunked(ids, 200)` koji i chunk-uje **i** paginira (chunk od 200 porudžbina može imati >1000 stavki — v. K3).
3. Ukloniti `RISK_SCAN_CAP`/`SUMMARY_SCAN_CAP` — oni daju lažni osećaj sigurnosti.

### K3. `db/metrics.ts` chunk štiti URL, ali ne i broj vraćenih redova `[POTVRĐENO]`

`db/metrics.ts:80-96`: `IN_CHUNK = 200` porudžbina po zahtevu. Ako tih 200 porudžbina ima **više od 1000 stavki ukupno**, odgovor se odseca — i to bez traga, jer `error` je null (odsecanje nije greška). Trenutni prosek je ~1,7 stavki/porudžbina, pa 200 porudžbina ≈ 340 stavki i prolazi; ali kod velike korpe (npr. veleprodajna porudžbina od 20 stavki) prag se dostiže na ~50 porudžbina.

**Ovo je isti bug koji je već jednom pogodio Dashboard**, samo zakrpljen na pola: chunk rešava URL dužinu, ne row cap.

**Predlog:** unutar chunk-a raditi `.range()` petlju dok se vraća pun page, ili prebaciti agregaciju u Postgres (v. Predlog P2 — RPC/view `order_profit` već postoji, samo se ne koristi u `computePeriodMetrics`).

### K4. Greške baze u server akcijama se gutaju bez logovanja `[POTVRĐENO]`

Obrazac ponovljen ~25 puta, npr. `app/(app)/porudzbine/actions.ts`:

```ts
const { error } = await supabase.from("order_items").update(...).eq("id", ...);
if (error) return { error: "Izmena cene nije uspela." };   // :176
```

Nigde u `app/(app)/**/actions.ts` (osim `obavestenja/actions.ts:41`) se `error` ne šalje u Sentry. Sentry se koristi samo na 11 fajlova, uglavnom webhook/cron/push/stock.

Gore od toga — pomoćne funkcije ne proveravaju grešku **uopšte**:
- `syncNeedsVp` (`actions.ts:123-134`) — dva upita, nula provera. Ako update padne, `needs_vp` ostaje netačan i porudžbina uđe u fakturu sa profitom 0.
- `recomputeGoodsTotal` (`actions.ts:142-153`) — isto. `goods_total` hrani `otkupOf()` u uplatama, dakle direktno novac.

**Posledica:** korisnik vidi „Izmena cene nije uspela.", ti ne vidiš ništa. Ne postoji način da se sazna zašto (RLS? constraint? mreža?).

**Predlog:** helper u `lib/actions.ts`:
```ts
export function dbFail(error: PostgrestError, userMsg: string): ActionState {
  Sentry.captureException(error, { tags: { layer: "action" } });
  return { error: userMsg };
}
```
i mehanička zamena svih `if (error) return { error: "..." }`. Za `syncNeedsVp`/`recomputeGoodsTotal` — bacati, ne gutati.

### K5. Bulk akcije = N+1 sa spoljnim HTTP pozivom u petlji → Vercel timeout `[POTVRĐENO]`

`app/(app)/porudzbine/actions.ts:563-595` (`markOrdersShipped`) i `:662-720` (`changeOrdersStatus`) idu **red po red**:
- 1 `UPDATE orders`
- 1 `INSERT order_status_history`
- 1 `syncStockForStatusChange` → još 2-3 upita + RPC
- 1 `pushWooStatus` → **HTTP PUT ka WooCommerce sa 10s timeout-om** (`lib/woo-client.ts:22`)

Za 100 selektovanih porudžbina to je ~500 round-tripova ka Supabase + do **1000 sekundi** čekanja na Woo u najgorem slučaju.

**Nijedna ruta ni akcija nema `export const maxDuration`** (grep: 0 pogodaka). Vercel default za Node funkcije je 300 s na Fluid compute, ali serverless default na Hobby planu je znatno niži. Bulk nad velikom selekcijom **hoće da pukne u pola posla** — a pošto nema transakcije, deo porudžbina ostane promenjen, deo ne.

**Predlog:**
1. `UPDATE` i `INSERT history` uraditi **batch-om** (jedan `.in("id", ids)` update po grupi + jedan `insert([...])` za istoriju).
2. Woo push izvući iz petlje u `Promise.allSettled` sa konkurentnošću 5-10, ili — bolje — u red poslova (tabela `woo_sync_queue` + cron), pošto je ionako best-effort.
3. Dodati `export const maxDuration = 60` na rute/akcije koje mogu dugo da traju.
4. Ograničiti veličinu selekcije u UI-ju (npr. 50) dok se gore ne uradi.

### K6. Nema transakcija — parcijalno primenjene promene su moguće `[POTVRĐENO]`

`supabase-js` ne nudi transakcije, a kod se svuda oslanja na sekvencu upita:
- Webhook `insertOrder` (`app/api/webhooks/woo/route.ts:239-248`) — ako insert stavki padne, ručno se briše `orders` red. Ako **i to brisanje** padne, ostaje porudžbina bez stavki sa `goods_total` (profit 0, tiho pogrešna faktura).
- `changeOrderStatus` (`:399-415`) — update prođe, `order_status_history` insert ne proverava `error` uopšte → istorija može da fali.
- `issueInvoice` u `app/(app)/finansije/actions.ts` — postavlja `payouts.invoice_id` **pa zatim** kaskadno `orders.invoice_id`; prekid između njih ostavlja fakturu sa uplatama ali bez zaključanih porudžbina (stavke ostaju editabilne → snapshot fakture može da se promeni posle izdavanja).

**Predlog:** za tokove koji diraju novac (`issueInvoice`, `deleteInvoice`, `createPayout`, `insertOrder`) napisati Postgres funkcije (`SECURITY DEFINER`, jedan statement blok) i zvati ih `supabase.rpc()`. Obrazac već postoji — `apply_stock_delta` (`lib/stock.ts:34`).

### K7. `order_profit` view sumira preko NULL-ova → **faktura može biti umanjena** `[POTVRĐENO]`

**Najozbiljniji pojedinačni nalaz u celom auditu.**

`supabase/migrations/20260710120000_finansije.sql:36-45` definiše view i tvrdi u komentaru:
> „profit je null za porudžbinu sa bar jednom needs_vp stavkom (null u sumi)"

**To nije tačno.** Postgres `sum()` **preskače** NULL vrednosti i vraća NULL samo ako su *sve* vrednosti NULL. Porudžbina sa stavkama `[profit_at_sale = 8000, profit_at_sale = NULL]` daje `sum = 8000`, ne NULL.

**Put do novca:**
`app/(app)/finansije/actions.ts:290-296` računa `total_amount` fakture kao `Σ order_profit` uz `(r.profit ?? 0)`. Porudžbina sa **delimično** nepoznatim VP-om tiho ulazi u fakturu sa **umanjenim** iznosom umesto da bude blokirana. `getBlockedNeedsVpOrders` je po odluci samo **upozorenje**, ne blokada — a upozorenje se oslanja na `needs_vp` flag koji `syncNeedsVp` (v. K4) ne proverava za greške.

Isti obrazac `?? 0` je i u `db/orders.ts:238` i `db/metrics.ts:93` — svuda gde nedostajući VP tiho postaje „zarada 0" umesto „ne znam".

**Ovo je tačno onaj bug koji je ubio Sheets tok** — cifra koja izgleda tačno a nije, bez ijednog signala.

**Popravka:**
```sql
create or replace view order_profit with (security_invoker = true) as
select order_id,
       case when count(*) filter (where profit_at_sale is null) > 0
            then null else sum(profit_at_sale) end as profit
from order_items group by order_id;
```
+ `issueInvoice` mora **tvrdo odbiti** porudžbinu sa `profit is null` (danas `?? 0`), + test br. 8 iz plana testiranja.

### K8. Automatsko skidanje zaliha ima dve trke koje duplo skidaju robu `[POTVRĐENO na nivou koda]`

`lib/stock.ts` + `supabase/migrations/20260731140000_order_stock_decrement.sql` (**oba necommit-ovana**).

**Šta je dobro:** `apply_stock_delta` (`:46-55`) je jedan `UPDATE … set stock_quantity = stock_quantity + delta` — otporan na klasičan lost update pod READ COMMITTED. `claimFlag` (`lib/stock.ts:60-67`) je pravi mutex (`.eq("stock_applied", !next)` u istom statement-u) — **dupli Woo retry ne može duplo da skine.** Permisije ispravne (`security definer`, `search_path=''`, grant samo `service_role`).

**R1 — TOCTOU između `claimFlag` i `applyDeltas`:** `lib/stock.ts:85-87` preuzme flag, **commit-uje**, pa tek onda u zasebnom round-tripu čita `order_items`. Nije jedna transakcija:
```
t1  Admin A vraća status iz „Otkazano" → claimFlag(true) COMMIT
t2  Admin B dodaje stavku → syncItemStock čita stock_applied = TRUE → skine −qty   [1×]
t3  A nastavlja: orderDeltas SELECT-uje stavke — sada UKLJUČUJE B-ovu → skine −qty  [2×]
```
Prozor je jedan round-trip, ali obe akcije su Admin akcije koje realno idu paralelno u dva taba.

**R2 — rollback prekidača posle uspešnog commit-a:** `lib/stock.ts:88-93`. Komentar tvrdi „katalog nije promenjen jer je RPC jedan statement" — to važi samo za **SQL greške**. Ako RPC uspe u bazi ali odgovor ne stigne (timeout / 504 / prekinut pooler — realno na Vercelu), catch grana vraća `stock_applied` nazad → **roba je skinuta, prekidač kaže da nije** → sledeći `reserve` skida ponovo.

**R3 — ogledalni gubitak pri `release`:** brisanje stavke u istom prozoru vidi `stock_applied = false` → preskoči vraćanje, a `orderDeltas` više ne vidi obrisani red → **količina se nikad ne vrati.**

**R4 — nema reconcile-a:** svaki neuspeh je best-effort `false` → tekstualno upozorenje u toast-u. Nema retry-ja, dead-letter-a, ni periodičnog usaglašavanja. Jednom promašeno = trajno pogrešno stanje.

**R5 — ručna izmena gazi konkurentni delta:** `katalog/actions.ts:353` piše **apsolutnu** `stock_quantity` iz forme. Ako webhook u međuvremenu skine 2 komada, „Sačuvaj" ih vraća. Nema optimistic locking-a.

**Popravka (gasi R1+R2+R3 odjednom):** sve prebaciti u **jednu SQL funkciju** koja u istoj transakciji radi `select … from orders where id = ? for update`, proveri+flipne prekidač, pročita stavke i primeni UPDATE. Uz to reconcile job u dnevnom cron-u.

---

## OZBILJNO

### O1. Nema generisanih Supabase tipova → 23 `as unknown as` casta `[POTVRĐENO]`

Ne postoji `database.types.ts` (grep: nula), `createClient()` se nigde ne parametrizuje generikom. Rezultat: svaki PostgREST odgovor je `any`-ish i ručno se „ubeđuje" u oblik.

- **0** `: any` / `as any` u kodu (dobro — disciplina se poštuje)
- **23** `as unknown as X` — `db/finance.ts` (9), `db/orders.ts` (7), `db/catalog.ts` (3), `db/expenses.ts`, `db/customer-risk.ts`, `app/(app)/porudzbine/actions.ts`
- **72** `as X` casta ukupno

Svaki od tih castova je mesto gde promena šeme **neće** oboriti `tsc`. Konkretno: kad je dodata kolona `stock_counted_at`, CLAUDE.md sam beleži da bi bez `db push` „varijante nestale iz kataloga jer se PostgREST greška ne proverava" — tip sistem to nije mogao da uhvati.

**Predlog:**
```bash
supabase gen types typescript --linked > db/database.types.ts
```
+ `npm run types:db` skripta, + `createServerClient<Database>(...)` u `lib/supabase/{server,client,admin,middleware}.ts`. Posle toga se svih 23 `as unknown as` brišu, a `Tables<"orders">` postaje izvor istine. Dodati `types:db` u CI da fail-uje kad je fajl zastareo (`git diff --exit-code`).

### O2. Ista logika kopirana na više mesta (bug-farm) `[POTVRĐENO]`

| Logika | Kopije | Rizik |
|---|---|---|
| Granice meseca | `db/finance.ts:756` `monthBounds`, `db/expenses.ts:29` `monthDateBounds`, `lib/period.ts:44-48` `presetBounds("mesec")` | Tri implementacije istog; `expenses` verzija nema UTC pred-filter |
| Lookup statusa po imenu | `db/finance.ts:14` , `db/dashboard.ts:17` , `db/metrics.ts:40` , `db/orders.ts:285` , `app/api/webhooks/woo/route.ts:109` , `app/api/cron/notifikacije/route.ts:99` , + 5× inline u `porudzbine/actions.ts` | 11 mesta; svako je zaseban round-trip po renderu i zaseban izvor greške |
| Srpska množina | `db/customer-risk.ts:122-127` `porudzbinePlural`, `app/api/cron/notifikacije/route.ts:157-162` `plural` | Identična formula, dva potpisa |
| „Nisko stanje" pravilo | `db/catalog-types.ts:58` `isVariantLowStock`, `db/catalog.ts:134-140`, `app/api/cron/notifikacije/route.ts:126-131` | **Tri kopije istog poslovnog pravila.** Kad se pravilo promenilo (dodat `stock_counted_at`), moralo se ručno menjati na sva tri mesta — jedno propušteno = push šalje pogrešan broj |
| Sumiranje zamrznute zarade | `db/metrics.ts:82-96` (inline), `db/orders.ts:219-241` `sumOrderItems`, `db/finance.ts:272-284` `profitByOrder` (preko view-a `order_profit`) | **Tri različita puta do iste cifre.** Dva sumiraju `order_items` direktno, jedan ide kroz view. Različit chunk (200 vs 500 vs 0). Ovo je najopasnija duplikacija — cifre se mogu razići |
| Otkazni statusi | dobro — jedan izvor `CANCELLED_STATUS_NAMES` u `lib/woo.ts` | ✔ |

**Predlog:** `db/status.ts` sa `cache()`-ovanim `statusIdByName()` / `statusIdsByNames()`; `lib/plural.ts`; `lib/month.ts`; a sumiranje zarade **isključivo** kroz `order_profit` view (jedan put, jedna definicija).

### O3. Sve je `force-dynamic` — nula keširanja `[POTVRĐENO]`

18 od 18 stranica u `app/(app)/**` ima `export const dynamic = "force-dynamic"`. Ustav („online-only, nikad zastarela finansijska stranica") to opravdava za finansije/porudžbine, ali:
- `/stil`, `/stil/komponente` (statične demo stranice) — nepotrebno
- `/katalog` povlači **ceo katalog** (svi proizvodi + sve varijante) na svaki request, pa filtrira/paginira na klijentu (`catalog-table.tsx`, 313 l.) — to je najskuplji upit u aplikaciji i najmanje se menja
- `/podesavanja`, `/obavestenja` — retko se menjaju

Uz to: **samo jedan `loading.tsx`** (`app/(app)/loading.tsx`) i **nijedan `error.tsx`** ni `not-found.tsx`. Greška u bilo kojoj stranici pada na Next-ov generički ekran, bez brendiranog stanja i bez „pokušaj ponovo".

**Predlog:**
- Ostaviti `force-dynamic` na finansijama/porudžbinama/dashboardu (ispravno).
- `/katalog` → server-side paginacija + pretraga (ne dovlačiti sve), ili `unstable_cache` sa `revalidateTag("katalog")` iz `katalog/actions.ts`.
- Dodati `error.tsx` po segmentu (`(app)/error.tsx` minimum) i `not-found.tsx`.
- `/stil/**` → statično.

### O4. Revalidacija ne prati zavisnosti između ekrana `[POTVRĐENO — v. detalj podagenta u nastavku]`

`revalidateOrder()` (`app/(app)/porudzbine/actions.ts:40-45`) revalidira **samo** `/porudzbine`. Ali promena statusa porudžbine menja i:
- `/` (Dashboard — broj porudžbina, zarada, „porudžbine koje čekaju")
- `/finansije/uplate` (kandidati za uplatu = isporučeno+neuplaćeno)
- `/finansije/fakture` (preko uplata)

Pošto su te stranice `force-dynamic`, u praksi se ne servira zastareli sadržaj pri navigaciji — ali **Router Cache na klijentu** (30 s za dinamičke rute u Next 15+/16) ume da pokaže staru vrednost pri `<Link>` navigaciji nazad. Kod to zaobilazi ručno preko `orders-refresh.tsx` / `router.refresh()`, što je zakrpa a ne rešenje.

**Predlog:** `revalidateOrder()` treba da revalidira `["/porudzbine", "/", "/finansije/uplate", "/finansije/fakture"]`, ili preći na `revalidateTag` sa tagovima `orders` / `finance` / `catalog`.

### O5. Nema CI-ja `[POTVRĐENO]`

Nema `.github/` foldera. `npm run lint`, `npx tsc --noEmit`, `prettier --check` se pokreću ručno. Vercel build hvata tip greške, ali **tek posle push-a na `main`** (deploy grana je `main` i commit-ovi idu direktno na nju — 80 commit-ova, nema PR toka).

**Rizik:** produkcija je jedna `git push` komanda od loma, bez ijedne automatske kapije.

**Predlog:** v. [Plan testiranja § CI](#ci).

### O6. Deployment / operativa

**a) Neprimenjene migracije `[POTVRĐENO]`** — CLAUDE.md na **6 mesta** kaže „Pre produkcije: `supabase db push`":
`20260711120000_notification_preferences` · `20260712140000_split_cancel_return_status` · `20260721120000_xexpress_invoices` · `20260722120000_payout_invoice_link` · `20260731120000_stock_count` · `20260710140000_storage_expense_attachments`.
Ne postoji način da se iz repoa vidi **koje su zaista primenjene** na produkciju. CLAUDE.md sam upozorava da neprimenjena migracija znači „upiti tiho vraćaju prazno" (jer se `error` ne proverava — v. K2/K4).

**Predlog:** `npm run db:status` (`supabase migration list --linked`) + obavezan korak pre deploy-a; dugoročno GitHub Action koji radi `supabase db push` na merge u `main`.

**b) Neispraćen WIP `[POTVRĐENO]`** — `git status` pokazuje **necommit-ovano**: `lib/stock.ts` (nov fajl, 130 l.), `supabase/migrations/20260731140000_order_stock_decrement.sql` (nova migracija), izmene u `porudzbine/actions.ts` i `webhooks/woo/route.ts`. Auto-decrement zaliha je po planu **Faza 2.2** i po zaključanoj odluci „NIJE u Fazi 1" — implementiran je bez formalne izmene te odluke. Rizik gubitka rada + odstupanje od plana.

**c) Nema rollback plana `[POTVRĐENO]`** — nijedna migracija nema down-skriptu. Za `20260712140000_split_cancel_return_status.sql` (preimenuje postojeći status red) povratak bi bio ručan. Backup baze nije dokumentiran nigde (Supabase free tier ima ograničen PITR).

**Predlog:** za svaku destruktivnu migraciju dodati komentar `-- ROLLBACK: ...` sa SQL-om; dokumentovati backup politiku u README (Supabase → Database → Backups, i ručni `pg_dump` pre svakog `db push` koji dira postojeće redove).

**d) Cron — jedna tačka otkaza `[POTVRĐENO]`** — `vercel.json` ima jedan unos, `0 18 * * *`. Ako izvršavanje padne (500), **nema retry-ja i nema alarma** — ruta samo vrati 500 i pošalje u Sentry. Nema health-check endpointa ni „dead man's switch"-a. Nikad nećeš saznati da push obaveštenja ćute.

**Predlog:** Sentry Cron Monitoring (besplatan) — `Sentry.withMonitor("dnevna-obavestenja", ...)` obavesti kad izvršavanje izostane.

**e) Env `[POTVRĐENO — bez nedostajućih]`** — poređenje `process.env.*` u kodu vs `.env.example`: **potpuno se poklapaju** (24 promenljive). `.env.local` nema `SENTRY_ORG`/`SENTRY_PROJECT` (upload source-map-a se tiho preskače lokalno — namerno) i `RLS_TEST_*` (idu u `.env.test.local`). ✔ Dobro održavano.

Jedina napomena: `NEXT_PUBLIC_APP_URL` se koristi kao VAPID `subject` (`lib/push.ts:30`); ako u Vercelu nije postavljen, push tiho pada na `mailto:info@sportem.rs`.

### O7. Zavisnosti — 5 „high" ranjivosti u produkcionom stablu `[POTVRĐENO]`

`npm audit --omit=dev`:

| Paket | Ozbiljnost | Šta |
|---|---|---|
| `next` 16.2.10 | high | 9 advisory-ja: **proxy/middleware bypass u App Router** (GHSA-6gpp-xcg3-4w24), DoS preko Server Actions, SSRF u Server Actions, cache confusion (2×), neautentifikovano otkrivanje Server Function endpoint-a |
| `postcss` (tranzitivno kroz next) | high | XSS + path traversal preko `sourceMappingURL` |
| `sharp` (tranzitivno kroz next) | high | libvips CVE-2026-33327/33328/35590/35591 |

**Fix je trivijalan:** `next@16.2.12` (patch verzija!). Blokira ga samo pin `"next": "16.2.10"` u `package.json`.

**Middleware bypass advisory je posebno relevantan** — cela zaštita ruta stoji na `proxy.ts` → `updateSession`. (RLS je druga linija odbrane i drži, ali PDF ruta `app/api/porudzbine/lista-za-slanje` se oslanja na `getProfile()` u samoj ruti, što je ispravno.)

`npm outdated` — 23 paketa zaostaju, sve minor/patch osim: `@types/node` 20→26, `eslint` 9→10, `typescript` 5.9→7.0 (major-i, ne dirati sada).

**Nekorišćenih zavisnosti nema** — proverio sam sve iz `dependencies` (`papaparse` → CSV uvoz, `@tanstack/react-table` → data-table, `sharp` → `scripts/generate-icons.mjs` + storage, `next-themes` → tema, `web-push`, `resend`, `serwist`, `@react-pdf/renderer` — sve u upotrebi).

**Predlog (odmah):**
```bash
npm i next@16.2.12 eslint-config-next@16.2.12
npm audit --omit=dev   # očekivano: 0
```
zatim minor bump ostalih (`@supabase/*`, `@sentry/nextjs`, `radix-ui`, `lucide-react`, `react`/`react-dom` 19.2.8).

### O8. Observability — rupe `[POTVRĐENO]`

Šta **radi**: `instrumentation.ts` + `instrumentation-client.ts` + `sentry.server/edge.config.ts` + `app/global-error.tsx`, tunel `/monitoring-tunnel`, tracing 10%, Session Replay isključen. Wiring je uredan.

Šta **nedostaje**:
1. **Server akcije ne loguju** (K4) — najveći deo poslovne logike je van Sentry-ja.
2. **Nema structured logging-a** — nula `console.*` poziva u celoj kodbazi. Sve što nije Sentry izuzetak je nevidljivo. Nema request-ID-ja, nema traga „ko je promenio status i šta je Woo odgovorio".
3. **Nema `Sentry.setUser()`** — greške stižu bez identiteta korisnika, iako `getProfile()` postoji na svakom requestu.
4. **Nema health-check rute** (`/api/health`) — nema šta da se monitoriše spolja.
5. **Nema alerting pravila** (dokumentovanih) — Sentry hvata, ali ko dobija mejl?
6. **Korisničke poruke kriju uzrok** — „Izmena cene nije uspela." je isto za RLS odbijanje, constraint violation i mrežni prekid.
7. `app/api/webhooks/woo/route.ts:56-63` — nevalidan payload vraća **200** i šalje `captureMessage` sa `level: "warning"`. Ispravno da Woo ne retry-uje, ali ako se šema promeni, dobićeš tihu poplavu warning-a koje niko ne gleda i **izgubljene porudžbine**.

**Predlog:** `Sentry.setUser({ id, role })` u `getProfile()`; `dbFail()` helper iz K4; `/api/health` koji proverava Supabase + vraća verziju build-a; Sentry alert na `level:warning` iz webhook-a (to znači izgubljena porudžbina).

---

## SITNO

### S1. `tsconfig.json` — strogost se može podići

`strict: true` ✔, ali nedostaju: `noUncheckedIndexedAccess` (hvata `arr[0]` kao možda-undefined — direktno relevantno za `orders[0]?.count` obrasce u `db/finance.ts:402`), `noUnusedLocals`, `noImplicitOverride`. `skipLibCheck: true` je OK. `target: ES2017` je bespotrebno nizak za Vercel Node 20+ (utiče na veličinu bundle-a — async/await se downlevel-uje).

### S2. `eslint.config.mjs` — nema pravila za ovaj projekat

Samo `next/core-web-vitals` + `next/typescript` + `prettier`. Nedostaje: `no-floating-promises` (relevantno — `syncNeedsVp(...)` bez `await` bi prošao tiho), `@typescript-eslint/no-unnecessary-type-assertion`, i **custom pravilo koje zabranjuje `as unknown as`** dok se ne uvedu generisani tipovi.

### S3. `scripts/fix-goods-total.mjs` je jednokratna skripta u repou

63 linije, hardkodovan default `wooId = 2818`. Trebalo bi obrisati ili premestiti u `scripts/oneoff/` sa README-om.

### S4. `.claude/settings.json` je narastao na ~130 allow pravila

Uključuje jednokratne komande sa apsolutnim putanjama do starih scratchpad sesija (`/private/tmp/claude-501/.../2db3948f-.../`) koje više ne postoje. Commit-uje se u repo. Predlog: očistiti na glob obrasce (`Bash(npm run *)`, `Bash(git *)`), ostalo u `settings.local.json` (gitignore).

### S5. Prazan `hooks/` folder + `assets/` van konvencije

`hooks/` postoji sa jednim fajlom, `assets/fonts/*.ttf` (Geist TTF za PDF) je van `public/` — namerno (`outputFileTracingIncludes`), ali nije dokumentovano u README strukturi foldera.

### S6. `db/orders.ts:143-146` — pretraga ne proverava error i ne limitira

`buildSearchOrParts` radi `supabase.from("customers").select("id").or(...)` bez limita i bez `error` provere, pa ubacuje sve ID-jeve u `customer_id.in.(...)`. Pretraga po čestom imenu („Marko") može da vrati stotine ID-jeva → dugačak URL → 414.

### S7. `sanitizeTerm` (`db/orders.ts:108-110`) uklanja `,()%` ali ne `.` ni `*`

PostgREST `or()` sintaksa i `ilike` pattern-i koriste i te znakove. Nije sigurnosna rupa (RLS štiti), ali pretraga po SKU-u sa tačkom se ponaša neočekivano.

### S8. Dokumentacija: README je zastareo

README kaže „Za lokalni razvoj baze (kasnije, Korak 0.4): `supabase start`" — a CLAUDE.md eksplicitno kaže **„Cloud + CLI, BEZ Docker-a; ne koristi se `supabase start`"**. Direktna kontradikcija. Tabela skripti u README-u ne pominje `rls:test`, `woo:test`, `backfill`, `icons`.

---

## Plan testiranja

### Izbor framework-a

**Vitest** — ne Jest.
- Radi sa ESM + TypeScript bez konfiguracije (Jest traži `ts-jest`/babel + ESM workaround-e).
- Isti `esbuild` transform kao Next 16, `@/*` alias radi kroz `vite-tsconfig-paths`.
- `vitest --coverage` (v8) bez dodatnih paketa.
- Brz dovoljno da se pokreće na `pre-commit`.

Za komponente (kasnije, nije prioritet): `@testing-library/react` + `jsdom`.
Za E2E (Faza 2): Playwright — ali **ne sada**, previše režije za tim od 2 čoveka.

```bash
npm i -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: { reporter: ["text", "html"], include: ["db/**", "lib/**"] },
  },
});
```

`package.json`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:cov": "vitest run --coverage",
"typecheck": "tsc --noEmit"
```

### Prvih 10 stvari koje MORAJU imati test

Poređano po tome koliko novca gubiš ako pukne.

| # | Šta se testira | Gde | Tip | Zašto |
|---|---|---|---|---|
| **1** | **Zamrznute cene se ne mešaju sa katalogom** — `insertOrder` snapshot: `mp_at_sale = round(line.total/qty)`, `vp_at_sale` = VP varijante **u tom trenutku**; promena kataloga posle toga **ne** menja `order_items` | `app/api/webhooks/woo/route.ts:158-291` | integracioni (test baza) | Ustav aplikacije. Bug koji je ubio Sheets tok |
| **2** | **Idempotentnost webhook-a** — isti `woo_order_id` dva puta → jedna porudžbina, jedan set stavki; `order.updated` **ne dira** `order_items`/iznose/adresu | isto | integracioni | Woo retry je svakodnevan; duplikat = duplo fakturisano |
| **3** | **`computePeriodMetrics` na >1000 porudžbina** — sintetički skup od 2500 porudžbina sa 6000 stavki; `zarada` mora biti tačna | `db/metrics.ts:30-113` | integracioni | Tačno ovaj bug je već bio u produkciji (K2/K3) |
| **4** | **Novčani helperi (čiste funkcije)** — `otkupOf`, `withPdv(base,20)` (round po porudžbini!), `pnlFrom`, `parseRsd` („3.000"→3000 vs „4990.00"→4990), `rsd()` | `db/finance.ts:39-50,544-556`, `lib/woo.ts` | unit — **trivijalno, uradi prvo** | Nula zavisnosti, 100% pokrivenost za 30 min |
| **5** | **Belgrade vreme / DST** — `belgradeDate` na granici ponoći, `previousWorkingDay` (pon→pet, uto→pon), `rangeToUtcPrefilter`, sve tri implementacije granica meseca daju **isti** rezultat | `lib/date-belgrade.ts`, `lib/period.ts`, `db/finance.ts:756`, `db/expenses.ts:29` | unit | T+1 logika uplata; DST prelaz (posl. ned. marta/oktobra) |
| **6** | **HMAC provera potpisa** — validan potpis prolazi, izmenjen bajt pada (401), prazan header pada, ping prolazi (200) | `lib/woo.ts` `verifyWooSignature`, `isWooPing` | unit | Jedina kapija javne rute |
| **7** | **RLS po roli** — Logistika: `orders`/`order_items`/`invoices`/`payouts`/`expenses` = 0 redova; `product_variants` = 0; `product_variants_public` = ima redova **bez** `mp_price`/`vp_price`/`profit`. Menadžer: čita sve, `INSERT`/`UPDATE` na `expenses` pada | `supabase/migrations/20260708172800_rls_policies.sql` | integracioni — **prenesi `scripts/rls-test.mjs` u Vitest** | 117 linija i 13 provera već postoji, samo im fali runner |
| **8** | **Životni ciklus fakture + `order_profit` NULL** — `issueInvoice(payout_ids)` postavlja `payouts.invoice_id` **i** `orders.invoice_id`; `total_amount = Σ order_profit`; **porudžbina sa jednom stavkom bez VP mora biti ODBIJENA, ne umanjena** (K7); posle izdavanja `updateItemPrice` pada; `deleteInvoice` vraća oba na null; `ISTORIJA-BACKFILL` i `placeno` zaštićeni | `app/(app)/finansije/actions.ts:267-415`, `20260710120000:36-45` | integracioni | Ovo je *ta* cifra koju drug naplaćuje — i tu je K7 |
| **9** | **Otkazivanje/vraćanje + zalihe** — obavezan razlog (server odbija prazan `note`); plaćena/fakturisana traži `force`; `force` je Admin-only; `cancelled_at` se postavlja; **`syncOrderStock` skida tačno jednom** pri: dvostrukom otkazivanju, Woo retry-ju, i **paralelnom dodavanju stavke tokom promene statusa** (R1 iz K8) | `app/(app)/porudzbine/actions.ts:321-426`, `lib/stock.ts` | integracioni | Novi kod (necommit-ovan), dve poznate trke |
| **10** | **Autorizacija svake server akcije** — parametrizovan test koji za sve 54 eksportovane akcije proverava da poziv bez sesije / sa pogrešnom rolom baca. Naročito: `setStockCount` sme Logistika ali **samo** `stock_quantity`/`stock_counted_at` (nikad cene) | svi `app/**/actions.ts` | integracioni | Kapija je `requireRole`; jedan zaboravljen poziv = rupa |

**Bonus 11 (jeftino, veliki povrat):** snapshot test da `.select()` bez `error` provere ne postoji — ESLint custom pravilo ili grep u CI:
```bash
! grep -rn "const { data } = await supabase" db app lib
```
Danas bi to prijavilo **46 mesta**.

### Kako to pokretati — dve trake

**Traka A: unit (bez baze), pokreće se svuda**
Stavke 4, 5, 6 + čiste funkcije iz `db/catalog-types.ts` (`isVariantLowStock`), `lib/notifications.ts` (`resolveChannel`), `db/customer-risk.ts` (`matchCancellations` — prima indeks kao argument, savršeno testabilno). Bez mreže, <2 s. **Ovo je 60% vrednosti za 20% truda — počni ovde.**

**Traka B: integracioni (traži bazu)**
Stavke 1, 2, 3, 7, 8, 9, 10. Opcije po ceni:
1. **Supabase branching** (Pro plan) — svaki PR dobija svoju bazu. Najčistije, košta.
2. **Zaseban „staging" Supabase projekat** (free tier) + `supabase db reset --linked` pre suite-a. Preporuka za sada.
3. `supabase start` lokalno (Docker) — CLAUDE.md ga eksplicitno isključuje za razvoj, ali za **CI** je legitiman: `supabase/setup-cli` action pokreće lokalnu instancu u GitHub runneru bez Docker-a na tvom Mac-u.

Preporuka: **opcija 3 za CI, opcija 2 za ručno lokalno**.

### CI

`.github/workflows/ci.yml` — na svaki push i PR:

```yaml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck          # tsc --noEmit
      - run: npm run lint
      - run: npm run format:check
      - run: npm run test               # Traka A — unit, bez baze
      - run: npm audit --omit=dev --audit-level=high

  db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start             # lokalni Postgres u runneru
      - run: supabase db reset          # primeni SVE migracije + seed
      - run: npm ci && npm run test:db  # Traka B — integracioni
```

Job `db` usput dokazuje da **migracije uopšte prolaze od nule** — to danas niko ne proverava, a `20260712140000_split_cancel_return_status.sql` zavisi od redosleda i postojećih redova.

Dodatno: **branch protection na `main`** (zahteva zeleni CI). Trenutno se commit-uje direktno na `main` koji je i deploy grana — CI bez toga je samo obaveštenje posle činjenice.

### Redosled uvođenja (realan za tim od 2)

| Nedelja | Šta |
|---|---|
| 0 | **Hitno, bez testova:** `next@16.2.12` (O7) + popravka `order_profit` view-a i blokade `needs_vp` u `issueInvoice` (K7). ~2 h. |
| 1 | Vitest + Traka A (stavke 4, 5, 6) + `typecheck`/`lint` u CI. ~4 h. |
| 2 | `supabase gen types` + brisanje 23 `as unknown as` (O1). ~4 h. |
| 3 | `selectAll()` helper + zamena svih 9 mesta iz K2 + `dbFail()` iz K4. ~6 h. |
| 4 | Staging baza + Traka B stavke 1, 2, 7 (webhook + RLS — `rls-test.mjs` se samo prepisuje u Vitest). ~6 h. |
| 5 | Test 8 (faktura + K7 regresija) i test 9 (zalihe + K8 trke) **pre** commit-ovanja `lib/stock.ts`. ~6 h. |
| 6+ | Stavke 3, 10 + indeksi i constraint-i iz P4 kako se dodiruju ti delovi. |

---

## Predlozi (strukturni)

### P1. `CLAUDE.md` je postao changelog — razdvojiti

55.642 bajta / ~250 linija guste proze. Struktura je danas: 10 numerisanih sekcija (uputstvo) + **19 nenumerisanih „dodataka"** hronološki nalepljenih posle njih, od kojih neki poništavaju gornje sekcije:

- Sekcija 3 kaže „Email nije u Fazi 1" → dodatak „Korak 1.9 dopuna" kaže da jeste.
- Sekcija 3 kaže „auto-decrement inventara NIJE u Fazi 1" → `lib/stock.ts` postoji.
- Sekcija 5 kaže „koristiti `date-fns-tz`" → dodatak 1.6 kaže „NE koristi se `date-fns-tz`".
- Sekcija 3 kaže statusi „Otkazano/Vraćeno" (jedan) → dodatak kaže dva.
- Sekcija 10 „Napomene / razrešene kontradikcije" pokušava da to reši, pa i sama zastareva.

Model čita ceo fajl na startu svake sesije. Kontradikcije = nedeterminističko ponašanje.

**Predlog — razdvojiti na tri fajla:**

```
CLAUDE.md              ≤ 150 linija — SAMO ono što važi DANAS
├─ Šta je projekat (5 linija)
├─ Zaključane odluke (aktuelne, bez istorije promena)
├─ Zamrznute cene (ustav — netaknuto)
├─ Tehničke konvencije (aktuelne — Intl umesto date-fns-tz itd.)
├─ Stack, struktura, komande
└─ Zlatno pravilo
   → svaka stavka linkuje na docs/odluke/NNN-*.md ako treba obrazloženje

docs/odluke/           ADR-ovi, jedan fajl po odluci
├─ 001-zamrznute-cene.md
├─ 014-email-kanal-u-fazi-1.md        (menja 003)
├─ 018-intl-umesto-date-fns-tz.md
├─ 022-razdvojeni-otkazano-vraceno.md
├─ 027-fakturisanje-po-uplatama.md    (menja 019)
└─ ...
   svaki: Kontekst · Odluka · Posledice · Menja/Zamenjuje #NNN

docs/CHANGELOG.md      Hronologija koraka (ono što je danas „dodatak" u CLAUDE.md)
```

**Pravilo:** kad se odluka promeni — **prepiši** je u CLAUDE.md (ne dodaj ispod) i napiši novi ADR koji „menja #NNN". CLAUDE.md nikad ne raste.

**Odmah, bez restrukturiranja:** razrešiti 4 kontradikcije gore u sekcijama 3 i 5, i dokumentovati `lib/stock.ts` (danas nije ni u jednoj sekciji — samo u necommit-ovanom diff-u).

### P2. Preseliti agregaciju novca u Postgres

Danas se zarada računa u JS-u nad hiljadama redova povučenih preko HTTP-a, na tri različita načina (O2), sa tihim odsecanjem (K2/K3). View `order_profit` već postoji (`20260710120000_finansije.sql`) ali ga `computePeriodMetrics` ne koristi.

**Predlog:** jedna Postgres funkcija
```sql
create function period_metrics(p_from date, p_to date)
returns table (zarada bigint, promet bigint, broj int, troskovi bigint)
```
koja radi `sum()` unutar baze uz `at time zone 'Europe/Belgrade'`. Rezultat: jedan round-trip umesto 15+, nema row cap-a, nema chunk-ovanja, nema tri kopije formule, i **Dashboard/Finansije/lista porudžbina matematički ne mogu da se raziđu**.

### P3. `db/` sloj: uvesti jedan obrazac pristupa

Danas svaka funkcija u `db/**` sama zove `await createClient()` (46 puta), sama radi cast, sama (ne) proverava error. Predlog: tanak wrapper
```ts
// db/_client.ts
export async function q<T>(fn: (db: TypedClient) => PostgrestBuilder<T>): Promise<T[]>
```
koji **uvek** proverava `error` (throw), **uvek** paginira, i vraća generisani tip. Migracija je mehanička, fajl po fajl, i briše i K2 i K4 i O1 odjednom.

### P4. Jedna „hardening" migracija za bazu

Sve iz Dodatka A staje u jednu migraciju koja ne menja nijedan podatak — samo dodaje zaštitu:

```sql
-- 1. Novac ne može biti negativan
alter table product_variants add constraint mp_nonneg check (mp_price >= 0);
alter table product_variants add constraint vp_nonneg check (vp_price >= 0);
alter table order_items    add constraint mp_sale_nonneg check (mp_at_sale >= 0);
alter table order_items    add constraint vp_sale_nonneg check (vp_at_sale is null or vp_at_sale >= 0);
alter table order_items    add constraint qty_pos check (quantity > 0);
alter table payouts        add constraint amount_nonneg check (amount >= 0);
alter table expenses       add constraint amount_nonneg check (amount >= 0);
-- NAPOMENA: postage_settlements.amount NAMERNO ostaje bez CHECK-a (predznak je deo modela)

-- 2. Status po imenu mora biti jedinstven (ceo app ga tako razrešava)
alter table order_statuses add constraint order_statuses_name_key unique (name);
alter table expense_categories add constraint expense_categories_name_key unique (name);

-- 3. Indeksi (v. A1)
create index concurrently orders_cancelled_idx on orders (cancelled_at) where cancelled_at is not null;
create index concurrently orders_ordered_at_desc_idx on orders (ordered_at desc nulls last);
create index concurrently orders_payout_candidates_idx on orders (status_id, delivered_at)
  where delivery_method = 'xexpress' and payment_status = 'neuplaceno' and payout_id is null;
create index concurrently orders_needs_vp_idx on orders (id) where needs_vp;
create index concurrently orders_needs_review_idx on orders (id) where needs_review;
create index concurrently payouts_payout_date_idx on payouts (payout_date desc);

-- 4. order_profit — NULL-safe (K7)
create or replace view order_profit with (security_invoker = true) as
select order_id,
       case when count(*) filter (where profit_at_sale is null) > 0
            then null else sum(profit_at_sale) end as profit
from order_items group by order_id;
```

Pre primene proveriti da postojeći podaci prolaze CHECK-ove (`select count(*) from order_items where quantity <= 0` itd.) — ako ne prolaze, to je samo po sebi nalaz.

Odvojeno (traži odluku): `order_items.order_id` sa `CASCADE` na `RESTRICT` ili `before delete` trigger koji odbija brisanje fakturisane porudžbine (A2e).

### P5. Woo push → red poslova

`pushWooStatus` je best-effort HTTP poziv unutar korisničke akcije (K5). Predlog: tabela `woo_sync_queue (order_id, target_status, attempts, last_error)` + obrada u postojećem cron-u. Akcija postaje instant, greške su vidljive i ponovljive, bulk prestaje da bude timeout bomba.

---

## Dodatak A — Audit šeme baze (15 migracija + seed + profiles)

### A0. Šta je verifikovano kao ISPRAVNO ✅

- **`orders.woo_order_id` je UNIQUE** (`init_schema.sql:164`) → idempotentnost webhooka je stvarno pokrivena na nivou baze; webhook hvata `23505` (`route.ts:236-240`). Nullable je (lične porudžbine), više NULL-ova dozvoljeno — korektno.
- **Svi novčani iznosi su `int`.** Nula `numeric`/`decimal`/`float`/`real`/`double`/`money` u svih 15 migracija. Jedini ne-`int` je `woo_order_id bigint` (spoljni ID). **Pravilo iz CLAUDE.md §5 je 100% ispoštovano.**
- **Nijedna tabela bez RLS**, nijedna politika za `anon`. Sve 4 kasnije dodate tabele uredno rade `enable row level security`.
- **Nijedan view ne curi finansije Logistici.** `product_variants_public` nema `mp_price`/`vp_price`/`profit`; `order_profit` je `security_invoker = true` pa Logistika dobija 0 redova.
- **`current_app_role()` i `apply_stock_delta`** — ispravan `security definer` + `set search_path = ''` + schema-kvalifikovani pozivi + `revoke from public/anon` + ciljani `grant`. Nema rekurzije na `profiles` RLS.
- **Generisane kolone** (`profit`, `profit_at_sale`) — formule ispravne, NULL propagacija namerna.
- `order_items`, `expenses`, `postage_settlements`, `notification_log`, `push_subscriptions` su indeksno pokriveni.

### A1. Indeksi koji NEDOSTAJU

| Prioritet | Indeks | Zašto |
|---|---|---|
| 🔴 | `orders (cancelled_at) where cancelled_at is not null` | `buildCancellationIndex` (`db/customer-risk.ts:67`) radi **pun scan na svakom renderu liste porudžbina i na svakoj novoj porudžbini u webhooku** |
| 🔴 | `orders (ordered_at desc nulls last)` | Postojeći `orders_ordered_at_idx` je `ASC NULLS LAST`; upit (`db/orders.ts:178`) traži `desc nulls last` — **ne poklapa se**, planner mora eksplicitan sort |
| 🔴 | `orders (status_id, delivered_at) where delivery_method='xexpress' and payment_status='neuplaceno' and payout_id is null` | Kandidati za uplatu (`db/finance.ts:62-67`) — 4 filtera, indeksiran samo `status_id`; zove se i sa Dashboarda |
| 🟠 | `orders (id) where needs_vp` + isto za `needs_review` | Dva puna `count` scana po Dashboard renderu (`db/dashboard.ts:57, :65`) |
| 🟠 | `payouts (payout_date desc)` | Sortira se po njemu na 2 mesta (`db/finance.ts:104, :306`) |
| 🟠 | `pg_trgm` + GIN na `orders(ship_name, ship_phone)`, `customers(name, phone, email)` | Pretraga koristi `ilike %…%` (`db/orders.ts:132-140`) — B-tree je beskoristan |
| 🟡 | `orders (delivered_at)`, `(payment_status)`, `(delivery_method)` | Koriste se u filterima liste i finansija |

**Dva postojeća indeksa su praktično mrtva:** `product_variants_active_idx` i `product_variants_uncounted_idx` su oba na koloni **`(id)`** (već PK) sa parcijalnim WHERE. Pošto upiti selektuju `sku`, `stock_quantity`, `low_stock_threshold` + embed `products(...)`, index-only scan je nemoguć → planner bira seq-scan. Da budu korisni, moraju nositi payload: `on product_variants (stock_counted_at, stock_quantity) where archived_at is null`.

### A2. Constraint-i koji nedostaju — svi štite novac

| # | Nedostaje | Rizik |
|---|---|---|
| **A2a** | **Nijedan `CHECK (>= 0)` na novčanim kolonama.** U celoj šemi postoje **samo 4 CHECK-a**, i nijedan ne dira novac (`profiles.role`, `invoices.status`, `orders.delivery_method`, `orders.payment_status`) | Negativan `vp_price` (tipfeler u CSV uvozu) **naduvava** `profit` generisanu kolonu i sve zamrznute `profit_at_sale`. Jedina zaštita je Zod. Napomena: `postage_settlements.amount` **mora ostati bez CHECK-a** (predznak je namerni) |
| **A2b** | `order_items.quantity` bez `CHECK (quantity > 0)` (`init:216`) | Negativna količina kroz `apply_stock_delta` **povećava** stanje i daje negativan profit |
| **A2c** | **`order_statuses.name` bez UNIQUE**, a ceo app razrešava status po imenu (`.eq("name", …).maybeSingle()` na ~12 mesta) **i UI dozvoljava Adminu da preimenuje/doda status** (`podesavanja/actions.ts:112-113`) | Dva statusa istog imena → `maybeSingle()` puca → funkcija tiho vraća `null`/`[]` (kandidati za uplatu postaju prazni). Preimenovanje „Isporučeno" **tiho gasi ceo tok uplata i fakturisanja.** Poklapa se sa nalazom B2g |
| **A2d** | `expense_categories.name` bez UNIQUE → **`seed.sql` nije idempotentan** (`:21-23` koristi `on conflict do nothing` **bez arbitra**) | Svako ponovno pokretanje seed-a duplira „Reklame/Pakovanje/Ostalo" |
| **A2e** | `order_items ON DELETE CASCADE` (`init:212`) + `orders_admin_write FOR ALL` (`rls:107-110`) | Brisanje `orders` reda **tiho briše zamrznute cene** — i za porudžbine koje su na fakturi. `assertEditable` pokriva samo izmene *stavki*, ne brisanje porudžbine. Admin sme DELETE i direktno iz browser klijenta. Treba `RESTRICT` ili `before delete` trigger |
| **A2f** | Ništa ne čuva konzistentnost **dvostruke veze na fakturu** — `orders.invoice_id` **i** `payouts.invoice_id` opisuju istu činjenicu, sinhronizuje ih samo app kod (`finansije/actions.ts:334, :396`) | Moguće stanje „porudžbina je na fakturi A, njena uplata na fakturi B" ili „porudžbina ima `invoice_id`, uplata nema". Najozbiljnija strukturna duplikacija u šemi (v. K6) |
| **A2g** | Nema veze status ↔ datumi | „status Isporučeno, `delivered_at` NULL" je dozvoljeno |
| **A2h** `[SUMNJA]` | `notification_log.reference_id` je nullable a deo UNIQUE indeksa → uz default `NULLS DISTINCT` dedup ne bi radio za NULL | Proverio sam sve pozivaoce — svi šalju non-null string, **trenutno nije živ bug**. Ipak treba `not null` |

### A3. RLS — jedna važna napomena

RLS je uredan (v. A0), **ali nije prava kapija za WRITE.** Sve write politike su `admin`-only, a Menadžer i Logistika pišu kroz `createAdminClient()` koji **potpuno zaobilazi RLS**: `porudzbine/actions.ts` (promena statusa — Menadžer), `katalog/actions.ts:396` `setStockCount` (Logistika), `lib/stock.ts:34`.

To je dokumentovano i namerno, ali znači: **jedan zaboravljen `requireRole` = pun write nad finansijama, bez drugog sloja odbrane.** Zato je test br. 10 iz plana testiranja (parametrizovana provera autorizacije svih 54 akcije) visoko na listi.

Sitno: `notification_log` je jedina tabela sa RLS bez ijedne politike — namerno (service-role only), verifikovano ✅.

### A4. Destruktivne migracije bez ijednog rollback skripta

**Nijedna od 15 migracija nema down skriptu.** Radni tok je `supabase db push` na cloud bez lokalnog Postgresa → **nema ni `db reset` kao izlaz.**

| Migracija | Šta trajno uništava |
|---|---|
| 🔴 `20260712120000_low_stock_default_5.sql:4-6` | `update … set low_stock_threshold = 5 where low_stock_threshold <> 5` — bezuslovan UPDATE nad celom tabelom, **briše svaki custom prag**. Nepovratno. Bonus: BEFORE-UPDATE trigger prepisuje `updated_at` svakom pogođenom redu. Uz to forma i dalje dozvoljava unos praga, pa migracija „normalizuje" ono što app odmah nastavlja da razjednačava |
| 🔴 `20260731120000_stock_count.sql:31-33` | `set stock_counted_at = updated_at where stock_quantity > 0`. **Dva problema:** (1) posle ovoga je nemoguće razlikovati stvarno popisanu od backfill-ovane varijante; (2) **skriveni side effect** — `SET x = updated_at` čita staru vrednost dok BEFORE-UPDATE trigger istovremeno postavlja `updated_at = now()`, pa migracija **uništava pravi `updated_at` celog popisanog kataloga.** Nije dokumentovano nigde. `db/catalog.ts:23` selektuje `updated_at` → „poslednja izmena" je posle ovoga lažna |
| 🟠 `20260712140000_split_cancel_return_status.sql:13-15` | Preimenovanje statusa po **hardkodovanom seed UUID-u**; stari naziv nepovratno izgubljen. Ako je Admin u međuvremenu preimenovao status kroz UI, migracija ga tiho pregazi |
| 🟡 `20260709100000`, `20260710140000` | `create policy` bez `if not exists` → rerun puca na `42710` |

**Predlog:** uz svaku destruktivnu migraciju obavezan `-- ROLLBACK:` komentar sa SQL-om, i `pg_dump` pre `db push` koji dira postojeće redove (v. O6c).

### A5. Mrtve i degenerисane kolone

| Kolona | Stanje |
|---|---|
| `orders.cod_amount` | **Poluмrtva** — i dalje se **piše** (`webhooks/woo/route.ts:224`), ali se **ne koristi ni u jednom novčanom računu** (zamenjena sa `otkupOf()`); `shipping-pdf.tsx:119` eksplicitno kaže „nepouzdan". Kandidat za `comment on column … 'DEPRECATED'` ili drop |
| `product_variants.stock_counted_by` | **Write-only** — upisuje se na 4 mesta, ali nije ni u `product_variants_public` view-u ni u `VARIANT_COLS`. **Niko je ne čita.** „Ko je popisao" se nigde ne prikazuje |
| `invoices.period_from` / `period_to` | **Degenerisale** — `finansije/actions.ts:303-304` upisuje `period_from = period_to = invoice_date`. Posle prelaska na fakturisanje po uplatama više ne nose informaciju, a i dalje se prikazuju → korisnik vidi „period od X do X" |
| `xexpress_invoices.vat_rate` | **Polovično poštovan** `[SUMNJA]` — `db/finance.ts:673, :734, :741` je korektno koriste, ali `getSaldoPostarine` (`:496`) zove `withPdv(o.shipping_actual)` **bez rate argumenta** → hardkodovani default 20, ignoriše `vat_rate` fakture. Ako se stopa promeni, global saldo i P&L po fakturi će se razići |
| `products.attribute_names` vs `product_variants.attributes` | Nema constraint-a da su ključevi u `attributes` podskup `attribute_names` — tiha divergencija moguća |

### A6. Trostruko modelovanje poštarine

`orders.shipping_charged/shipping_actual` + `xexpress_invoices` (grupisanje) + `postage_settlements` (ledger). Namerno po dizajnu, ali: `gross` se svaki put **rekomputuje** iz `orders` (`finance.ts:490-496`) dok `balance_before` čuva **snapshot** — dva izvora istine za isti saldo, bez ijedne provere da se slažu.

## Dodatak B — Audit keširanja, revalidacije i renderovanja

### B0. Glavni zaključak: ustav „online-only" JESTE ispoštovan — ali slučajno

**Rizik da se prikaže zastarela finansijska cifra je danas praktično nula**, i to na četiri nezavisna sloja:
1. **Full Route Cache** — nema nijednog unosa (sve `force-dynamic` + `cookies()` u layoutu).
2. **Data Cache** — `@supabase/ssr` koristi običan `fetch` bez `next: { revalidate }`; u Next 15+ `fetch` nije keširan po defaultu.
3. **Client Router Cache** — `next.config.ts` nema `experimental.staleTimes` → `staleTime = 0` za dynamic segmente; uz to **33** eksplicitna `router.refresh()` poziva.
4. **Service Worker** — `app/sw.ts` bez `defaultCache`, `cacheOnNavigation: false`, `runtimeCaching` samo `/_next/static/` i ikonice.

**ALI:** ta svežina počiva na tome što je *sve* dynamic, a **ne** na tome što je revalidacija tačna. Revalidacija je danas u velikoj meri pogrešna (v. B2) — samo je bezopasna. Jedan uklonjen `force-dynamic`, uključen `cacheComponents`, ili `staleTimes.dynamic > 0` pretvara ceo B2 u niz realnih bugova sa zastarelim novcem. **Popraviti iako trenutno ništa ne kvari.**

### B1. Režim renderovanja — 18/18 `force-dynamic`, i svih 18 je redundantno

`app/(app)/layout.tsx:9` zove `getProfile()` → `cookies()`, što **ceo `(app)` segment već prevodi u dynamic**. Svaki `export const dynamic = "force-dynamic"` unutar grupe je tehnički bez efekta. Nije štetno (dokumentuje nameru, osigurava od uklanjanja `cookies()`), ali treba znati da nije to što drži svežinu.

U celom repou **ne postoji** nijedan `export const revalidate`, `fetchCache`, `dynamicParams`, `generateStaticParams`. Jedan `runtime` export (`lista-za-slanje`, `nodejs` — ispravno, `@react-pdf` čita font sa diska).

`revalidateTag` — **nigde**. `unstable_cache` / `"use cache"` / `cacheComponents` — **nigde**. `React.cache()` — **jedno mesto**, `lib/auth.ts:27` (`getProfile`), i tu radi ispravno (layout + page = 1 upit).

### B2. `revalidatePath` — 27 poziva, većina pogrešno usmerena

| # | Nalaz | Dokaz |
|---|---|---|
| **B2a** | **`revalidatePath("/finansije")` je mrtav poziv na 5 mesta.** `app/(app)/finansije/page.tsx` je čist `redirect("/finansije/uplate")` bez ijednog podatka. Komentar u tom fajlu čak kaže da se stranica drži „zbog `revalidatePath('/finansije')`" — kružno rezonovanje. | `finansije/actions.ts:35,233,434,442`; `troskovi/actions.ts:27` |
| **B2b** | **Troškovi revalidiraju pogrešnu rutu.** `revalidateExpenses()` cilja `/finansije` sa komentarom „neto profit čita expenses.amount" — ali neto profit se prikazuje na **dashboardu** (`app/(app)/page.tsx:93-98` → `getDashboardMetrics` → `db/metrics.ts:99`). Treba `revalidatePath("/")`. | `troskovi/actions.ts:27` |
| **B2c** | **Promena statusa ne revalidira nijednu rutu na kojoj se te cifre vide.** `changeOrderStatus`/`changeOrdersStatus`/`markOrdersShipped` menjaju `status_id`, `delivered_at`, `cancelled_at` i preko `syncOrderStock` i **`variants.stock_quantity`**. Nedostaje: `/` (zarada, marža, 4 „čeka" kartice, „Niska zaliha"), `/katalog` + `/katalog/[id]` (stanje!), `/finansije/uplate`, `/finansije/fakture`, `/finansije/postarina/fakture/*`. | `porudzbine/actions.ts:40-45, :600, :725` |
| **B2d** | **Edit stavki ne revalidira finansije.** 5 akcija menja `profit_at_sale`/`goods_total`/`needs_vp`, a revalidira se samo `/porudzbine`. Te vrednosti čitaju `/` , `/finansije/uplate[/id]` (`profitByOrder`), `/finansije/fakture` („Drug mi duguje"). | `porudzbine/actions.ts:179,214,242,262,308` |
| **B2e** | **Nekonzistentnost u istom fajlu.** `revalidateXexpress` revalidira `/porudzbine` (menja `orders.xexpress_invoice_id`) — ali `revalidatePayouts` (menja `orders.payment_status`) i `revalidateInvoices` (menja `orders.invoice_id`, što **zaključava edit stavki**) to ne rade. Isto pravilo, tri ishoda. | `finansije/actions.ts:34-38, :232-236, :441-446` |
| **B2f** | **Katalog akcije ne revalidiraju dashboard.** `setStockCount`, `updateVariant` (`low_stock_threshold`), `archiveVariant`, `deleteVariant` menjaju tačno ono što dashboard prikazuje u „Niska zaliha" + brojaču nepopisanih. Nedostaje i `/porudzbine/[id]` (`getActiveVariantOptions`). | `katalog/actions.ts:28-31`, `katalog/uvoz/actions.ts:274` |
| **B2g** | **Najopasnije po arhitekturi:** `upsertOrderStatus`/`deleteOrderStatus` revalidiraju 2 rute, a lookup statusa **po imenu** (`APP_STATUS`) koristi **~12 mesta** u kodu. Preimenovanje statusa tiho obara sve njih. | `podesavanja/actions.ts:27-30` |
| **B2h** | `savePreferences` nema **nijedan** `revalidatePath`, a `obavestenja/page.tsx:23-27` čita tu tabelu. | `obavestenja/actions.ts:24-45` |

**Predlog:** preći na `revalidateTag` sa 4 taga — `orders`, `finance`, `catalog`, `settings` — i tagovati `db/**` upite. To ukida celu klasu grešaka umesto da se krpi 27 poziva.

### B3. Duplirani upiti u jednom renderu `[POTVRĐENO]`

| Ruta | Šta se duplira | Gde |
|---|---|---|
| `/` (dashboard) | **`order_statuses` čitan 3×** | `db/metrics.ts:40` + `db/dashboard.ts:17` + `db/finance.ts:16` |
| `/porudzbine` | `order_statuses` 2× | `db/orders.ts:285` + `:321` |
| `/porudzbine?risky=1` | **`buildCancellationIndex` 2×** — a to je pun skan svih otkazanih porudžbina sa join-om, bez limita | `db/orders.ts:180` + `:293` |
| `/porudzbine/[id]` | `getOrderStatuses` + ponovni cancellation index | `db/orders.ts:321`, `db/customer-risk.ts:113` |
| `/podesavanja` | `getClaims()` 2× | `podesavanja/page.tsx:19` vs `lib/auth.ts:29` |

`order_statuses` je sitna referentna tabela koja se menja par puta godišnje — idealan kandidat za jednu `cache()`-ovanu `getStatusMap()`. Ovo se poklapa sa nalazom O2 (11 kopija lookup logike).

**Bonus:** `lib/supabase/server.ts:10` `createClient()` nije `cache()`-ovan → 8+ instanci po requestu na dashboardu. Jeftino, ali `export const createClient = cache(...)` je semantički ispravno i besplatno.

### B4. Waterfall-ovi — nivo stranica je dobar, `db/` sloj nije `[POTVRĐENO]`

**Dobro:** `Promise.all` je na mestu u **12** stranica (`page.tsx:45-50`, `porudzbine/page.tsx:64-68`, `porudzbine/[id]/page.tsx:49-54`, itd.).

**Loše — sve je jedan sloj niže:**

| Mesto | Problem |
|---|---|
| `db/metrics.ts:37-104` | **Najkritičniji.** `order_statuses` (`:40`) i `expenses` (`:99`) su nezavisni od svega, a idu sekvencijalno. Chunk petlja `:82-88` je **sekvencijalna** — 1000 porudžbina = 5 uzastopnih round-tripova, 5000 = 25. Dubina waterfalla je **linearna po broju porudžbina.** |
| `db/finance.ts:705-741` | `getXexpressInvoiceDetail` — ~5 uzastopnih round-tripova; `:739` (`getEligibleXexpressOrders`, i sam 3-deep) je potpuno nezavisan od `:709`/`:717` |
| `db/finance.ts:605-618` | `eligibleXexpressStatusIds()` i `xexpressHistoryBoundary()` su nezavisni, idu sekvencijalno |
| `db/finance.ts:486-505` | `getSaldoPostarine` — dva potpuno nezavisna upita sekvencijalno |
| `db/orders.ts:249-308` | `getOrdersSummary` — 5 sekvencijalnih faza; `:285` i `:293` mogu paralelno sa `:275` |
| `finansije/uplate/[id]/page.tsx:31-33` | `getPayoutDetail` pa `getPayoutSpisak` — nezavisni (isti `id`), 4 round-tripa umesto 2. Jedini razlog za redosled je `notFound()` guard — `Promise.all` pa guard posle |
| `db/dashboard.ts:53-56` | `statusIdByName` blokira `Promise.all` iako 3/4 upita u njemu ne zavise od njega |
| `api/webhooks/woo/route.ts:162-163` | `upsertCustomer` + `getStatusId` — nezavisni |

### B5. Nula streaming-a: nema `<Suspense>`, nema `error.tsx` `[POTVRĐENO]`

- **Jedan `loading.tsx`** za ceo `(app)` segment; **nijedna** ruta nema svoj. Renderuje generički `TableSkeleton` — i na `/podesavanja`, `/obavestenja`, `/katalog/uvoz` gde nema tabele.
- **`<Suspense>` u serverskim komponentama: nigde.** Jedini u repou je klijentski, za `useSearchParams` boundary (`prijava/page.tsx:50`).
- **Nema `error.tsx` ni `not-found.tsx` nigde.** `notFound()` se poziva na **5 mesta** (`porudzbine/[id]:47`, `finansije/uplate/[id]:32`, `finansije/fakture/[id]:33`, `postarina/fakture/[id]:35`, `.../izmena:26`) i sve pada na Next-ov default 404 **koji izlazi iz `AppShell`-a** — bez sidebara, bez bottom nava. (`app/global-error.tsx` postoji i pokriva samo root-level krahove, ne per-rutu.)

**Posledica:** svaka stranica blokira **kompletan** HTML dok se ne završi najsporiji upit u `Promise.all`. Dashboard: brze `count` kartice čekaju `computePeriodMetrics` sa paginiranim skanom. `/porudzbine`: lista čeka `getOrdersSummary`.

**Predlog:** obaviti spore agregate u `<Suspense>` sa sopstvenim skeletonom — kartice se pojave odmah, cifre dokapaju. Dodati `(app)/error.tsx` i `(app)/not-found.tsx`.

### B6. Klijentske komponente — obrazac je ispravan

**60 fajlova sa `"use client"`, ~8.958 linija.** Ali:
- **Nema klijentskog fetch-ovanja poslovnih podataka.** Jedini `fetch` na klijentu je `use-push.ts:85,110` ka `/api/push/*` — legitimno.
- Nema `createBrowserClient`, `useSWR`, `useQuery`, `useEffect(fetch)`.
- `AppShell` je **serverska** komponenta; `Sidebar`/`BottomNav` su klijentski samo zbog `usePathname`. Client boundary je gurnut do lista stabla — tačno ispravno.

**Mesta za pogled:**
- `porudzbine/[id]/order-items-editor.tsx` (457 l.) prima **ceo aktivni katalog** (`getActiveVariantOptions`) kao props → veliki RSC payload na svakoj detalj-stranici porudžbine.
- **`app/(app)/stil/komponente/page.tsx` (304 l., `"use client"`) + `stil/page.tsx` (266 l.)** — showcase dizajn sistema je **prava ruta u produkcionom build-u, bez ijednog role gate-a** (ne zove ni `requireRole` ni `getProfile`). ~570 linija dev-only sadržaja isporučenih korisnicima. Predlog: gate na `admin` ili isključiti iz prod build-a.
- **`orders-refresh.tsx:20-27`** — auto `router.refresh()` **svakih 60 s** dok je tab vidljiv, renderuje se i na `/porudzbine` **i na dashboardu** (`page.tsx:19,:82`). Znači: `computePeriodMetrics` sa paginiranim skanom se pokreće svakih 60 s **po otvorenom tabu**. Uz B4, ovo je najskuplji ponavljajući posao u aplikaciji.

### B7. Preostala sumnja

**Back/forward navigacija `[SUMNJA]`** — u App Routeru se povratna navigacija servira iz Router Cache-a i za dynamic segmente, nezavisno od `staleTime`. Scenario: `/finansije/uplate` → `/porudzbine` → promeni status → Back. Pošto `revalidateOrder()` čisti samo `/porudzbine`, unos za `/finansije/uplate` nije eksplicitno invalidiran. **Ovo je jedini mehanizam gde bi B2 postao vidljiv danas.** Vredi ručno testirati; ako se potvrdi, popravka je upravo dodavanje nedostajućih putanja iz B2.
