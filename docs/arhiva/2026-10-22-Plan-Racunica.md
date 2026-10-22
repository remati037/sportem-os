# Sportem — Plan implementacije: Računica (isplativost artikala)

> Verzija 1.2 · 22.10.2026 · status: **URAĐEN (P1–P6, 22.10.2026)** — arhiva; važeće odluke su u `CLAUDE.md` §3 („Računica — zaključane odluke")
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo

Stavka **Računica** (`/racunica`, sekcija „Novac") je jedno mesto gde se vidi **koliko se koji artikal
isplati**. Prikazuje maržu u dinarima i procentima, i to dvaput: po **katalogu** (trenutna MP − VP) i
po **stvarnoj prodaji** (zamrznute stavke). Uz to idu filteri i sortiranje, razvrstavanje (ABC, matrica,
mrtva roba), prognoze, kalkulator „šta ako" i AI.

### 0.1 Potvrđene odluke (ispitivanje 22.10.2026)

| # | Tema | Odluka |
|---|---|---|
| D1 | Osnova marže | **Oba, jedno pored drugog:** „Katalog" (trenutna `mp_price − vp_price`) i „Stvarno" (zamrznuti `order_items` u periodu). Razlika pokazuje gde popusti jedu zaradu. |
| D2 | Marža % | **Od MP:** `(MP − VP) / MP`, ista formula kao „Prosečna marža" na Dashboardu. |
| D3 | Troškovi | **Samo MP − VP.** Poštarina, reklame i ostali troškovi **ne** ulaze u računicu po artiklu. Otkazani i vraćeni se samo **broje** (stopa), ne umanjuju zaradu. |
| D4 | Mesto | Nova stavka u meniju, **sekcija Novac**, ruta `/racunica`. |
| D5 | Nivo | **Red po proizvodu** (zbir varijanti), klik otvara **varijante po SKU**. |
| D6 | Pristup | **Admin i Menadžer vide sve** (modul samo čita). Logistika nema stavku, rutu ni podatke (`requireRole("admin","manager")`). |
| D7 | Podrazumevani period | **Poslednjih 90 dana**; brzi izbor 30 dana / 90 dana / tekući mesec / ova godina / sve, plus prilagođen opseg. |
| D8 | Ciljna marža | **Jedan prag za sve** (podrazumevano 30 %), u URL-u (`?cilj=30`), **bez migracije**. Ispod praga je crveno, filter „Ispod cilja". |
| D9 | Razvrstavanje | **ABC (Pareto) + matrica obim × marža + mrtva roba.** **Svaki pogled se može ugasiti** (prekidači; v. P2). |
| D10 | Prognoze | **Prodaja po artiklu (30 dana + dana do nule) · zarada do kraja meseca · trend artikla · „šta ako" simulacija.** |
| D11 | „Šta ako" | **Samo računa, ništa ne piše.** Cena se i dalje menja u Katalogu, a Woo ručno. |
| D12 | AI | **Alat u Asistentu + „Pitaj asistenta" + AI sažetak na klik.** Bez chat panela u samoj strani. |

### 0.2 Ključna posledica: **modul nema nijednu migraciju**

Sve je čitanje nad postojećom šemom: `order_items` (zamrznuto), `product_variants`/`products`/`categories`
(katalog i stanje), `order_statuses` (po imenu). Prag i prekidači su u URL-u i `localStorage`-u.
AI sažetak se čuva kao običan razgovor u `ai_conversations`/`ai_messages` (v. P5).
**Nijedna faza ne radi `supabase db push`.**

### 0.3 Tehničke činjenice na kojima modul stoji

**1. Stvarna prodaja se grupiše po `sku`, ne po `variant_id`.** `variant_id` je `null` na ~93 % istorije
(backfill), a `order_items.sku` je `not null`. Mapiranje SKU → varijanta → proizvod ide kroz
**trenutni katalog** (`product_variants.sku` je `unique`). SKU koji nije u katalogu (preimenovan,
obrisan, nepoznat pri webhook-u) ide u zasebnu grupu **„Van kataloga"** sa nazivom iz
`product_name` snapshot-a. Nikad se ne gubi iz zbira.

**2. Isti učitavač kao Dashboard i Asistent.** Prodaja se čita kroz `loadSales` (od P1 u `db/sales.ts`):
`ordered_at` u celim beogradskim danima, Otkazano/Vraćeno **po imenu**, paginacija kroz `paginate.ts`.
U P1 se izvlači iz `lib/ai/tools/` u `db/sales.ts` (jer ga sada koriste i strane, ne samo AI); AI alati
ga uvoze odatle. **Dokaz:** zbir stvarne zarade svih redova Računice = zarada na Dashboardu za isti
period, **0 RSD razlike**.

**3. Stvarna marža ne sme da se razblaži porudžbinama bez VP.** Stavka sa `profit_at_sale = null`
(`needs_vp`) **ne ulazi ni u brojilac ni u imenilac** stvarne marže %. Promet i komadi je i dalje broje,
a red dobija `*` i napomenu „N komada bez VP — zarada nepotpuna". Dashboard broji `profit ?? 0`, pa
se **zarada u RSD** poklapa (`?? 0`), a **marža %** je na Računici poštenija. To se piše ispod tabele.

**4. Katalog marža = trenutno stanje.** Kolone „Katalog" su izričito označene kao *trenutna cena*.
Nikad ne ulaze u zbir zarade za period (§4 — izveštaji čitaju samo zamrznuto).

### 0.4 Šta se NE dira

Zamrznute cene i `order_items` (samo čitanje) · cene u katalogu (simulacija ne piše) · finansije ·
RLS politike · tok statusa · webhook · `syncOrderStock` · `computePeriodMetrics` (samo se poredi sa njim).

---

## 1. Kolone i definicije (jedan izvor za tabelu, CSV, AI alat i sažetak)

Definicije žive u **`lib/racunica.ts`** (bez `server-only`, jer ih UI koristi za zaglavlja i boje).
`db/racunica.ts` (server) puni redove.

| Kolona | Definicija |
|---|---|
| **Katalog MP / VP** | `product_variants.mp_price` / `vp_price`. Na redu proizvoda: raspon (min–max) kad se varijante razlikuju |
| **Katalog marža RSD / %** | `MP − VP` · `(MP − VP) / MP` |
| **Prodato (kom)** | Σ `quantity`, realizovane porudžbine (bez Otkazano/Vraćeno) u periodu |
| **Promet** | Σ `mp_at_sale × quantity` (realizovane) |
| **Prosečna prodajna cena** | promet / komadi |
| **Popust vs katalog** | `1 − prosečna prodajna / katalog MP`. Pokazuje koliko se prodaje ispod kataloga |
| **Stvarna zarada RSD** | Σ `profit_at_sale` (realizovane; `null` → 0, kao Dashboard) |
| **Stvarna marža %** | Σ profit / Σ promet, **samo stavke sa poznatim VP** (činjenica 3) |
| **Zarada po komadu** | stvarna zarada / komadi sa poznatim VP |
| **Udeo u zaradi** | zarada reda / ukupna zarada perioda |
| **Otkazano/vraćeno** | komadi u otkazanim/vraćenim porudžbinama + stopa `otk / (realizovano + otk)` |
| **Stanje** | Σ `stock_quantity` aktivnih varijanti (nepopisane označene, pravilo iz „Popis zaliha") |
| **Vezano po VP** | `stanje × vp_price` (samo popisane, `stock_quantity > 0`) |

---

## 2. Faze i koraci

> P1 sam po sebi ima punu vrednost (tabela + filteri + sortiranje). Svaka sledeća faza je dodatak
> koji odmah radi, pa se može stati posle bilo koje.

---

### P1 — Tabela isplativosti, filteri, sortiranje, CSV

**Cilj:** `/racunica` sa tabelom proizvod → varijante, obe marže, filterima i sortiranjem.

**Fajlovi**
- `db/sales.ts` **(premešteno)**: `loadSales`/`sumItems`/`bucketOf`/`norm` iz `lib/ai/tools/sales.ts`. AI alati i `db/dashboard-charts.ts` menjaju samo import. Ponašanje se ne dira.
- `lib/racunica.ts` **(novo)**: tipovi `RacunicaRow`/`RacunicaVariant`, kolone (§1), `marginPct()`, `DEFAULT_TARGET_PCT = 30`, ključevi sortiranja.
- `db/racunica.ts` **(novo, `server-only`)**: `getRacunica({ from, to }, client?)` povlači katalog (`products` + `product_variants` + kategorija/brend, kroz `selectAll`) i `loadSales`, spaja po `sku`, pa gradi redove proizvoda sa varijantama i grupu „Van kataloga". Opcioni `client` služi za AI alat i `ai:check` (obrazac iz `db/customers.ts`).
- `lib/period.ts`: dodati preset-e `30d` / `90d` / `godina` / `sve` (granice kroz postojeći `addDays`; „sve" = od `2026-02-02`). Postojeći preset-i i Dashboard ostaju nedirani.
- `app/(app)/racunica/page.tsx` **(novo)**: `requireRole("admin","manager")`, period (podrazumevano 90 dana), kartice iznad tabele (ukupna stvarna zarada, stvarna marža %, broj artikala ispod cilja, vezano po VP).
- `app/(app)/racunica/racunica-table.tsx` **(novo, klijent)**: desktop tabela sa sklopivim redom proizvoda (varijante ispod), mobilne kartice. Sortiranje klikom na zaglavlje, ceo skup je već na klijentu (stotine redova, nema paginacije na serveru).
- `app/(app)/racunica/racunica-toolbar.tsx` **(novo)**: pretraga (naziv/SKU, bez dijakritika, `norm`), kategorija, brend, „Ispod cilja", „Sa prodajom / Bez prodaje", „Prikaži arhivirane", polje cilja %.
- **CSV:** „Izvezi CSV" za trenutni filter i sort (`;` + BOM, varijante kao zasebni redovi). Pravi se `lib/csv.ts` (`toCsv`) **po specifikaciji iz Izveštaji R0**, da R0 kasnije samo koristi gotov helper.
- `lib/nav.ts`: stavka „Računica" (`Calculator`, sekcija `novac`, `roles: STAFF`, `primaryRoles: []`).

**URL:** `?od=&do=&q=&kategorija=&brend=&cilj=30&ispod=1&prodaja=sa|bez&arhiva=1&sort=zarada&smer=desc`.
Deljiv link = deljiv pogled. Podrazumevani sort je **stvarna zarada ↓**.

**Rezultat**
- Σ stvarne zarade svih redova (uklj. „Van kataloga") = Dashboard „Zarada" za isti period, **0 RSD**. Isto važi za promet. Dokaz: `npm run provera:racunica` (`scripts/provera-racunica.ts`, samo čita, 5 perioda).
- Logistika na `/racunica` dobija redirect; `rls:static` kapija dodata.
- 360 px bez horizontalnog skrola strane (tabela u `overflow-x-auto`). Provera u pravom `AppShell`-u.

> **✅ URAĐENO 22.10.2026 — odstupanja od teksta iznad:**
> - Preseti 30d/90d/godina/sve su **odvojen tip** `RangePresetKey` + `resolveRange()` u `lib/period.ts` (Dashboardov `PresetKey` nedirnut).
> - Filteri/sort/otvorene varijante rade **na klijentu** i upisuju se u URL kroz `history.replaceState` (bez ponovnog učitavanja); period ide kroz server (`?od&do`). Zato je i filter perioda klijentska komponenta (`range-filter.tsx`) — čuva ostale parametre.
> - CSV se pravi **u pregledaču** (`toCsv` + `downloadCsv` iz `lib/csv.ts`), bez API rute; jedan red po varijanti, trenutni filter i sort.
> - „Vezano po VP" je preimenovano u **„Stanje po VP"** — roba je u drugovom magacinu, nije Sportem-ov zarobljen novac (`sportem-kontekst.md`).
> - Kategorija filter se ne prikazuje dok tabela `categories` nema redova (danas prazna).
> - Dokaz: `npm run provera:racunica` — 5 perioda, **0 RSD**, svaki SKU u tačno jednom redu (`docs/perf/2026-10-22-provera-racunica.txt`). Van kataloga je jedan SKU: **SM195 „Podesive bučice"**.

> **PROMPT ZA SESIJU (P1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Racunica.md (sekcije 0, 1 i korak P1).
> Uradi SAMO P1: premesti loadSales u db/sales.ts (bez promene ponašanja), lib/racunica.ts,
> db/racunica.ts (katalog + prodaja po sku, grupa „Van kataloga", stvarna marža bez stavki bez VP),
> preset-i 30d/90d/godina/sve u lib/period.ts, /racunica strana (requireRole admin+manager, podrazumevano
> 90 dana), tabela proizvod→varijante sa sortiranjem i filterima u URL-u, cilj % (default 30),
> CSV kroz lib/csv.ts, nav stavka u sekciji Novac. scripts/provera-racunica.ts (0 RSD vs Dashboard).
> Bez migracije. lint + tsc + rls:static + build, vizuelno u pravom AppShell-u (desktop + 360 px).
> ```

---

### P2 — Razvrstavanje: ABC, matrica, mrtva roba (svaki pogled sa prekidačem)

**Cilj:** odmah se vidi šta nosi zaradu, šta je kandidat za izbacivanje i gde stoji zarobljena roba.

- **ABC (Pareto)** po stvarnoj zaradi u periodu: proizvodi sortirani ↓, kumulativni udeo **A ≤ 80 % · B ≤ 95 % · C ostatak**. Proizvodi bez prodaje i sa zaradom ≤ 0 su uvek C. Badge u tabeli + filter „A/B/C".
- **Matrica obim × marža**: x = prodato komada, y = stvarna marža %. Granice su **medijana komada** i **ciljna marža** (D8). Kvadranti: **Zvezde** (mnogo + iznad cilja) · **Obim** (mnogo + ispod) · **Niša** (malo + iznad) · **Kandidati za izbacivanje** (malo + ispod). Grafikon tačaka (inline SVG, novi `components/charts/scatter-chart.tsx` na `core.tsx`, bez nove zavisnosti). Hover pokazuje naziv i cifre, klik filtrira tabelu na kvadrant. Bez prodaje = van grafikona (pišu se brojem).
- **Mrtva roba**: popisano stanje > 0 i **nema prodaje N dana** (60/90, bira se). Kolone: stanje, poslednja prodaja (datum, iz cele istorije, ne samo iz perioda), **vezano po VP**. Zbir „ukupno zarobljeno".
- **Prekidači** iznad tabele: „ABC · Matrica · Mrtva roba". Isključen pogled se ne renderuje (ni kolona ABC, ni grafikon, ni sekcija). Stanje je u **`localStorage`** (`sportem.racunica.pogledi`, try/catch, bez njega su svi uključeni) i u URL-u (`?pogledi=abc,matrica`), da deljen link pokaže isto.

**Rezultat:** Σ zarade A+B+C = ukupna zarada; isključivanje svakog pogleda uklanja ga bez praznih mesta; prag matrice prati polje „cilj %".

> **✅ URAĐENO 22.10.2026 — odstupanja i detalji:**
> - ABC i matrica se računaju nad **svim redovima perioda** (pravilo vidljivosti arhiviranih), ne nad filtriranom tabelom — klasa se ne menja kad se suzi pretraga. „Van kataloga" red dobija klasu kao i ostali.
> - „Mnogo" = **više od medijane** komada (danas medijana = 2), pa je linija granice na `medijana + 0,5`. Tačke sa istim brojem komada su razmaknute (`jitter` 6 px, stalan po ključu). Klik na tačku traži taj artikal u tabeli; klik na kvadrant u legendi filtrira (`?kvadrant=`).
> - Mrtva roba je **po varijanti**, gleda unazad od danas (60/90 dana, `?mrtva=`), nezavisno od perioda. Poslednja prodaja dolazi iz **cele istorije**: `getRacunica` sada čita `loadSales` jednom od `DATA_START` i u memoriji deli na period i na `lastSoldDay` po SKU (bez drugog upita).
> - Prekidači: URL `?pogledi=` ima prednost, pa `localStorage` (`sportem.racunica.pogledi`), pa svi uključeni. Gašenje pogleda briše i njegov filter.
> - CSV dobija kolone ABC / Kvadrant / Poslednja prodaja samo kad je pogled uključen.
> - Provera (`npm run provera:racunica`): ABC — svaki red ima klasu, A+B+C = ukupna zarada, A ≥ 80 %; mrtva roba — nijedna nema prodaju posle granice. Danas: **221 varijanta / 38,6 mil. RSD po VP** bez prodaje 90 dana.

---

### P3 — Prognoze i trend

**Cilj:** šta će se prodati, kada nestaje sa stanja i kako stoji mesec.

- **`lib/sales-velocity.ts` (novo, čista funkcija, deli se sa Nabavkom N1):** dnevni tempo po SKU = **ponderisani prosek** (poslednjih 30 dana × 2 + prethodnih 60 dana × 1) / ukupna težina, uvek nad **poslednjih 90 dana bez obzira na izabrani period**, jer je prognoza vezana za danas. Prognoza 30 dana = tempo × 30. **Dana do nule** = stanje / tempo (samo popisano stanje; tempo 0 → „—"). Nabavka N1 posle koristi istu funkciju umesto svoje formule iz D2 (upisati u plan Nabavke).
- **Trend artikla**: poslednjih 30 dana prema prethodnih 30 (komadi). Prikaz ↑ / ↓ / → sa %. **Ispod 5 komada u oba prozora piše „malo podataka"**, bez strelice. Filter „Raste / Pada".
- **Zarada do kraja meseca** (kartica iznad tabele): ostvareno od 1. do danas + prosečan dnevni tempo poslednjih 28 dana × preostali dani. Uz to ide **raspon** (najslabija i najjača od poslednje 4 nedelje, preračunata na preostale dane) da cifra ne izgleda sigurnije nego što jeste. Osnova je ista kao Dashboard (`computePeriodMetrics`), pa se ostvareni deo poklapa sa karticom „Zarada" za tekući mesec.
- **Granica iskrenosti** (piše se na strani): istorija počinje 02.02.2026, pa **sezona nije uračunata**. Kad prođe godina dana, P3 se dopunjuje upoređivanjem sa istim mesecom prošle godine (van v1).

**Rezultat:** prognoza 30 dana za SKU = tempo iz `lib/sales-velocity.ts`; kartica „ostvareno" = Dashboard za tekući mesec, 0 RSD.

> **✅ URAĐENO 22.10.2026 — odstupanja i detalji:**
> - Tempo = `(2·q30 + q31–90) / 120`. Prozori (`Velocity`: `q30`, `qPrev30`, `q31to90`) se računaju u `getRacunica` iz istog učitavanja cele istorije (P2), po SKU; red proizvoda je zbir varijanti.
> - **Dana do nule je null kad artikal nije prodavan 90 dana** (nula na stanju bez potražnje nije „nestaje"); 0 = nema na stanju, a traži se. Na redu proizvoda se prikazuje **prva varijanta koja nestaje** (`rowDaysToZero`), ne zbirno stanje — kod veličina/težina zbir laže.
> - Trend: `few` (< 5 kom u oba prozora → „—" uz opis), `new` (prethodnih 30 dana 0 → „novo"), inače ±% sa pragom ±10 % za „bez promene". Filter `?trend=raste|pada|nestaje` (nestaje = < 30 dana); sort `trend`, `prognoza`, `do_nule` (rastuće).
> - Kartica „Zarada do kraja meseca" stoji iznad prekidača pogleda (nije pogled koji se gasi). Tempo = prosek 28 **punih** dana pre danas; raspon = najslabija/najjača od 4 nedelje × preostali dani.
> - Tabela je sa P3 šira od 1280 px ekrana → **prva kolona (naziv) je zaključana** pri vodoravnom skrolu.
> - Provera: komadi 30 / 31–60 / 31–90 dana = nezavisan račun, ostvareno u mesecu = Dashboard, 28 dana = referenca, raspon obuhvata procenu — PASS.

---

### P4 — Kalkulator „šta ako"

**Cilj:** proveriti cenu pre nego što se promeni u Katalogu. **Ništa se ne upisuje.**

Otvara se iz reda (proizvod ili varijanta) kao `Sheet` (desno na desktopu, odozdo na telefonu). Polja su pred-popunjena iz kataloga:
- **Nova MP** ili **popust %** (dva polja vezana jedno za drugo) i **nova VP** (pregovori sa drugom).
- Izlaz: nova marža RSD i %, razlika prema sadašnjoj, i **prag isplativosti**: koliko komada treba prodati po novoj ceni za **istu zaradu** kao u periodu (`stvarna zarada / nova zarada po komadu`, uz „+N % komada").
- **„MP za ciljnu maržu"**: `VP / (1 − cilj)`, zaokruženo na **prvih 90 ili 990 RSD naviše** (kako su cene na sajtu). Prikazuje se i nezaokružena cifra.
- Sve u celim RSD (`Math.round`, bez decimala u prikazu; §5). Čist klijentski kod u `lib/racunica.ts` (`simulate()`), testabilan.
- Dugme „Otvori u Katalogu" vodi na `/katalog/{productId}`. Upis cene ostaje tamo (D11).

**Rezultat:** popust 0 % daje tačno sadašnje cifre; MP za cilj 30 % sa VP 3.000 → 4.286 RSD (prikazano 4.290).

> **✅ URAĐENO 22.10.2026 — odstupanja i detalji:**
> - Kalkulator radi **po varijanti** (cena živi tamo). Sa reda proizvoda bira se varijanta, a podrazumevana je najprodavanija u periodu. Dugme sa ikonom kalkulatora stoji na redu proizvoda, na svakoj aktivnoj varijanti i na mobilnoj kartici. Za red „Van kataloga" ga nema, jer nema kataloške cene.
> - „Za istu zaradu iz perioda N kom" je zamenjeno sa **„na M kom iz perioda: zarada sada X → posle Y"**. Obe cifre su iz kataloga, jer je stara verzija i bez promene cene pisala „65 umesto 66" (stvarna zarada je sa popustima). Prag isplativosti u % komada ostaje.
> - Zaokruživanje „kao na sajtu" (`shopPrice`): ispod 10.000 RSD na …90, od 10.000 na …990 (9.995 → 10.990). Dugme „Isprobaj" upisuje tu cenu u polje — **samo u kalkulator**.
> - Popust i MP su vezani u oba smera; negativan popust je poskupljenje. Funkcije `simulate`, `mpForTarget` i `shopPrice` su u `lib/racunica.ts`, provereno skriptom (−10 % → 1.500/kom, +33,3 % komada; gubitak → null).

---

### P5 — AI: alat, „Pitaj asistenta", sažetak na klik

**Cilj:** pitanja tipa „šta da dignem", „zašto pada X", „šta da izbacim" bez ručnog čitanja tabele.

- **Alat `isplativost_artikala`** (`lib/ai/tools/index.ts`, samo čita, RLS klijent): ulaz `od`/`do` (podrazumevano 90 dana), `pretraga`, `kategorija`, `sort`, `limit` (do 30), `samo_ispod_cilja`, `cilj`. Vraća **iste redove kao `/racunica`** (zove `getRacunica` sa prosleđenim klijentom) + ABC klasu, kvadrant, trend i tempo. Labela „Isplativost artikala" u `lib/ai/tool-labels.ts`; system prompt ga pominje za pitanja o marži i isplativosti.
- **„Pitaj asistenta"** (`AskAssistantButton`): na vrhu strane (pitanje sa periodom i ciljem) i u kalkulatoru (pitanje sa artiklom i cenama). Samo pred-popuni, ne šalje.
- **„Analiziraj"** (AI sažetak): dugme iznad tabele → server pravi **nov razgovor u Asistentu** („Analiza računice DD.MM.") i u njemu jedan odgovor sa alatom: **5–6 zaključaka** (šta nosi zaradu, šta je ispod cilja sa obimom, kandidati za izbacivanje, mrtva roba, šta raste/pada) sa SKU-ovima i ciframa **iz alata**. Rezultat se prikazuje na strani + „Nastavi u Asistentu →".
  - **Zašto razgovor, a ne poseban upis:** cena ide u `ai_messages.cost_micro_usd`, pa **važi mesečni limit** (A5) i potrošnja se vidi u Asistentu, a korisnik može da nastavi pitanja. Nema nove tabele.
  - Model: **Sonnet 5.5** (sažetak ne traži Opus), poziv kroz isti put kao chat ruta (izdvojiti zajedničko jezgro iz `app/api/asistent/chat/route.ts` u `lib/ai/run.ts`, ne kopirati). Na klik, nikad automatski. Limit dostignut → dugme onemogućeno sa porukom.
- **`npm run ai:check`** dopunjen: alat `isplativost_artikala` za 3 perioda = `getRacunica` = Dashboard zarada, 0 RSD.

> **✅ URAĐENO 22.10.2026 — odstupanja i detalji:**
> - **„Analiziraj" zove POSTOJEĆU rutu `/api/asistent/chat`** (nov razgovor, Sonnet 5.5, bez weba) i čita isti NDJSON tok — **nije pravljen `lib/ai/run.ts`**. Isti efekat (razgovor u Asistentu, `cost_micro_usd`, mesečni limit, auto-naslov), nula dupliranja rute. Komponenta `app/(app)/racunica/analiza.tsx`; strana na serveru računa `AiState` (ključ + `getAiBudget`), a ruta ionako proverava ponovo.
> - Ne-NDJSON odgovor (istekla sesija → proxy vrati `/prijava`) i odgovor bez teksta prikazuju srpsku poruku umesto prazne kartice.
> - Alat `isplativost_artikala` (`samo`: ispod_cilja / zvezde / obim / nisa / kandidati / raste / pada / nestaje; `sort`, `smer`, `limit` ≤ 40) vraća i zbirove, ABC, kvadrante, procenu meseca i top 5 mrtve robe. `ai:check` ga poredi u svih 5 perioda (zarada i promet = Dashboard = `getRacunica`, A+B+C = zarada) — PASS.
> - „Pitaj asistenta" u kalkulatoru nosi artikal, SKU, sadašnju i novu MP/VP, cilj i period (samo pred-popuni).
> - **Nije provereno uživo:** prava analiza do kraja (trošila bi AI kredit; probna strana nema sesiju). Provereni su prikaz, greška i 360 px.

---

### P6 — QA, dozvole i dokumentacija (zatvara modul)

- `rls:static`: kapije `/racunica` (strana + akcija/ruta sažetka) na `requireRole("admin","manager")` / `getAiSession()`.
- `npm run perf`: sonda „racunica" (cilj < 600 ms medijana, service-role). Ako je sporije, keš kataloga po zahtevu (`cache()`), ne SQL agregacija.
- Prazna stanja: „Nema prodaje u ovom periodu", „Nema artikala za ove filtere", „Nema mrtve robe", „Malo podataka za trend".
- 360 px, tastatura (sort, prekidači, sheet), boje ispod/iznad cilja čitljive i bez boje (ikona + tekst).
- `CLAUDE.md`: §3 podsekcija „Računica — zaključane odluke" + beleške P1–P6 u §10; §1 lista planova; plan u `docs/arhiva/`.

> **✅ URAĐENO 22.10.2026:**
> - **Brzina:** `/racunica` je merena na 1.696 ms (8 uzastopnih `.in(200)` upita za stavke cele istorije). Dve izmene: `loadSales` čita parčad **paralelno** (koristi i AI i Dashboard grafikoni, pravila nedirana), a Računica koristi novi **`loadSalesWide`** — statusi, porudžbine i stavke cele tabele kroz `selectAllByIdShards` istovremeno (obrazac `/kupci`). Rezultat: **228–289 ms** medijana (service-role), 12 round-tripova. `provera:racunica` i `ai:check` posle izmene i dalje PASS (0 RSD). Snimak: `docs/perf/2026-10-22-perf-racunica.txt`.
> - Sonda `racunica` dodata u `npm run perf`; sonda `dashboard` usklađena sa paralelnim parčadima.
> - Prazna stanja, pristup (Logistika → redirect, nema stavke u meniju), 360 px i tastatura provereni kroz P1–P5; nije bilo novih nalaza.

---

## 3. Namerno van opsega (v1)

Poštarina, reklame i ostali troškovi po artiklu (D3) · upis cene iz simulacije (D11) · prag po kategoriji ·
sezonska prognoza (premalo istorije) · cenovna elastičnost (koliko više komada donosi niža cena — nema
dovoljno promena cena da se izmeri) · chat panel u strani · automatski/zakazani AI sažeci · pristup za Logistiku.
