# Izveštaj o stanju aplikacije — Sportem OS

**Datum:** 31.07.2026. · **Grana:** `main` @ `9c3c4c9` (+ nekomitovan rad na skidanju zaliha)
**Obim:** kompletna kodbaza (~20.000 linija TS/TSX, 956 linija SQL migracija), produkciona baza (samo čitanje), rekonsilijacija sa WooCommerce-om.

**Metod:** šest paralelnih dubinskih audita po oblastima (finansije, porudžbine/Woo, katalog/zalihe, sigurnost/RLS, UX/PWA, arhitektura) + nezavisna provera nalaza direktnim upitima nad produkcionom bazom i Woo REST API-jem. Svaki nalaz označen kao **POTVRĐEN** je pročitan u kodu, a najvažniji su i **empirijski reprodukovani nad pravim podacima**.

Puni izveštaji po oblastima su u prilogu na kraju.

---

## 1. Rezime

Aplikacija je **u dobrom stanju za proizvod koji je star nekoliko meseci i pisan uz rad**. Ono što je najteže — snapshot zamrznutih cena, RLS po rolama, webhook integracija — je urađeno ispravno i to je provereno, ne pretpostavljeno:

- **Webhook ne gubi porudžbine.** Rekonsilijacija sa Woo-om: 1045 porudžbina u app-u, 1045 u Woo-u, **0 propuštenih, 0 viška**. Samo 4 neslaganja statusa, sva iz backfill-a.
- **Zamrznute cene se nigde ne krše.** Nijedno čitanje `mp_price`/`vp_price` iz kataloga u finansijskoj logici.
- **Sigurnost drži.** Nijedan put ne vodi Logistiku do cena ni anonimnog korisnika do podataka. Nema kritičnih nalaza.

Ali ima i ozbiljnih stvari, i jedna od njih **već daje pogrešnu cifru na ekranu**.

### Šest stvari koje bih uradio prve

| # | Šta | Zašto sada |
|---|---|---|
| 1 | **Popraviti zbir iznad liste porudžbina** | Traka „Za ovaj filter" **danas prikazuje 0 RSD** umesto 1.169.773 RSD. Reprodukovano nad pravim podacima. |
| 2 | **Popis: prazno polje se tiho snima kao 0** | Logistika obriše cifru i tapne drugde → varijanta sa 12 komada postaje **0 i markirana kao „popisano"**. Gubitak podataka u toku koji se radi 50× po smeni. |
| 3 | **Zaključati CSV uvoz kataloga** | Sledeći uvoz cenovnika bez kolone „Stanje" **nulira zalihe svih 372 varijante** i briše kategorije. Nepovratno. |
| 4 | **`npm i next@16.2.12`** | 5 „high" CVE u produkcionom stablu. Patch verzija, bez breaking change-a. |
| 5 | **Ne slati automatsko skidanje zaliha kakvo jeste** | Nekomitovani rad ima dve trke i sudara se sa popisom. Migracija još nije na produkciji — idealan trenutak da se model popravi. |
| 6 | **Odjava na telefonu** | `signOut` postoji samo u sidebar-u koji je `hidden md:flex`. Na telefonu se korisnik ne može odjaviti, ni videti u kojoj je roli. |

### Ocena po oblastima

| Oblast | Ocena | Komentar |
|---|---|---|
| Sigurnost / RLS | ★★★★★ | Nema kritičnih nalaza. Provereno kroz view, embed, RPC, storage, PDF. |
| Zamrznute cene (ustav) | ★★★★★ | Poštovan svuda, uključujući nov kod. |
| Woo integracija | ★★★★☆ | Pouzdana i idempotentna; fale replay zaštita i pomirenje `refunded` posle `cancelled`. |
| Finansijska logika | ★★★☆☆ | Formule tačne, timezone tačan — ali agregacija ima tihe rupe koje rastu sa obimom. |
| Katalog / uvoz | ★★☆☆☆ | CSV uvoz je destruktivan; nema istorije kretanja zaliha. |
| Arhitektura / testovi | ★★☆☆☆ | Nula testova, nema CI-ja, 46 upita bez provere greške. |
| UX / mobilni | ★★☆☆☆ | Desktop je solidan, mobilni je znatno slabiji — 16 kritičnih nalaza, dva sa gubitkom podataka. |

---

## 2. Stanje sistema danas (iz produkcione baze)

| Podatak | Vrednost |
|---|---|
| Porudžbine | **1045** (941 backfill + 104 žive) |
| Stavke porudžbina | 1710 |
| Proizvodi / varijante | 219 / 372 |
| Kupci | 960 |
| Uplate / fakture | 23 / 3 |
| Troškovi | 19 unosa |
| Korisnici (`profiles`) | **2 — oba `admin`** |
| Vremenski opseg | 02.02.2026 – 31.07.2026 |

**Statusi:** Isporučeno 923 · Otkazano 95 · Vraćeno 17 · Kreirano 8 · Poslato 2
**Plaćanje:** uplaćeno 802 · keš 123 · neuplaćeno 120

### Zdravlje podataka

| Provera | Rezultat |
|---|---|
| `needs_vp` / `needs_review` | **0 / 0** — čisto |
| Stavke bez VP | 0 |
| Duplikati `woo_order_id` | 0 |
| Porudžbine u Woo-u kojih nema u app-u | **0** |
| Varijante bez popisa | 0 (backfill popisa je prošao) |
| Varijante u minusu | 0 |
| **Stavke bez `variant_id`** | **1591 / 1710 (93%)** |
| Porudžbine bez `shipping_charged` | 890 |

### Dve stvari koje vrede pažnje

**a) 93% stavki nije povezano sa katalogom.** Svih 1571 backfill stavki ima `variant_id = null` (backfill nije spajao SKU sa varijantama), plus **20 živih stavki** iz porudžbina #2797–#2816 — tada ti SKU-ovi još nisu postojali u katalogu. Posledice:
- Nema izveštaja „prodaja po artiklu" za februar–jul, iako `sku` i `profit_at_sale` postoje na stavci.
- Novo automatsko skidanje zaliha te stavke **preskače** (`lib/stock.ts` filtrira `variant_id != null`).
- Nema akcije u app-u koja bi stavku naknadno povezala sa artiklom.

Popravka za onih 20 živih je jednokratan `UPDATE` po SKU-u; za istoriju se može uraditi isto (SKU-ovi su tu), čime se otključava sva statistika po artiklu.

**b) Uplata datirana 03.08.2026** — u budućnosti u odnosu na današnji dan. `payouts` nema nikakvu proveru datuma; vredi proveriti da nije omaška u unosu.

---

## 3. Živi bagovi — dešavaju se sada

### Ž1 · Zbir iznad liste porudžbina pokazuje 0 RSD `[REPRODUKOVANO]`

**Fajl:** [db/orders.ts:219-241](../db/orders.ts#L219-L241) (`sumOrderItems`, `CHUNK = 500`)

Traka „Za ovaj filter" (Zarada / Promet / Marža) na `/porudzbine` bez filtera **prikazuje 0 RSD**. Tačna vrednost je **1.169.773 RSD**.

Zašto: `sumOrderItems` šalje po 500 UUID-jeva u `.in()`. Testirao sam prag nad pravom bazom:

```
 200 UUID -> OK (374 redova)
 350 UUID -> OK (611 redova)
 400 UUID -> PUKLO: TypeError: fetch failed     ← URL predugačak
 500 UUID -> PUKLO
```

Sa 1045 porudžbina to su dva chunk-a (500 + 433) — **oba pucaju**. Greška se ne proverava (`const { data } = ...` bez `error`), pa `data = null`, `?? []`, zbir ostaje 0. Nema poruke, nema Sentry zapisa.

**Popravka:** `CHUNK = 200` (dokazano bezbedno) + paginacija unutar chunk-a + `if (error) throw`. Obrazac već postoji u [db/metrics.ts:80-96](../db/metrics.ts#L80-L96) — samo nije prenet.

### Ž2 · `SUMMARY_SCAN_CAP = 20000` i `RISK_SCAN_CAP = 5000` su iluzija `[REPRODUKOVANO]`

**Fajl:** [db/orders.ts:198](../db/orders.ts#L198), [db/orders.ts:274](../db/orders.ts#L274)

Kod pretpostavlja da `.range(0, 19999)` zaobilazi PostgREST limit. **Ne zaobilazi ga.** Izmereno nad produkcijom:

```
select bez .range()        -> 1000 redova   (a ima ih 1045)
select .range(0, 4999)     -> 1000 redova
select .range(0, 19999)    -> 1000 redova
select .limit(5000)        -> 1000 redova
```

Projekat ima tvrd cap od **1000 redova**. Znači `getOrdersSummary` već danas vidi samo 1000 od 1045 porudžbina, a filter „rizičan kupac" gleda samo prvih 1000. Te dve konstante daju lažan osećaj sigurnosti i treba ih ukloniti, ne povećati.

### Ž3 · Datumski filter liste je UTC, ostatak app-a je Beograd `[POTVRĐENO]`

**Fajl:** [db/orders.ts:167-168](../db/orders.ts#L167-L168)

```ts
if (from) query = query.gte("ordered_at", from);                  // UTC ponoć = 02:00 po Beogradu
if (to)   query = query.lte("ordered_at", `${to}T23:59:59.999Z`); // hvata 2h narednog dana
```

Dashboard i Finansije koriste `rangeToUtcPrefilter` + `belgradeDate` i daju **drugačiji rezultat za isti mesec**. Izmereno: **31 od 1045 porudžbina** pada u drugi dan po UTC-u nego po Beogradu; jedna prelazi i granicu meseca (`2026-05-31T23:34+00` = 1. jun po Beogradu), pa maj/jun u listi i na Dashboardu ne daju isti broj.

Uticaj je danas mali (±1 porudžbina po mesecu), ali je to tačno ona vrsta neslaganja koja pojede sat vremena kad se primeti. Funkcije za ispravku već postoje u [lib/period.ts](../lib/period.ts).

### Ž4 · Pretraga po broju porudžbine ne radi po defaultu `[POTVRĐENO]`

**Fajl:** [db/orders.ts:131](../db/orders.ts#L131), [app/(app)/porudzbine/page.tsx:49](../app/%28app%29/porudzbine/page.tsx#L49)

Podrazumevano polje pretrage je „ime". Uslov `woo_order_id.eq.<term>` se dodaje **samo** kad je izabrano „sve". Ukucaš `2419` → prazan rezultat, iako ta porudžbina postoji.

**Popravka:** ako je pojam čisto numerički, uvek dodati pretragu po broju.

---

## 4. Bagovi koji čekaju prag

Ovo su iste klase greške kao Ž1/Ž2, samo im obim još nije stigao. Vredi ih popraviti odjednom, jednim helperom.

| # | Mesto | Kad puca | Posledica |
|---|---|---|---|
| P1 | `profitByOrder` — [db/finance.ts:272](../db/finance.ts#L272) | preko ~350 porudžbina u svim uplatama (danas 118) | **Zarada svih uplata postaje 0 RSD**; hrani i „Za fakturisanje" |
| P2 | `issueInvoice` — [app/(app)/finansije/actions.ts:280](../app/%28app%29/finansije/actions.ts#L280) | isto | **Izdavanje fakture na 0 RSD** uz zaključavanje uplata i stavki |
| P3 | `getSaldoPostarine` — [db/finance.ts:485](../db/finance.ts#L485) | preko 1000 fakturisanih pošiljki (danas 105) | Saldo poštarine trajno pogrešan i **nestabilan** (nema `ORDER BY`); „Poravnaj keš" onda predaje pogrešnu sumu |
| P4 | `listXexpressInvoices` — [db/finance.ts:650](../db/finance.ts#L650) | isto | P&L starijih XExpress faktura umanjen |
| P5 | `buildCancellationIndex` — [db/customer-risk.ts:64](../db/customer-risk.ts#L64) | preko 1000 otkazanih (danas 112) | „Rizičan kupac" tiho prestaje da radi |
| P6 | `fetchVariants` — [db/catalog.ts:47](../db/catalog.ts#L47) | oko 200+ proizvoda (danas 219 — **na granici**) | Katalog prikaže sve proizvode **bez varijanti i bez cena** |
| P7 | `getUnpaidDeliveredXexpress` — [db/finance.ts:56](../db/finance.ts#L56) | preko 1000 | Kandidati za uplatu nestaju bez poruke |
| P8 | `getActiveVariantOptions` — [db/orders.ts:452](../db/orders.ts#L452) | preko 1000 varijanti | „Dodaj stavku" ne nudi sve artikle |
| P9 | `lowStockCount` u cron-u — [app/api/cron/notifikacije/route.ts:112](../app/api/cron/notifikacije/route.ts#L112) | preko 1000 varijanti | Dnevni push šalje pogrešan broj |

**Jedna popravka za sve:** helper `lib/supabase/paginate.ts` sa `selectAll(query)` (`.range()` petlja + obavezan `error` check) i `chunked(ids, 200)`. Zamena je mehanička, fajl po fajl.

### P10 · `order_profit` view sumira preko NULL-ova

**Fajl:** [supabase/migrations/20260710120000_finansije.sql](../supabase/migrations/20260710120000_finansije.sql)

Komentar u migraciji tvrdi: *„profit je null za porudžbinu sa bar jednom needs_vp stavkom"*. **To nije tačno** — Postgres `sum()` preskače NULL i vraća NULL samo ako su sve vrednosti NULL. Porudžbina sa stavkama `[8000, NULL]` daje `8000`, ne NULL.

Put do novca: `issueInvoice` računa `total_amount = Σ order_profit` uz `(r.profit ?? 0)`. Porudžbina sa **delimično** nepoznatim VP-om tiho ulazi u fakturu sa umanjenim iznosom.

**Danas je bezopasno** — u bazi je `needs_vp = 0` i nema nijedne stavke bez VP. Postaje opasno prvog dana kad kroz webhook prođe nepoznat SKU.

**Popravka:**
```sql
case when count(*) filter (where profit_at_sale is null) > 0
     then null else sum(profit_at_sale) end as profit
```
\+ `issueInvoice` mora **tvrdo odbiti** porudžbinu sa `profit is null`, umesto `?? 0`.

---

## 5. CSV uvoz kataloga je destruktivan

Tri odvojena bug-a, svi POTVRĐENI čitanjem koda. Svi se aktiviraju **normalnim korišćenjem** — uvozom cenovnika koji nema sve kolone.

### U1 · Uvoz bez kolone „Stanje" nulira zalihe celog kataloga

**Fajl:** [app/(app)/katalog/uvoz/actions.ts:241-250](../app/%28app%29/katalog/uvoz/actions.ts#L241-L250)

```ts
stock_quantity: d.stock_quantity ?? 0,          // uvek ide u UPDATE
low_stock_threshold: d.low_stock_threshold ?? 5, // gazi ručne pragove
weight_grams: d.weight_grams ?? null,            // briše težine
```

Kolona nije mapirana → `undefined` → `?? 0` → **eksplicitna nula u `UPDATE`**. Svih 372 varijante dobijaju stanje 0. Pošto `stock_counted_at` ostaje netaknut, sve i dalje izgledaju „popisano" — dakle **ceo katalog upada u nisko stanje**, Dashboard lista i dnevni push eksplodiraju, a stvarna evidencija je izgubljena (nema istorije stanja da se vrati).

Isto: `deriveVariantName` bez mapirane kolone pretvara „Crvena · 2.4 m" u **„4"**.

### U2 · Uvoz bez kolone „Kategorija" briše kategorije

**Fajl:** [app/(app)/katalog/uvoz/actions.ts:209-222](../app/%28app%29/katalog/uvoz/actions.ts#L209-L222)

`category_id` je uvek `null` kad kolona nije mapirana, i taj `null` ide u `UPDATE`. Svi dodirnuti proizvodi ostaju bez kategorije; vraćanje je ručno, proizvod po proizvod.

### U3 · Cene sa decimalama se množe sa 100

**Fajl:** [lib/validation/catalog.ts:129-134](../lib/validation/catalog.ts#L129-L134)

```ts
const digits = v.replace(/\D/g, "");   // "4990.00" -> "499000"
```

Skida **sve** što nije cifra. `"9.990"` → 9990 (tačno, srpske hiljade), ali `"4990.00"` → **499000**. Google Sheets podrazumevano formatira brojeve sa dve decimale.

Backfill skripta ima ispravan `parseRsd` koji razlikuje ta dva slučaja ([scripts/woo-backfill.mjs](../scripts/woo-backfill.mjs)); uvoz kataloga tu logiku nema. Dry-run ne bi ništa prijavio, a zarada bi u katalogu i dalje izgledala „tačno" (generisana kolona `mp − vp`).

**Ublažavajuće:** zamrznute cene starih porudžbina ostaju netaknute — ustav radi.

**Popravke (redom po ceni):**
1. Odmah: prekidač **„Samo dodaj nove, ne diraj postojeće"** — najjeftinija zaštita dok se ostalo ne prepiše.
2. Graditi `UPDATE` patch **samo od mapiranih polja** (razdvojiti `insertFields` od `updateFields`).
3. Preuzeti `parseRsd` iz backfill skripte + sanity guard u dry-run-u („nova cena > 10× stara").
4. `import_batches` sa prethodnim vrednostima → dugme **„Poništi poslednji uvoz"**.

Dodatno: uvoz radi ~560 sekvencijalnih upita bez transakcije. Prekid na pola (Vercel timeout — nijedna ruta nema `maxDuration`) pravi **duplikate proizvoda** pri ponovnom pokretanju.

---

## 6. Nekomitovani rad: automatsko skidanje zaliha

`lib/stock.ts` + `supabase/migrations/20260731140000_order_stock_decrement.sql` + izmene u `porudzbine/actions.ts` i `webhooks/woo/route.ts`.

**Status: migracija NIJE primenjena na produkciju** (provereno — kolona `orders.stock_applied` ne postoji). To je dobra vest: ima vremena da se model popravi pre nego što ode uživo.

### Šta je urađeno dobro (provereno, ne treba ponovo gledati)

- `apply_stock_delta` je jedan `UPDATE ... set stock_quantity = stock_quantity + delta` → otporan na klasičan lost update.
- `claimFlag` je pravi mutex (`.eq("stock_applied", !next)` u istom statement-u) → **Woo retry ne može duplo da skine**.
- Migracija je tehnički čista: `security definer` + `search_path = ''` je ispravno (`jsonb_array_elements`/`uuid` su iz `pg_catalog`), `not null default false` ne radi rewrite tabele, `revoke`/`grant` su tačni.
- Snapshot se ne dira; `stock_counted_at` se ne gazi; istorijske porudžbine ne mogu naduvati stanje.

### Dva problema koja treba rešiti pre slanja

**S1 · `claimFlag` i `applyDeltas` nisu atomični** — to su dva odvojena HTTP poziva.

- Proces umre između njih → `stock_applied = true`, roba **nije** skinuta. Nikad se samo ne popravi (svaki sledeći `reserve` vidi flag i tiho izađe).
- RPC uspe u bazi ali odgovor ne stigne (timeout, 504, prekinut pooler — realno na Vercelu) → `catch` vraća flag na `false` → **sledeći pokušaj skida drugi put**.
- Ista trka postoji i između `syncItemStock` i `syncOrderStock` (dva admina u dva taba).

**Popravka:** prebaciti ceo tok u **jednu plpgsql funkciju** — `apply_order_stock(p_order_id uuid, p_reserve boolean)` koja u istoj transakciji uradi `select ... for update`, proveri i flipne prekidač, pročita stavke i primeni `UPDATE`. Jedan poziv iz Node-a → ili se desi sve ili ništa. Time nestaju svi gornji scenariji odjednom.

**S2 · Popis i rezervacija mere dve različite stvari, a pišu u istu kolonu**

Rezervacija se dešava na **„Kreirano"** (prijem webhooka), a roba fizički napušta magacin tek na **„Poslato"** — a šalje se ponedeljkom i četvrtkom. U tom prozoru (do 4 dana) `stock_quantity` je umanjen, ali je roba i dalje na polici.

Popis upisuje **apsolutnu fizičku cifru**:

1. Varijanta ima 10. U ponedeljak padnu 3 porudžbine → app kaže 7.
2. U utorak Logistika prebroji policu (roba još nije poslata), vidi 10, ukuca 10 → **rezervacija je izbrisana**.
3. U četvrtak roba ode. App kaže 10, stvarno ima 7. Greška se akumulira svake nedelje.

Ovo kvari upravo onaj problem koji je popis (migracija `20260731120000`) trebalo da reši.

**Tri opcije, po ceni:**

| Opcija | Šta | Trud |
|---|---|---|
| A | Rezervisati na **„Poslato"** umesto na „Kreirano" | mali — premestiti poziv |
| B | Razdvojiti `stock_quantity` (fizički popis) i `reserved_quantity` (Σ živih porudžbina); prikaz „raspoloživo = stanje − rezervisano" | srednji — **najčistije** |
| C | Ostaviti model, ali pri popisu prikazati „rezervisano N kom (nije još poslato)" i porediti sa svežom vrednošću iz baze | mali — krpa |

Preporuka: **B**, jer usput rešava i percepciju („Logistika vidi zašto se broj ne slaže") i daje bratu jasnu sliku šta mora u ponedeljak.

### Ostalo oko zaliha

- Neuspelo skidanje se **nikad ne pokuša ponovo** — prelazi unutar živog toka namerno preskaču sinhronizaciju. Predlog: uvek zvati `syncOrderStock("reserve")` kad ciljni status nije otkazni (`claimFlag` je idempotentan, pa je poziv besplatan i samopopravljajući) + dnevna cron provera „žive porudžbine sa `stock_applied = false`".
- **Brisanje porudžbine trajno gubi rezervaciju** (`on delete cascade`). Predlog: `before delete` trigger.
- **`npm run woo:test` menja `stock_quantity` prave varijante u produkcionoj bazi** — skripta bira nasumičnu realnu varijantu. Vraća stanje na polaznu cifru na kraju, ali **prekid na sredini** (throw, Ctrl+C, `process.exit` na neuspeloj proveri) ostavlja pogrešnu cifru koja i dalje izgleda „popisano". Trebalo bi da kreira sopstveni test proizvod sa fiksnim UUID-om, kao `dev-fixtures`.
- **Nema ledgera kretanja zaliha.** `stock_quantity` menja 5 puteva (webhook, status, izmena stavke, popis, CSV uvoz, forma) i **nijedan ne ostavlja trag**. Kad se stanje raziđe sa policom — a hoće — nema načina da se rekonstruiše šta se desilo. Ovo je ista klasa problema zbog koje postoji ceo snapshot ustav. Predlog: append-only `stock_movements (variant_id, delta, reason, order_id, user_id, balance_after, created_at)`.
- **Minus stanje je namerno dozvoljeno u migraciji, ali `variantSchema` ima `min(0)`** → admin ne može ni cenu da promeni na varijanti koja je u minusu.

---

## 7. Sigurnost

**Kritičnih nalaza nema.** Ovo je eksplicitno provereno, ne pretpostavljeno:

- Logistika ne dolazi do cena **nijednim putem** — ni kroz `product_variants` (RLS), ni kroz restriktovani view (nema tih kolona), ni kroz PostgREST embed, ni kroz `order_profit` (`security_invoker = true`), ni kroz RPC, ni kroz storage, ni kroz PDF rutu (403).
- RLS je uključen na **svih 18 tabela**. Nijedna nije bez politike.
- Svih ~45 server akcija ima autorizaciju. Nema IDOR-a. Eskalacija role je zatvorena.
- `getClaims()` stvarno **kriptografski verifikuje** JWT (provereno u `node_modules`) — nije slepo dekodiranje.
- Service-role ključ nikad ne dospeva u klijentski bundle. Nijedan `NEXT_PUBLIC_*` ne nosi tajnu.
- Nula `dangerouslySetInnerHTML`. CSRF pokriven. **Open redirect na `/auth/callback` je testiran i nije iskoristiv.**

### Ozbiljno (4)

**B1 · `apply_stock_delta` je „napunjen pištolj"** — [migracija:39-62](../supabase/migrations/20260731140000_order_stock_decrement.sql#L39-L62)
Funkcija je `security definer` u `public` šemi i radi **neograničen `UPDATE`** nad `product_variants`, bez ijedne unutrašnje provere. Jedina odbrana je jedan `revoke` red. PostgREST je automatski izlaže kao RPC — jedan pogrešan `grant` u budućnosti (ili Supabase-ov „grant all on functions" šablon) i **svaki ulogovani korisnik uključujući Logistiku može jednim POST-om da sabotira stanje celog magacina**.
**Popravka pre `db push`:** premestiti u `private` šemu (PostgREST je tada ne vidi uopšte) ili dodati guard `if auth.role() <> 'service_role' then raise exception`.

**B2 · Menadžer menja finansijske iznose** — [porudzbine/actions.ts:746-768](../app/%28app%29/porudzbine/actions.ts#L746-L768)
`updateShipping` propušta Menadžera i piše kroz service-role klijent (zaobilazi RLS koji je Admin-write). `shipping_charged` ulazi u otkupninu na Uplatama, `shipping_actual` je osnovica XExpress rekonsilijacije. Krši zaključanu odluku „Menadžer — bez izmene finansija".
Dodatno: **nema guard-a na `xexpress_invoice_id`** — izmena `shipping_actual` tiho menja P&L već zaključene XExpress fakture.
**Odluka je tvoja:** ili dokumentovati da je poštarina operativna a ne finansijska, ili razdvojiti (težina/paketi → Admin+Menadžer, poštarina → samo Admin).

**B3 · `setStockCount` ne isključuje arhivirane i ne proverava da varijanta postoji** — [katalog/actions.ts:378-403](../app/%28app%29/katalog/actions.ts#L378-L403)
Jedino mesto gde Logistika piše u katalog, i to kroz service-role. Cene **jesu** bezbedne (patch ima fiksne ključeve, nema spread-a). Fale: `.is("archived_at", null)`, `.select("id")` provera (nepostojeći UUID vraća lažno „Popisano."), i gornja granica na količinu.

**B4 · Sentry može primiti telefone kupaca** — `sendDefaultPii` jeste isključen, ali Postgres unique-violation na `customers.phone` nosi `Key (phone)=(064…)` u `error.details`, a webhook radi `captureException(error)`. Predlog: `beforeSend` scrubber.

### Sitno

12 server akcija prima goli `id` bez zod `uuid()` provere (sve iza `requireRole`, PostgREST parametrizuje — nizak uticaj, ali odstupa od pravila); cron secret se poredi ne-konstantnim vremenom dok webhook koristi `timingSafeEqual`; webhook nema anti-replay (nema timestamp/nonce); `prefs` jsonb bez ograničenja veličine; `/stil/*` bez role guard-a; MIME priloga se veruje klijentu.

---

## 8. Arhitektura i tehnički dug

### A1 · Nula automatizovanih testova

Ne postoji test framework, ni jedan `.test.ts`, ni `test` skripta, ni CI. Postoje tri `.mjs` smoke skripte vezane za **živu bazu** (`rls-test`, `woo:test`, `backfill`) — to su integracioni alati, ne test suite.

Nijedna funkcija koja računa novac (`otkupOf`, `withPdv`, `pnlFrom`, `computePeriodMetrics`, `belgradeDate`, `previousWorkingDay`, `parseRsd`) nema test. Istorija to potvrđuje: bug „Zarada/Marža = 0" je stigao u produkciju i otkriven ručno — a Ž1 iz ove analize je **isti bug na drugom mestu, i još uvek je tamo**.

**Predlog — Vitest, dve trake:**

*Traka A (unit, bez baze, <2 s)* — novčani helperi, Belgrade vreme/DST, HMAC provera potpisa, `isVariantLowStock`, `matchCancellations`. **60% vrednosti za 20% truda, ~4 h posla.** Počni ovde.

*Traka B (integracioni, staging Supabase projekat)* — snapshot zamrznutih cena, idempotentnost webhook-a, `computePeriodMetrics` nad 2500 porudžbina, RLS po roli (`rls-test.mjs` se samo prepisuje u Vitest), životni ciklus fakture, otkazivanje/vraćanje + zaliha, autorizacija svih akcija.

*CI (`.github/workflows/ci.yml`)* — `typecheck` + `lint` + `format:check` + `test` + `npm audit --audit-level=high` na svaki push; zaseban `db` job sa `supabase db reset` koji usput dokazuje da **migracije uopšte prolaze od nule** (danas to niko ne proverava). Uz branch protection na `main` — trenutno se commit-uje direktno na deploy granu, 80 commit-ova bez ijedne kapije.

**Jeftina provera koja se isplati odmah:**
```bash
! grep -rn "const { data } = await supabase" db app lib
```
Danas prijavi **38 mesta**.

### A2 · Zavisnosti — 5 „high" ranjivosti `[POTVRĐENO: npm audit]`

| Paket | Šta |
|---|---|
| `next` 16.2.10 | 9 advisory-ja: middleware/proxy bypass, DoS i SSRF u Server Actions, cache confusion (2×), neautentifikovano otkrivanje Server Function endpoint-a |
| `postcss` (kroz next) | XSS + path traversal preko `sourceMappingURL` |
| `sharp` (kroz next) | libvips CVE-2026-33327/33328/35590/35591 |

**Fix je patch verzija:** `npm i next@16.2.12 eslint-config-next@16.2.12` → očekivano 0.

Napomena o kalibraciji: advisory za middleware bypass se odnosi na **Turbopack** build, a produkcija se gradi sa `next build --webpack` — verovatno ne pogađa vas direktno. Ostali (Server Actions DoS/SSRF, cache confusion) pogađaju. Nadogradnja je ionako besplatna.

Nekorišćenih zavisnosti nema. Ostalih 23 paketa zaostaje minor/patch — bezbedno; `typescript` 5→7, `eslint` 9→10, `@types/node` 20→26 su major-i, ne dirati sada.

### A3 · Ista logika kopirana na više mesta

| Logika | Kopije | Rizik |
|---|---|---|
| **Sumiranje zamrznute zarade** | 3 (`db/metrics.ts` inline, `sumOrderItems`, `profitByOrder` preko view-a) | **Najopasnije** — tri puta do iste cifre, tri različita chunk-a (200 / 500 / 0). Cifre se mogu razići |
| Lookup statusa po imenu | 11 mesta | Svako je zaseban round-trip i zaseban izvor greške |
| „Nisko stanje" pravilo | 3 kopije | Kad se pravilo promenilo (dodat `stock_counted_at`), moralo se menjati na tri mesta |
| Granice meseca | 3 implementacije | `expenses` verzija nema UTC pred-filter |
| Srpska množina | 2 identične funkcije | — |

Otkazni statusi su dobro urađeni — jedan izvor (`CANCELLED_STATUS_NAMES`).

**Predlog (P2, strukturni):** preseliti agregaciju novca u Postgres — jedna funkcija `period_metrics(from, to)` koja radi `sum()` unutar baze uz `at time zone 'Europe/Belgrade'`. Rezultat: jedan round-trip umesto 15+, **nema row cap-a, nema chunk-ovanja, nema tri kopije formule**, i Dashboard / Finansije / lista porudžbina matematički ne mogu da se raziđu.

### A4 · Greške baze se gutaju

Obrazac `if (error) return { error: "Izmena nije uspela." }` ponovljen ~25 puta, **nigde bez slanja u Sentry**. Gore: `syncNeedsVp` i `recomputeGoodsTotal` ne proveravaju grešku **uopšte** — a `goods_total` hrani otkupninu na uplatama.

Korisnik vidi „nije uspelo", ti ne vidiš ništa i ne možeš saznati da li je RLS, constraint ili mreža.

**Predlog:** helper `dbFail(error, userMsg)` koji uz povratnu poruku uvek radi `Sentry.captureException`; `syncNeedsVp`/`recomputeGoodsTotal` treba da **bacaju**, ne da gutaju.

### A5 · Bulk akcije su tempirana bomba

`markOrdersShipped` i `changeOrdersStatus` idu red po red: 1 UPDATE + 1 INSERT istorije + (novo) sinhronizacija zaliha + **HTTP PUT ka Woo-u sa 10 s timeout-om**. Šema dozvoljava **200 porudžbina** po potezu. Realno: 200 × ~0,6 s = 2 minuta.

**Nijedna ruta nema `export const maxDuration`** (0 pogodaka u grep-u). Bulk nad velikom selekcijom puca u pola posla, bez transakcije — deo porudžbina promenjen, deo ne, korisnik bez poruke, selekcija ostaje → najverovatnija reakcija je „klikni ponovo".

**Popravka:** batch UPDATE (`.in("id", ids)`) + batch INSERT istorije; Woo push kroz `Promise.allSettled` sa konkurentnošću 5–8 (ili u red poslova, pošto je ionako best-effort); `maxDuration = 60`; do tada spustiti `max` na ~50.

### A6 · Nema generisanih Supabase tipova

Ne postoji `database.types.ts`. Rezultat: **23 `as unknown as` casta** (i 72 `as` ukupno). Nula `any` — disciplina se poštuje, ali svaki cast je mesto gde promena šeme **neće** oboriti `tsc`.

```bash
supabase gen types typescript --linked > db/database.types.ts
```
\+ `createServerClient<Database>(...)`. Posle toga se svih 23 castova briše, a `Tables<"orders">` postaje izvor istine.

### A7 · Operativa

- **Ne postoji način da se iz repoa vidi koje su migracije stvarno primenjene.** CLAUDE.md na 6 mesta kaže „Pre produkcije: `supabase db push`". Proverio sam direktno: sve osim najnovije (`stock_applied`) **jesu** primenjene. Predlog: `npm run db:status` (`supabase migration list --linked`) kao obavezan korak.
- **Nema rollback plana** — nijedna migracija nema down-skriptu. `20260712140000_split_cancel_return_status.sql` preimenuje postojeći red; povratak bi bio ručan. Backup politika nije dokumentovana nigde.
- **Cron je jedna tačka otkaza** — jedan unos, bez retry-ja i bez alarma. Ako padne, nikad nećeš saznati da push obaveštenja ćute. Predlog: Sentry Cron Monitoring (besplatan).
- **Env je uredan** — 24 promenljive u kodu se potpuno poklapaju sa `.env.example`. Jedina napomena: `NEXT_PUBLIC_APP_URL` se koristi kao VAPID `subject`.
- **Sve je `force-dynamic`** (18/18 stranica), što je za finansije ispravno, ali `/katalog` povlači ceo katalog na svaki request, a `orders-refresh.tsx` radi `router.refresh()` **svakih 60 s** i na Dashboardu — što pokreće pun paginirani skan porudžbina po otvorenom tabu.
- **`revalidatePath` je u velikoj meri pogrešno usmeren** (27 poziva): promena statusa ne revalidira Dashboard, katalog (stanje!) ni finansije; troškovi revalidiraju `/finansije` iako se neto profit vidi na `/`; `revalidatePath("/finansije")` je **mrtav poziv na 5 mesta** jer je ta stranica čist `redirect`. Danas je bezopasno jer je sve dynamic — ali je bezopasno slučajno, ne po dizajnu.
- **Nema `error.tsx` ni `not-found.tsx` nigde**, a `notFound()` se zove na 5 mesta → pada na Next-ov engleski 404 **izvan `AppShell`-a** (bez navigacije).

### A8 · CLAUDE.md je postao changelog

55 KB, 10 numerisanih sekcija (uputstvo) + **19 hronološki nalepljenih dodataka**, od kojih neki poništavaju gornje sekcije:

- §3 „Email nije u Fazi 1" → dodatak kaže da jeste.
- §3 „auto-decrement NIJE u Fazi 1" → `lib/stock.ts` postoji.
- §5 „koristiti `date-fns-tz`" → dodatak 1.6 kaže „NE koristi se `date-fns-tz`".
- §3 „Otkazano/Vraćeno" (jedan status) → dodatak kaže dva.

Model čita ceo fajl na startu svake sesije; kontradikcije daju nedeterminističko ponašanje.

**Predlog:** `CLAUDE.md` ≤ 150 linija sa **samo onim što važi danas** · `docs/odluke/NNN-*.md` (ADR-ovi, svaki sa „menja #NNN") · `docs/CHANGELOG.md` za hronologiju. Pravilo: kad se odluka promeni — **prepiši je**, ne dodaj ispod.

**Odmah, bez restrukturiranja:** razrešiti te 4 kontradikcije. *(Napomena: tokom trajanja ovog audita u `CLAUDE.md` je dodat dodatak o automatskom skidanju zaliha — on ispravno beleži promenu odluke, ali time i dalje raste fajl umesto da se §3 prepiše. To je tačno obrazac koji ovaj predlog rešava.)*

Sitno: README je u direktnoj kontradikciji sa CLAUDE.md (`supabase start` vs „bez Docker-a").

---

## 9. UX, mobilni i dizajn

Ovo je oblast sa najviše nalaza. App se koristi na telefonu (brat u pokretu, drug u magacinu), a **mobilna verzija je znatno slabija od desktop verzije**.

### Šta je dobro (da se ne pokvari)

- **Dijakritika je besprekorna.** Skeniran ceo repo — nijedan korisnički string bez č/ć/š/ž/đ.
- **Nula Tailwind default boja** u `app/**` i `components/**`; `globals.css` je 1:1 sa dizajn dokumentom.
- **Logistika stvarno ne dobija cene** — `db/catalog.ts` bira restriktovani view, pa cene **ne stižu ni u payload klijenta**. Nije „ne renderuje se", nego ih nema.
- `reduced-motion`, `tnum`, `env(safe-area-inset-bottom)` — implementirano po dizajnu.
- Menadžer gejt je dosledan — nema „dugme se vidi pa puca".

### Kritično

**U1 · Popis zalihe tiho briše količinu** — [stock-count-control.tsx:64-75](../app/%28app%29/katalog/stock-count-control.tsx#L64-L75)
`Number("") === 0` prolazi validaciju. Logistika obriše cifru da otkuca novu, pa slučajno skroluje ili tapne drugde (blur) → **varijanta koja je imala 12 komada postaje 0, sa `stock_counted_at` postavljenim**. Odmah upada u „Nisko stanje", Dashboard listu i dnevni push. Nema upozorenja. Isti put i za nevalidan unos („12a" → `""` → 0).

**U2 · Potvrda nepromenjenog broja ne radi ništa** — isti fajl, `:73`
`if (parsed === stockQuantity) return;`. Najčešći slučaj u magacinu je „prebrojao sam, ima ih 8, isto kao što piše". Otkuca 8, blur → **ništa**: nema toasta, „Fali količina" ostaje, `stock_counted_at` ostaje `null`. Čovek je siguran da je popisao, a nije. Uz to, **popis uopšte nema toast uspeha** — `setStockCount` vraća `success: "Popisano."` koje se nigde ne prikazuje.

Zajedno, U1+U2 znače da je popis tok u kome se ne zna ni da li je snimljeno, ni da li je preskočeno, ni da li je nešto obrisano.

**U3 · Prazno polje u XExpress fakturi briše poštarinu iz Woo-a** — [xexpress-invoice-form.tsx:130-137](../app/%28app%29/finansije/postarina/fakture/xexpress-invoice-form.tsx#L130-L137)
`Number(chargeds[id]) || 0` → prazno polje postaje 0 i server to upisuje u `orders.shipping_charged`. Zod ne hvata jer je 0 validno. Posledice: otkupnina na Uplatama se menja (`otkupOf = goods_total + shipping_charged`), a `shipping_actual = 0` znači „XExpress nam ništa nije naplatio" → **saldo poštarine se veštački napumpa**.
Uz to, vezivanje ide `for` petljom **bez transakcije i bez rollback-a** — ako pukne na 40. porudžbini, faktura je već kreirana i 39 porudžbina već izmenjeno. `createPayout` ima rollback; ovde ga nema.

**U4 · „Štampaj" na fakturi nikad ne radi** — [invoice-print.tsx:49](../app/%28app%29/finansije/fakture/[id]/invoice-print.tsx#L49)
`window.open("", "_blank", "noopener,…")` — po HTML spec-u, kad je `noopener` u `windowFeatures`, poziv **uvek vraća `null`**. Dugme uvek pada u „Štampa nije uspela (blokiran pop-up)" iako pop-up nije blokiran. Identičan kod u spisku uplata **nema** `noopener` i radi.

**U5 · Na telefonu se ne može odjaviti** — `signOut` se poziva **samo** iz sidebar-a koji je `hidden md:flex`. Mobilni nema header uopšte: ni ime, ni rolu, ni izlaz. `/podesavanja` nema dugme za odjavu.

**U6 · Redirect petlja bez izlaza** — korisnik sa validnom sesijom ali bez `profiles` reda: middleware ga šalje sa `/prijava` na `/`, layout ga vraća na `/prijava` → `ERR_TOO_MANY_REDIRECTS`. To stanje app sam proizvodi — `korisnici/actions.ts:65` eksplicitno dopušta ishod „pozivnica poslata, ali upis role nije uspeo".

**U7 · Preimenovanje statusa tiho lomi sistem** — cela aplikacija radi lookup statusa **po imenu** (namerna odluka), ali forma u Podešavanjima dozvoljava da se „Isporučeno" preimenuje u „Dostavljeno". Posle toga uplate, fakture, Dashboard i cron **prestanu da rade bez ijedne greške** — samo se sve isprazni. Predlog: zaključati imena seed statusa, dozvoliti samo boju i redosled.

**U8 · Nepovratne akcije bez potvrde** — „Označi plaćeno" trajno zaključava fakturu (nema akcije koja vraća `placeno` → `izdato`), a dugme je 32px. Bulk „Označi poslato" izvršava se **odmah na `onSelect`**, gura desetine porudžbina u Woo bez potvrde — dok pojedinačna ista akcija na detalju **ima** `ConfirmDialog`. Susedne stavke u tom meniju su „Otkazano"/„Vraćeno".

**U9 · Nema `not-found.tsx` ni ijednog `error.tsx`** — 404 je Next-ov **engleski** ekran bez navigacije; svaka greška u server komponenti eskalira u `global-error.tsx` koji zamenjuje ceo dokument (gubi se sidebar i bottom nav, i ne nosi Geist font). Postojeća `ErrorState` komponenta se nigde ne koristi kao boundary.

**U10 · Bez interneta korisnik vidi dinosaurusa** — app je namerno online-only i to je ispravno, ali **nema offline fallback stranice**. U instaliranom PWA (bez URL trake) gubitak signala izgleda kao da je app crkao. Za magacin sa slabim signalom to je svakodnevno. Jedna precache-ovana `/offline` stranica ne narušava ustav — ne servira nijedan podatak, samo poruku.

**U11 · Lozinka može završiti u URL-u** — forme u `/podesavanja` nemaju `action`, oslanjaju se samo na `onSubmit`. Dok React nije hidriran (spor mobilni net), „Go" na tastaturi izvede native GET → `/podesavanja?password=…` u istoriji pretraživača i u Vercel logovima.

### Najveći gubitak vremena u svakodnevnom radu

**Katalog gubi filtere pri povratku** — [catalog-table.tsx:101-105](../app/%28app%29/katalog/catalog-table.tsx#L101-L105)
Pretraga, kategorija i filteri stanja su **lokalni React state**, a strana je `force-dynamic` → povratak sa detalja proizvoda re-montira komponentu. Tok „popiši 50 varijanti" postaje: filtriraj → uđi → nazad → **filtriraj ponovo** → skroluj do iste tačke. `/troskovi` već radi ispravno sa `?mesec=` — isti obrazac rešava ovo.

**Poštarina je odvojena od koraka „Poslato"** — dokumentacija kaže da se popunjava „na koraku Poslato", ali su to dva razdvojena mesta: otvori → skroluj → „Poslato" → potvrdi → skroluj dole → 4 polja → „Sačuvaj". Za 20 porudžbina dnevno = 80+ interakcija. **Bulk „Poslato" uopšte ne nudi poštarinu**, a bulk unosa nema nigde — pa posle bulk slanja moraš da otvaraš svaku. Pošto saldo poštarine i XExpress fakture zavise od `shipping_charged`, ovo je operativna rupa.

**Popis nema režim za magacin** — za jednu varijantu treba ~6-7 tapova; ×50 ≈ **350 tapova** bez ijedne potvrde. Nema „potvrdi sve prikazane", Enter ne pomera fokus na sledeće polje, nema skeniranja SKU-a, nema brojača napretka.

**Uplata se ne može ispraviti** — UI uvek šalje nepromenjen `orderIds`. Ako zaboraviš da čekiraš jednu porudžbinu, jedini put je obriši-pa-napravi-novu — a brisanje je zabranjeno ako je bilo šta fakturisano → **ćorsokak**. Server **ume** da re-veže, samo to nije izloženo.

**Bulk slanje: desetine sekundi bez ijednog znaka** — 30 porudžbina = 30 uzastopnih HTTP poziva ka Woo-u (10 s timeout po pozivu). UI pokazuje samo zasivljeno dugme — nema spinnera, progresa, „Obrađujem 12/30". Na telefonu izgleda kao da se app zaledio → korisnik tapka ponovo.

### Sistemska odstupanja

**Tap mete** — dizajn dokument (§8) traži **min 40px** uz napomenu „brat radi sa telefona". Realnost: 48 pojava `size="sm"` / `h-8`. Najvažnije:
- **„X" za zatvaranje dijaloga je ~16px** — u *svakom* dijalogu u aplikaciji.
- Svih 5 dugmadi brzog toka na detalju porudžbine („Poslato", „Isporučeno", „Otkaži", „Vrati", „Keš") su **32px** — to su najvažnije dnevne akcije.
- Popis: input 32px + čekboks **16px**, 50× po smeni.
- Strelice za mesec na Troškovima: **24×24px**.
- Nema `components/ui/checkbox.tsx` — **16 sirovih `<input type="checkbox" className="size-4">`** nose *sve* bulk tokove. Na kartici porudžbine čekboks leži iznad overlay linka: promašaj od 3-4px otvara detalj umesto da čekira.

**Kontrast — izračunato, ne procenjeno:**

| Token | Odnos | AA |
|---|---|---|
| `ink-faint` na belom (koristi se na 11-12px) | 3,01:1 | ✗ |
| `ink-faint` na `surface-2` | 2,91:1 | ✗ |
| `warning` pilula (Neuplaćeno / Nisko / Treba VP) | 3,95:1 | ✗ |
| `sent` pilula (Poslato) | 4,25:1 | ✗ za 12px bold |
| „Vraćeno" / „Isporučeno" pilula | 2,86 / 2,95:1 | ✗ |

Statusne pilule su jedini deo app-a koji vizuelno „nije Sportem" — boje dolaze iz `seed.sql` kao **Tailwind default heksovi** sa 10% alfe, ne kao brend tokeni.

**Tipografija je stepenik-dva ispod sopstvenog dizajn dokumenta:** `h1` je `text-xl` (1,25rem) umesto 1,75rem na **15 od 21 mesta**; `h2` je na 8 mesta `text-sm`; stat broj na Dashboardu je 24px umesto 36px. Jedini ekran koji tačno prati dokument je `/stil`.

**Mobilni prelivi (375px):**
- **Dashboard ima horizontalni scroll** — `rsd()` vraća **non-breaking space**, pa je „184.300 RSD" jedan neprelomiv token širi od kartice.
- Polju za pretragu na listi porudžbina ostaje **~90px** — placeholder odsečen, unos neupotrebljiv.
- „Izaberi sve na strani" postoji **samo u desktop tabeli**; na telefonu 25 tapova po 16px.
- Traka „Izabrano: N" je na **vrhu** liste i nije sticky — odčekiraš dole, moraš da skroluješ nazad.
- Tabele na detaljnim stranama finansija **nemaju mobilnu kartičnu varijantu** (za razliku od listi). XExpress detalj ima 6 kolona sa `whitespace-nowrap`, a najvažnija („Rezultat") je van ekrana.
- Dijalozi kandidata su skrol u skrolu u skrolu — vidiš ~6 od 40+ redova, a „Sačuvaj" je ispod liste u istom skrolu.
- Logistika ima **jednu** primarnu nav stavku → „Katalog" se `flex-1` rasteže preko pola ekrana, što izgleda kao greška.

**`/stil` i `/stil/komponente`** su jedine rute pod `(app)` **bez role guarda** — ~570 linija dizajn-showcase-a isporučenih u produkcionom build-u. Sadrže samo lažne demo podatke (nema pravih cena), pa nije curenje — ali Logistika vidi demo tabelu sa kolonama MP/VP/Zarada, što je nepotrebno zbunjujuće. Predlog: guard na `admin` ili izbaciti iz prod build-a.

### Ocena po ekranu

Skala: ✅ solidno · ⚠️ upotrebljivo uz trenje · ❌ blokira realan rad

| Ekran | Desktop | Mobilni | Glavni razlog |
|---|---|---|---|
| App shell / nav | ✅ | ❌ | nema headera ni odjave (U5); redirect petlja (U6) |
| Dashboard | ✅ | ❌ | NBSP preliva karticu → horizontalni scroll; stat broj 24px |
| Porudžbine — lista | ✅ | ❌ | pretraga ~90px; nema select-all; traka akcija nije sticky |
| Porudžbine — detalj | ⚠️ | ❌ | svih 5 glavnih dugmadi 32px; poštarina odvojena od „Poslato" |
| Katalog — lista | ⚠️ | ⚠️ | filteri se gube pri povratku; O(n²) pretraga |
| Katalog — detalj / popis | ⚠️ | ❌ | prazno polje → 0 (U1); nepromenjena cifra se ne snima (U2) |
| Katalog — uvoz CSV | ⚠️ | — | nedostupno tastaturom; greška u zelenom okviru |
| Finansije — uplate | ✅ | ⚠️ | dijalog u tri skrola; uplata se ne može ispraviti |
| Finansije — fakture | ⚠️ | ⚠️ | „Štampaj" ne radi (U4); „Plaćeno" nepovratno bez potvrde |
| Finansije — poštarina / XExpress | ⚠️ | ❌ | prazno polje briše poštarinu (U3); nema rollback-a |
| Troškovi | ✅ | ⚠️ | strelice meseca 24px; prazno stanje bez akcije |
| Obaveštenja | ⚠️ | ⚠️ | zaglavlje kolona ne stoji iznad čekboksa |
| Podešavanja | ⚠️ | ⚠️ | nema odjave; preimenovanje statusa lomi sistem (U7) |
| Korisnici | ✅ | ⚠️ | nema „pošalji pozivnicu ponovo" ni uklanjanja |
| Prijava / Postavi lozinku | ⚠️ | ⚠️ | **nema „Zaboravljena lozinka"**; deep link se gubi |
| `/stil` | ✅ | ✅ | jedini tačan po dizajnu — ali bez role guarda |
| PWA / offline | ⚠️ | ❌ | nema offline stranice; nema install prompta; privremene ikonice |
| 404 / greška | ❌ | ❌ | nema `not-found.tsx` ni `error.tsx` (U9) |

### UX predlozi (najveći efekat za najmanje posla)

1. **Mobilni header sa nalogom i odjavom** — rešava U5 i daje mesto za globalnu pretragu.
2. **`components/ui/checkbox.tsx` sa metom od 40px** — jedna komponenta popravlja svih 16 mesta.
3. **Filteri kataloga i finansija u URL** — rešava najveći dnevni gubitak vremena.
4. **Režim popisa za magacin** — velika polja, `Enter` → sledeća varijanta, brojač „popisano 12/50", „Potvrdi sve prikazane", skeniranje SKU-a. Jedini tok koji drug koristi, a najskuplji po tapu.
5. **Poštarina u istom koraku kao „Poslato"** (pojedinačno i bulk, sa „ista poštarina za sve").
6. **Globalna pretraga (⌘K / lupa)** — kupac zove i kaže broj; danas ne postoji nijedno mesto odakle se to nađe.
7. **In-app istorija obaveštenja** — `notification_log` postoji ali se **nikad ne čita u UI**. Ako push promakne, događaj je nepovratno propušten.
8. **Undo kroz toast (5 s)** za promenu statusa i popis — poništava veliki deo štete od promašenog tapa na 32px dugmadi; `order_status_history` već pamti šta je bilo.
9. **„Zaboravljena lozinka"** — realan operativni rizik da Admin ostane zaključan iz sopstvenog sistema.
10. **`?next=` posle prijave** — danas svaki klik na push obaveštenje sa isteklom sesijom završi na Dashboardu umesto na porudžbini.

---

## 10. Poslovna slika iz podataka

Ovo ne govori o kodu nego o tome šta app pokazuje. Cifre su iz produkcione baze, po istoj logici koju koristi Dashboard (sve porudžbine po datumu kreiranja, bez Otkazano/Vraćeno).

| Mesec | Porudžbina | Zarada | Promet | Marža |
|---|---:|---:|---:|---:|
| 2026-02 | 147 | 138.808 | 607.970 | 22,8% |
| 2026-03 | 204 | 205.940 | 882.960 | 23,3% |
| 2026-04 | 191 | 235.899 | 1.034.100 | 22,8% |
| 2026-05 | 174 | 196.616 | 725.190 | 27,1% |
| 2026-06 | 109 | 139.508 | 493.620 | 28,3% |
| 2026-07 | 108 | 113.997 | 332.390 | 34,3% |

**Tri stvari koje se vide:**

1. **Promet je pao 45% od aprila** (1.034.100 → 332.390), ali **marža je porasla sa 22,8% na 34,3%**. Prodaje se manje, ali profitabilnije — što se poklapa sa napomenom u dokumentaciji da je Meta Ads „trenutno usporeno".

2. **Zarada za 6 meseci: 1.030.768 RSD. Troškovi: 955.601 RSD.** Neto ≈ **75.000 RSD za pola godine.** Od troškova je 596.722 RSD (62%) na Reklame. Ovo je cifra koju app već ima, ali je nigde ne prikazuje kumulativno — Dashboard pokazuje samo izabrani period. **Poređenje perioda i trend grafikon bi ovo učinili očiglednim** (v. predlog F2).

3. **Stopa otkaza/vraćanja raste: 5,2% → 14,3%.**

| Mesec | Otkazano/Vraćeno |
|---|---|
| 2026-02 | 8/155 = 5,2% |
| 2026-03 | 22/226 = 9,7% |
| 2026-04 | 22/213 = 10,3% |
| 2026-05 | 23/197 = 11,7% |
| 2026-06 | 19/128 = 14,8% |
| 2026-07 | 18/126 = 14,3% |

Skoro trostruko za pet meseci. App danas **ne prikazuje ovu stopu nigde**, a razlozi otkazivanja se od nedavno unose kao slobodan tekst — pa se ne mogu ni izbrojati. Šifrarnik razloga (v. F9) bi ovo pretvorio u odgovor na pitanje „zašto".

**Ostalo:**
- **Ponovljeni kupci: 6,8%** (65 od 960). Za sportsku opremu (potrošni asortiman — trake, prostirke) ovo je prostor za rad; app ima sve podatke za segmentaciju, ali nema nijedan ekran za kupce.
- **Top artikli po zaradi:** Platnene trake (SM177) 174.380 · Podesive bučice (SM195) 81.200 · Gumene trake (SM116) 63.700 · NBR Prostirka crna 33.980. Najveće marže su na sitnoj robi (Hand grip 61%, Joga blok 49%), najniže na vinil bučicama (15–18%).
- **154 varijante sa zalihom nikad nisu prodate.** Magacin je drugov, pa to nije tvoj zarobljen kapital — ali jeste asortiman koji ne radi, i podatak koji app ima a ne prikazuje.

Sve ove cifre postoje u zamrznutim `order_items` — fali samo ekran koji ih agregira.

---

## 11. Predlozi novih funkcionalnosti

Poređano po odnosu vrednost/trud. Prve četiri su sve „podaci već postoje, fali ekran".

| # | Šta | Zašto | Trud |
|---|---|---|---|
| **F1** | **Prodaja po artiklu / kategoriji** — top artikli po komadima, prometu, zaradi, marži + „nije prodato N dana" | Direktno vodi odluke o nabavci. Sve je u `order_items`. **Najveći ROI.** | jedan view + jedna strana |
| **F2** | **Poređenje perioda + trend** — „ovaj mesec vs prošli" (Δ i %), sparkline zarade/marže po mesecima | `computePeriodMetrics` već prima proizvoljan `{from,to}` — drugi poziv i jedna kolona | mali |
| **F3** | **Izvoz CSV/Excel svega** — porudžbine (za trenutni filter), uplate, fakture, troškovi, XExpress specifikacije | Nema **nijednog** izvoza u celoj aplikaciji. Ništa se ne može dati knjigovođi | mali, veliki efekat |
| **F4** | **Istorija kretanja zaliha (`stock_movements`)** | Preduslov za poverenje u bilo koji broj o zalihama; danas 5 puteva menja količinu bez traga | srednji |
| **F5** | **Delimično vraćanje / zamena** | Vraćanje je danas sve-ili-ništa, a realno se vrati 1 od 3 artikla. **Najveća rupa u modelu** | veći |
| **F6** | **„Rezervisano" na varijanti** — „na stanju 10 · rezervisano 3 · raspoloživo 7" | Rešava S2 iz sekcije 6 i čini automatsko skidanje razumljivim Logistici | srednji |
| **F7** | **Pretraga po SKU / artiklu** — „nađi sve porudžbine sa artiklom X" | Povlačenje serije, reklamacije, „koliko sam ovoga prodao" | mali |
| **F8** | **Bulk izmena cena** — selekcija → „+10%", „marža na X%", „zaokruži na 90", uz obavezan dry-run | Danas se cene menjaju varijanta-po-varijanta ili kroz rizičan CSV uvoz | srednji |
| **F9** | **Šifrarnik razloga otkazivanja/vraćanja** (dropdown + opcioni tekst) | Pretvara rastuću stopu otkaza iz sekcije 10 u odgovor „zašto" | mali |
| **F10** | **Starost potraživanja (aging)** za „isporučeno, neuplaćeno" — 0–7 / 8–14 / 15–30 / 30+ dana | Odmah pokazuje šta je zaglavilo kod XExpress-a | mali |
| **F11** | **Broj pošiljke (tracking) + link ka praćenju** uz korak „Poslato" | `weight_grams`/`package_count` se već unose, broj pošiljke ne postoji | mali |
| **F12** | **`printed_at`** — koje su porudžbine već bile na PDF listi | Sprečava dvostruko slanje; „štampaj samo neštampane" | mali |
| **F13** | **Interna napomena po porudžbini + istorija komunikacije** (poziv/SMS/Viber, ishod, ko) | Kod otkupnina se puno zove; to znanje sad živi u glavi | srednji |
| **F14** | **Izvoz kataloga za Woo** (SKU, cena, stanje) | App je „glavni katalog", a Woo se ažurira **ručno**. Woo klijent i Write ključ već postoje | mali |
| **F15** | **Ekran keš prodaja** — `payment_status = 'kes'` (123 porudžbine) ulazi u zaradu ali se nigde ne izlistava | Nema dnevnika keša ni provere „koliko je primljeno u julu" | mali |
| **F16** | **„Uplaćeno bez uplate-reda"** — filter/izveštaj | Najmanje 54 takve porudžbine su nevidljive svuda; zarada im je faktički otpisana, a nema načina ni da se vidi koliko je to | mali |
| **F17** | **Barkod/skener za popis** (`BarcodeDetector` na telefonu) | Popis 372 varijante kroz brojčano polje je spor | srednji |
| **F18** | **Predlog za poručivanje** — spoj stanja, praga i brzine prodaje → „ostalo za 6 dana" | Fiksni prag od 5 je isti za trake i za bučice od 20 kg | srednji |
| **F19** | **Revizioni trag finansija** | Uplata/faktura se menja i briše bez traga; porudžbine imaju `order_status_history`, novac nema ništa | srednji |
| **F20** | **Povezivanje stavke sa artiklom iz kataloga** | 20 živih stavki (i 1571 istorijskih) nema `variant_id`; otključava F1 za istoriju | mali |

---

## 12. Predloženi redosled rada

**Nedelja 1 — zaustavi krvarenje (~1,5 dan)**
1. `sumOrderItems` CHUNK 500 → 200 + paginacija + `error` check *(Ž1 — pogrešna cifra na ekranu)*
2. Popis: prazan string ≠ 0, snimi i nepromenjenu cifru, dodaj toast uspeha *(U1, U2 — gubitak podataka)*
3. XExpress forma: ne slati prazna polja *(U3 — briše poštarinu i pomera otkupninu)*
4. Prekidač „samo dodaj nove" u CSV uvozu *(U1–U3 iz sekcije 5, privremena brana)*
5. `npm i next@16.2.12` *(5 CVE)*
6. `apply_stock_delta` premestiti iz `public` šeme — **pre `db push`** *(B1)*
7. Sitno a bolno: skloniti `noopener` sa „Štampaj" *(U4)*; `ConfirmDialog` na bulk „Poslato" i „Označi plaćeno" *(U8)*; zaključati imena seed statusa *(U7)*

**Nedelja 2 — temelj (~1,5 dan)**
8. Vitest + Traka A (novčani helperi, Belgrade vreme, HMAC) — ~4 h
9. CI: `typecheck` + `lint` + `test` + `npm audit` + branch protection na `main`
10. `supabase gen types` → brisanje 23 `as unknown as` castova
11. Mobilni header sa odjavom + `components/ui/checkbox.tsx` (40px) + `error.tsx` / `not-found.tsx` / `/offline` *(U5, U9, U10)*

**Nedelja 3 — sistemski (~1,5 dan)**
12. `selectAll()` + `chunked()` helper → zameniti svih 9 mesta iz sekcije 4 *(P1–P9)*
13. `dbFail()` helper → sve akcije šalju grešku u Sentry *(A4)*
14. `order_profit` view: NULL umesto tihe nule + `issueInvoice` tvrdo odbija *(P10)*
15. Datumski filter liste na Belgrade *(Ž3)* + pretraga po broju porudžbine *(Ž4)*
16. Filteri kataloga u URL *(najveći dnevni gubitak vremena)*

**Nedelja 4 — zalihe kako treba**
17. Odluka o modelu (preporuka: opcija B — `reserved_quantity`) *(sekcija 6, S2)*
18. `apply_order_stock` kao jedna transakcija *(S1)*
19. `stock_movements` ledger *(F4)*
20. Tek onda `db push` + commit

**Zatim, po vrednosti:** F1 (prodaja po artiklu) → F3 (izvoz) → F2 (poređenje perioda) → F10 (aging) → F9 (razlozi otkaza).

**Paralelno, kad stigneš:** restrukturirati CLAUDE.md *(A8)* — svaka naredna sesija radi bolje.

---

## 13. Šta ovaj audit NIJE pokrio

Da bude pošteno:

- **Nisam klikao kroz ulogovanu aplikaciju.** Prijava kroz skriptu je blokirana sigurnosnim filterom okruženja. Sve rute su verifikovane da odgovaraju i da redirektuju neulogovane (307), a UX analiza je rađena čitanjem koda i dizajn dokumenta. Vizuelni bagovi koji se vide samo u browseru mogu postojati.
- **Provere koje jesu pokrenute i prolaze:** `tsc --noEmit` čist · `eslint` čist (jedan poznat warning o TanStack Table) · `next build --webpack` **prolazi**, `public/sw.js` se generiše, sve 34 rute se grade (28 dinamičkih, 6 statičkih).
- **Nisam ništa upisivao u bazu** ni menjao fajlove u repou osim ovog izveštaja.
- **Nisam testirao push notifikacije na realnim uređajima** — to je i po planu deo koraka 1.10.
- Nalazi označeni kao **SUMNJA** u prilozima traže kratku proveru uživo.

---

## 14. Prilozi — puni izveštaji po oblastima

Detaljni izveštaji sa tačnim `fajl:linija` referencama, scenarijima i predlozima popravki:

| Oblast | Fajl | Obim |
|---|---|---|
| Finansije | [docs/audit/audit-finansije.md](audit/audit-finansije.md) | 475 linija — 4 kritična, 9 ozbiljnih, 14 sitnih, 12 predloga |
| Porudžbine + Woo | [docs/audit/audit-porudzbine.md](audit/audit-porudzbine.md) | 295 linija — 5 kritičnih, 12 ozbiljnih, 14 sitnih, 12 predloga |
| Katalog / zalihe | [docs/audit/audit-katalog.md](audit/audit-katalog.md) | 283 linije — 5 kritičnih, 9 ozbiljnih, 14 sitnih, 12 predloga |
| Sigurnost / RLS | [docs/audit/audit-sigurnost.md](audit/audit-sigurnost.md) | 202 linije — 0 kritičnih, 4 ozbiljna, 10 sitnih, 22 potvrđeno pokrivena |
| UX / PWA / a11y | [docs/audit/audit-ux.md](audit/audit-ux.md) | 736 linija — 16 kritičnih + ocena po ekranu |
| Arhitektura / tehnički dug | [docs/audit/audit-arhitektura.md](audit/audit-arhitektura.md) | 750 linija — 8 kritičnih, 8 ozbiljnih + pun plan testiranja i CI-ja |

Svaki prilog ima tačne `fajl:linija` reference, konkretne scenarije pucanja i predloge popravki, uz oznaku **POTVRĐENO** / **SUMNJA**.
