# Backlog — šta je još otvoreno

> **Stanje na dan:** 26.09.2026. · **Provereno nad:** `main` @ `832598f` (nalazi), uz zatvaranja iz koraka K2 (26.09.2026)
> **Poreklo:** audit od 31.07.2026 (`docs/arhiva/2026-07-31-audit/`, snimljen na `9c3c4c9`), **prepročitan nalaz po nalaz nad današnjim kodom.**
> Od audita je prošlo 13 commita (ceo modul Tiketi + automatsko skidanje zaliha), pa deo nalaza više ne stoji — v. „Popravljeno od audita".
>
> **Oznake:** `[P]` = potvrđeno u kodu danas (pročitana konkretna linija) · `[N]` = preneto iz audita, **nije ponovo provereno**.
> Kad nešto zatvoriš — obriši red odavde. Ovaj fajl je jedini spisak otvorenog; arhiva se ne ažurira.

---

## P0 — novac ili gubitak podataka, radi se prvo

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

### 5. ~~`order_profit` view sumira preko NULL-ova~~ — **POPRAVLJENO (K4, 26.09.2026)**
`supabase/migrations/20260926120000_order_profit_indeksi_norm_phone.sql` — view sad vraća **NULL kad IJEDNA stavka** ima `profit_at_sale is null` (`count(*) filter (…) > 0`), umesto `sum()` koji preskače NULL-ove. Porudžbina sa stavkama `[8000, NULL]` više ne daje `8000` nego „zarada nije poznata".
`security_invoker = true` je ostao. Dokaz pre commita: `npm run provera:k4` mora da ispiše **0 porudžbina sa promenjenom cifrom** (plan je izmerio da bug još nije stigao da pogodi podatke).

### 6. ~~`issueInvoice` ne odbija porudžbinu sa `profit is null`~~ — **POPRAVLJENO (K4, 26.09.2026)**
`app/(app)/finansije/actions.ts` — `?? 0` je zamenjen tvrdim odbijanjem: porudžbine bez VP na svim stavkama se imenuju po Woo broju i faktura se ne izdaje. (K2 je pre toga zatvorio deo o `error` proveri i parčanju `.in()`.)

### 7. Popis: **prazno polje se tiho snima kao 0** i markira kao popisano `[P]`
`app/(app)/katalog/stock-count-control.tsx:64-75` — `Number("")` je `0`, prođe kroz `Number.isInteger(parsed) && parsed >= 0`, pa `save(true, 0)`.
Logistika obriše cifru da otkuca novu, tapne drugde → varijanta sa 12 komada postaje **0 i „popisana"**. Radi se 50× po smeni.
**Popravka:** `if (qty.trim() === "") { setQty(String(stockQuantity)); return; }` pre parsiranja.

---

## P1 — pogrešna cifra ili blokada u radu

### 8. ~~Finansijski upiti bez paginacije i bez provere greške~~ — **POPRAVLJENO (K2, 26.09.2026)**
Svih sedam mesta iz ovog nalaza prešlo je na `lib/supabase/paginate.ts` (`selectAll` / `selectAllIn` / `must`): `sumOrderItems`, `getOrdersSummary`, `RISK_SCAN_CAP`, `profitByOrder`, `buildCancellationIndex`, `fetchVariants`, `getSaldoPostarine`, `listXexpressInvoices`, `issueInvoice`.
Uz to je **svaki** `const { data } = await supabase…` u `db/` sloju dobio proveru greške — v. `CLAUDE.md`, „Korak K2".

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
| Zbir „Za ovaj filter" pokazuje 0 RSD (bivši #0) | **Popravljeno** (26.09.2026, korak K2) — `lib/supabase/paginate.ts`; dokazano skriptom `npm run provera:k2` (`docs/perf/2026-09-26-provera-k2.txt`): bez filtera 501.265 → **1.442.169 RSD**, poklapa se sa Dashboardom. |
| Tihi PostgREST cap od 1000 redova u `db/` sloju (bivši #8) | **Popravljeno** (26.09.2026, korak K2) — svi neograničeni `select` upiti u `db/` idu kroz `selectAll`, svi `.in()` kroz parčad po `IN_CHUNK = 200`. |
| Neprovereni PostgREST `error` kroz ceo `db/` sloj | **Popravljeno** (26.09.2026, korak K2) — nijedan `const { data } = await supabase…` bez provere nije ostao u `db/`; greška baca čitljivu poruku (`must`). |

---

## Šta ovaj spisak NE pokriva

Preneto iz audita bez ponovne provere `[N]`: većina **sitnih** nalaza (KAT S1–S14, ORD sitno, SEC S1/S3–S6/S8/S9), ceo **UX detaljni deo** (kontrast statusnih pilula, tipografija, tap mete po ekranu, srpska terminologija, prazna stanja) i **predlozi novih funkcionalnosti**.
Sve to i dalje stoji u `docs/arhiva/2026-07-31-audit/` sa tačnim `fajl:linija` referencama — samo imaj na umu da je snimljeno na `9c3c4c9` i da je modul Tiketi nastao posle njega, pa ga audit uopšte ne pokriva.
