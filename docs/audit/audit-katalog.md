# Audit — KATALOG / PROIZVODI / ZALIHE / UVOZ

Datum: 2026-07-31 · Grana `main` · uključuje nekomitovane `lib/stock.ts` + `supabase/migrations/20260731140000_order_stock_decrement.sql`

Oznake: **[POTVRĐENO]** = pročitan kod dokazuje ponašanje · **[SUMNJA]** = jak indikator, traži live proveru.

---

## KRITIČNO

### K1. CSV uvoz NULIRA stanje celog kataloga kad kolona „Stanje" nije mapirana [POTVRĐENO]
`app/(app)/katalog/uvoz/actions.ts:241-250`

```ts
const fields = {
  variant_name: deriveVariantName(d.sku, d.variant_name),
  mp_price: d.mp_price,
  vp_price: d.vp_price,
  stock_quantity: d.stock_quantity ?? 0,      // ← uvek u patch-u
  low_stock_threshold: d.low_stock_threshold ?? 5,
  supplier_sku: d.supplier_sku,
  weight_grams: d.weight_grams ?? null,       // ← uvek u patch-u
  ...
};
```

`d.stock_quantity` je `undefined` kad kolona nije mapirana (`importIntOptional` → `undefined`), ali `?? 0` ga pretvara u **eksplicitnu nulu** koja ide u `UPDATE`. (Za razliku od `supplier_sku`/`description` koji ostaju `undefined` i JSON.stringify ih izbaci — ti su bezbedni.)

**Scenario:** Admin dobije od druga novi cenovnik (SKU, MP, VP) i uveze ga da osveži cene. Kolone „Stanje" nema. Rezultat: **svih ~360 varijanti dobija `stock_quantity = 0`**. Pošto `stock_counted_at` ostaje netaknut (jer `counted = d.stock_quantity != null` = false), sve popisane varijante ostaju „popisane" sa nulom → **ceo katalog pada u nisko stanje**, Dashboard lista i dnevni push eksplodiraju, a stvarna evidencija zaliha je nepovratno izgubljena (nema istorije stanja).

**Isto važi za:**
- `low_stock_threshold: ?? 5` — gazi ručno podešene pragove.
- `weight_grams: ?? null` — **briše težine** (potrebne za XExpress/poštarinu).
- `variant_name: deriveVariantName(...)` — kad kolona „Naziv varijante" nije mapirana, izvodi naziv iz SKU sufiksa → „Crvena · 2.4 m" postaje **„4"**.

**Rešenje:** graditi patch samo od polja koja su stvarno mapirana:
```ts
const fields: Record<string, unknown> = { mp_price: d.mp_price, vp_price: d.vp_price };
if (d.variant_name != null) fields.variant_name = ...;
if (d.stock_quantity != null) { fields.stock_quantity = d.stock_quantity; fields.stock_counted_at = ...; }
if (d.low_stock_threshold != null) fields.low_stock_threshold = ...;
if (d.weight_grams != null) fields.weight_grams = ...;
```
Za INSERT (nova varijanta) default-i su u redu — razdvojiti `insertFields` od `updateFields`.

---

### K2. CSV uvoz briše kategoriju postojećim proizvodima [POTVRĐENO]
`app/(app)/katalog/uvoz/actions.ts:209-222`

```ts
const categoryId = first.category ? (categoryByNorm.get(normalize(first.category)) ?? null) : null;
const productFields = { name, description, brand, category_id: categoryId };
await supabase.from("products").update(productFields).eq("id", productId);
```

`category_id` je uvek `null` kad kolona „Kategorija" nije mapirana → `null` je stvarna vrednost (nije `undefined`) → **UPDATE postavlja `category_id = NULL`** na svakom dodirnutom proizvodu.

**Scenario:** cenovni uvoz bez kategorije → svi proizvodi ostaju „Bez kategorije", filter kategorije u katalogu postaje beskoristan. Vraćanje je ručno, proizvod po proizvod.

**Rešenje:** izostaviti ključ kad `first.category == null` (`...(first.category ? { category_id: categoryId } : {})`).

---

### K3. CSV parser množi decimalne cene sa 100 [POTVRĐENO]
`lib/validation/catalog.ts:129-134`

```ts
const sanitizeInt = (v) => { const digits = v.replace(/\D/g, ""); return Number(digits); }
```

Skida **sve** što nije cifra. `"4990.00"` → `499000`. `"1.299,00"` → `129900`. `"9.990"` → `9990` (tačno).

CLAUDE.md (Korak 1.3) eksplicitno beleži da su CSV brojevi iz Sheets-a **mešani** — srpske hiljade („3.000") i decimale („4990.00") — i da `parseRsd` u `scripts/woo-backfill.mjs` te slučajeve razlikuje. Uvoz kataloga tu logiku **nema**.

**Scenario:** Sheets izvoz gde je cena formatirana kao broj sa 2 decimale (default kod „Format → Number"). Dry-run prikaže „za ažuriranje: 360 SKU", commit prođe bez greške, i MP/VP celog kataloga postaju 100× veći. Zarada u katalogu ostaje „tačna" (generated `mp − vp`) pa ništa ne vrišti; sledeća porudžbina zamrzne apsurdnu VP.

**Ublažavajuće:** zamrznute cene starih porudžbina su netaknute (ustav radi).

**Rešenje:** preuzeti `parseRsd` obrazac iz backfill skripte (tačka sa tačno 3 cifre iza = separator hiljada; inače decimalni separator), i dodati **sanity guard** u dry-run: upozorenje kad je nova cena > 10× stara.

---

### K4. Automatsko skidanje zaliha i ručni popis mere DVE različite stvari [POTVRĐENO — dizajn]
`lib/stock.ts:81-99` + `app/api/webhooks/woo/route.ts:259` + `app/(app)/katalog/actions.ts:378-403`

Rezervacija se dešava na **„Kreirano"** (prijem webhooka), a roba fizički napušta drugov magacin tek na **„Poslato"** — a šalje se samo **ponedeljkom i četvrtkom** (`docs/sportem-kontekst.md:26`). U tom prozoru (do 3–4 dana) `stock_quantity` je umanjen, ali je roba i dalje na polici.

Popis (`setStockCount`) upisuje **apsolutnu fizičku cifru**. Semantike se sudaraju:
- `stock_quantity` posle auto-decrement-a znači „fizički − rezervisano".
- `stock_quantity` posle popisa znači „fizički".

**Scenario:** varijanta ima 10 kom. U ponedeljak padne 3 porudžbine × 1 kom → app kaže 7. U utorak Logistika prebroji policu (roba još nije poslata), vidi 10, ukuca 10 → rezervacija je **izbrisana**. U četvrtak roba ode; app i dalje kaže 10, stvarno 7. Greška se akumulira svake nedelje.

**Obrnut scenario:** Logistika popiše 10 u 12:00, webhook u 12:01 skine 1 → 9. Nema konflikta, redosled je bezbedan. Problem je isključivo kad popis dolazi **posle** rezervacije koja još nije fizički realizovana.

**Dodatno:** `stock-count-control.tsx:73` — `if (parsed === stockQuantity) return;` poredi sa **props-om iz server rendera**. Ako je stanje u međuvremenu opalo (auto-decrement), a korisnik ukuca staru cifru koju vidi na ekranu, ništa se ne snima → potvrda popisa se tiho gubi.

**Predlog rešenja (jedno od tri):**
1. **Rezervisati na „Poslato", ne na „Kreirano"** — najbliže fizičkoj stvarnosti; `syncOrderStock("reserve")` premestiti iz webhooka u `markOrdersShipped`/`changeOrderStatus → Poslato`.
2. **Razdvojiti kolone**: `stock_quantity` (fizički popis) + `reserved_quantity` (Σ živih porudžbina) → prikaz „raspoloživo = stock − reserved". Čist model, više posla.
3. Minimum ako se ništa ne menja: pri popisu prikazati „rezervisano N kom (nije još poslato)" i ponuditi da se ta cifra oduzme; a `commitQty` porediti sa svežom vrednošću iz baze, ne sa props-om.

---

### K5. `stock_quantity` sme u minus, ali forma varijante ga odbija [POTVRĐENO]
`supabase/migrations/20260731140000_order_stock_decrement.sql:19-23` (namerno bez clamp-a) vs `lib/validation/catalog.ts:100` (`nonNegativeInt(...).default(0)`).

**Scenario:** nepopisana varijanta (0) dobije porudžbinu od 2 kom → stanje −2 (po dizajnu ispravno). Admin otvara „Izmeni varijantu" da promeni MP cenu; forma nosi `stock_quantity = -2`; submit → zod `min(0)` → **„Stanje mora biti ceo broj ≥ 0."** Admin ne može da promeni cenu dok ne izmisli stanje. Isto blokira i `setStockCount` (`stockCountSchema:120`) i `StockCountControl.commitQty` (`stock-count-control.tsx:66`).

Uz to, `<Input type="number" min={0}>` u popisu ne pokazuje da je vrednost nevalidna dok se ne pokuša snimanje.

**Rešenje:** ako je minus namerno stanje, dozvoliti ga u šemama (`z.number().int()` bez `min(0)`) i vizuelno ga označiti crveno („Prodato više nego evidentirano — potreban popis"). Alternativno, forma varijante da uopšte ne šalje `stock_quantity` kad nije promenjen.

---

## OZBILJNO

### O1. Neprovereni PostgREST `error` u svim katalog upitima [POTVRĐENO]
`db/catalog.ts:34-39, 42-52, 64-70, 113-122, 157-163, 176-180` — nijedan `{ data }` destructuring ne uzima `error`. Isti obrazac u `app/api/cron/notifikacije/route.ts:113-118` i `app/(app)/katalog/uvoz/actions.ts:56-63, 101`.

Ovo je **isti bug koji je već pukao** u `computePeriodMetrics` (CLAUDE.md: „`.in(...)` sa 1000+ UUID je tiho padao, `data=null`, greška se nije proveravala → zarada=0").

**Konkretan rizik ovde:** `fetchVariants` (`db/catalog.ts:47-50`) radi `.in("product_id", productIds)` sa **svim** ID-jevima proizvoda. Pri ~200 proizvoda URL je ≈ 8 KB — tačno na granici default `large_client_header_buffers` (8k). Prelaskom granice upit vrati 414/400, `data = null`, `?? []` → **katalog prikaže svaki proizvod sa 0 varijanti, 0 stanja i bez cena**, bez ijedne poruke o grešci.

Isto: `fetchExistingVariants` u uvozu (`chunkSize 300` — bolje, ali bez `error` provere → tiho tretira postojeći SKU kao nov → **duplikat SKU insert padne na unique**, ili gore: proizvod se duplira).

**Rešenje:** svuda `const { data, error } = ...; if (error) throw error;`. Za `fetchVariants` — ili izbaciti `.in()` (dohvatiti sve varijante jednim upitom, dataset je mali), ili chunk-ovati po 200 kao u `db/metrics.ts`.

### O2. Nema paginacije → tiho odsecanje na 1000 redova [POTVRĐENO]
`db/catalog.ts:64` (`products`), `47` (`product_variants`), `113`/`157`, `db/orders.ts:452`.

PostgREST vraća max 1000 redova po default-u. Katalog je danas ~200 proizvoda / ~360 varijanti pa radi, ali:
- `getActiveVariantOptions()` (izbor artikla pri dodavanju stavke) preći će 1000 pre ostalih.
- Rast kataloga → varijante se **tiho** gube iz prikaza i iz „nisko stanje" brojača.

**Rešenje:** `.range()` loop (obrazac već postoji u `db/metrics.ts` za `orders`).

### O3. Uvoz nema transakciju — delimičan neuspeh pravi duplikate proizvoda [POTVRĐENO]
`app/(app)/katalog/uvoz/actions.ts:193-272`

Tok je: (1) insert kategorija → (2) insert/update proizvoda po grupi → (3) insert/update varijanti. Nema `BEGIN/COMMIT`. Greška u koraku 3 se **ne** baca (samo se gura u `report.errors`), ali greška u koracima 1–2 baca → `fatalError` i izlaz.

**Scenario:** uvoz od 360 redova pukne na 200. redu (mrežni timeout / Vercel limit). Kreirano je npr. 90 novih proizvoda, ali varijante za poslednjih 20 nisu upisane. Admin ponovo pokrene uvoz → `fetchExistingVariants` ne nalazi te SKU (nisu upisani) → `rows.some(existingBySku.has)` je false → **kreira se DRUGI proizvod sa istim imenom**. Katalog dobija duplikate koje treba ručno čistiti.

**Rešenje:** grupu razrešavati i po nazivu proizvoda (ne samo po postojećem SKU), ili prebaciti ceo commit u jednu Postgres funkciju (`create function import_catalog(jsonb)` sa transakcijom), ili bar dodati „ponovi uvoz je bezbedan" tako što se prvo insertuju varijante pa proizvodi.

### O4. Uvoz radi ~2N sekvencijalnih round-trip-a → timeout na Vercelu [SUMNJA]
`app/(app)/katalog/uvoz/actions.ts:236-268` — `for` petlja sa `await` po redu (1 upit po varijanti) + 1 po grupi u koraku 2. Za 360 varijanti / ~200 grupa to je ~560 sekvencijalnih upita. Pri 40–80 ms po upitu → **25–45 s**.

`vercel.json` nema `maxDuration`, nijedna ruta ne postavlja `export const maxDuration`. Server akcija koja pređe limit se prekida usred posla → tačno scenario iz O3.

**Rešenje:** `upsert` u batch-evima (`.upsert(rows, { onConflict: "sku" })` po 500) umesto petlje; postaviti `export const maxDuration = 60` na ruti uvoza.

### O5. Greške pri upload-u slike izlaze kao neuhvaćen izuzetak, ne kao poruka [POTVRĐENO]
`lib/storage.ts:35` (`throw new Error(...)`), `lib/storage.ts:22-27` (sharp baca na neispravan sadržaj) — `handleImageUpload` (`katalog/actions.ts:44-60`) ne hvata ništa, pa izuzetak propagira iz `createProduct`/`updateProduct`/`createVariant`.

Klijent (`product-form.tsx:88-101`, `variant-form.tsx:87-104`) radi `const result = await action(...)` unutar `startTransition` **bez try/catch** → promise se odbija, `toast.error` se nikad ne pozove. Korisnik vidi da se dijalog ne zatvara i ne dobija objašnjenje.

Validacija tipa je samo po **klijentskom `file.type`** (`actions.ts:52`) — preimenovani `.exe` u `.jpg` prolazi tu proveru i puca u `sharp`.

**Rešenje:** `try/catch` oko `uploadCatalogImage` sa srpskom porukom + `Sentry.captureException`; validirati stvarni format iz `sharp().metadata()` umesto MIME iz browsera.

### O6. Arhivirani proizvod je nedostupan iz UI-ja [POTVRĐENO]
`db/catalog.ts:55-65` — `getCatalog` se poziva samo sa default `includeArchived = false` (`katalog/page.tsx:26`). Nema ni filtera ni prekidača „Prikaži arhivirane".

`catalog-table.tsx:63,148,275` renderuje badge „Arhiviran" — **mrtav kod**, taj red nikad ne stigne u tabelu.

**Scenario:** Admin arhivira proizvod (ili ga „obriše" pa se automatski arhivira jer ima varijante — `actions.ts:245-249`). Proizvod nestaje. „Vrati iz arhive" postoji samo na detaljnoj strani (`product-actions.tsx:63`), do koje se stiže **isključivo direktnim URL-om** `/katalog/<uuid>`. Praktično nepovratno.

**Rešenje:** čekboks „Prikaži arhivirane" u `catalog-table.tsx` + `?arhiva=1` → `getCatalog({ role, includeArchived: true })`.

### O7. Varijante arhiviranog proizvoda i dalje izlaze pri dodavanju stavke [POTVRĐENO]
`db/orders.ts:452-458`

```ts
.from("product_variants").select(...).is("archived_at", null)   // samo varijanta
```

Filtrira se `product_variants.archived_at`, ali **ne** `products.archived_at`. Arhiviranje proizvoda (`archiveProduct`) ne arhivira njegove varijante.

**Scenario:** proizvod se povuče iz prodaje (arhivira). Admin dodaje stavku na porudžbinu, u pretrazi i dalje nalazi taj SKU i snapshot-uje cenu proizvoda koji više ne postoji. Isto važi i za `changeOrderStatus`/`addItemFromCatalog` (`porudzbine/actions.ts:284-289` — lookup po `id`, bez ijedne provere arhive).

**Rešenje:** embed + filter `products!inner(archived_at)` `.is("products.archived_at", null)`, ili kaskadno arhiviranje varijanti u `archiveProduct`.

### O8. Prekidač `stock_applied` može ostati „true" bez stvarnog skidanja [SUMNJA]
`lib/stock.ts:84-94`

```ts
if (!(await claimFlag(supabase, orderId, next))) return true;
try { await applyDeltas(...) } catch (e) { await claimFlag(supabase, orderId, !next).catch(() => {}); throw e; }
```

Rollback pokriva `throw`, ali **ne pokriva prekid procesa** (Vercel timeout, OOM, deploy usred zahteva) između `claimFlag` i `applyDeltas`. Tada je `stock_applied = true` a količine nisu skinute → kasnije otkazivanje **vrati robu koja nikad nije skinuta** → stanje naduvano.

Isto: `claimFlag` i `applyDeltas` su dva statement-a bez zajedničke transakcije.

**Rešenje:** premestiti ceo tok u jednu Postgres funkciju (`apply_order_stock(p_order_id uuid, p_reserve bool)`) koja unutar jedne transakcije preuzme prekidač i primeni delte. Baza već ima `apply_stock_delta` — proširiti je.

### O9. Nema evidencije kretanja zaliha (ledger) [POTVRĐENO — nedostatak]
`stock_quantity` je jedini broj; menja ga 5 različitih puteva: webhook rezervacija, promena statusa, izmena stavke, ručni popis, CSV uvoz, forma varijante. **Ne postoji nijedan zapis ko je i zašto promenio količinu.** `stock_counted_by` čuva samo poslednjeg popisivača i prepisuje se.

Kad se stanje razilazi sa policom (a hoće — v. K4), nema načina da se rekonstruiše šta se desilo. Ovo je isti razred problema kao Sheets bug zbog kog postoji ceo snapshot ustav.

**Rešenje:** append-only `stock_movements (variant_id, delta, reason, order_id, user_id, balance_after, created_at)` po uzoru na `postage_settlements`. Pisati iz `apply_stock_delta` i iz `setStockCount`.

---

## SITNO

### S1. Prekidanje na nuli u popisu — cifra se ne snima kad je nepromenjena [POTVRĐENO]
`stock-count-control.tsx:73` — `if (parsed === stockQuantity) return;`. Nepopisana varijanta ima `stock_quantity = 0`; Logistika prebroji, vidi 0, ukuca 0 → **ništa se ne snima**, „Fali količina" ostaje. Mora da klikne čekboks, što nije očigledno (tooltip objašnjava, tekst se vidi samo na mobilnom, `showLabel`). Rešenje: uvek snimati na blur ako polje nije prazno.

### S2. SKU nije normalizovan po veličini slova [POTVRĐENO]
`lib/validation/catalog.ts:97` — samo `.trim()`. DB `unique` je case-sensitive. „sm021-4" i „SM021-4" su dva reda; webhook (`webhooks/woo/route.ts:170-174`) gađa `.in("sku", skus)` egzaktno → pogrešan slučaj = `vp_at_sale null` + `needs_vp` + **nema rezervacije** (`variant_id` null → `orderDeltas` preskače stavku, `lib/stock.ts:49-51`). Rešenje: `.toUpperCase()` u šemi + `citext`/funkcionalni unique indeks.

### S3. Nema provere `mp_price >= vp_price` [POTVRĐENO]
`lib/validation/catalog.ts:98-99` — obe cene samo `.positive()`. Zamena polja (VP u MP) proizvodi negativnu zaradu; generated `profit` je tiho negativan, a „Zarada" u tabeli ispisuje minus zelenim (`variants-table.tsx:201`). Rešenje: zod `.refine(mp >= vp)` uz mogućnost svesnog override-a + crveni prikaz negativne zarade.

### S4. Proizvod bez ijedne varijante je moguć [POTVRĐENO]
Zaključana odluka (CLAUDE.md §3, kontekst §7): „svaki proizvod ima bar jednu varijantu". `createProduct` (`actions.ts:121-153`) ne kreira default varijantu; prazno stanje na detalju samo kaže „Dodajte bar jednu varijantu". Takav proizvod je nevidljiv za porudžbine (webhook gađa SKU). Rešenje: pri kreiranju proizvoda ponuditi SKU u istom dijalogu i kreirati „Default" varijantu.

### S5. Popis se ne blokira na arhiviranoj varijanti na serveru [POTVRĐENO]
`variants-table.tsx:207` skriva kontrolu (`canCount && !archived`), ali `setStockCount` (`actions.ts:378`) ne proverava `archived_at`. Klijentska higijena bez server guarda — protivno §5 CLAUDE.md („RLS je izvor sigurnosti, UI je samo higijena"). Nizak rizik (Logistika je poverljiva), ali obrazac je pogrešan.

### S6. `getProductWithVariants` prima nevalidiran `id` iz URL-a [POTVRĐENO]
`db/catalog.ts:170-180` — `/katalog/blabla` daje PostgREST 400 (`invalid input syntax for type uuid`), `data` undefined, → `notFound()`. Ponaša se ispravno slučajno, jer `error` nije proveren. Dodati `isUuid()` guard (helper već postoji u `lib/validation/uuid.ts`).

### S7. `deleteCategory` ne upozorava koliko proizvoda gubi kategoriju [POTVRĐENO]
`actions.ts:106-117` — FK je `ON DELETE SET NULL`, poruka je samo „Kategorija obrisana." Predlog: prebrojati proizvode i tražiti potvrdu.

### S8. Uvoz šalje ceo dataset kroz server akciju dvaput [SUMNJA]
`import-wizard.tsx:120-143` — `buildItems()` se serijalizuje u `previewImport` pa opet u `commitImport`. Next.js default limit tela server akcije je **1 MB**. ~360 redova × ~200 B ≈ 72 KB (prolazi), ali izvoz sa opisima ili 5000 redova probija limit uz nejasnu grešku. Rešenje: `serverActions.bodySizeLimit` u `next.config.ts` ili upload fajla u Storage pa obrada server-side.

### S9. Duplikat SKU u fajlu se prijavljuje, ali se prvi red i dalje uvozi [POTVRĐENO]
`uvoz/actions.ts:87-91` — drugi red se odbija sa porukom, prvi prolazi tiho. Ako su cene u ta dva reda različite, uvozi se ona koja je slučajno prva. Predlog: prijaviti kao konflikt i preskočiti **oba**, ili prikazati obe vrednosti u dry-run-u.

### S10. Slika se briše tek posle uspešnog UPDATE-a, bez provere ishoda brisanja [POTVRĐENO]
`actions.ts:195-197, 360-362` — `deleteCatalogImage` „tiho ignoriše greške" (`lib/storage.ts:40-44`). Neuspelo brisanje ostavlja siroče u bucket-u zauvek; nema housekeeping skripte. Nizak trošak (webp ~100 KB), ali raste. Predlog: povremeni cron koji poredi `storage.objects` sa `products.image ∪ product_variants.image`.

### S11. `catalog-table.tsx` filter po kategoriji radi `products.find()` u petlji [POTVRĐENO]
`catalog-table.tsx:116-119` — O(n²) na svaki keystroke pretrage. Pri 200 proizvoda neprimetno; pri 2000 zamrzava input. Rešenje: `categoryId` uneti u `CatalogRow` u `toRow()`.

### S12. Popis nema optimističko zaključavanje [POTVRĐENO]
Dva korisnika (Admin + Logistika) koji istovremeno popisuju istu varijantu: poslednji upis pobeđuje, bez upozorenja. `setStockCount` je bezuslovni `UPDATE`. Nizak rizik (dvoje ljudi), ali u kombinaciji sa K4 pravi tihe gubitke.

### S13. `apply_stock_delta` okida `updated_at` trigger [POTVRĐENO — informativno]
`product_variants_set_updated_at` se izvršava i na automatskom skidanju. `updated_at` više ne znači „neko je ručno menjao artikal" — što je bila pretpostavka backfill-a popisa (`20260731120000_stock_count.sql:31-33`). Buduće migracije koje bi se oslonile na `updated_at` biće pogrešne.

### S14. Nema `error` provere ni u cron low-stock upitu [POTVRĐENO]
`app/api/cron/notifikacije/route.ts:113-118` — isti obrazac; tiho vraća 0 i push „nisko stanje" nikad ne stigne, bez traga u Sentry.

---

## PREDLOZI FUNKCIONALNOSTI

Poređano po odnosu vrednost/trud za vlasnika ecommerce-a.

1. **Istorija kretanja zaliha (`stock_movements`)** — v. O9. Preduslov za poverenje u bilo koji broj o zalihama. *Visok prioritet.*
2. **Bulk izmena cena** — trenutno se MP/VP menja isključivo varijanta-po-varijanta kroz dijalog ili kroz rizičan CSV uvoz. Potrebno: selekcija u katalogu → „+10%", „postavi maržu na X%", „zaokruži na 90". Sa obaveznim dry-run pregledom (isti obrazac kao uvoz).
3. **Istorija promena cena (`price_history`)** — snapshot ustav štiti stare porudžbine, ali ne postoji odgovor na „kad sam i zašto podigao cenu ovog artikla". Trivijalno uz trigger na `product_variants`.
4. **Prodaja po artiklu / mrtva roba** — podaci već postoje (`order_items` sa `sku`, `quantity`, `profit_at_sale`). Ekran „Top 20 artikala" (komada, promet, zarada, marža) + „Nije prodato N dana" bi direktno vodio odluke o nabavci. Najveći ROI u odnosu na trud — **jedan view + jedna strana**.
5. **Predlog za poručivanje** — spoj `stock_quantity`, `low_stock_threshold` i brzine prodaje (kom/nedelja iz `order_items`) → „ostalo za 6 dana prodaje". Trenutni prag od fiksnih 5 kom je isti za trake i za bučice od 20 kg.
6. **Rezervisano vs. raspoloživo u katalogu** — v. K4 opcija 2. Kolona „Rezervisano (nije poslato)" pored „Stanje" rešava i konflikt popisa i daje bratu jasnu sliku šta mora u ponedeljak.
7. **Izvoz kataloga u CSV / Woo sync** — app je „glavni katalog", a WooCommerce se ažurira **ručno** (zaključana odluka). Ne mora puna integracija: dugme „Izvezi CSV za Woo import" (SKU, regular_price, stock) uklanja najveći dnevni ručni posao i izvor grešaka. Woo REST klijent (`lib/woo-client.ts`) i Write ključ već postoje.
8. **Barkod/skener za popis** — na telefonu, `BarcodeDetector` API + polje `barcode` na varijanti. Popis 360 varijanti kroz brojčano polje je spor; skener ga svodi na minute. Radi i offline-ish (mada je app online-only).
9. **Dobavljači + nabavne porudžbine** — `supplier_sku` postoji, tabele dobavljača nema. Za sada je jedan dobavljač (drug), pa je prioritet nizak; postaje bitno kad se uvede drugi izvor robe.
10. **Više slika po proizvodu (galerija)** — trenutno jedna slika po proizvodu i jedna po varijanti. Nizak prioritet za interni alat.
11. **„Samo dodaj nove, ne diraj postojeće" prekidač u uvozu** — najjeftinija zaštita od K1/K2/K3 dok se ne prepiše parser.
12. **Vraćanje uvoza (undo)** — snimiti `import_batches` sa prethodnim vrednostima izmenjenih polja; jedno dugme „Poništi poslednji uvoz". Direktno pokriva sve tri kritične greške uvoza.

---

## Šta je proveravano i NIJE nađen problem

- **Zamrznute cene:** nijedan katalog put ne piše u `order_items`; `lib/stock.ts` eksplicitno ne dira snapshot (`lib/stock.ts:22`). Ustav poštovan.
- **RLS / role:** `product_variants_public` view ne sadrži `mp_price`/`vp_price`/`profit` (`20260731120000_stock_count.sql:42-47`); `db/catalog.ts:42-51` bira izvor po roli, a UI dodatno ne renderuje kolone (`variants-table.tsx:157-163`). Logistika ne može da vidi cene ni preko `getCatalog` ni preko detalja.
- **`setStockCount` kroz service role:** guard `requireRole("admin","logistics")` je pre upisa, patch dira isključivo `stock_quantity`/`stock_counted_at`/`stock_counted_by` — cene nedostupne. Ispravno.
- **`apply_stock_delta` prava:** `revoke ... from public, anon, authenticated` + `grant ... to service_role`, `security definer` sa praznim `search_path`. Ispravno.
- **Idempotentnost rezervacije:** `claimFlag` je uslovni UPDATE u jednom statement-u → Woo retry ne skida duplo. Ispravno (osim scenarija O8).
- **Istorijske porudžbine:** `stock_applied` default `false` za sve postojeće redove → otkazivanje backfill porudžbine ne naduvava stanje. Ispravno.
- **Hard-delete zaštita:** `deleteProduct` (varijante → arhiva) i `deleteVariant` (`order_items` → arhiva) rade kako je dokumentovano; FK `products.id` je `ON DELETE RESTRICT` kao dodatni pojas.
- **Javni bucket slika:** `product-images` je public-read, imena su UUID, listanje objekata zahteva `select` politiku koju anon nema. Ne curi ništa finansijsko.
