# Backlog — šta je još otvoreno

> **Stanje na dan:** 22.09.2026. · **Provereno nad:** `main` @ `832598f`
> **Poreklo:** audit od 31.07.2026 (`docs/arhiva/2026-07-31-audit/`, snimljen na `9c3c4c9`), **prepročitan nalaz po nalaz nad današnjim kodom.**
> Od audita je prošlo 13 commita (ceo modul Tiketi + automatsko skidanje zaliha), pa deo nalaza više ne stoji — v. „Popravljeno od audita".
>
> **Oznake:** `[P]` = potvrđeno u kodu danas (pročitana konkretna linija) · `[N]` = preneto iz audita, **nije ponovo provereno**.
> Kad nešto zatvoriš — obriši red odavde. Ovaj fajl je jedini spisak otvorenog; arhiva se ne ažurira.

---

## P0 — novac ili gubitak podataka, radi se prvo

### 0. Zbir iznad liste porudžbina pokazuje **0 RSD** `[P]`
`db/orders.ts:243` — `sumOrderItems` ima `CHUNK = 500`. Audit je to **izmerio nad pravom bazom**: 200 UUID prolazi, 350 prolazi, **400 puca**, 500 puca (predugačak URL → `fetch failed`). Greška se ne proverava (`const { data } = …`) → `data = null` → zbir 0, bez poruke i bez Sentry zapisa.
Traka „Za ovaj filter" bez filtera danas prikazuje **0 RSD** umesto stvarnog zbira.

**Uz to — `SUMMARY_SCAN_CAP = 20000` je iluzija** (`db/orders.ts:293`). Audit je izmerio da projekat ima **tvrd PostgREST cap od 1000 redova**: ni `.range(0, 19999)` ni `.limit(5000)` ga ne zaobilaze. Sa **1191 porudžbinom danas** zbir ionako vidi samo prvih 1000. Isto važi za `RISK_SCAN_CAP` i filter „rizičan kupac".

> **Ovo je korak R0 u `docs/Sportem-Plan-Izvestaji.md`** — helper je preduslov za izveštaje, pa se ovaj bug usput zatvara. Ako se radi modul Izveštaji, ne popravljati zasebno.

**Popravka (rešava i #8):** jedan helper `lib/supabase/paginate.ts` — `selectAll(query)` (`.range()` petlja dok stiže pun blok + **obavezan `error` check**) i `chunked(ids, 200)`. Obrazac već postoji u `db/metrics.ts`, samo nije izvučen.

### 1. `next@16.2.10` — 1 **kritična** + 6 „high" ranjivosti `[P]`
`npm audit --omit=dev` danas: **8 ranjivosti (1 critical, 6 high, 1 moderate)**. Kritična je u samom `next`-u; `postcss` i `sharp` se vuku kroz njega.
U julu je audit tražio `16.2.12` i brojao 5 „high" — **situacija je od tada gora, ne bolja.**

```bash
npm audit fix                 # reši 5 tranzitivnih (brace-expansion, browserslist, fast-uri, nanoid, baseline-browser-mapping)
npm i next@16.3.5             # reši critical + postcss + sharp; minor bump, nije major
npm run build && npm run rls:test   # provera posle bump-a (build MORA proći --webpack zbog Serwist-a)
```

### 2. CSV uvoz kataloga **nulira stanje, prag i težinu** svih varijanti u fajlu `[P]`
`app/(app)/katalog/uvoz/actions.ts:241-250` — kod UPDATE-a postojeće varijante piše:
```ts
stock_quantity: d.stock_quantity ?? 0,
low_stock_threshold: d.low_stock_threshold ?? 5,
weight_grams: d.weight_grams ?? null,
supplier_sku: d.supplier_sku,
```
Uvezeš cenovnik **bez kolone „Stanje"** → svih ~370 varijanti dobije **0**, prag se resetuje na 5, težine i šifre dobavljača se brišu. Nepovratno, bez ijednog upozorenja.
**Popravka:** u `update` grani slati **samo polja koja su stvarno mapirana** (izostaviti ključ umesto slanja `?? 0`). `insert` grana sme da ostane na podrazumevanim vrednostima.

### 3. CSV uvoz **briše kategoriju, brend i opis** postojećim proizvodima `[P]`
`app/(app)/katalog/uvoz/actions.ts:210-222` — `productFields` se uvek šalje u celosti, a `category_id` je `null` kad kolona nije mapirana. Isti obrazac kao #2, ista popravka.

### 4. CSV parser **množi decimalne cene sa 100** `[P]`
`lib/validation/catalog.ts:129-134` — `sanitizeInt` skida sve što nije cifra: `"4990.00"` → **499000**, `"1.299,00"` → **129900**. Tačno je samo za srpske hiljade (`"9.990"` → 9990).
Sheets izvoz sa „Format → Number" (2 decimale) tiho poveća ceo katalog 100×. Zarada u katalogu je generisana kolona (`mp − vp`) pa ništa ne vrišti; sledeća porudžbina zamrzne apsurdnu VP.
**Popravka:** preuzeti `parseRsd` iz `scripts/woo-backfill.mjs` (tačka sa tačno 3 cifre iza = hiljade, inače decimala) + sanity upozorenje u dry-run-u kad je nova cena > 10× stara.
**Umiruje:** zamrznute cene starih porudžbina su netaknute — ustav radi.

### 5. `order_profit` view sumira preko NULL-ova → **faktura može biti umanjena** `[P]`
`supabase/migrations/20260710120000_finansije.sql:38-42` — komentar tvrdi da je `profit` null kad porudžbina ima `needs_vp` stavku. **Nije tačno:** Postgres `sum()` preskače NULL i vraća NULL tek ako su *svi* NULL. Porudžbina sa stavkama `[8000, NULL]` daje `8000`.
Porudžbina sa **delimično** nepoznatim VP-om tiho ulazi u fakturu umanjena. `getBlockedNeedsVpOrders` je po odluci samo upozorenje, ne blokada.
**Ovo je tačno onaj bug koji je ubio Sheets tok** — cifra koja izgleda tačno a nije.
```sql
create or replace view public.order_profit with (security_invoker = true) as
select order_id,
       case when count(*) filter (where profit_at_sale is null) > 0
            then null else sum(profit_at_sale) end as profit
from public.order_items group by order_id;
```
\+ `issueInvoice` mora **tvrdo odbiti** porudžbinu sa `profit is null` (danas je `?? 0`).

### 6. `issueInvoice` računa total bez provere greške → **faktura na 0 RSD** `[P]`
`app/(app)/finansije/actions.ts:288-296` — ni `error` provera ni chunk-ovanje `.in()`. Ako upit padne ili ga PostgREST odseče, `total_amount` postane 0, faktura se izda, a porudžbine se **zaključaju** (`invoice_id`).
**Popravka:** proveriti `error` i baciti; chunk-ovati `.in()` po 200; odbiti `profit is null` (v. #5).

### 7. Popis: **prazno polje se tiho snima kao 0** i markira kao popisano `[P]`
`app/(app)/katalog/stock-count-control.tsx:64-75` — `Number("")` je `0`, prođe kroz `Number.isInteger(parsed) && parsed >= 0`, pa `save(true, 0)`.
Logistika obriše cifru da otkuca novu, tapne drugde → varijanta sa 12 komada postaje **0 i „popisana"**. Radi se 50× po smeni.
**Popravka:** `if (qty.trim() === "") { setQty(String(stockQuantity)); return; }` pre parsiranja.

---

## P1 — pogrešna cifra ili blokada u radu

### 8. Finansijski upiti bez paginacije i bez provere greške `[P]`
Isti obrazac na četiri mesta — tihi PostgREST cap od 1000 redova i progutana greška:

| Mesto | Šta pukne |
|---|---|
| `db/orders.ts:237-259` `sumOrderItems` (`CHUNK = 500`) | **v. #0 — puca već danas** |
| `db/finance.ts:272-284` `profitByOrder` | zarada uplate tiho 0 |
| `db/customer-risk.ts` `buildCancellationIndex` | „Rizičan kupac" tiho prestaje da radi preko 1000 otkazanih |
| `db/catalog.ts` `fetchVariants` | katalog prikaže proizvode **bez varijanti i cena** (danas 235 proizvoda — na granici) |
| `db/finance.ts:485-507` `getSaldoPostarine` | saldo poštarine se „zamrzne" preko 1000 porudžbina |
| `db/finance.ts:650-656` `listXexpressInvoices` | pogrešan P&L po XExpress fakturi |
| `app/(app)/finansije/actions.ts:288-296` | v. #6 |

**Popravka:** jedan zajednički helper (chunk po 200 + `.range()` petlja + `throw` na `error`) — obrazac već postoji u `db/metrics.ts`, samo nije izvučen. **Koraci R0 i R2 plana `docs/Sportem-Plan-Izvestaji.md` zatvaraju `sumOrderItems` i `buildCancellationIndex`; ostala tri mesta ostaju.**

### 9. Bulk „Označi poslato" → Vercel timeout `[P]`
`app/(app)/porudzbine/actions.ts:563-594` — po porudžbini: UPDATE + INSERT istorije + **`pushWooStatus` (spoljni HTTP, 10s timeout)**, sve sekvencijalno u `for` petlji. 50 porudžbina ume da probije limit funkcije, a nema nikakvog indikatora da app radi.
**Popravka:** Woo push u `Promise.allSettled` po grupama od ~10, ili ga izbaciti iz zahteva (red poslova).

### 10. Datumski filter liste porudžbina nije Belgrade `[P]`
`db/orders.ts:283-284` — `to` se gradi kao `` `${to}T23:59:59.999Z` `` (UTC). Leti (CEST, +2) porudžbine od 00:00–02:00 sledećeg dana upadaju u prethodni dan.
Ostatak app-a koristi `belgradeDate` (`lib/date-belgrade.ts`) — ovde nije.

### 11. Menadžer menja finansijske iznose kroz service role `[P]`
`app/(app)/porudzbine/actions.ts:746-750` — `updateShipping` pušta `requireRole("admin","manager")` i piše `shipping_charged` / `shipping_actual` kroz admin klijent (zaobilazi RLS).
Krši zaključanu odluku „Menadžer — svi Sportem podaci, **bez izmene finansija**" (`CLAUDE.md` §3). Oba polja ulaze u saldo poštarine i XExpress P&L.
**Odluka koja ti treba:** ili suziti na `admin`, ili svesno proširiti odluku u §3 (Menadžer fizički prijavljuje pošiljke, pa možda i treba da unosi poštarinu).

### 12. Na telefonu se ne može odjaviti `[P]`
`signOut` postoji **samo** u `components/layout/sidebar.tsx:57`, a sidebar je `hidden md:flex` (linija 21). Na telefonu nema ni odjave ni prikaza u kojoj si roli.

### 13. Nema nijednog `error.tsx` ni `not-found.tsx` `[P]`
Postoji samo `app/global-error.tsx` i `app/(app)/loading.tsx`. Svaka bačena greška u bilo kom segmentu ruši ceo app na Next-ov podrazumevani ekran, na engleskom.

### 14. Korisnik bez `profiles` reda upada u beskonačnu redirect petlju `[P]`
`lib/auth.ts:39` — `getProfile()` vraća `null` kad `profiles` red ne postoji → `requireRole` šalje na `/prijava`, a proxy vidi validnu sesiju i vraća na `/`. Dešava se pozvanom korisniku ako invite prođe a upis u `profiles` padne.

### 15. `npm run woo:test` piše u **produkcioni** katalog `[P]`
`scripts/woo-webhook-test.mjs:25-27` — gađa `NEXT_PUBLIC_SUPABASE_URL` iz `.env.local`, a to je cloud produkcija. Test pravi porudžbine i mrda stanje test varijante (vraća ga na kraju — ako ne pukne u sredini).

### 15b. Pretraga po broju porudžbine ne radi po defaultu `[P]`
`db/orders.ts:133` — uslov `woo_order_id.eq.<term>` se dodaje **samo kad je izabrano „sve"**, a podrazumevano polje je „ime" (`db/orders.ts:271`). Ukucaš `2419` → prazan rezultat, bez objašnjenja.
**Popravka:** uvek dodati `woo_order_id.eq` kad je termin čisto numerički, nezavisno od izabranog polja.

### 16. Lozinka može da završi u URL-u i istoriji pretraživača `[P]`
`app/(app)/podesavanja/profile-settings.tsx:59` i `:87` — obe forme nemaju `action`, samo `onSubmit` + `preventDefault()`. Dok React nije hidriran (spor mobilni net, prvi ulazak u PWA), „Go" na tastaturi izvede **native GET** → `/podesavanja?password=…`.
**Popravka:** dodati server akciju kao `action` (progressive enhancement) ili držati dugme `disabled` do hidracije.

---

## P2 — tehnički dug, radi se kad ima vazduha

- **Živi `rls:test` ne može da se pokrene — nema Logistika nalog** `[P]` (25.09.2026) — postoje
  samo 2 naloga i **oba su Admin**. `scripts/rls-test.mjs:151` zove `signIn("logistics")` koji radi
  `process.exit(2)`, pa test staje posle tri statičke provere. Menadžer je opcion (`signInOptional`).
  **Rok: pre koraka K10** iz `docs/Sportem-Plan-Optimizacija.md` (Katalog na server-side filter je
  jedini korak koji menja ono što Logistika vidi). Zaobilaznica do tada: `npm run rls:static`
  (statičke provere) + samo-proveravajuća migracija u K3. Uputstvo za naloge: plan, K0-b.
- **Nedokazano: „Logistika dobija 0 redova" iz novih SQL funkcija (K5/K6)** `[P]` (25.09.2026) —
  funkcije su `security invoker` pa RLS važi po konstrukciji, i nijedna ne stoji na ruti koju
  Logistika otvara, ali provera u `rls:test` čeka nalog iz reda iznad.

- **Neprovereni PostgREST `error` kroz ceo `db/` sloj** `[P]` — obrazac `const { data } = await …` bez `error` je pravilo, ne izuzetak. Svaki takav upit na grešku vrati prazno, što u finansijama znači **0 RSD umesto poruke**. Ovo je koren nalaza #6 i #8.
- **Nula automatizovanih testova + nema CI-ja** `[P]` — nema `.github/`, nema test runner-a. `rls:test` i `woo:test` su namenske provere, ne test suite. Prvi kandidati za test: snapshot cena, `order_profit` sa NULL-om, `syncOrderStock` idempotentnost, Belgrade granice meseca.
- **35× `as unknown as`** `[P]` — nema generisanih Supabase tipova (`supabase gen types typescript`). Svaka promena šeme prolazi kroz TS neprimećeno.
- **`stock_applied` može ostati `true` bez stvarnog skidanja** `[P]` — `lib/stock.ts:88-95` vraća prekidač nazad ako RPC padne, ali ako proces umre **između** `claimFlag` i `applyDeltas`, porudžbina je „rezervisana" a roba nije skinuta. Nema self-healing-a ni ledgera da se to primeti.
- **Nema evidencije kretanja zaliha (ledger)** `[N]` — `stock_quantity` je samo trenutni broj; ne može se rekonstruisati zašto je pao.
- **Forma varijante odbija negativno stanje, baza ga dozvoljava** `[P]` — `lib/validation/catalog.ts:100` je `min(0)`, a odluka je da stanje **sme** u minus (`CLAUDE.md`, auto-skidanje). Varijanta koja ode u minus ne može da se sačuva kroz formu dok se ne otkuca ≥ 0.
- **Nema `Checkbox` komponente** `[P]` — `components/ui/` je nema, pa su svi bulk tokovi native checkbox-i od ~16px. Dizajn sistem traži min 40px tap metu („brat radi sa telefona").
- **`/monitoring-tunnel` nije u `PUBLIC_PATHS`** `[P]` — `lib/supabase/middleware.ts:10`. Sentry tunel prolazi kroz auth proveru bez potrebe.
- **Cron secret se poredi ne-konstantnim vremenom** `[P]` — `app/api/cron/notifikacije/route.ts:31`, `auth !== \`Bearer ${secret}\``. Teorijski timing napad; `timingSafeEqual` se već koristi u Woo webhook-u.
- **`/stil` i `/stil/komponente` nemaju role guard** `[P]` — iza auth-a jesu (proxy), ali ih vidi i Logistika.
- **25 ruta na `force-dynamic`** `[P]` — nula keširanja. Ustav „online-only" jeste ispoštovan, ali slučajno; nijedna ruta nije svesno keširana.
- **`CLAUDE.md` je narastao na ~90 KB** — §10 je postao hronološki changelog. Razmisliti o razdvajanju na „važeće odluke" (kratko, čita se svaka sesija) i `docs/arhiva/odluke-hronologija.md`.

---

## Popravljeno od audita (31.07. → danas) — ne traži ponovo

| Nalaz iz audita | Status danas |
|---|---|
| Automatsko skidanje zaliha ima dve trke koje duplo skidaju robu | **Popravljeno** — `lib/stock.ts:55-67` `claimFlag` radi uslovni UPDATE (`.eq("stock_applied", !next)`), jedan Postgres statement. Poslato u `d0713f6`. |
| Reopen fakturisane/plaćene porudžbine ne traži `force` | **Popravljeno** — `force` postoji, Admin-only, uz obavezan razlog (`CLAUDE.md`, „Vraćanje/otkazivanje PLAĆENE ili FAKTURISANE porudžbine"). |
| Popis: potvrda nepromenjenog broja ne radi ništa | **Rešeno dizajnom** — uveden čekboks „Popisano" baš za potvrdu nepromenjene cifre (npr. nule). |
| `scripts/fix-goods-total.mjs` je jednokratna skripta u repou | **Obrisana** (22.09.2026). |
| README je zastareo | **Sređen** (22.09.2026) — uklonjen `supabase start`, dopunjene skripte i struktura. |

---

## Šta ovaj spisak NE pokriva

Preneto iz audita bez ponovne provere `[N]`: većina **sitnih** nalaza (KAT S1–S14, ORD sitno, SEC S1/S3–S6/S8/S9), ceo **UX detaljni deo** (kontrast statusnih pilula, tipografija, tap mete po ekranu, srpska terminologija, prazna stanja) i **predlozi novih funkcionalnosti**.
Sve to i dalje stoji u `docs/arhiva/2026-07-31-audit/` sa tačnim `fajl:linija` referencama — samo imaj na umu da je snimljeno na `9c3c4c9` i da je modul Tiketi nastao posle njega, pa ga audit uopšte ne pokriva.
