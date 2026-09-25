# Sportem — Plan implementacije: Optimizacija (brzina i odziv)

> Verzija 2.0 · 25.09.2026 · status: **spreman za rad**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".
> Sve cifre u §1 su **izmerene nad produkcionom bazom 25.09.2026**, ne procenjene.
>
> **Vrhovno pravilo ovog plana (zahtev korisnika, 25.09.2026):**
> **ništa ne sme da pukne i ništa ne sme da promeni ponašanje.** Menja se samo *koliko traje*,
> nikad *šta radi*. Svaki korak ispod ima „Kako se vraća unazad" — ako nešto zaškripi, vraćanje je
> jedna komanda.

---

## 1. Šta je izmereno i šta je dijagnoza

### 1.1 Baza NIJE problem

| Tabela | Redova |
|---|---|
| `orders` | 1.324 (od toga 141 otkazano/vraćeno) |
| `order_items` | 2.090 |
| `customers` | 1.220 |
| `products` / `product_variants` | 240 / 401 |
| `order_status_history` | 758 |
| `tickets` | 16 |

Postgres ovo agregira u **jedinicama milisekundi**. Nijedan upit nije spor zbog količine podataka.
**Problem je sve što stoji između Postgresa i piksela na telefonu.**

### 1.2 Izmereno vreme po stranici (samo dohvat podataka, bez rendera)

| Stranica | Vreme | Round-trip-ova | Glavni krivac |
|---|---|---|---|
| **Porudžbine (lista)** | **17.909 ms** | 8 | `.in(order_id, 500 UUID)` pukne posle 8 s, dva puta |
| **Dashboard** | **2.376 ms** | 13 | 13 upita za 4 cifre |
| Finansije → Uplate | 984 ms | ~5 | `profitByOrder` nad 304 id-ja + lookup statusa |
| Detalj porudžbine | 730 ms | 7 | `getActiveVariantOptions` (401 red / 62 KB) + indeks rizika |
| Katalog | 717 ms | 5 | ceo inventar u jednom upitu, pa **196 KB** na telefon |
| Tiketi board | 475 ms | ~12 | hidracija u 7 paralelnih upita (dobar obrazac, ostaje) |

Na ovo se dodaje latencija regiona (§2, O1), RLS po redu (§1.3 t. 2), render, prenos RSC payload-a
i hidracija klijentskih komponenti.

### 1.3 Pet korenskih uzroka

**1. `.in()` sa preko ~350 UUID-jeva ne radi — a greška se ne proverava.**

| Broj UUID-jeva u `.in()` | Rezultat (izmereno) |
|---|---|
| 200 | 331 ms, 307 redova ✓ |
| **500** | **8.061 ms → `TypeError: fetch failed`** |

`db/orders.ts:243` (`sumOrderItems`, `CHUNK = 500`) to radi **dva puta** po otvaranju liste
porudžbina (1000 redova / 500) = ~16 s čekanja, pa `data = null`, pa zbir **0 RSD** bez ijedne
poruke. Ovo je `docs/backlog.md` #0 — ali nije samo pogrešna cifra, to je **najsporija stvar u
celoj aplikaciji**.

**2. 82 RLS politike zovu `public.current_app_role()` bez `(select …)` omotača.**
Provereno `grep`-om nad `supabase/migrations/*.sql`: **82 nezaomotana poziva, 0 zaomotanih.**
Postgres `stable` funkciju u RLS predikatu, ako nije u pod-upitu, izvršava **po redu**. Pri
skeniranju `orders` to je 1.324 poziva, svaki sa `select role from profiles where id = auth.uid()`.
Zaomotano u `(select public.current_app_role())` izvrši je **jednom po upitu** (InitPlan).
Supabase za ovo ima linter `auth_rls_initplan` — trenutno ga gazimo 82 puta.

**3. Agregacija se radi u JavaScript-u, preko mreže.**
`computePeriodMetrics` (`db/metrics.ts`) dovuče sve porudžbine perioda, pa im dovuče sve stavke u
parčićima po 200, pa sabira u JS-u — 4 do 9 round-tripova za četiri broja. Isto `getOrdersSummary`,
`getWaitingOrders` (5 upita), `listPayouts` + `profitByOrder`, i `buildCancellationIndex` (141 red +
join na kupce, **na svakom** otvaranju liste porudžbina i na **svakom** detalju).
Isti posao u jednoj SQL funkciji = **1 round-trip, ~5 ms u bazi**. Obrazac već postoji i radi u
projektu — `offer_rule_stats` / `offer_daily_stats` (`20260925120000_ponude.sql`).

**4. Nula keširanja i nula streaming-a.**
25 ruta na `force-dynamic`. Nijedan `<Suspense>`. Jedan jedini `loading.tsx`, na nivou `(app)`
grupe. Posledica: server render **blokira do poslednjeg upita** — na telefonu se ne pojavi ništa
(ni zaglavlje, ni tabovi, ni filter bar) dok i najsporiji upit ne stigne, pa onda odjednom sve.
Uz to: 39 `revalidatePath` poziva ruše ceo render rute posle svake akcije (6× `/finansije`,
5× `/porudzbine`), a `staleTimes` nije podešen → „nazad" svaki put ide na server.

**5. Na telefon se šalje previše.**
Katalog serijalizuje **231 proizvod + 401 varijantu = 196 KB** JSON-a i onda filtrira i paginira
**na klijentu**. Detalj porudžbine šalje `getActiveVariantOptions` = 401 red / 62 KB i kad korisnik
ne dodaje stavku. Slike kataloga idu kroz sirovi `<img>` sa Supabase Storage-a — puna rezolucija u
okvir od 40 px. Klijentski chunkovi su 2,4 MB (jedan od **480 KB / 147 KB gzip**), a `radix-ui` i
`@tanstack/react-table` nisu u `optimizePackageImports`.

### 1.4 Tri činjenice koje su ovaj plan učinile bezbednijim (izmereno 25.09.2026)

- **0 porudžbina ima NULL `profit_at_sale`** (provereno paginirano nad svih 2.090 stavki),
  `needs_vp = 0` → popravka `order_profit` NULL buga **ne menja ni jednu cifru danas**. Ide u plan
  kao zaštita od budućeg, bez ikakvog rizika.
- **Postoje samo 2 naloga, oba Admin.** `npm run rls:test` **ne može** da se pokrene (`signIn(
  "logistics")` radi `process.exit(2)`). Zato K3 dobija **mehanički dokaz iz `pg_policies`** umesto
  živog testa, a nalozi se odlažu do **K10** — v. odluku **O5**.
- **Jedina cifra koja će vidljivo da se promeni** je zbir „Za ovaj filter" na `/porudzbine`:
  danas **0 RSD**, posle K2 **stvaran broj**. To je popravka, ne regresija.

---

## 2. Odluke — donete, sa obrazloženjem

Tražio si da odlučim sam, uz uslov „ništa da ne pukne". Sve četiri idu na konzervativnu stranu.

### O1 — Region: Vercel funkcije se sele u **Dublin (`dub1`)**

**Stanje:** Vercel = North America, Supabase = **eu-west-1 (Irska)**, korisnici = Srbija.
Najgori mogući raspored — i DB hop i korisnički hop prelaze Atlantik.

**Računica** (13 DB round-tripova danas, 1 korisnički):

| Opcija | DB hop | Korisnik ↔ server | Ukupno čiste latencije |
|---|---|---|---|
| **danas** (North America) | 13 × ~85 ms | ~130 ms | **~1.235 ms** |
| **`dub1` Dublin** ✅ | 13 × ~2 ms | ~55 ms | **~81 ms** |
| `fra1` Frankfurt | 13 × ~25 ms | ~28 ms | ~353 ms |

`dub1` je **isti AWS region kao Supabase** (eu-west-1) → DB hop praktično nestaje. Frankfurt je
bliži Srbiji, ali plaća 25 ms na *svaki* upit; i posle K5/K6 (kad padnemo na 2 round-tripa) `dub1`
i dalje vodi (59 ms vs 78 ms).

**Odbacio sam preseljenje Supabase-a u US** — korisnici su u Srbiji, to bi pogoršalo korisnički hop.
**Nema migracije podataka, nema novog URL-a, nema prekida rada.** Samo promena regiona + redeploy.

> `proxy.ts` (middleware) ostaje na Edge-u, globalno blizu korisnika — i to je ispravno, jer
> `getClaims()` verifikuje JWT **lokalno** bez poziva ka bazi (provereno u kodu).

### O2 — `pushWooStatus` **OSTAJE sinhron**. `after()` samo za ono što korisnik ne vidi

Prvobitno sam predložio Woo push u `after()`. **Odustajem.** Razlog: danas korisnik **vidi**
upozorenje „(WooCommerce nije ažuriran — proveri kasnije.)" u istoj poruci akcije. Sa `after()` to
upozorenje fizički ne može da stigne u odgovor → to je **promena ponašanja**, a to je zabranjeno.

Umesto toga:
- **Pojedinačna promena statusa** → Woo push ostaje sinhron, u zahtevu, sa istom porukom. (Jedna
  porudžbina, ~300–500 ms — nije problem.)
- **Bulk „Poslato"** → Woo push se iz sekvencijalne `for` petlje prebacuje u `Promise.allSettled`
  **po grupama od 10, i dalje unutar zahteva**. Brojač `wooFailed` i poruka ostaju **identični** —
  50 porudžbina samo pada sa ~30 s na ~3 s. Ništa se ne menja, samo se radi paralelno.
- **`after()` se koristi isključivo** za posao koji već danas ne proizvodi nikakav izlaz ka
  korisniku: `notifyRoles`/`notifyUsers` (push/email), `logTicketEvent` (istorija tiketa) i
  `revalidateTag` u Woo webhooku. Sve tri su u `CLAUDE.md` već deklarisane kao best-effort koje
  „nikad ne obaraju akciju".

### O3 — `force-dynamic` **OSTAJE na svim rutama**. Keširaju se samo referentni podaci

Prvobitni plan je predviđao skidanje `force-dynamic`. **Odustajem**, i to je najvažnija
konzervativna odluka u planu.

**Razlog:** u `CLAUDE.md` je zapisano najmanje tri jednokratna data-cleanup-a rađena **direktno
kroz service-role / Supabase dashboard** („obrisane sve `payouts` 12–13.07.", „15 porudžbina
postavljeno `uplaceno`", „jednokratni data-fix"). Keš rute takvu izmenu **ne vidi** — cifra bi
ostala stara i ti bi mislio da app laže. To je tačno onaj tip buga koji je ubio Sheets tok.

**Šta se onda kešira:** samo tri referentne tabele koje po RLS-u čitaju **sve** role
(`order_statuses_select`, `categories_select`, `products_select` su `using (true)` — provereno u
`20260708172800_rls_policies.sql`), plus tiket config. To je danas **4–6 round-tripova po stranici
koji se ponavljaju uvek isti**. Keš ima i `revalidate: 300` kao mrežu za slučaj — ručna izmena
statusa kroz dashboard se sama izliječi za 5 minuta, a kroz app se izliječi **trenutno** preko taga.

**Nijedan finansijski ni porudžbinski podatak se ne keshira.** Njihova brzina dolazi iz K5/K6
(1 round-trip umesto 13), ne iz keša.

### O5 — Test nalozi se odlažu do K10; K3 dobija **mehanički** dokaz umesto živog testa

**Pitanje (25.09.2026):** „Ne mogu sad da pravim naloge — da ih preskočim ili da testiram sa
Admin nalogom?" **Odgovor: preskoči ih za sada, ali ni jedno ni drugo nije dovoljan dokaz za K3 —
pa K3 dobija bolji.**

**Zašto Admin nalog nije zamena.** Testiranje kao Admin dokazuje „Admin i dalje vidi sve" — što
hvata katastrofalnu grešku (politika slučajno previše zabrani), ali **ne hvata opasan smer**:
da Logistika slučajno *dobije* pristup cenama. A to je jedini pravi rizik migracije koja dira 82
politike.

**Zašto ni „preskoči i to je to" nije dobro.** `scripts/rls-test.mjs` zove `signIn("logistics")`
koji radi `process.exit(2)` bez kredencijala — dakle **bez Logistike test ne može da se pokrene
uopšte**, i K3 bi ostao bez ijedne kapije.

**Rešenje: K3 se dokazuje iz same baze, ne kroz naloge.** Migracija postaje **samo-proveravajuća**:
snimi predikate svih politika iz `pg_policies` *pre* promene, primeni 82 `alter policy`, pa uporedi
predikate *posle* — nakon što se skine `(SELECT …)` omotač, moraju biti **identični**. Ako bilo gde
nisu, migracija `raise exception` i **ceo `db push` se vrati unazad** (baza ostane netaknuta).

Ovo je za **ovu konkretnu izmenu jači dokaz od živog testa**, jer:
- proverava **svih 82 politike mehanički**, a živi test uzorkuje par čitanja po tabeli;
- predikat renderuje **Postgres sam** (`pg_policies.qual`), ne moj string — svaki typo, izgubljen
  `in ('admin','manager')` ili zamenjeno `=` se vidi;
- ne zahteva nijedan nalog, nijednu lozinku baze, nijedan `psql`.

**Gde nalozi ipak postaju obavezni:** **pre K10** (Katalog na server-side filter). To je jedini
korak koji menja ono što **Logistika** vidi — ona čita restriktovani view `product_variants_public`
i popis je njena jedina akcija u katalogu. Tamo Admin testiranje stvarno nije dovoljno.

**Posledica za K5:** `catalog_summary()` se **seli iz K5 u K10**. Da je ostala u K5 kao
`security invoker` funkcija nad `product_variants`, **Logistici bi Katalog vratio prazno** (ona na
toj tabeli nema `select` politiku) — tačno onaj tip loma koji bez Logistika naloga ne bismo videli.
K5 tako ostaje isključivo STAFF-only (Dashboard), gde Logistika nikad ne dolazi.

### O4 — Svaka izmenjena cifra se dokazuje skriptom pre `db push`

Svaki korak koji dira cifru dobija skriptu koja ispiše **staru i novu vrednost jednu pored druge**,
i ti je pogledaš pre nego što bilo šta ide na produkciju. Isti obrazac koji je verifikovao backfill
u Koraku 1.3 („0 RSD razlike, dokazano").

Konkretno se očekuje:
- **K2:** zbir na `/porudzbine` se menja sa `0 RSD` na stvaran broj. **Jedina namerna promena
  cifre u celom planu.** Kontrola: taj zbir mora da se **poklopi sa Dashboardom** za isti period.
- **K4 (`order_profit`):** izmereno je da danas ima **0** porudžbina sa NULL profitom → skripta mora
  da ispiše **0 razlika**. Ako ispiše bilo šta drugo, korak se zaustavlja.
- **K5, K6:** nove SQL funkcije moraju da daju **bit-po-bit iste cifre** kao stari JS. Razlika
  **0 RSD**, inače se ne komituje.

---

## 3. Ciljevi (merljivo)

| Metrika | Danas | Cilj | Koji korak |
|---|---|---|---|
| Vreme do **prvog piksela** (skeleton) na navigaciji | = vreme cele strane | **< 100 ms** | K7 |
| Porudžbine — podaci gotovi | 17.909 ms | **< 400 ms** | K1, K2, K6 |
| Dashboard — podaci gotovi | 2.376 ms | **< 300 ms** | K1, K5 |
| Round-tripova ka Supabase-u po stranici | 5–13 | **1–3** | K5, K6, K8 |
| Katalog — payload na telefon | 196 KB | **< 20 KB** | K10 |
| Klijentski JS na najtežoj ruti | 147 KB gzip shared | **−35 %** | K9, K10 |
| „Nazad" na telefonu | pun server round-trip | **instant iz keša** | K7 |
| Odziv posle klika na akciju | čeka server (bulk do 30 s) | **instant / < 3 s** | K11 |

---

## 4. Arhitektura — pet slojeva

```
┌─ 5. Bundle i asseti ──────── manje JS-a, next/image, optimizePackageImports  → K9, K10
├─ 4. UI / streaming ───────── shell odmah + Suspense po bloku + skeleton      → K7
├─ 3. Next data sloj ───────── unstable_cache SAMO za referentne + tagovi      → K8
├─ 2. Postgres ─────────────── SQL agregacije (1 round-trip) + indeksi + RLS   → K3, K4, K5, K6
└─ 1. Transport ────────────── isti region Vercel ↔ Supabase (dub1)            → K0
```

Pravilo koje drži celu arhitekturu: **svaka stranica ima „shell" koji ne traži ni jedan podatak.**
Zaglavlje, tabovi, filter bar, dugmad — sve bez `await`. Podaci žive isključivo unutar `<Suspense>`
granica, svaka sa svojim skeletonom. Tako je vreme do prvog piksela nezavisno od najsporijeg upita.

---

## 5. RUČNI POSLOVI — šta ti radiš i kada

Ovo je jedina lista koju moraš da držiš pri ruci. Sve ostalo radim ja u sesijama.

### 5.1 ODMAH, pre prve sesije (~25 min) — Korak K0

Detaljna uputstva klik-po-klik su u **K0** ispod. Ukratko: **samo promena Vercel regiona +
redeploy** (~10 min). Test nalozi su odloženi do K10 (odluka **O5**) — ne trebaju ti sada.

### 5.2 Posle svake sesije (~5 min)

1. Pročitaj šta sam napisao u „Rezultat / kako proveravaš" tog koraka.
2. Ako korak ima migraciju → pokreni `supabase db push` **(tek posle mog OK-a i posle što
   pogledaš dokaznu skriptu)**.
3. Klik-test na telefonu po roli.
4. `git commit` + `push` (direktno na `main`, po zaključanoj odluci).

### 5.3 Kalendar migracija (`supabase db push`) — samo 3 puta u celom planu

| Korak | Migracija | Rizik | Kada |
|---|---|---|---|
| **K3** | probna `__tx_probe` (mora da se vrati unazad) + `rls_initplan` — `(select …)` omotač na 82 politike; **samo-proveravajuća** | nizak, **nula promene ponašanja** | posle K2 |
| **K4** | `order_profit` fix + 8 indeksa + `norm_phone` | nizak (0 pogođenih redova danas) | posle K3 |
| **K5** | `perf_aggregates` — SQL funkcije | srednji (dira cifre) → **dokazna skripta obavezna** | posle K4 |

K6 dopunjuje `perf_aggregates` (druga migracija, isti obrazac). K0, K1, K2, K7–K11 **nemaju
migraciju**.

### 5.4 Šta NIKAD ne radiš u ovom planu

- Ne menjaš šemu kroz Supabase dashboard (samo `supabase/migrations`).
- Ne pokrećeš `npm run woo:test` na produkciji bez potrebe (`docs/backlog.md` #15 — piše u pravu
  bazu). Kad ga tražim, tražim ga izričito i kažem zašto.
- Ne komituješ korak čiji „Rezultat" ne stoji.

---

## 6. Koraci

Redosled je namerno takav da **prvu razliku osetiš već posle K0 i K2**, pre ijedne migracije.

---

### K0 — RUČNO: region, test nalozi, zelena polazna tačka

> **Ovo radiš ti, sam, bez mene. ~25 minuta. Nema koda, nema migracije.**
> Posle ovog koraka app bi već trebalo da bude **osetno** brži — samo od promene regiona.

#### K0-a) Vercel region → Dublin (`dub1`)

1. Otvori **vercel.com** → tvoj projekat (Sportem).
2. **Settings** (gornji meni) → **Functions** (levi meni).
   - Ako ne vidiš „Functions", probaj **Settings → General** i traži
     „Function Region" / „Serverless Function Region" (Vercel je menjao mesto).
3. Nađi **Function Region** → klikni dropdown.
4. Izaberi **Dublin, Ireland (dub1)**.
   - ⚠️ Ako je lista zaključana i piše da je potreban Pro plan za više regiona — to se odnosi na
     *više* regiona. **Jedan** region smeš da promeniš i na Hobby-ju.
   - ⚠️ Ako u listi nema `dub1`, izaberi **`fra1` Frankfurt** — nije idealno (25 ms na svaki upit)
     ali je 10× bolje od Amerike. Reci mi šta si izabrao.
5. **Save**.
6. **Ovo ne važi dok ne deployuješ ponovo.** Idi na **Deployments** → najnoviji deployment → „⋯"
   (tri točkice) → **Redeploy** → potvrdi.
   - Ostavi „Use existing Build Cache" uključeno — brže je, a region se svakako primenjuje.
7. Kad deploy pozeleni, otvori app na telefonu i klikni kroz: Dashboard → Porudžbine → Katalog.

**Kako znaš da je uspelo:** Dashboard i Katalog treba da budu **primetno** brži (Dashboard je
plaćao ~1,2 s samo na latenciju). **Porudžbine će i dalje biti spore** — tu je `.in(500)` bug, njega
gasim u K2.

#### K0-b) Test nalozi — **ODLOŽENO do K10** (odluka O5, 25.09.2026)

**Ne moraš ih praviti sada.** Prvobitno su bili preduslov za K3; našao sam bolji dokaz za K3 koji
ne traži nijedan nalog (v. O5 i K3). Ali **pre K10 jesu obavezni** — tamo je jedini korak koji
menja ono što **Logistika** vidi, i tu Admin testiranje stvarno nije dovoljno.

Kad dođe vreme (pre K10), uputstvo je:

1. App → **`/korisnici`** (vidljivo samo Adminu) → **Pozovi korisnika** → rola **Logistika**.
   - Koristi svoj alias: `marko2000.dev+logistika@gmail.com` — Gmail `+` alias stiže u tvoj inbox,
     a Supabase-u je to drugi korisnik.
2. Isto za **Menadžer** (`…+menadzer@gmail.com`) — ovaj je *opcion*, `rls:test` ga preskače uz
   upozorenje ako ga nema.
3. Invite mejl → `/postavi-lozinku` → postavi lozinke i zapiši ih.
4. `.env.test.local` (u `.gitignore`, ne ide u repo):
   ```
   RLS_TEST_ADMIN_EMAIL=marko2000.dev@gmail.com
   RLS_TEST_ADMIN_PASSWORD=<tvoja admin lozinka>
   RLS_TEST_LOGISTICS_EMAIL=marko2000.dev+logistika@gmail.com
   RLS_TEST_LOGISTICS_PASSWORD=<lozinka logistike>
   RLS_TEST_MANAGER_EMAIL=            # opciono
   RLS_TEST_MANAGER_PASSWORD=
   ```
5. `npm run rls:test` → mora biti zeleno.
   - Test namerno napravi i obriše jedan tiket i jednu kolonu (prefiks `__rls-test`); `ticket_code_seq`
     odmakne za jedan (rupa u SPT brojevima), ništa više.

> **Zašto Logistika, a ne Menadžer:** `scripts/rls-test.mjs` zove `signIn("logistics")` koji radi
> `process.exit(2)` bez kredencijala — **bez Logistike test ne može da se pokrene uopšte**.
> Menadžer ide kroz `signInOptional` i samo se preskoči.

#### K0-c) Zelena polazna tačka **bez naloga**

Umesto punog `rls:test`, uzmi ono što radi i bez naloga — **tri statičke provere** koje su u
skripti već prve po redu (matrica `ticket_*` politika iz migracije, matrica `offer_*` politika,
kapije ruta):

```bash
mkdir -p docs/perf
npm run rls:static > docs/perf/rls-static-baseline.txt 2>&1
```

> `npm run rls:static` **još ne postoji** — pravim ga u K1 (izlaz iz `rls-test.mjs` posle statičkih
> provera, bez prijave). Do tada preskoči ovaj pod-korak; K0 je završen i bez njega.

#### Rezultat K0
- [ ] Vercel Function Region = Dublin (`dub1`), **redeploy odrađen**
- [ ] App na telefonu osetno brži (osim Porudžbina)
- [ ] *(odloženo do K10)* test nalozi + `.env.test.local`
- [ ] *(posle K1)* `npm run rls:static` zeleno, izlaz u `docs/perf/`

#### Kako se vraća unazad
Vrati Function Region na staru vrednost + Redeploy. Ništa drugo se nije promenilo.

---

### K1 — Merenje: `npm run perf`

> **Prva sesija sa mnom.** Bez rizika — skripta samo čita.

**Zašto prvo:** bez ovoga je svaka sledeća tvrdnja „sad je brže" pogađanje. Treba nam broj koji
možemo da uporedimo posle svakog koraka.

**Šta radim:**
- `scripts/perf-bench.mjs` + `npm run perf` — po jedna sonda za svaku tešku stranicu, koja ponavlja
  **tačan niz upita** te stranice i ispisuje vreme + broj round-tripova.
- Sonda meri **dva puta**: kao Admin kroz anon ključ (dakle *sa* RLS-om, prava cena) i kroz
  service-role (*bez* RLS-a) → razlika je „RLS overhead", što nam treba za dokaz K3.
- Skripta **prijavljuje** ono što app danas guta: PostgREST `error` i svaki rezultat od **tačno
  1000 redova** (tihi cap).
- Snimi baseline u `docs/perf/2026-XX-XX-baseline.txt`.
- **`npm run rls:static`** (novo, zbog odluke O5) — izlaz iz `rls-test.mjs` **posle tri statičke
  provere, pre ijedne prijave**. Tako imamo kapiju za politike i **bez test naloga**. Pun
  `npm run rls:test` ostaje nedirano ponašanje za kad nalozi postoje.

**PROMPT ZA SESIJU K1:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K1.

Napravi scripts/perf-bench.mjs + npm skriptu "perf". Zahtevi:
- Po jedna sonda za: Dashboard, Porudžbine (lista), Detalj porudžbine, Katalog,
  Finansije/Uplate, Finansije/Poštarina, Tiketi board. Svaka sonda ponavlja TAČAN
  niz upita te stranice iz db/ sloja (pročitaj kod, ne izmišljaj).
- Meri dva puta: (a) ulogovan kao Admin kroz anon ključ (RLS aktivan), (b) service-role.
  Ispiši razliku kao „RLS overhead".
- Za svaki upit prijavi: trajanje, broj redova, i UPOZORENJE ako je error != null
  ILI ako je vratio tačno 1000 redova (tihi PostgREST cap).
- Izlaz: tabela + ukupno po stranici + ukupan broj round-tripova.
- Kredencijali iz .env.test.local (obrazac iz scripts/rls-test.mjs). Admin nalog postoji;
  Logistika i Menadžer NE postoje — sonda mora da radi i samo sa Adminom, a „RLS overhead"
  kolonu da preskoči uz upozorenje ako Admin kredencijali nisu podešeni.
- Skripta NE PIŠE u bazu. Ni jedan insert/update/delete.

Dodatno (odluka O5): napravi `npm run rls:static` — pokreće SAMO tri statičke provere iz
scripts/rls-test.mjs (testTicketPoliciesInMigration, testOfferPoliciesInMigration,
testRouteGuards) i izlazi PRE ijedne prijave. Ne duplirati kod: izvuci ih u zajednički
modul ili dodaj flag (npr. --static) postojećoj skripti. `npm run rls:test` mora da
nastavi da radi identično kao danas.

Pokreni oboje, snimi izlaze u docs/perf/ kao baseline i pokaži mi tabelu.
```

**Rezultat / kako proveravaš:** `npm run perf` ispiše tabelu kao §1.2. Porudžbine moraju da pokažu
`fetch failed` — to je dokaz da sonda vidi pravi bug. `npm run rls:static` zeleno.

**Kako se vraća unazad:** `git revert` — skripta ništa ne dira.

---

### K2 — Gašenje 17,9-sekundnog buga (⚑ najveći pojedinačni dobitak)

> **Bez migracije. Samo app kod.** Ovde ćeš osetiti najveću razliku.

**Zašto:** `.in(order_id, 500 UUID)` visi 8 s pa vrati `fetch failed`, dva puta po otvaranju liste.
Posle ovog koraka: **17.909 ms → ~1.500 ms**, i zbir „Za ovaj filter" prestaje da piše 0 RSD.

> **Koordinacija:** ovo je **korak R0** iz `docs/Sportem-Plan-Izvestaji.md`. Radi se ovde; kad se
> završi, R0 se tamo označava kao urađen i ne radi se dva puta.

**Šta radim:**
1. Nov `lib/supabase/paginate.ts`:
   - `selectAll()` — `.range()` petlja dok stiže pun blok, sa **obaveznom** `error` proverom.
   - `chunked(ids)` — parčad za `.in()`, **`IN_CHUNK = 200`** (izmereno: 500 puca). Jedina
     konstanta te veličine u projektu; nigde se više ne prepisuje lokalno.
   - `must(res, label)` — baci čitljivu grešku na PostgREST `error` umesto da vrati prazno.
2. Zamena na svih 9 mesta iz `docs/backlog.md` #0, #6, #8:
   `db/orders.ts:243` (`CHUNK=500`) · `db/orders.ts:293` (`SUMMARY_SCAN_CAP`) ·
   `db/orders.ts:217` (`RISK_SCAN_CAP`) · `db/finance.ts:272` (`profitByOrder`) ·
   `db/finance.ts:485` (`getSaldoPostarine`) · `db/finance.ts:650` (`listXexpressInvoices`) ·
   `db/catalog.ts` (`fetchVariants`) · `db/customer-risk.ts` (`buildCancellationIndex`) ·
   `app/(app)/finansije/actions.ts:288` (`issueInvoice`).
3. Svaki `const { data } = await …` u `db/` dobija `error` proveru kroz `must()` — zatvara P2 nalaz
   „neprovereni PostgREST `error` kroz ceo `db/` sloj".

**PROMPT ZA SESIJU K2:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K2.

1. Napravi lib/supabase/paginate.ts sa selectAll(), chunked() (IN_CHUNK = 200) i
   must(res, label). IN_CHUNK se izvozi odatle i nigde se ne prepisuje lokalno.
2. Zameni sve na 9 mesta navedenih u K2 (tačne linije su u planu).
3. Dodaj error proveru (must) na SVAKI `const { data } = await supabase…` u db/.
4. NE MENJAJ ni jedno poslovno pravilo: isti filteri, isto isključivanje
   Otkazano/Vraćeno po imenu, isti Belgrade datumi, ista zamrznuta cena.
   Cifre smeju da se promene SAMO zato što su pre ovoga bile pogrešne (0 RSD).
5. Napravi scripts/provera-k2.mjs koji za 5 perioda (tekući mesec, prošli mesec,
   tekuća godina, 2026 cela, sve) ispiše STARU (današnju) i NOVU vrednost zarade,
   prometa i broja porudžbina jednu pored druge, pa razliku.

Pokreni npm run perf i provera-k2, pokaži mi obe tabele. Onda npm run build.
```

**Rezultat / kako proveravaš:**
- `npm run perf`: Porudžbine **< 2.000 ms**, nijedan `fetch failed`, nijedna sonda ne vrati tačno
  1000 redova *jednim potezom* (pun blok od 1000 unutar `selectAll` petlje je normalan — sonda ga
  zato više i ne prijavljuje).
- **Ti očima:** otvori `/porudzbine` bez filtera → traka „Za ovaj filter" pokazuje **stvaran zbir**.
  Uporedi taj zbir sa Dashboardom za isti period → **mora da se poklopi.**
- `npm run build` prolazi.

**Kako se vraća unazad:** `git revert <commit>`. Nema migracije, nema promene šeme.

#### ✅ URAĐENO 26.09.2026 — izmereno

| Stranica | Pre K2 | Posle K2 | Round-tripova |
|---|---|---|---|
| **Porudžbine — lista** | **8.321 ms** + `fetch failed` | **1.050 ms** | 7 → 12 |
| Dashboard | 346 ms | 414 ms | 15 → 15 |
| Katalog | 229 ms | 392 ms | 4 → 5 |
| Uplate | 317 ms | 261 ms | 4 → 5 |
| Poštarina | 174 ms | 153 ms | 5 → 5 |
| Detalj porudžbine | 299 ms | 274 ms | 6 → 6 |
| Tiketi | 331 ms | 249 ms | 11 → 11 |
| **UKUPNO** | **10.017 ms**, 2 ⚠ | **2.793 ms**, **0 ⚠** | 52 → 59 |

Izlazi: `docs/perf/2026-09-26-perf-posle-k2.txt`, `docs/perf/2026-09-26-provera-k2.txt`.

> **Round-tripova je NAMERNO nešto više** (52 → 59): tamo gde je PostgREST ranije tiho vraćao prvih
> 1000 redova i time „štedeo" upit, sada se dohvata i druga strana. Sedam dodatnih round-tripova
> kupuje tačne cifre; K5/K6 ih svode na 1–3 po stranici SQL agregacijama.

**Cifra koja se promenila (jedina, kao što je plan predvideo):** zbir „Za ovaj filter" bez filtera
**501.265 → 1.442.169 RSD**, promet **1.854.852 → 5.629.536 RSD**, broj porudžbina **878 → 1.184**.
Kontrola prošla: nova cifra se **poklapa sa Dashboardom** za isti period (`provera-k2` to proverava
sama i ispisuje „poklapa se ✓"). Tekući i prošli mesec: **0 RSD razlike** — tamo baga nije ni bilo
(manje od 1000 porudžbina u periodu).

**Odstupanje od plana (obim):** popravljeno je **više od 9 nabrojanih mesta.** Pravilo koje je
primenjeno: *svaki neograničen `select` u `db/` sloju (bez `.limit()`, bez `maybeSingle()`) ide kroz
`selectAll`, svaki `.in()` kroz parčad po `IN_CHUNK`, svaki upit dobija proveru greške.* Devet mesta
iz plana su bila ona koja **već danas** lažu; ostala (`getUnpaidDeliveredXexpress`, `getPayoutSpisak`,
`listPayouts`, `listInvoices`, `getEligibleXexpressOrders`, `getOrdersForShipping`,
`getActiveVariantOptions`, `getLowStockVariants`, katalog, ceo `db/tickets.ts`, `db/expenses.ts`,
`db/profiles.ts`, `db/tickets-config.ts`) su isti obrazac koji bi slagao **sutra**. Poslovna pravila
nisu dirana ni na jednom mestu.

**Jedna tehnička dopuna:** paginiranim upitima je dodat **`order("id")` kao tiebreaker**. Bez
jedinstvenog redosleda `.range()` petlja može da ponovi ili preskoči red između dva bloka. Na
zbirovima to ništa ne menja (sabiranje je nezavisno od redosleda); na jedinom prikazu gde je
redosled vidljiv (lista „rizičan kupac") razrešava samo tačan izjednačen `ordered_at`.

---

### K3 — RLS `initplan` (migracija #1, nula promene ponašanja)

> **Prva migracija.** Dira sigurnosni sloj — zato je **samo-proveravajuća** (odluka O5): ako bilo
> koji od 82 predikata ne bude identičan posle promene, migracija sama sebe obori i baza ostane
> netaknuta. **Ne traži test naloge.**

**Zašto:** `current_app_role()` se danas izvršava **po redu** — 1.324× po skeniranju `orders`.

**Šta radim:**
1. **Prvo provera da rollback uopšte radi.** Pre prave migracije ide jedna bezopasna, za jednokratnu
   upotrebu: napravi pomoćnu tabelu pa `raise exception`. Ako posle `db push` te tabele **nema**,
   potvrđeno je da `supabase db push` obmotava fajl u transakciju → samo-proveravajuća migracija je
   pouzdana kapija. (Ako se tabela ipak pojavi, odmah je brišem i menjam strategiju na dve
   migracije: prvo `pg_policies` snapshot u pravu tabelu, pa provera, pa alteri.)
2. Migracija `2026XXXX_rls_initplan.sql`:
   - `create temp table … as select policyname, tablename, qual, with_check from pg_policies where
     schemaname = 'public'` — **snapshot pre**;
   - svih 82 poziva → `(select public.current_app_role())` kroz **`alter policy`** (ne
     `drop`/`create` — tabela nikad ne stoji bez politike; imena politika ostaju identična jer ih
     `rls-test.mjs` proverava po imenu);
   - **`do` blok na kraju:** za svaku politiku uporedi novi predikat sa snapshot-om **nakon što se
     skine omotač** (`regexp_replace` nad `( SELECT public.current_app_role() AS …)`) — na svaku
     razliku `raise exception` sa imenom politike, starim i novim predikatom;
   - dodatno tvrdi: broj politika pre == broj posle, i **nijedna politika nije ostala sa
     nezaomotanim** `current_app_role()`.
3. Isto proveravam za `auth.uid()` u `push_subscriptions_own` i `notification_preferences_own`.
4. `npm run rls:static` (iz K1) dobija još jednu statičku proveru: nijedan `current_app_role()` u
   `supabase/migrations/` ne sme ostati bez `(select` — da regresija ne prođe neprimećeno kroz kod.

**PROMPT ZA SESIJU K3:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K3 i odluku O5.

KORAK 1 — dokaži da rollback radi:
Napravi jednokratnu migraciju koja kreira tabelu public.__tx_probe pa uradi
raise exception. Ja ću je pushovati; ako tabele posle toga NEMA, transakcija je
potvrđena. Reci mi kako da proverim i kako da je uklonim iz istorije migracija.

KORAK 2 — prava migracija (samo posle mog OK-a na korak 1):
Svih 82 poziva public.current_app_role() u RLS politikama zaomotaj u
(select public.current_app_role()).

Tvrdi zahtevi:
- ALTER POLICY, ne DROP+CREATE. Imena politika se NE MENJAJU.
- Logika predikata se NE MENJA — samo omotač.
- SAMO-PROVERAVAJUĆA: temp snapshot pg_policies pre alterā; na kraju DO blok koji
  uporedi predikate posle skidanja (SELECT …) omotača i RAISE EXCEPTION na svaku
  razliku, uz ime politike + stari i novi predikat. Takođe tvrdi: isti broj politika
  pre/posle, i nijedna nije ostala nezaomotana.
- Proveri i auth.uid() u push_subscriptions_own i notification_preferences_own.
- UNDO SQL u komentaru migracije.
- Dopuni rls:static proverom da u migracijama nema nezaomotanog current_app_role().

NE pokreći supabase db push — to radim ja.
```

**Šta ti radiš ručno, i kada:**
1. `supabase db push` za **probnu** migraciju → pa proveri da `public.__tx_probe` **ne postoji**
   (daću ti tačnu komandu). Javi mi rezultat.
2. Pročitaj pravu migraciju (dugačka ali monotona — 82× isti obrazac).
3. `supabase db push` → **ako prođe bez greške, dokaz je položen.** Ako padne sa
   `RAISE EXCEPTION`, baza je netaknuta i ja popravljam predikat koji je prijavila.
4. `npm run rls:static` zeleno.
5. Klik-test kao **Admin** (jedina rola koju imaš): Dashboard, Porudžbine, Katalog, Finansije,
   Tiketi, Podešavanja — sve radi kao pre.
6. `npm run perf` → kolona „RLS overhead" treba da padne.
7. Commit.

**Kako se vraća unazad:** UNDO SQL je u komentaru migracije. Ponašanje je svakako identično, pa ni
vraćanje ništa ne menja osim brzine.

> **Zaostala obaveza:** živi `rls:test` (Logistika + Menadžer) ostaje **otvoren dug** do K10.
> Upisano u `docs/backlog.md` da se ne izgubi.

---

### K4 — Zaštita fakture + indeksi koji fale (migracija #2)

> **Izmereno: 0 pogođenih redova danas.** Ovo je čista zaštita od budućeg + brži upiti.

**Zašto:**
- `order_profit` view sumira preko NULL-ova (`docs/backlog.md` #5): porudžbina sa stavkama
  `[8000, NULL]` daje `8000` i **tiho ulazi u fakturu umanjena**. Danas takvih ima **0**
  (proverio sam), ali čim jedna porudžbina dobije nepoznat SKU — imaš Sheets bug ponovo.
- Fale indeksi za najčešće filtere i za `ilike` pretragu po imenu (danas sekvencijalno skeniranje).

**Šta radim:**
- `order_profit` → `case when count(*) filter (where profit_at_sale is null) > 0 then null else
  sum(profit_at_sale) end`, `security_invoker = true` ostaje.
- `issueInvoice` **tvrdo odbija** porudžbinu sa `profit is null` (danas je `?? 0`) — srpska poruka.
- 8 indeksa: `orders(cancelled_at)` parcijalni · `orders(needs_vp)` · `orders(needs_review)` ·
  `orders(status_id, delivery_method, payment_status) where payout_id is null` ·
  `pg_trgm` + GIN na `orders.ship_name` i `customers.name` (za pretragu).
- `public.norm_phone(text)` `immutable` — SQL kopija `normalizePhone` iz `lib/woo.ts` — plus
  generisane kolone `orders.ship_phone_norm`, `customers.phone_norm` + indeksi. **Priprema za K6**
  (`order_risk_counts`), ništa je još ne koristi.

**PROMPT ZA SESIJU K4:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K4.

Migracija sa četiri stvari:
1. order_profit view → vrati NULL kad IJEDNA stavka ima profit_at_sale IS NULL
   (backlog #5). security_invoker = true ostaje.
2. issueInvoice (app/(app)/finansije/actions.ts) tvrdo odbija porudžbinu sa
   profit IS NULL, srpska poruka. Danas je `?? 0` — to je bug.
3. 8 indeksa navedenih u K4.
4. public.norm_phone(text) IMMUTABLE — SQL kopija normalizePhone iz lib/woo.ts,
   BIT PO BIT ista logika + generisane kolone ship_phone_norm / phone_norm + indeksi.
   Ništa je još ne koristi (priprema za K6).

Obavezno:
- scripts/provera-k4.mjs: (a) uporedi norm_phone(x) iz baze sa normalizePhone(x) iz
  TS-a nad SVIM ship_phone i customers.phone vrednostima — mora 0 razlika;
  (b) ispiše koliko porudžbina order_profit vraća drugačije pre/posle — očekuje se 0.
- UNDO SQL u komentaru migracije.

NE pokreći db push. Pokaži mi migraciju i skriptu.
```

**Šta ti radiš ručno:**
1. `supabase db push`
2. `node --env-file=.env.local scripts/provera-k4.mjs` → **mora: 0 razlika u telefonima, 0
   porudžbina sa promenjenim profitom.** Ako nije 0 → stani i pozovi me.
3. `npm run rls:test` zeleno.
4. `npm run perf` → pretraga po imenu na `/porudzbine` treba da bude brža.
5. Commit.

**Kako se vraća unazad:** UNDO SQL u komentaru (vrati stari view, `drop index`, `drop column`).
Generisane kolone se brišu bez posledica — ništa ih ne čita do K6.

---

### K5 — Dashboard u jedan upit (migracija #3, prvi deo SQL agregacija)

**Zašto:** Dashboard danas plaća **13 round-tripova za 4 cifre**. U SQL-u je to 1 upit i ~5 ms.

**Šta radim:** funkcije `period_metrics()`, `orders_waiting()`, `low_stock_variants()`,
`uncounted_variant_count()`.

> **`catalog_summary()` je namerno izbačena iz K5 i prebačena u K10** (odluka O5). Kao
> `security invoker` funkcija nad `product_variants` **Logistici bi vratila prazno** — ona na toj
> tabeli nema `select` politiku, čita restriktovani view. To bi joj **slomilo Katalog**, a bez
> Logistika naloga to ne bismo videli. K5 tako ostaje isključivo STAFF-only (Dashboard), gde
> Logistika nikad ne dolazi — pa nijedna funkcija iz K5 ne može da je pogodi.

**Nepregovorljivo za svaku funkciju:** `security invoker = true` (**RLS pozivaoca ostaje na
snazi** — Logistika i dalje ne vidi ništa), `stable`, `set search_path = ''`, schema-kvalifikovane
reference, `grant execute to authenticated` / `revoke from anon`. Statusi **po IMENU**, kao
parametar iz `CANCELLED_STATUS_NAMES` / `APP_STATUS` (TS ostaje jedini izvor imena). Novac
isključivo iz `order_items` — **zamrznute cene se ne diraju**. Belgrade datum kroz
`at time zone 'Europe/Belgrade'` (isti obrazac kao `offer_daily_stats`).

**PROMPT ZA SESIJU K5:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K5.

Prebaci Dashboard agregacije u SQL. Funkcije: period_metrics(p_from, p_to, p_cancelled),
orders_waiting(p_created, p_delivered), low_stock_variants(), uncounted_variant_count().
NE pravi catalog_summary() — ona ide u K10 (v. odluku O5: Logistika nema select politiku na
product_variants, pa bi joj security invoker funkcija slomila Katalog).

Obrazac je offer_rule_stats iz 20260925120000_ponude.sql. Tvrdi zahtevi:
- security invoker = true, stable, set search_path = '', grant to authenticated,
  revoke from anon.
- Statusi kao PARAMETAR (imena iz APP_STATUS / CANCELLED_STATUS_NAMES u TS-u),
  nikad hardkodovan UUID ni ime u SQL-u.
- Novac SAMO iz order_items (profit_at_sale, mp_at_sale). Ne diraj snapshot.
- Belgrade dan kroz at time zone 'Europe/Belgrade'.
- Poslovna pravila IDENTIČNA: brojPorudzbina uključuje otkazane/vraćene,
  zarada/promet/marža ih isključuju, troškovi po expenses.date. Definicija
  „nisko stanje" = popisana varijanta (stock_counted_at NOT NULL) sa
  stock_quantity <= prag, proizvod nearhiviran. Nepopisana NIJE nisko stanje.
- db/metrics.ts, db/dashboard.ts, db/catalog.ts pozivaju .rpc() umesto JS agregacije.
  Stari JS kod OSTAVI u fajlu, zakomentarisan ili pod imenom *_legacy — treba mi za
  dokaznu skriptu.

scripts/provera-k5.mjs: za 8 perioda uporedi STARI JS i NOVU SQL funkciju, cifru po
cifru (zarada, promet, marža, broj, troškovi, neto). Razlika MORA biti 0 RSD.
Isto za orders_waiting (4 broja) i low_stock (lista SKU-ova mora biti identična).

NE pokreći db push. Pokaži mi migraciju + izlaz dokazne skripte.
```

**Šta ti radiš ručno:**
1. `supabase db push`
2. `node --env-file=.env.local scripts/provera-k5.mjs` → **0 RSD razlike na svih 8 perioda.**
   Ako bilo gde nije 0 → **stani**, ne komituj, pozovi me.
3. `npm run rls:static` zeleno. (Živi `rls:test` čeka naloge iz K10 — nijedna funkcija iz K5 ne
   dira rutu koju Logistika otvara, pa ovo nije rizik. Provera „Logistika dobija 0 redova iz novih
   funkcija" je zaostala obaveza upisana u backlog.)
4. `npm run perf` → Dashboard **< 300 ms**.
5. Klik-test: Dashboard sa svim periodima (dan / nedelja / mesec / prilagođeno) — cifre iste kao
   juče. Uporedi sa screenshot-om ako ga imaš.
6. Commit.

**Kako se vraća unazad:** `db/` fajlovi se vrate na `*_legacy` poziv (`git revert`) — funkcije mogu
da ostanu u bazi neiskorišćene, ne štete. Ili UNDO SQL iz komentara obriše i njih.

---

### K6 — Porudžbine, rizik kupca i finansije u jedan upit (migracija #4)

**Zašto:** ostatak JS agregacije. `buildCancellationIndex` se danas izvršava na **svakom**
otvaranju liste porudžbina **i na svakom detalju** — 141 red + join na kupce, svaki put.

**Šta radim:** `orders_summary()`, `order_risk_counts(p_order_ids, p_our_emails)`,
`payouts_overview()`, `postage_balance()`, `xexpress_invoice_pnl()`. `order_risk_counts` koristi
`ship_phone_norm` / `phone_norm` iz K4 → poklapanje ide po **indeksu**, i računa se **samo za
redove koji su na ekranu** (25), ne za ceo indeks.
Uz to: `deliveredStatusId()` i slični lookup-i po imenu prelaze u parametre funkcija; gde moraju
da ostanu, obmotani su u `cache()` iz React-a (obrazac iz `lib/auth.ts`) → jedan upit po zahtevu.

**PROMPT ZA SESIJU K6:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K6.

Nastavi K5 obrascem: orders_summary(...filteri...), order_risk_counts(p_order_ids,
p_our_emails), payouts_overview(), postage_balance(), xexpress_invoice_pnl().

Isti tvrdi zahtevi kao K5 (security invoker, statusi kao parametar, novac iz
order_items, Belgrade). Dodatno:
- order_risk_counts koristi ship_phone_norm / phone_norm iz K4 i računa rizik SAMO
  za prosleđene order_ids (redovi na ekranu), ne za ceo indeks. OUR_EMAILS ide kao
  parametar p_our_emails — lista internih mejlova ostaje u TS-u (db/customer-risk.ts).
- Pravilo rizika IDENTIČNO: poklapanje po normalizovanom telefonu ILI e-mailu,
  bez same porudžbine (excludeId), dedup po id-u, interni mejlovi se ne broje.
- Filter „rizičan kupac" na /porudzbine mora da nastavi da radi isto, sada kroz SQL
  (danas skenira 5000 redova i paginira u JS-u).
- deliveredStatusId i slični lookup-i po imenu → parametar funkcije; gde moraju
  ostati, obmotaj u cache() iz React-a.
- Stari JS ostavi kao *_legacy za dokaznu skriptu.

scripts/provera-k6.mjs: uporedi stari JS i novi SQL za (a) orders_summary nad 10
kombinacija filtera, (b) order_risk_counts nad SVIH 1324 porudžbina — lista rizičnih
mora biti IDENTIČNA, (c) payouts_overview svih 50 uplata, (d) postage_balance,
(e) xexpress_invoice_pnl svih 9 faktura. Svuda 0 razlike.

NE pokreći db push.
```

**Šta ti radiš ručno:**
1. `supabase db push`
2. `node --env-file=.env.local scripts/provera-k6.mjs` → **0 razlike svuda**, i lista rizičnih
   kupaca **identična**. Ako nije → stani.
3. `npm run rls:static` zeleno. (Sve iz K6 je STAFF-only — Logistika ne otvara ni Porudžbine ni
   Finansije, pa nema rutu koju ovaj korak može da joj slomi.)
4. `npm run perf` → Porudžbine **< 400 ms**, Uplate **< 250 ms**.
5. Klik-test: `/porudzbine` sa filterom „rizičan kupac" → isti kupci kao pre. Detalj porudžbine
   rizičnog kupca → crveni flag i istorija otkazivanja stoje. `/finansije/uplate` i
   `/finansije/postarina` → iste cifre.
6. Commit.

**Kako se vraća unazad:** kao K5 — `git revert` na `*_legacy`.

---

### K7 — Shell odmah, podaci u Suspense (⚑ „instant odziv" koji si tražio)

> **Bez migracije.** Ovo je korak posle kog se na telefonu skeleton pojavi **odmah**.

**Zašto:** danas render blokira do poslednjeg upita → ne vidi se **ništa**, pa onda odjednom sve.

**Šta radim:**
1. **Per-ruta `loading.tsx`** — 11 fajlova, svaki izgleda kao *ta* strana (danas jedan generički
   pokazuje tabelu i za Dashboard, pa „zablinka" pa se pretvori u kartice). Preseti već postoje
   (`components/patterns/loading.tsx`); dodajem `BoardSkeleton` i `MetricGridSkeleton`.
2. **Svaka stranica → shell + suspendovani blokovi.** `await` se seli u dete komponentu, pa
   najsporiji blok ne drži najbrži:
   ```tsx
   <Header />                                                     {/* odmah */}
   <PeriodFilter period={period} />                               {/* odmah */}
   <Suspense fallback={<MetricGridSkeleton />}><Metrics …/></Suspense>
   <Suspense fallback={<CardsSkeleton n={4} />}><WaitingOrders /></Suspense>
   ```
3. **`error.tsx` + `not-found.tsx` po segmentu** (`docs/backlog.md` #13). Nije higijena —
   **bez toga jedan pukao Suspense blok ruši celu stranu** na Next-ov engleski ekran. Srpski, sa
   dugmetom „Probaj ponovo". `components/patterns/error-state.tsx` već postoji.
4. **Router keš:** `experimental.staleTimes: { dynamic: 30, static: 180 }` → „nazad" sa detalja na
   listu u roku od 30 s je **0 ms, iz memorije**. Verovatno najveći *osećajni* dobitak, jer je
   bratov tok upravo lista → detalj → nazad → detalj.
5. **`prefetch` na donjem baru** (4–5 primarnih stavki) → tap na „Porudžbine" daje instant skeleton
   bez ijednog zahteva. Na dinamičnim rutama prefetch vuče samo do `loading` granice — tačno ono
   što treba, i ne troši mobilne podatke na cifre.
6. **`<Activity>`** (React 19.2) za tabove tiket board-a na telefonu → prebacivanje kolona bez
   remount-a.

**PROMPT ZA SESIJU K7:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K7.

Faza A streaming-a. NE uključuj cacheComponents/PPR — izričito van opsega.

1. Per-ruta loading.tsx za 11 ruta iz K7. Svaki mora da izgleda kao TA strana
   (Dashboard = grid metrika, Tiketi = kolone, Katalog = redovi sa sličicom…).
   Koristi postojeće presete iz components/patterns/loading.tsx; dodaj BoardSkeleton
   i MetricGridSkeleton.
2. Razdvoj svaku tešku stranicu na shell (bez ijednog await osim requireRole i
   searchParams) + <Suspense> po bloku, svaki sa svojim skeletonom. await se seli u
   dete komponentu. searchParams čitaj JEDNOM u shell-u i prosledi kao prop.
3. error.tsx + not-found.tsx po segmentu, srpski sa dijakriticima, dugme
   „Probaj ponovo" (reset()). Koristi components/patterns/error-state.tsx.
4. next.config.ts: experimental.staleTimes { dynamic: 30, static: 180 }.
   NE dodaji ništa drugo u ovoj sesiji.
5. prefetch={true} na primarne stavke bottom-nav.tsx.
6. <Activity> za tabove u tiketi/mobile-board.tsx.

NE MENJAJ ni jedan upit, ni jednu cifru, ni jedno poslovno pravilo. Ovo je isključivo
raspored rendera.
```

**Šta ti radiš ručno:**
1. `npm run build && npm start` (SW radi samo u prod build-u).
2. Chrome DevTools → Network → throttle **„Fast 4G"** + Performance → CPU **4×** (realan telefon).
3. Klikni: Dashboard → Porudžbine → detalj → **nazad** → Katalog → Tiketi.
   - Skeleton mora da se pojavi **skoro odmah** (< 100 ms), i to **skeleton te strane**.
   - „Nazad" mora biti **instant, 0 zahteva** u Network tabu.
4. Namerno pokvari nešto (npr. isključi internet na sekundu na Dashboardu) → mora da se pojavi
   **srpska** greška u tom bloku, a ostatak strane da radi.
5. Deploy → isti test na telefonu.
6. Commit.

**Kako se vraća unazad:** `git revert`. Nema migracije, nema promene podataka.

---

### K8 — Keš referentnih podataka (usko, po odluci O3)

**Zašto:** posle K5/K6 stranica ima 1–3 round-tripa, ali 4–6 njih su **uvek isti** referentni
podaci (statusi, kategorije, tiket config).

**Šta radim:**
- `lib/cache.ts` — registar tagova (`TAG.statuses`, `TAG.categories`, `TAG.ticketConfig`, …), nigde
  string u letu.
- `unstable_cache` **samo** na `getOrderStatuses`, `getCategories`,
  `getTicketColumns/Priorities/Tags`. Sve tri tabele su po RLS-u `using (true)` za sve role
  (provereno) → nema curenja. `revalidate: 300` kao mreža za ručne izmene kroz dashboard.
- **39 `revalidatePath` → ciljani `revalidateTag`.** Danas jedna promena statusa ruši ceo render
  `/porudzbine`; 6 akcija ruši `/finansije`. Posle: akcija briše samo tag grupe koju je stvarno
  promenila.
- **Woo webhook** zove `revalidateTag` u `after()` — best-effort, nikad ne obara webhook.
- **`force-dynamic` ostaje svuda** (odluka O3).

**PROMPT ZA SESIJU K8:**
```
Pročitaj CLAUDE.md i docs/Sportem-Plan-Optimizacija.md, korak K8 i odluku O3.

1. lib/cache.ts: registar TAG konstanti. Nijedan tag string se ne piše u letu.
2. unstable_cache SAMO na getOrderStatuses, getCategories, getTicketColumns,
   getTicketPriorities, getTicketTags. revalidate: 300 + tag.
   NE keširaj ništa iz orders/order_items/finance/product_variants.
3. Prođi kroz SVIH 39 revalidatePath poziva i zameni ciljanim revalidateTag tamo gde
   je grupa jasna. Napravi tabelu „akcija → koji tag briše" i pokaži mi je PRE izmene.
   revalidatePath ostaje samo gde se menja struktura rute.
4. Woo webhook: revalidateTag(TAG.orders) u after(), best-effort, nikad ne obara
   webhook (Sentry na grešku).
5. force-dynamic OSTAJE na svim rutama. Ne diraj ga.

Ako iko od njih 39 nije jasno mapiran na tag — ostavi revalidatePath i reci mi koji.
Bolje sporije nego zastarela cifra.
```

**Šta ti radiš ručno:**
1. Pogledaj tabelu „akcija → tag" koju ti dam — **ti znaš tokove najbolje**; ako negde nešto ne
   bude invalidovano, to je jedini način da se uhvati.
2. Klik-test **lanaca**: promeni status porudžbine → lista osvežena? · dodaj kategoriju → pojavi se
   u formi proizvoda? · dodaj tiket kolonu u Podešavanjima → pojavi se na board-u? · napravi
   porudžbinu na sajtu → pojavi se u listi bez „Osveži"?
3. `npm run perf`, commit.

**Kako se vraća unazad:** `git revert`. Keš je samo sloj — bez njega se čita direktno.

---

### K9 — Bundle i slike (prvo otvaranje na telefonu)

**Zašto:** „prvo otvaranje app-a na telefonu" — tu kod ne pomaže, pomaže samo manje bajtova.
Izmereno: 2,4 MB chunkova, najveći **480 KB / 147 KB gzip**.

**Šta radim:**
1. `optimizePackageImports: ["radix-ui", "@tanstack/react-table"]`. `lucide-react` i `date-fns` su
   **već** u Next-ovoj podrazumevanoj listi (proverio sam), ali **`radix-ui`** (jedinstveni paket
   v1.6, barrel export svega) **nije** — a koristi se na 10+ mesta.
2. **`next/image`** za sličice kataloga (4 mesta danas koriste sirovi `<img>` → puna rezolucija u
   okvir od 40 px). Traži `images.remotePatterns` za Supabase host. **Najveći mobilni dobitak.**
3. **`getActiveVariantOptions` (401 red / 62 KB) izlazi iz detalja porudžbine** — šalje se na svaki
   detalj, a treba samo kad se klikne „Dodaj stavku". Zamena pretragom na zahtev; obrazac već radi
   (`searchVariantOptions` + `LinkPicker` sa debounce 300 ms u `ticket-dialog.tsx`).
4. `npm run analyze` (`@next/bundle-analyzer`, samo devDependency, iza env flaga) — da vidimo šta je
   u chunk-u od 480 KB pre nego što diramo dalje.
5. `experimental.inlineCss: true` — CSS inline, jedan render-blokirajući zahtev manje.
6. **SW ostaje online-only** (ustav iz Koraka 0.7). `/_next/static/*` je već `CacheFirst`, pa
   ponovno otvaranje PWA ne skida JS ponovo. Ne dodajem keširanje navigacija ni Supabase odgovora.

**PROMPT ZA SESIJU K9:** *(daću ga na početku te sesije — zavisi od toga šta `analyze` pokaže)*

**Šta ti radiš ručno:** `npm run build`, pa Lighthouse mobile na `/porudzbine` i `/katalog`
(throttle 4G) pre/posle; pa deploy i test na telefonu — naročito **prvo otvaranje** PWA.

---

### K10 — Katalog prestaje da šalje ceo inventar

> ⚠️ **OVDE su test nalozi obavezni** (odluka O5). Ovo je **jedini korak u planu koji menja ono što
> Logistika vidi** — ona čita restriktovani view `product_variants_public` i popis je njena jedina
> akcija u katalogu. Admin testiranje ovde **nije dovoljno**: greška bi bila ili „Logistici Katalog
> prazan" ili, gore, „Logistika vidi cene". **Pre ove sesije odradi K0-b** (Logistika nalog +
> `.env.test.local`) i pošalji mi zelen `npm run rls:test`.

**Zašto:** 196 KB na telefon, pa filtriranje i paginacija **na klijentu**.

**Šta radim:** `catalog_summary()` (prebačena iz K5) sa **role-aware putem** — zbirne cifre za
Logistiku iz `product_variants_public`, za Admin/Menadžer iz `product_variants` (cene). Pa
server-side filter + paginacija kroz URL, tačno kao što `/porudzbine` već radi
(`?q=&kategorija=&stanje=&popis=&page=&per_page=`). Lista više ne selektuje `description` i
`attributes` (nisu na ekranu — to je najveći deo od 147 KB varijanti). Zbirne cifre po proizvodu iz
`catalog_summary()` (napravljena u K5). `@tanstack/react-table` otpada sa te rute.
**Pravila filtera ostaju identična** — „Stanje 0" = bar jedna aktivna varijanta sa
`stock_quantity = 0 AND stock_counted_at IS NOT NULL`; nepopisana nula pripada „Fali količina".

**Šta ti radiš ručno:** ovo je korak sa najviše klik-testa. Svaka kombinacija filtera + pretraga +
paginacija + `?popis=fali` link sa Dashboarda, i to **kao Admin i kao Logistika** (Logistika mora da
vidi Katalog bez cena i da može da popiše).

---

### K11 — Odziv posle klika

**Zašto:** bulk „Poslato" je sekvencijalna petlja sa 10 s Woo timeout-om po porudžbini
(`docs/backlog.md` #9) — 50 porudžbina realno probija Vercel limit, bez ikakvog indikatora.

**Šta radim:**
1. **Bulk „Poslato" sa 3N na 3 upita:** jedan `UPDATE … .in()`, jedan `INSERT` sa nizom redova
   istorije, Woo push u `Promise.allSettled` po grupama od 10 (**i dalje u zahtevu**, v. O2).
   Brojači `shipped`/`skipped`/`wooFailed` i poruka **identični**. ~30 s → ~3 s.
2. **`useOptimistic`** na ono što se radi 50× po smeni: statusna pilula, „Popisano" čekboks + broj
   stanja, štikliranje checklist stavke. Rollback + `toast.error` na grešku (obrazac je dokazan u
   `board.tsx`).
3. **`docs/backlog.md` #7 istom rukom:** prazno polje popisa se danas tiho snima kao **0** i
   markira kao „popisano" (`Number("")` je `0`). Sa optimističkim UI-jem bi se ta nula još i
   *instantno prikazala* — pa guard ide pre `useOptimistic`.
4. `after()` za `notifyRoles`/`notifyUsers` i `logTicketEvent` (v. O2 — samo to, ne Woo).

**Šta ti radiš ručno:** `npm run woo:test` (**obavezno u ovom koraku** — 30 provera, uklj. stanje
zaliha; `after()` ne menja ni jedan ishod, samo trenutak). Pa bulk test sa ~20 porudžbina na
produkciji i provera da su sve zaista otišle u Woo.

---

### K12 — (opciono, sigurnost ne brzina) `next` bump

`docs/backlog.md` #1: `next@16.2.10` ima **1 kritičnu + 6 „high"** ranjivosti. **Nije deo
optimizacije** i nije preduslov ni za jedan korak (proverio sam da `staleTimes`, `inlineCss` i
`optimizePackageImports` postoje već u 16.2.10). Ali je jedina stvar u repou koja realno može da
pukne na bump, pa dobija svoj korak i svoj rollback. **Predlog: posle K7**, kad imamo `error.tsx`
svuda i kad možemo da vidimo šta se pokvarilo.

---

## 7. Šta ovaj plan NE dira

- **Zamrznute cene (snapshot).** Nijedan korak ne piše `order_items`; nijedna nova SQL funkcija ne
  čita `product_variants` za istorijske cifre. `CLAUDE.md` §4 ostaje netaknut.
- **RLS kao izvor sigurnosti.** Nijedan finansijski podatak ne prelazi na service-role radi brzine.
  Jedina izmena politika je `(select …)` omotač (K3), koji ne menja *šta* politika pušta. Sve nove
  SQL funkcije su `security invoker` → RLS pozivaoca ostaje.
- **Tok statusa porudžbina, `order_status_history`, `syncOrderStock`, Woo webhook logika.**
- **Woo push ostaje sinhron i vidljiv** (odluka O2).
- **`force-dynamic` ostaje na svim rutama** (odluka O3).
- **Online-only ustav servisnog radnika** — bez keširanja navigacija, Supabase odgovora i `/api/*`.
- **Poslovna pravila:** „nisko stanje" / „fali količina", „Otkazano" vs „Vraćeno", osnova
  Dashboard/Neto metrika (`ordered_at`, bez otkazanih), fakturisanje po uplatama, rizičan kupac.
  Sve se samo **premešta u SQL**, identično.
- **Dizajn sistem** — skeletoni koriste postojeće presete i tokene.
- **`cacheComponents` / PPR** — izričito van opsega.

---

## 8. Kako se dokazuje da je brže (i da nije nešto puklo)

Svaki korak se zatvara sa **tri broja**, ne sa osećajem:

1. `npm run perf` — tabela iz §1.2, pre i posle, u `docs/perf/`.
2. `npm run rls:static` — zeleno (radi bez test naloga). Pun `npm run rls:test` od **K10**, kad
   nalozi postoje. K3 se uz to dokazuje **sam iz migracije** (`pg_policies` pre/posle, O5).
3. Za korake koji diraju cifre (K2, K4, K5, K6) — **dokazna skripta `provera-kN.mjs`**: stara i nova
   vrednost jedna pored druge, **razlika 0**.

Na kraju K7 i K9: Chrome DevTools, throttle **„Fast 4G" + CPU 4×**, na `/porudzbine` i `/katalog` —
vreme do prvog skeletona, vreme do prve cifre, prenesenih bajtova, „nazad" = 0 zahteva.

---

## 9. Kako se ovo uklapa u ostale planove

| Plan | Odnos |
|---|---|
| `docs/Sportem-Plan-Izvestaji.md` | **K2 = korak R0** (paginate helper). Uraditi ovde, pa R0 tamo označiti kao završen. Izveštaji posle toga stoje na temelju koji ne laže. |
| `docs/backlog.md` | Plan zatvara **#0, #5, #6, #7, #8, #9, #13** i P2 nalaze „neprovereni PostgREST `error`" i „25 ruta na `force-dynamic`" (ovaj drugi *svesnom odlukom da ostane* — O3, upisati to u backlog). **#1** (`next` ranjivosti) je K12. Kad se korak završi — red se **briše** iz backloga. |

---

## 10. Redosled i procena

```
K0   RUČNO: Vercel region        ~10 min   TI, sam. Bez koda. Već tu osetiš razliku.
K1   Merenje (npm run perf)      ½ sesije  bez rizika, samo čita
K2   Paginate + 17,9 s bug       1 sesija  ⚑ 17,9 s → 1,5 s. Bez migracije.
──── ovde razlika već treba da bude očigledna ───────────────────────────────
K3   RLS initplan       migr. #1 1 sesija  nula promene ponašanja
K4   order_profit + indeksi  #2  1 sesija  0 pogođenih redova danas
K5   Dashboard u SQL     #3      1–2 ses.  dokaz 0 RSD obavezan
K6   Porudžbine/rizik/finansije #4 1–2 ses. dokaz 0 RSD obavezan
K7   Suspense + skeleton         2 sesije  ⚑ „instant odziv"
K12  next bump (sigurnost)       ½ sesije  opciono, ali preporučeno ovde
K8   Keš referentnih             1 sesija  usko, po odluci O3
K9   Bundle + next/image         1 sesija
K10  Katalog server-side         1–2 ses.  ⚠ TRAŽI test naloge (O5) + najviše klik-testa
K11  Bulk + optimistično         1 sesija  woo:test obavezan
```

**Ako ikad zatreba da se stane na pola:** posle **K2** i posle **K7** su dve prirodne tačke gde je
app u potpuno stabilnom stanju i osetno brži, a nijedan naredni korak nije preduslov za rad.

---

## 11. Sledeći korak — sada

**Ti:** odradi **K0-a** (§6, ~10 min): Vercel → Settings → Functions → Function Region →
**Dublin (dub1)** → Save → **Deployments → najnoviji → ⋯ → Redeploy**.
Test nalozi **ne trebaju** — odloženi su do K10 (odluka O5).

**Onda:** javi mi da je region prošao i kako se app oseća na telefonu — i krećem **K1** (merenje +
`npm run rls:static`).

**Zaostala obaveza koju ne smemo izgubiti:** Logistika (+ Menadžer) nalog i pun `npm run rls:test`
**pre K10**. Upisati u `docs/backlog.md`.
