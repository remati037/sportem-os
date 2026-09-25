# Sportem — Plan implementacije: Izveštaji / Izvoz

> Verzija 1.0 · 22.09.2026 · status: **spreman za rad**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo

Kartica **Izveštaji / Izvoz** (`/izvestaji`) — jedno mesto gde se vidi i skine sve što se danas
vadi ručno. Povod: sedam CSV izvoza od 06–08.09.2026 rađenih van aplikacije, jer app **nema nijedan izvoz**.

### Potvrđene odluke (ispitivanje 22.09.2026)

| Tema | Odluka |
|---|---|
| Grupe izveštaja | **Sve četiri:** Prodaja · Kupci · Katalog i zalihe · Finansije |
| Format | **CSV (`;` + BOM)** za sve + **PDF** za sažete izveštaje (top liste, mesečni pregled) |
| Prikaz | **Ekran sa tabelom i zbirovima**, pa dugme „Izvezi" — **plus grafikoni** (linijski trend + stubičasti top-10) |
| Poređenje | **Da** — uz svaku cifru i prethodni period sa razlikom u procentima |
| Dozvole | **Admin i Menadžer vide sve.** **Logistika vidi SAMO grupu „Zalihe", bez ijedne cenovne kolone.** |
| Email | **Mesečni sažetak 1. u mesecu** kroz postojeći cron + Resend, sa CSV prilogom |
| Čuvanje izveštaja | **Ne** — sve se računa na zahtev. Nema tabele „sačuvanih izveštaja", nema zakazivanja iz UI-ja. |

### Ključna posledica: **modul nema nijednu migraciju**

Izveštaji su čitanje nad postojećom šemom; mesečni email koristi `notification_preferences.prefs`
koji je `jsonb`, pa nov tip ne traži `ALTER`. **Nijedna faza ne radi `supabase db push`.**
To znači i da nijedna faza ne može da obori produkciju šemom — najgori ishod je pogrešna cifra na ekranu.

### Tri tehničke činjenice koje ceo modul drže

**1. Grupiše se po `sku`, ne po `variant_id`.**
`order_items.sku` i `order_items.product_name` su **`not null` snapshot** kolone. `variant_id` je `null`
na ~93% stavki (backfill nije spajao SKU sa varijantama). Grupisanje po `variant_id` bi dalo izveštaj
koji počinje od avgusta; grupisanje po `sku` pokriva **celu istoriju od 02.02.2026**.
Naziv artikla ide iz `product_name` snapshot-a — proizvod je u međuvremenu mogao biti preimenovan.

**2. Bez paginacije svaki izveštaj laže.**
PostgREST ima **tvrd cap od 1000 redova** — ni `.range(0, 19999)` ni `.limit(5000)` ga ne zaobilaze
(izmereno u auditu). Danas ima **1191 porudžbina i 1917 stavki**, pa bi svaki izveštaj tiho izgubio
rep. Zato je prvi korak (R0) helper za paginaciju — koji usput **popravlja i postojeći bug**
„zbir iznad liste porudžbina = 0 RSD" (`docs/backlog.md` #0 i #8).

**3. Novac isključivo iz zamrznutih stavki.**
Svaka cifra prometa/zarade/marže ide iz `order_items` (`mp_at_sale`, `vp_at_sale`, `profit_at_sale`),
**nikad iz kataloga**. Jedini izveštaj koji čita katalog je **Cenovnik**, i on je izričito označen kao
„trenutno stanje kataloga", ne istorija.

### Jedno pravilo koje mora biti isto u svim izveštajima

**Otkazano i Vraćeno:** promet, zarada i marža ih **isključuju** (`CANCELLED_STATUS_NAMES`, po imenu —
nikad po UUID-u); **broj porudžbina ih uključuje**, uz zasebnu kolonu „od toga otkazano/vraćeno".
Isti obrazac kao Dashboard (`CLAUDE.md`, „Dashboard čišćenje"). Svaki izveštaj u zaglavlju piše
koju osnovu koristi, da se dve cifre nikad ne razilaze bez objašnjenja.

### Šta se NE dira

Zamrznute cene i `order_items` · finansijske akcije (fakture, uplate, poravnanja) · RLS politike
postojećih tabela · tok statusa porudžbina · `syncOrderStock` · webhook · restriktovani view za Logistiku.
**Modul je read-only nad svim postojećim podacima** — jedini upis u celom modulu je `notification_log`
(dedup mesečnog email-a) i to kroz postojeći `lib/push.ts`.

---

## 1. Arhitektura: registar izveštaja

Jedan izveštaj se definiše **na jednom mestu**, i iz te definicije se hrane **tabela na ekranu, CSV,
PDF i mesečni email**. Bez toga se četiri prikaza raziđu prvim sledećim dodavanjem kolone.

```ts
// lib/reports.ts  (bez `server-only` — UI čita labele i grupe)
export type ReportColumn<Row> = {
  header: string;                       // naziv kolone na srpskom
  value: (row: Row) => string | number | null;
  align?: "left" | "right";             // brojevi desno (tnum), tekst levo
  kind?: "rsd" | "int" | "pct" | "date" | "text";  // formatiranje za prikaz i CSV
};

export type ReportDef<Row> = {
  key: string;                          // URL i ime fajla: "prodaja-po-artiklu"
  label: string;                        // „Prodaja po artiklu"
  group: "prodaja" | "kupci" | "zalihe" | "finansije";
  roles: Role[];                        // ko sme — proverava se NA SERVERU
  description: string;                  // jedna rečenica ispod naslova: šta broji, šta isključuje
  pdf: boolean;                         // sme li u PDF (sažeti da, sirovi ne)
  columns: ReportColumn<Row>[];
  fetch: (period: Period) => Promise<Row[]>;
  summary?: (rows: Row[]) => SummaryStat[];   // zbirni red + kartice iznad tabele
  chart?: ChartSpec<Row>;               // opcioni grafikon (R6)
};
```

**Zašto registar, a ne stranica po izveštaju:** dodavanje novog izveštaja je jedan objekat, a ne
četiri fajla; dozvole se proveravaju na jednom mestu; CSV i PDF ne mogu da „zaborave" kolonu.

### Rute

| Ruta | Šta |
|---|---|
| `/izvestaji` | ekran: izbor grupe i izveštaja, filter perioda, kartice, grafikon, tabela |
| `/izvestaji?izvestaj=prodaja-po-artiklu&od=…&do=…` | sve stanje u URL-u → deljiv link |
| `/api/izvestaji/[kljuc]/csv` | preuzimanje CSV-a (`Content-Disposition: attachment`) |
| `/api/izvestaji/[kljuc]/pdf` | preuzimanje PDF-a (samo za `pdf: true`) |

**Dozvole se proveravaju dvaput:** registar filtrira listu po roli (higijena), a **ruta za preuzimanje
sama ponovo proverava** `def.roles.includes(session.profile.role)` → 403. Obrazac iz
`app/api/porudzbine/lista-za-slanje/route.tsx` (`getProfile()`, ne `requireRole()` — `redirect()` baca
u route handleru).

---

## 2. Faze i koraci

> Redosled je namerno takav da **R0 sam po sebi ima vrednost** (popravlja postojeći bug), a svaka
> sledeća faza dodaje jednu grupu izveštaja koja odmah radi. Može se stati posle bilo koje faze.

---

### R0 — Temelj: paginacija, CSV motor, registar, prazan ekran

**Cilj:** infrastruktura na kojoj sve ostale faze stoje + popravka postojećeg novčanog buga.

**Fajlovi**
- ✅ `lib/supabase/paginate.ts` **(URAĐENO 26.09.2026 u koraku K2** plana optimizacije) — `selectAll` / `selectAllIn` / `chunked(ids, IN_CHUNK=200)` / `must` / `mustRows` / `mustOne`. **Ne raditi ponovo.**
- ✅ `db/orders.ts` — `sumOrderItems` i `getOrdersSummary` su na helperu *(zatvorilo `docs/backlog.md` #0 i #8)*. **Ne raditi ponovo.**
- `lib/csv.ts` **(novo)** — `toCsv(columns, rows)`: `;` separator, **BOM** (`﻿`), CRLF, navodnici samo kad treba, RSD bez decimala, datumi `DD.MM.YYYY.`, procenti sa jednom decimalom
- `lib/reports.ts` **(novo)** — tipovi + prazan registar + `reportsForRole(role)` + `findReport(key, role)`
- `app/(app)/izvestaji/page.tsx` **(novo)** — filter perioda (`lib/period.ts`), izbor grupe i izveštaja, prazno stanje
- `app/(app)/izvestaji/report-table.tsx` **(novo)** — generička tabela iz `columns` (desktop tabela / mobilne kartice, obrazac iz `/troskovi`)
- `app/api/izvestaji/[kljuc]/csv/route.ts` **(novo)** — guard, `findReport`, `toCsv`, `attachment; filename="<kljuc>-YYYY-MM-DD.csv"`
- `lib/nav.ts` — stavka `/izvestaji` (`BarChart3`, `roles: ALL`, `primaryRoles: []` → sekundarni meni)

**Odluke**
- `selectAll` **baca** na grešku umesto da vrati prazno — izveštaj sme da pukne, ne sme da slaže.
- Tvrd limit **50.000 redova** po izveštaju uz jasnu srpsku poruku; CSV se pravi u memoriji (danas je najveći izveštaj 1917 redova — streaming nije potreban i ne uvodi se).
- Ime fajla nosi **datum izvoza**, ne period — tako se dva izvoza istog perioda ne gaze.
- Datumi: **uvek** `rangeToUtcPrefilter` + JS suženje po `belgradeDate` (obrazac iz `db/metrics.ts`). Nikad `T23:59:59.999Z`.

**Rezultat**
`/izvestaji` postoji i kaže „Izaberi izveštaj"; nav stavka se vidi; `npm run build` prolazi.
~~Traka „Za ovaj filter" iznad liste porudžbina više ne pokazuje 0 RSD~~ — **već urađeno u K2**
(26.09.2026): zbir bez filtera je 501.265 → 1.442.169 RSD i poklapa se sa Dashboardom.

> **Šta je od R0 ostalo:** `lib/csv.ts`, `lib/reports.ts`, `app/(app)/izvestaji/**`,
> `app/api/izvestaji/[kljuc]/csv/route.ts` i nav stavka. Paginacija je gotova — u novim upitima
> izveštaja koristiti `selectAll` / `selectAllIn` iz `lib/supabase/paginate.ts` i **ne prepisivati
> `IN_CHUNK` lokalno.**

> **PROMPT ZA SESIJU (R0)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R0).
> Uradi SAMO R0 — temelj modula Izveštaji, BEZ ijednog konkretnog izveštaja i BEZ migracije:
> 1) i 2) — PRESKOČI, urađeno u koraku K2 (lib/supabase/paginate.ts postoji, db/orders.ts je na
>    helperu). Koristi selectAll/selectAllIn/must iz njega i ne prepisuj IN_CHUNK lokalno.
> 3) lib/csv.ts — toCsv(columns, rows): separator ';', BOM, CRLF, srpski brojevi i datumi.
> 4) lib/reports.ts — tipovi ReportDef/ReportColumn, prazan registar, reportsForRole, findReport.
> 5) app/(app)/izvestaji/page.tsx + report-table.tsx — filter perioda iz lib/period.ts, izbor
>    izveštaja, prazno stanje, generička tabela iz columns.
> 6) app/api/izvestaji/[kljuc]/csv/route.ts — getProfile() guard (401/403 kao lista-za-slanje),
>    findReport po roli, Content-Disposition: attachment.
> 7) lib/nav.ts — stavka „Izveštaji" (BarChart3, roles ALL, primaryRoles []).
> Sve datumske granice kroz rangeToUtcPrefilter + belgradeDate. Na kraju lint + tsc + build.
> ```

---

### R1 — Prodaja

**Cilj:** pet izveštaja koji pokrivaju četiri tvoja ručna izvoza.

**Fajlovi**
- `db/reports-sales.ts` **(novo)** — svi upiti kroz `selectAll`
- `lib/reports.ts` — registracija pet definicija u grupi `prodaja`

**Izveštaji**

| Ključ | Šta | Zamenjuje ručni izvoz |
|---|---|---|
| `prodaja-po-porudzbini` | red po porudžbini: broj, datum, status, dostava, plaćanje, grad, vrednost robe, poštarina, otkup, zarada, marža, komada, datumi slanja/isporuke, faktura | `prodaja-porudzbine-*.csv` |
| `prodaja-po-stavci` | red po stavci: porudžbina, datum, šifra, SKU, artikal, varijanta, količina, MP/VP po komadu, ukupno, zarada | `prodaja-stavke-*.csv` |
| `prodaja-po-artiklu` | **grupisano po SKU-u**: prodato komada, broj porudžbina, promet, zarada, marža, prva/poslednja prodaja | `najprodavaniji-50-*.csv`, `top10-promet-zarada-*.csv` |
| `prodaja-po-mesecu` | mesec, broj porudžbina, promet, zarada, marža, prosečna korpa | — |
| `prodaja-po-gradu` | grad, broj porudžbina, promet, zarada, udeo u prometu | — |

**Odluke**
- „Po artiklu" grupiše po **`sku`** (v. §0, činjenica 1) i nudi prekidač **„grupiši po osnovi šifre"** (SM001-1, SM001-2 → SM001), jer su tvoje top liste bile po šifri proizvoda, a ne po varijanti.
- Otkazano/Vraćeno po pravilu iz §0: van prometa i zarade, u broju porudžbina uz zasebnu kolonu.
- `needs_vp` stavke ulaze sa zaradom 0 i broje se u zasebnoj koloni „bez VP" — nikad se tiho ne zaokruže na nulu bez traga.
- Marža = `zarada / promet`, jedna decimala; deljenje nulom → prazno, ne `0.0`.

**Rezultat**
Svih pet izveštaja se vidi na ekranu, izvozi u CSV, i cifre se **poklapaju sa tvojim ručnim izvozom
od 07.09.2026** na svaku porudžbinu i svaki dinar. To je kriterijum prihvatanja ove faze.

> **PROMPT ZA SESIJU (R1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R1). R0 je gotov.
> Uradi SAMO R1 — grupa „Prodaja": db/reports-sales.ts + pet definicija u registru
> (po porudžbini, po stavci, po artiklu, po mesecu, po gradu).
> KLJUČNO: „po artiklu" grupiši po order_items.sku (NE po variant_id — 93% istorijskih stavki
> ga nema), naziv iz snapshot kolone product_name. Dodaj prekidač „grupiši po osnovi šifre".
> Sve cifre iz zamrznutih order_items, nikad iz kataloga. Otkazano/Vraćeno van prometa i zarade
> (po imenu, CANCELLED_STATUS_NAMES), ali u broju porudžbina uz zasebnu kolonu.
> Svi upiti kroz selectAll iz lib/supabase/paginate.ts. Bez migracije. Na kraju lint + tsc + build.
> ```

---

### R2 — Kupci

**Cilj:** ekran kupaca kojeg app uopšte nema.

**Fajlovi**
- `db/reports-customers.ts` **(novo)**
- `lib/reports.ts` — četiri definicije u grupi `kupci`

**Izveštaji**

| Ključ | Šta |
|---|---|
| `kupci-ponovni` | 2+ porudžbine: kupac, grad, broj porudžbina, promet, zarada, komada, prva/poslednja kupovina, brojevi porudžbina, **po čemu su spojeni** |
| `kupci-top` | top po prometu i po zaradi (dve sekcije, kao tvoj `top10-*.csv`) |
| `kupci-rizicni` | kupci sa otkazanim/vraćenim porudžbinama: broj otkaza, ukupno porudžbina, procenat |
| `kupci-neaktivni` | kupovali pa stali — poslednja kupovina starija od N meseci (N podesiv u filteru) |

**Odluke**
- Spajanje kupaca po **normalizovanom telefonu** (`normalizePhone` iz `lib/woo.ts`, `+381`/`00381`/`381` → `0…`), pa po e-mailu; kolona **„Spojeno po"** kaže po čemu — isto kao tvoj ručni izvoz. Ime se uzima sa **najnovije** porudžbine (kupci menjaju ime primaoca).
- Telefon i adresa su **PII**: prikazuju se u app-u (Admin/Menadžer ionako vide porudžbine), ali izveštaj u zaglavlju nosi upozorenje da fajl sadrži lične podatke kupaca.
- „Rizični" ponovo koristi `db/customer-risk.ts` (`buildCancellationIndex`, `matchCancellations`) — **prebačen na `selectAll`** u ovoj fazi, jer danas tiho staje na 1000 otkazanih (`docs/backlog.md`, P1 #8).

**Rezultat**
`kupci-ponovni` daje **59 redova** i poklapa se sa `ponovni-kupci-2026-09-08.csv` po broju porudžbina,
prometu i zaradi za svakog kupca.

> **PROMPT ZA SESIJU (R2)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R2). R0 i R1 su gotovi.
> Uradi SAMO R2 — grupa „Kupci": db/reports-customers.ts + četiri definicije
> (ponovni, top po prometu/zaradi, rizični, neaktivni).
> Spajanje kupaca po normalizovanom telefonu (normalizePhone iz lib/woo.ts), pa po e-mailu;
> kolona „Spojeno po" kaže po čemu. Ime sa najnovije porudžbine.
> Usput prebaci db/customer-risk.ts (buildCancellationIndex) na selectAll — danas tiho staje na 1000.
> Sve cifre iz zamrznutih order_items. Bez migracije. Na kraju lint + tsc + build.
> ```

---

### R3 — Katalog i zalihe (+ jedini pristup za Logistiku)

**Cilj:** cenovnik i stanje, i prvi izveštaj koji Logistika sme da vidi.

**Fajlovi**
- `db/reports-catalog.ts` **(novo)** — **bira izvor po roli**: Admin/Menadžer → `product_variants`, Logistika → `product_variants_public`
- `lib/reports.ts` — četiri definicije u grupi `zalihe`
- `app/(app)/izvestaji/page.tsx` — grupe se filtriraju po roli (Logistika vidi samo „Zalihe")

**Izveštaji**

| Ključ | Šta | Ko |
|---|---|---|
| `katalog-cenovnik` | šifra, proizvod, SKU, varijanta, MP, VP, zarada, marža, arhivirano | **Admin, Menadžer** |
| `zalihe-stanje` | proizvod, SKU, varijanta, stanje, popisano (datum), prag, nisko stanje, šifra dobavljača, težina | **sve role** |
| `zalihe-nisko` | samo varijante ispod praga — **popisane** (nepopisana nula nije nisko stanje) | **sve role** |
| `zalihe-bez-prodaje` | aktivne varijante bez ijedne stavke u periodu — kandidati za rasprodaju | **Admin, Menadžer** |

**Odluke**
- **Logistika NIKAD ne dobija cenovne kolone** — ne „prazne", nego ih u `columns` nema, a izvor je view koji ih ni ne vraća. Ruta za preuzimanje proverava rolu i vraća 403 za `katalog-cenovnik`.
- „Nisko stanje" nasleđuje pravilo iz `isVariantLowStock`: traži `stock_counted_at != null` — **popisana nula jeste nisko stanje, nepopisana varijanta nije**.
- Cenovnik i stanje su **trenutno stanje kataloga**, ne istorija — filter perioda se na njima ne primenjuje i to piše u opisu izveštaja. `zalihe-bez-prodaje` jedini koristi period.

**Rezultat**
Logistika se uloguje, vidi `/izvestaji` sa **samo grupom „Zalihe"**, skine CSV stanja — **bez ijedne
cene u fajlu**. Pokušaj direktnog odlaska na `/api/izvestaji/katalog-cenovnik/csv` vraća **403**.

> **PROMPT ZA SESIJU (R3)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R3). R0–R2 su gotovi.
> Uradi SAMO R3 — grupa „Katalog i zalihe": db/reports-catalog.ts + četiri definicije
> (cenovnik, stanje, nisko stanje, bez prodaje).
> KLJUČNO za dozvole: Logistika sme SAMO zalihe i NIJEDNU cenovnu kolonu — izvor za nju je view
> product_variants_public (Admin/Menadžer čitaju product_variants), a kolone MP/VP/zarada se za
> nju NE renderuju (nema ih u columns, ne blur). Ruta za preuzimanje ponovo proverava rolu → 403.
> „Nisko stanje" traži stock_counted_at != null (popisana nula jeste nisko, nepopisana nije).
> Cenovnik i stanje ignorišu filter perioda i to piše u opisu. Bez migracije. lint + tsc + build.
> ```

---

### R4 — Finansije

**Cilj:** ono što se danas gleda po tabovima, u jednom izvozu.

**Fajlovi**
- `db/reports-finance.ts` **(novo)**
- `lib/reports.ts` — šest definicija u grupi `finansije`

**Izveštaji**

| Ključ | Šta |
|---|---|
| `finansije-uplate` | uplate u periodu: datum, iznos, broj porudžbina, Σ otkupnina, poštarina, razlika, fakturisano |
| `finansije-fakture` | fakture drugu: broj, datum, uplate, porudžbine, iznos, status plaćanja |
| `finansije-postarina` | po porudžbini: naplaćeno, stvarno (osnovica), PDV, razlika — i zbirni saldo |
| `finansije-xexpress` | po XExpress fakturi: period, broj porudžbina, naplaćeno kupcima, osnovica + PDV, P&L |
| `finansije-troskovi` | troškovi po kategoriji i po mesecu, sa udelom |
| `finansije-neto-po-mesecu` | mesec, zarada, troškovi, neto profit, marža |

**Odluke**
- `finansije-neto-po-mesecu` **mora da zove `computePeriodMetrics`** (`db/metrics.ts`), a ne da računa po svome — inače se Dashboard i izveštaj raziđu, što je tačno bug koji je već jednom bio popravljen.
- Poštarina nosi PDV po `withPdv` (`db/finance.ts`), zaokruživanje **po porudžbini**, da se zbir izveštaja poklopi sa saldom na `/finansije/postarina`.
- Izveštaj **ne dira** nijednu finansijsku akciju — čisto čitanje.
- `ISTORIJA-BACKFILL` faktura se prikazuje, ali je označena kao sintetička, da ne zbuni zbir.

**Rezultat**
`finansije-neto-po-mesecu` daje **identične cifre** kao kartica „Neto profit" za isti mesec.
Zbir `finansije-postarina` = saldo na `/finansije/postarina`.

> **PROMPT ZA SESIJU (R4)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R4). R0–R3 su gotovi.
> Uradi SAMO R4 — grupa „Finansije": db/reports-finance.ts + šest definicija
> (uplate, fakture, poštarina, XExpress, troškovi, neto po mesecu).
> KLJUČNO: neto po mesecu MORA da zove computePeriodMetrics iz db/metrics.ts (ne računati po svome,
> inače se Dashboard i izveštaj raziđu). Poštarina kroz withPdv, zaokruživanje po porudžbini,
> da se zbir poklopi sa saldom na /finansije/postarina. Sve read-only, sve iz zamrznutih cena.
> Admin i Menadžer; Logistika nema pristup grupi. Bez migracije. lint + tsc + build.
> ```

---

### R5 — Poređenje sa prethodnim periodom

**Cilj:** uz svaku cifru i koliko je bilo prošli put.

**Fajlovi**
- `lib/period.ts` — `previousPeriod(period)`: „mesec" → prethodni kalendarski mesec, „nedelja" → prethodna, „dan" → prethodni dan, **prilagođeni raspon → isto toliko dana unazad**
- `lib/reports.ts` — `summary` vraća i `prev` + `delta`
- `app/(app)/izvestaji/summary-cards.tsx` **(novo)** — kartica sa cifrom, prethodnom vrednošću i razlikom u procentima (zelena/crvena po smeru, strelica)

**Odluke**
- Poređenje se računa **samo za zbirne kartice**, ne za svaki red tabele — inače se broj upita udvostruči za sve izveštaje.
- Rast troška je **crven**, rast zarade **zelen** — smer „dobrog" se definiše po metrici (`goodWhen: "up" | "down"`), ne pogađa se iz predznaka.
- Deljenje nulom (prošli period bez prometa) → prikaz **„novo"** umesto `∞%`.
- Poređenje **ne ulazi u CSV** (fajl ostaje sirovi podaci); ulazi u PDF i u mesečni email.

**Rezultat**
Za „mesec: septembar" kartice pokazuju i avgust i razliku; za prilagođeni raspon od 10 dana poredi
sa prethodnih 10 dana. Prebacivanje perioda ne pravi dupli upit nad istim podacima.

> **PROMPT ZA SESIJU (R5)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R5). R0–R4 su gotovi.
> Uradi SAMO R5 — poređenje sa prethodnim periodom: previousPeriod() u lib/period.ts
> (mesec → prethodni kalendarski, nedelja → prethodna, dan → prethodni, prilagođeni raspon →
> isto toliko dana unazad), summary sa prev + delta, i summary-cards.tsx sa razlikom u procentima.
> Smer „dobrog" po metrici (goodWhen), NE po predznaku — rast troška je crven, rast zarade zelen.
> Prošli period bez prometa → „novo", ne ∞%. Poređenje ide u prikaz i PDF, NE u CSV.
> Računa se samo za zbirne kartice, ne po redu tabele. Bez migracije. lint + tsc + build.
> ```

---

### R6 — Grafikoni

**Cilj:** trend se vidi, ne iščitava iz tabele.

**Fajlovi**
- `package.json` — **`recharts`** (jedina nova zavisnost celog modula)
- `app/(app)/izvestaji/report-chart.tsx` **(novo)** — klijentska komponenta, dva tipa: **linijski** (vremenska serija) i **stubičasti** (top-N)
- `lib/reports.ts` — `ChartSpec` po izveštaju (tip, x, y, boja); izveštaj bez `chart` prikazuje samo tabelu

**Odluke**
- **Boje isključivo iz dizajn tokena** (`docs/Sportem-Dizajn-Sistem.md`): brend zelena `#1B7A45` za zaradu, `info` `#3D6B8C` za promet, `danger` `#B23B30` za otkazano. Bez podrazumevane recharts palete.
- Grafikon je **dopuna, ne zamena** — tabela ostaje ispod i uvek ima iste cifre.
- Na telefonu grafikon ide **preko pune širine, visine ~220px**, sa manje tickova; tabela ispod ostaje na karticama.
- `recharts` se uvozi **dinamički** (`next/dynamic`, `ssr: false`) da ne uđe u početni bundle ostalih ekrana.
- Bez animacija na učitavanju (brojevi treba odmah da se čitaju).

**Rezultat**
„Prodaja po mesecu" ima linijski grafikon zarade i prometa; „Prodaja po artiklu" stubičasti top-10.
Bundle ostalih ruta se ne menja (provera: `npm run build` i poređenje veličina).

> **PROMPT ZA SESIJU (R6)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R6). R0–R5 su gotovi.
> Uradi SAMO R6 — grafikoni: instaliraj recharts (jedina nova zavisnost modula) i dodaj
> report-chart.tsx sa dva tipa — linijski (vremenska serija) i stubičasti (top-N).
> ChartSpec ide u definiciju izveštaja; izveštaj bez chart prikazuje samo tabelu.
> Boje ISKLJUČIVO iz dizajn tokena (zelena #1B7A45 zarada, info #3D6B8C promet, danger #B23B30
> otkazano) — ne recharts podrazumevana paleta. Uvoz kroz next/dynamic ssr:false da ne uđe u
> bundle ostalih ruta. Na telefonu puna širina, ~220px, manje tickova. Bez animacija.
> Tabela ostaje ispod grafikona. Bez migracije. lint + tsc + build.
> ```

---

### R7 — PDF izvoz + mesečni email sažetak

**Cilj:** izveštaj koji se šalje i štampa, i jedan koji stiže sam.

**Fajlovi**
- `app/api/izvestaji/[kljuc]/pdf/route.tsx` **(novo)** — obrazac iz `lista-za-slanje` (`runtime = "nodejs"`, Geist iz `assets/fonts/`)
- `app/(app)/izvestaji/report-pdf.tsx` **(novo)** — generički `@react-pdf` dokument iz `columns` + zaglavlje (naziv, period, poređenje, datum izvoza) + zbirni red
- `lib/notifications.ts` — nov tip `monthly_report` (`roles: admin, manager`)
- `lib/reports-email.ts` **(novo)** — sastavlja mesečni sažetak
- `app/api/cron/notifikacije/route.ts` — **1. u mesecu** šalje sažetak za prethodni mesec

**Odluke**
- **PDF samo za `pdf: true`** — sažeti izveštaji (po artiklu, top liste, po mesecu, neto). „Po stavci" (1917 redova) u PDF-u nema smisla i ruta ga odbija sa porukom.
- PDF je **A4 portret**, brojevi desno u `Geist Mono`, zaglavlje ponavlja period i osnovu („bez otkazanih/vraćenih") — da odštampan papir stoji sam za sebe.
- Email **nosi CSV prilog** (mali je) i cifre u telu; bez `RESEND_API_KEY` tiho ne šalje, kao i sve ostalo (`lib/email.ts`).
- Nov tip poštuje **postojeće preference** — ko ga isključi na `/obavestenja`, ne dobija ga. Bez migracije (`prefs` je `jsonb`, default za tip koji nema red je „uključeno, kanal push" → za ovaj tip **email** treba biti podrazumevani kanal, pa `DEFAULT_CHANNEL` dobija izuzetak po tipu).
- `reference_id` = `monthly_report:{YYYY-MM}` → dedup, cron sme da se pozove dvaput.

**Rezultat**
Dugme „PDF" radi na sažetim izveštajima; 1. u mesecu stiže email „Avgust 2026: promet X, zarada Y,
neto Z (−4% u odnosu na jul)" sa CSV prilogom.

> **PROMPT ZA SESIJU (R7)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R7). R0–R6 su gotovi.
> Uradi SAMO R7 — PDF izvoz i mesečni email:
> 1) app/api/izvestaji/[kljuc]/pdf/route.tsx po obrascu app/api/porudzbine/lista-za-slanje
>    (runtime nodejs, Geist iz assets/fonts, getProfile guard) + generički @react-pdf dokument
>    iz columns, A4 portret, brojevi desno u Geist Mono, zaglavlje sa periodom i osnovom.
>    PDF SAMO za definicije sa pdf:true — ostale ruta odbija porukom.
> 2) Nov tip obaveštenja monthly_report u lib/notifications.ts (admin, manager), podrazumevani
>    kanal EMAIL (dodaj izuzetak u DEFAULT_CHANNEL po tipu).
> 3) lib/reports-email.ts + okidač u app/api/cron/notifikacije/route.ts — 1. u mesecu, sažetak
>    prethodnog meseca sa poređenjem, CSV prilog, reference_id „monthly_report:YYYY-MM" za dedup.
> Best-effort kao sva obaveštenja (nikad ne obara cron). BEZ MIGRACIJE — prefs je jsonb.
> lint + tsc + build.
> ```

---

### R8 — QA, dozvole i dokumentacija

**Cilj:** dokazati da Logistika ne vidi cene i da se cifre poklapaju, pa zatvoriti modul.

**Fajlovi**
- `scripts/rls-test.mjs` — **dopuna postojeće skripte** (ne nova): Logistika dobija 403 na svaku rutu izveštaja osim zaliha; CSV zaliha **ne sadrži nijednu cenovnu kolonu** (provera zaglavlja fajla)
- `docs/backlog.md` — brisanje stavki koje je R0/R2 zatvorio
- `CLAUDE.md` — nova podsekcija u §10 sa zaključanim odlukama modula
- `docs/Sportem-Plan-Izvestaji.md` — označiti korake kao urađene

**Provere (ručno, uz skriptu)**
1. **Poklapanje sa ručnim izvozima** — `prodaja-po-porudzbini` i `kupci-ponovni` protiv fajlova u `~/Desktop/Marko/sportem-izvestaji/` (isti period): svaka porudžbina, svaki dinar.
2. **Poklapanje sa app-om** — `finansije-neto-po-mesecu` = kartica Neto profit; `finansije-postarina` = saldo; `prodaja-po-porudzbini` zbir = traka „Za ovaj filter".
3. **Preko 1000 redova** — izveštaj nad celom istorijom vraća 1191, ne 1000.
4. **Logistika** — vidi samo „Zalihe", CSV bez cena, 403 na cenovnik.
5. **Mobilni (360px)** — grafikon i tabela bez horizontalnog skrola strane; duga imena artikala se prelamaju.
6. **Prazna stanja** — period bez prodaje, izveštaj bez redova, katalog bez varijanti; sve na srpskom sa punim dijakriticima.
7. **Excel** — otvoriti CSV duplim klikom i proveriti `š đ č ć ž` i da su brojevi brojevi, ne tekst.

> **PROMPT ZA SESIJU (R8)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Izvestaji.md (sekcije 0, 1 i korak R8). R0–R7 su gotovi.
> Uradi SAMO R8 — QA i zatvaranje modula:
> 1) DOPUNI scripts/rls-test.mjs (ne praviti novu skriptu): Logistika → 403 na sve rute izveštaja
>    osim zaliha, i zaglavlje CSV-a zaliha ne sme da sadrži MP/VP/zaradu/maržu.
> 2) Statička provera da svaka ruta izveštaja zove getProfile i proverava def.roles.
> 3) Prođi QA listu iz koraka R8 (poklapanje sa ručnim izvozima i sa app-om, preko 1000 redova,
>    mobilni 360px, prazna stanja, otvaranje CSV-a u Excelu).
> 4) Obriši iz docs/backlog.md stavke koje su R0 i R2 zatvorili (#0 i delove #8).
> 5) Upiši zaključane odluke modula u CLAUDE.md §10 i označi korake u planu kao urađene.
> lint + tsc + build.
> ```

---

## 3. Pre produkcije (čeklista)

- [ ] **Nema `supabase db push`** — modul nema migraciju. Ako je neka faza uvela tabelu, nešto je skrenulo s plana.
- [ ] `RESEND_API_KEY` i `EMAIL_FROM` u Vercel env — bez njih mesečni email tiho ne šalje (push i dalje radi).
- [ ] Provera da `recharts` nije ušao u bundle ruta van `/izvestaji` (`npm run build`, poređenje veličina).
- [ ] Prvi mesečni email sačekati ili ručno okinuti cron sa `CRON_SECRET` i proveriti prilog.
- [ ] Test sa **Logistika nalogom** — traži da nalog postoji (v. `docs/backlog.md`, otvoreno).

## 4. Namerno van opsega (v1)

- **Sačuvani izveštaji i zakazivanje iz UI-ja** (osim fiksnog mesečnog email-a).
- **Prilagođeni izveštaj** („izaberi kolone") — registar to omogućava kasnije, ali v1 ima fiksne definicije.
- **Izvoz cele baze / backup** — to je operativna tema, ne izveštaj.
- **Uvoz bilo čega** — modul je isključivo izvoz. (CSV uvoz kataloga ostaje gde jeste, i **i dalje je destruktivan** — `docs/backlog.md` #2–#4.)
- **Poređenje sa prošlom godinom** — nema podataka pre 02.02.2026.
- **Grafikoni u PDF-u** — PDF nosi tabelu i cifre; `recharts` ne renderuje u `@react-pdf`.
