# Audit — Porudžbine + WooCommerce integracija (Sportem OS)

Datum: 2026-07-31 · Grana `main` · Uključuje NEKOMITOVANI rad na automatskom skidanju zaliha
(`lib/stock.ts`, `supabase/migrations/20260731140000_order_stock_decrement.sql`, izmene u
`app/(app)/porudzbine/actions.ts`, `app/api/webhooks/woo/route.ts`, `scripts/woo-webhook-test.mjs`).

Legenda: **[P]** = potvrđeno čitanjem koda · **[S]** = sumnja / traži proveru na živoj bazi.

---

## KRITIČNO

### K1 — `stock_applied` prekidač i primena delta NISU atomični [P]
`lib/stock.ts:81-99` (`syncOrderStock`) radi dva odvojena HTTP poziva: `claimFlag()` (UPDATE
`orders.stock_applied`) pa `applyDeltas()` (RPC `apply_stock_delta`). Komentar u fajlu tvrdi da je
to bezbedno „jer je RPC jedan statement" — to štiti od konkurentnosti unutar RPC-a, ali ne i od
prekida između dva poziva.

Dva scenarija koja realno pucaju:
1. **Gubitak skidanja.** Vercel funkcija umre (timeout / OOM / deploy / prekinuta konekcija) posle
   `claimFlag` a pre `applyDeltas`. Rezultat: `stock_applied = true`, a stanje NIJE skinuto. Ovo se
   nikad samo ne popravi — svaki sledeći `reserve` vidi flag `true` i tiho vraća `true` (linija 85).
2. **Duplo skidanje.** RPC se izvrši u bazi, ali odgovor ne stigne (mrežni timeout / 502 sa
   Supabase gateway-a). `applyDeltas` baci → `catch` na liniji 88-92 **vrati flag na `false`** i
   baci dalje. Stanje je već skinuto, a flag kaže da nije → sledeći `reserve` (npr. reopen ili
   retry webhooka) skida **drugi put**.

**Predlog:** premestiti CELU logiku u jednu plpgsql funkciju/transakciju:
```sql
create function public.apply_order_stock(p_order_id uuid, p_reserve boolean) returns boolean ...
-- update orders set stock_applied = p_reserve where id = p_order_id and stock_applied <> p_reserve
--   → if not found: return false
-- update product_variants v set stock_quantity = v.stock_quantity + (case when p_reserve then -1 else 1 end) * i.quantity
--   from order_items i where i.order_id = p_order_id and i.variant_id = v.id
-- return true
```
Sve u jednom statement-u iz Node-a → ili se desi celo ili ništa. Time nestaje i K1 i O4.

### K2 — Popis zaliha i rezervacija se ne mire → fantomska/izgubljena roba [P]
Popis (`setStockCount`, `app/(app)/katalog/actions.ts:395`), forma varijante i CSV uvoz pišu
**apsolutnu** cifru u `stock_quantity`. Rezervacija (`lib/stock.ts`) piše **relativnu** deltu na tu
istu kolonu. Nema nijednog mesta gde se te dve semantike izmire.

Scenario koji se dešava svakodnevno:
1. Porudžbina od 2 kom → stanje 12 → 10, `stock_applied = true`.
2. Logistika popiše fizičku policu: prebroji 10 komada, upiše 10 (`stock_counted_at` = sada).
3. Kupac vrati porudžbinu → `release` → +2 → **12**, iako fizički ima 10 (roba se vratila u
   magacin, ali popis je već obuhvatio te komade — ili nije, i to niko ne zna).

Obrnuti smer je isto tako loš: popis usred „živog" toka „briše" rezervaciju, pa sledeće otkazivanje
izmišlja robu. Ovo direktno kvari upravo onaj problem koji je popis (migracija `20260731120000`)
trebalo da reši.

**Predlog:** razdvojiti „na stanju" od „rezervisano" — `stock_quantity` ostaje ono što je fizički
prebrojano, a rezervacija se drži zasebno (kolona `reserved_quantity`, ili izvedeno `Σ quantity`
otvorenih porudžbina po varijanti kroz view). Raspoloživo = `stock_quantity − reserved`. Tada popis
i porudžbine nikad ne pišu istu kolonu. Minimum ako se ne menja model: na detalju varijante
prikazati „rezervisano N u otvorenim porudžbinama" i pri popisu ponuditi da se rezervacije resetuju.

### K3 — Bulk akcije preko 200 porudžbina sekvencijalno → timeout funkcije [P]
`app/(app)/porudzbine/actions.ts:662-720` (`changeOrdersStatus`) i `563-595`
(`markOrdersShipped`) rade petlju sa `await` po porudžbini. Po jednoj porudžbini sada ide:
1 UPDATE + 1 INSERT u istoriju + (novo) `syncStockForStatusChange` = do 3 round-tripa + `pushWooStatus`
= HTTP PUT ka WooCommerce sa **10 s timeout-om** (`lib/woo-client.ts:22`).

Šema dozvoljava **200 porudžbina** po potezu (`lib/validation/orders.ts:77,85`). Realno: 200 × ~0.6 s
= 2 minuta. Vercel Hobby funkcija puca na 10 s, Pro default na 60 s. Rezultat: **504, delimično
primenjena promena, korisnik ne dobija nikakvu poruku, selekcija ostaje** — pa je najverovatnija
reakcija „klikni ponovo", što ponovo gura Woo statuse i ponovo piše istoriju.

**Predlog:** (a) jedan batch UPDATE (`.in("id", ids)`) + jedan batch INSERT istorije umesto petlje;
(b) stanje jednom RPC-om nad svim porudžbinama; (c) Woo push kroz `Promise.allSettled` sa
ograničenom konkurentnošću (5–8); (d) spustiti `max` na ~50 dok se to ne uradi.

### K4 — Tihi PostgREST cap od 1000 redova (bug koji je već jednom popravljen u `db/metrics.ts`) [P]
CLAUDE.md dokumentuje potvrđeni bug „Zarada/Marža = 0" upravo zbog toga i fix u `db/metrics.ts`
(`PAGE = 1000` + `.range()` petlja, `IN_CHUNK = 200`, provera `error`). **Isti obrazac nije primenjen
u oblasti porudžbina:**

| Mesto | Problem | Posledica |
|---|---|---|
| `db/customer-risk.ts:64-67` | `buildCancellationIndex` bez paginacije i bez `limit` | Kad broj otkazanih/vraćenih pređe 1000, „Rizičan kupac" tiho prestaje da radi — u listi, na detalju i u webhook push-u. Backfill je već uvezao 941 porudžbinu; ovo je pitanje meseci. |
| `db/orders.ts:274-275` | `SUMMARY_SCAN_CAP = 20000` u jednom `.range(0, 19999)` — PostgREST i dalje seče na 1000 | Traka „Za ovaj filter" (Zarada/Promet/Marža/broj) je **tiho pogrešna** čim filter obuhvati >1000 porudžbina (npr. bez filtera, ili ceo mesec kad naraste obim). |
| `db/orders.ts:198-199` | `RISK_SCAN_CAP = 5000` isto | Filter „rizični" ne vidi starije porudžbine. |
| `db/orders.ts:225-239` | `sumOrderItems` CHUNK = **500** UUID u `.in()` (metrics koristi 200) + rezultat >1000 stavki se seče + `error` se **ne proverava** | Isti tihi nula-rezultat koji je već jednom bio bug. |
| `db/orders.ts:452-458` | `getActiveVariantOptions` bez limita/paginacije | „Dodaj stavku" na detalju porudžbine tiho ne nudi artikle preko 1000. reče se bez ikakvog znaka. |
| `db/orders.ts:427-434` | `getOrdersForShipping` embed `order_items` za do 200 porudžbina | PDF „lista za slanje" može ostati bez artikala na poslednjim porudžbinama. |
| `app/api/cron/notifikacije/route.ts:112-131` | `lowStockCount` bez paginacije | Dnevni push podbacuje broj artikala na niskom stanju. |

**Predlog:** izvući `paginateAll()` helper iz `db/metrics.ts` u `lib/` i koristiti ga na svim gornjim
mestima; svuda proveravati `error` (throw), nikad `const { data }` bez provere.

### K5 — Datumski filter liste porudžbina nije Belgrade [P]
`db/orders.ts:167-168`:
```ts
if (from) query = query.gte("ordered_at", from);                    // "2026-07-01" = UTC ponoć
if (to)   query = query.lte("ordered_at", `${to}T23:59:59.999Z`);   // UTC kraj dana
```
UTC ponoć = **02:00 po Beogradu (CEST)**. Posledica: porudžbine napravljene između 00:00 i 02:00 na
`from` danu **ispadaju iz liste**, a dva sata narednog dana posle `to` **ulaze**. Dashboard i
Finansije koriste `rangeToUtcPrefilter` (`lib/period.ts`) + `belgradeDate` i daju drugačiji rezultat
za isti mesec → cifre se ne poklapaju, a ne postoji način da korisnik shvati zašto.

**Predlog:** koristiti `rangeToUtcPrefilter(from, to)` + `belgradeDate()` sužavanje, isto kao
`db/metrics.ts` — funkcije već postoje.

---

## OZBILJNO

### O1 — Stavke bez `variant_id` nikad ne diraju stanje i ne mogu se povezati [P]
`lib/stock.ts:49-51` filtrira `variant_id != null`. Nepoznat SKU iz Woo-a
(`app/api/webhooks/woo/route.ts:191-192`) upisuje `variant_id: null`. Jedina akcija za popravku je
`setItemVp` (`actions.ts:219`), koja upisuje samo `vp_at_sale` — **`variant_id` ostaje null zauvek**.
Roba fizički ode iz magacina, stanje se nikad ne skine, i nema nikakvog upozorenja.
**Predlog:** akcija „poveži stavku sa artiklom iz kataloga" koja upiše `variant_id` i, ako je
`stock_applied`, odmah pozove `syncItemStock(orderId, variantId, -quantity)`.

### O2 — Nema self-healing-a: neuspelo skidanje se nikad ne pokuša ponovo [P]
`actions.ts:83`: `if (isCancelled === wasCancelled) return true;` — prelazi unutar živog toka
(Kreirano→Poslato→Isporučeno) namerno preskaču `syncOrderStock`. Ako je početni `reserve` u webhooku
pao (`route.ts:261`, best-effort), porudžbina zauvek ostaje `stock_applied = false` a roba je
otišla. Sentry zabeleži, ali niko ne dobija zadatak.
**Predlog:** (a) `syncOrderStock(orderId, "reserve")` zvati **uvek** kad ciljni status nije otkazni —
`claimFlag` je ionako idempotentan, pa je poziv besplatan i samopopravljajući; (b) dodati u dnevni
cron proveru „žive porudžbine kreirane posle <datum uvođenja> sa `stock_applied = false`" i push
Adminu.

### O3 — Race `order.created` + `order.updated` ostavlja otkazanu porudžbinu sa skinutom robom [P]
`route.ts:76-90` lepo hvata `23505` i pada na `syncExistingOrder`. Ali redosled može da bude:
1. Zahtev A (`processing`) i zahtev B (`cancelled`) stižu istovremeno; oba vide „nema reda".
2. A insertuje order + stavke; B dobija 23505, pročita `raced`, postavi `cancelled_at` + pozove
   `syncOrderStock(release)` — flag je još `false` → **no-op**.
3. A nastavlja u `else` granu (jer je *njegov* payload `processing`) i poziva `reserve` → flag `true`,
   stanje **−qty**.

Rezultat: porudžbina je „Otkazano", a roba je skinuta i ostaje skinuta (nijedno kasnije otkazivanje
neće proći kroz `!existing.cancelled_at` guard).
**Predlog:** posle `reserve` u `insertOrder` ponovo pročitati `cancelled_at` i, ako je postavljen,
odmah pozvati `release`; ili sve prebaciti u RPC iz K1 koja u istoj transakciji čita status.

### O4 — `syncItemStock` i `updateItemQuantity` nisu atomični [P]
- `lib/stock.ts:115-122`: pročita `stock_applied`, pa primeni deltu. Ako se između ta dva koraka
  porudžbina otkaže (webhook), `release` vrati sve stavke **i** ova delta se primeni povrh → duplo
  vraćanje te stavke.
- `actions.ts:207-211`: delta = `target.quantity − nova` gde je `target.quantity` pročitana u
  `getEditableOrderIdForItem` **pre** UPDATE-a. Dva admina paralelno (ili dupli klik) → pogrešna
  delta, bez ikakve detekcije.
- `actions.ts:87-91` (`statusName`): `changeOrderStatus` ne proverava `error` iz PostgREST-a; ako
  embed `status:order_statuses(name)` ne uspe, `statusName` vrati `null` → `wasCancelled = false` →
  reopen otkazane porudžbine **neće** skinuti robu (`isCancelled === wasCancelled` → no-op).
  Sigurniji dizajn je uopšte ne računati nameru iz imena statusa nego uvek zvati `syncOrderStock` i
  pustiti `stock_applied` da bude jedini izvor istine.

### O5 — Brisanje porudžbine trajno gubi rezervaciju [P]
`orders → order_items` je `on delete cascade` (`20260708164149_init_schema.sql`), a `stock_applied`
nestaje sa redom. Nijedan mehanizam ne vraća robu. Postojeći delete pozivi:
`scripts/woo-webhook-test.mjs:119`, `scripts/woo-backfill.mjs:481` i `:652`, i ručne intervencije
kroz service role (CLAUDE.md ih beleži nekoliko).
**Predlog:** `before delete` trigger na `public.orders` koji, kad je `old.stock_applied`, vrati
količine na `product_variants`.

### O6 — `npm run woo:test` piše u PRODUKCIJSKI katalog [P]
Po CLAUDE.md ne postoji lokalni Postgres (cloud + CLI, bez Docker-a), pa `.env.local` service role
gađa produkcionu bazu. Skripta bira **nasumičnu realnu varijantu**
(`scripts/woo-webhook-test.mjs:126-131`, `.limit(1).single()`) i sada joj menja `stock_quantity`
(linije 156-160, 247). Ako run pukne na sredini (throw, Ctrl+C, `process.exit` na neuspelu proveru),
realna varijanta ostaje sa pogrešnom cifrom, a `stock_counted_at` je netaknut — pa cifra izgleda kao
„popisano" i niko je neće preispitati.
**Predlog:** skripta neka kreira sopstveni test proizvod + varijantu (fiksni UUID, kao dev-fixtures)
i obriše ih na kraju; ili guard `ALLOW_STOCK_TEST=1`.

### O7 — `updateShipping` menja `shipping_actual` i na porudžbini koja je već na XExpress fakturi [P]
`actions.ts:746-768` proverava samo rolu; nema guard-a na `xexpress_invoice_id`. Izmena
`shipping_actual` kroz formu na detalju porudžbine tiho menja P&L već zaključene XExpress fakture
(`db/finance.ts` čita baš to polje) i globalni saldo poštarine.
**Predlog:** guard analogno `assertEditable` — ako je `xexpress_invoice_id != null`, blokirati
izmenu `shipping_actual` uz poruku „izmeni kroz XExpress fakturu".

### O8 — Reopen fakturisane/plaćene porudžbine NE traži `force` [P]
`actions.ts:359-377`: `locked` guard i `requiresForce` postoje **samo** kad je ciljni status otkazni.
Suprotan smer (Otkazano/Vraćeno → Isporučeno) prolazi bez potvrde i dostupan je i **Menadžeru**.
Posledica: fakturisana porudžbina se vrati u tok, njena zarada se vraća u Dashboard/Neto profit
(oba isključuju samo otkazane statuse), a faktura ostaje ista → cifre se raziđu.
**Predlog:** tražiti `force` (Admin-only) i za izlazak iz otkaznog statusa kad je
`invoice_id != null` ili `payment_status != 'neuplaceno'`.

### O9 — Woo `cancelled` pa `refunded` (ili obrnuto) — drugi događaj se potpuno gubi [P]
`route.ts:307`: `if (isWooCancelled(order.status) && !existing.cancelled_at)`. Kad Woo pošalje
`cancelled`, pa kasnije `refunded` (tipičan tok: prvo otkaz, pa povraćaj novca), drugi događaj
preskoči celu granu → app ostaje na „Otkazano" i nikad ne postane „Vraćeno". Operativna razlika
zbog koje su statusi i razdvojeni je izgubljena.
**Predlog:** dozvoliti promenu **između** otkaznih statusa kad se Woo status promeni (bez ponovnog
postavljanja `cancelled_at` i bez ponovnog `release`).

### O10 — `error` iz PostgREST-a se ignoriše kroz ceo `db/orders.ts` [P]
`getOrders` (`:206`), `getOrdersSummary` (`:275`), `sumOrderItems` (`:227`), `getOrderStatuses`
(`:321`), `getOrderStatusHistory` (`:339`), `getOrderDetail` (`:383`), `getOrdersForShipping`
(`:430`), `getActiveVariantOptions` (`:453`), `buildCancellationIndex`
(`db/customer-risk.ts:64`) — svuda `const { data }` bez `error`. Ovo je tačno onaj obrazac koji je
proizveo potvrđeni bug „Zarada/Marža = 0" iz CLAUDE.md. Greška se pretvara u praznu listu / nulu,
bez Sentry zapisa.

### O11 — `buildCancellationIndex` je pun scan i zove se na svakom pogledu i svakom webhook-u [P]
Poziva se u `getOrders` (`db/orders.ts:180`, svaka strana liste), u `getOrderCancellationHistory`
(svaki detalj) i u `insertOrder` (`route.ts:274`, svaka nova porudžbina). Svaki poziv povlači **sve**
otkazane/vraćene porudžbine sa embed-om `customers`. Uz K4 (cap 1000) to je i sporo i netačno.
**Predlog:** za detalj i webhook — ciljani upit po konkretnom telefonu/e-mailu
(`or(ship_phone.eq.X,customer_id.in.(...))`) umesto celog indeksa; za listu — jedan upit ograničen
na telefone/e-mailove sa te strane.

### O12 — Podrazumevana pretraga je „ime", pa broj porudžbine ne nalazi ništa [P]
`app/(app)/porudzbine/page.tsx:49` i `orders-filter-bar.tsx:112` postavljaju default `qf = "name"`,
a `db/orders.ts:131` dodaje uslov `woo_order_id.eq.<term>` **samo** kad je polje `"all"`. Vlasnik
najčešće traži baš po broju (#2419) — po defaultu dobije prazno.
**Predlog:** ako je term čisto numerički, uvek dodati `woo_order_id.eq` bez obzira na izabrano polje.

---

## SITNO

- **S1 [P] Migracija je tehnički ispravna** (provereno jer je zadatak tražio):
  `security definer` + `set search_path = ''` **nije** problem — telo koristi
  `public.product_variants` (kvalifikovano), a `jsonb_array_elements`, `uuid` i `int` su iz
  `pg_catalog` koji Postgres uvek implicitno pretražuje. `add column ... not null default false`
  na `orders` **ne** radi rewrite tabele (PG 11+ fast default). `revoke all ... from public, anon,
  authenticated` + `grant execute ... to service_role` je tačan i dovoljan (`createAdminClient()`
  se predstavlja kao `service_role`).
- **S2 [S]** Migracija ne radi `notify pgrst, 'reload schema'`. Supabase to obično okine DDL event
  trigger-om; ako posle `db push` RPC vrati „function not found in schema cache", to je uzrok.
- **S3 [P]** `apply_stock_delta` ne vraća broj pogođenih redova. Ako `variant_id` više ne postoji
  (hard delete varijante — `order_items.variant_id` je `on delete set null`), UPDATE tiho pogodi 0
  redova, a `stock_applied` se svejedno postavi na `true`. Predlog: `returns int` + poređenje sa
  očekivanim brojem varijanti.
- **S4 [P]** Redosled deploy-a: kod je nekomitovan, migracija **nije primenjena**. Ako kod ode na
  Vercel pre `supabase db push`, svaki poziv pada na „column orders.stock_applied does not exist" →
  `catch` → Sentry + `false` → upozorenje „(Stanje u katalogu nije ažurirano — proveri.)" na svakoj
  promeni statusa i svakoj izmeni stavke. Webhook i dalje vraća 200 (dobro), ali Sentry se puni.
- **S5 [P]** `stockNote` (`actions.ts:69`) lepi upozorenje u `success` poruku, pa se prikazuje kao
  **zeleni toast uspeha**. Isti problem već postoji sa Woo upozorenjem. Predlog: posebno polje
  `warning` u `OrderActionState` + `toast.warning`.
- **S6 [P]** `isWooPing` (`lib/woo.ts:36-45`) vraća 200 na **nepotpisan** `{"webhook_id":N}`.
  Bezopasno (nema akcije), ali je to javni endpoint koji uvek vraća 200 — koristan kao probe. Sitno.
- **S7 [P]** Ručni rollback u `insertOrder` (`route.ts:245`) briše porudžbinu, ali ne i kupca kog je
  `upsertCustomer` možda tek kreirao → siročići u `customers` posle svakog neuspelog inserta stavki.
- **S8 [P]** `upsertCustomer` (`route.ts:138-145`) na svakoj novoj porudžbini **prepisuje** ime,
  adresu, grad i e-mail postojećeg kupca. Adresa porudžbine je ionako snapshot, pa je pitanje da li
  kupca uopšte treba prepisivati — trenutno se poslednjom porudžbinom gubi ranija adresa kupca.
- **S9 [P]** `resolveReview` (`actions.ts:504`) briše `needs_review` bez ikakvog zapisa u
  `order_status_history` — nema traga ko je i kada razrešio i zašto.
- **S10 [P]** `orders-bulk-table.tsx:169-173` u „Promeni status na" nudi i „Kreirano", što u
  `changeOrdersStatus` briše `shipped_at` i `delivered_at` bez ikakvog upozorenja u dijalogu.
- **S11 [P]** `openPdf` (`orders-bulk-table.tsx:104-107`) šalje sve id-jeve u query stringu; ruta
  seče na 200 (`route.tsx:29`) — korisnik koji selektuje 300 dobije PDF sa 200 i nikakvu poruku.
- **S12 [P]** `changeOrderStatus` ne proverava `needs_review` (za razliku od `markOrdersShipped`
  koji ga preskače) — brza dugmad na detalju rade i na porudžbini „za proveru". Verovatno namerno,
  ali nekonzistentno.
- **S13 [P]** `insertOrder` postavlja `goods_total = Σ mp_at_sale × quantity` a ne Woo `total −
  shipping_total`; dokumentovano kao prihvatljivo, ali `otkupOf` u uplatama i PDF „Otkupnina" čitaju
  baš `goods_total` — kod kupona na nivou korpe otkupnina na papiru neće odgovarati onome što
  XExpress naplaćuje kupcu. Vredi bar prikazati Woo `total` na detalju radi kontrole.
- **S14 [P]** `order.updated` namerno ne dira adresu (zaključana odluka). Posledica: kupac promeni
  adresu u Woo-u posle porudžbine, a app i PDF lista za slanje štampaju staru — bez ikakvog signala.
  Predlog niže (F8).

---

## PREDLOZI FUNKCIONALNOSTI (redom po realnoj vrednosti za vlasnika)

1. **Delimično vraćanje / zamena.** Trenutno je vraćanje sve-ili-ništa. Realno se vraća 1 od 3
   artikla. `order_items.returned_quantity` + korekcija `profit_at_sale` (kroz novu zamrznutu
   stavku, ne diranjem postojeće) + korekcija stanja. Ovo je najveća rupa u modelu.
2. **„Rezervisano" na varijanti u katalogu.** Prikaz „na stanju 10 · rezervisano 3 · raspoloživo 7".
   Rešava percepciju iz K2 i čini automatsko skidanje razumljivim Logistici.
3. **Pretraga po SKU / artiklu.** „Nađi sve porudžbine koje sadrže artikal X" — neophodno za
   povlačenje serije, reklamacije i proveru „koliko sam ovoga prodao".
4. **Izvoz CSV/XLSX liste porudžbina za trenutni filter.** Danas se sve završava na ekranu; za
   knjigovođu i za bilo kakvu ad-hoc analizu treba izvoz.
5. **Interna napomena po porudžbini** (odvojena od `ship_note` koji dolazi iz Woo-a) + istorija
   komunikacije (poziv / SMS / Viber, ishod, ko). Kod otkupnina se puno zove, a to znanje sad živi
   u glavi.
6. **Broj pošiljke (tracking) + link ka XExpress praćenju** na porudžbini, popunjava se uz „Poslato".
   Trenutno se `weight_grams`/`package_count` unose, ali broj pošiljke nigde ne postoji.
7. **`printed_at` — koje su porudžbine već bile na PDF listi za slanje.** Sprečava dvostruko slanje i
   omogućava „štampaj samo neštampane".
8. **Detekcija razlike Woo ↔ app.** Pošto `order.updated` namerno ne dira adresu/stavke, prikazati
   badge „Woo podaci se razlikuju (adresa/iznos)" umesto tihog ignorisanja — Admin onda odluči.
9. **Šifrarnik razloga otkazivanja/vraćanja** (dropdown + opcioni tekst) umesto slobodnog teksta →
   statistika „zašto se vraća" i osnov za rizik kupca.
10. **Detekcija duplikata porudžbine** (isti telefon + isti artikal u kratkom roku) uz postojeći
    „Rizičan kupac" flag.
11. **Undo / revizija bulk operacije.** Bulk promeni 50 statusa; danas nema ni traga da je to bila
    jedna operacija, ni načina da se vrati.
12. **Filter „stavka bez artikla iz kataloga"** (`variant_id is null`) — direktno pokazuje
    porudžbine koje ne skidaju stanje (v. O1). Danas postoji samo `needs_vp`, što nije isto.
