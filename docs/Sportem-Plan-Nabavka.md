# Sportem — Plan implementacije: Nabavka (dopuna magacina)

> Verzija 1.0 · 18.10.2026 · status: **nacrt — pitanje N-0 iz §0.2 MORA biti odgovoreno pre ičega**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo

### 0.1 Polazna činjenica — Sportem ne kupuje robu unapred

Po `docs/sportem-kontekst.md` (§2, §3, §6): **Sportem nema svoj stok.** Roba je u **drugovom
magacinu** (zajednički — drug ima i druge kupce), šalje se direktno odatle, a Sportem robu
„uzima" po VP ceni tek kad je proda (VP ide drugu kroz fakturu/keš). Zato „nabavka" ovde
**nije** kupovina robe sa računom i plaćanjem, nego:

1. **Znati na vreme šta će nestati** — po stanju i brzini prodaje, ne samo po pragu.
2. **Javiti drugu šta treba dopuniti** — jedan spisak umesto poruka po artiklu.
3. **Upisati šta je stiglo** — da stanje u app-u odmah bude tačno (danas se to radi ručno kroz formu varijante ili popis).
4. **Zapamtiti artikle koje treba uvesti** (novi proizvodi) — za to već postoji tiket-tag **„Nabavka"**, pa modul tu **ništa ne gradi**, samo linkuje na `/tiketi?tag=…`.

### 0.2 Odluke — PREDLOG (potvrditi sa korisnikom pre N1)

| # | Tema | Predlog |
|---|---|---|
| **N-0** | **Da li Sportem ikad sam plaća robu unapred** (sopstvena nabavka, uvoz, roba koja je Sportem-ova)? | Plan pretpostavlja **NE**. Ako je odgovor DA, modul dobija nabavnu cenu, dobavljača, trošak i vezu sa finansijama — to je **drugi plan**, ne ovaj. Pitati prvo. |
| D1 | Novac u modulu | **Nijedna cifra novca za Logistiku.** Admin/Menadžer vide „vrednost zahteva po VP" (informativno: koliko robe će se uzimati) — kolona se za Logistiku **ne renderuje**, a izvor joj je `product_variants_public` |
| D2 | Predlog količine | `ceil(prodato_u_30_dana × dani_pokrivanja / 30) − stanje`, min 0; **dani pokrivanja = 30** (podesivo u filteru) |
| D3 | Prodaja po varijanti | iz zamrznutih `order_items` **po `sku`** (`variant_id` je null na ~93% istorije), bez Otkazano/Vraćeno |
| D4 | Nepopisane varijante | ne ulaze u predlog kao „treba dopuniti" nego u zasebnu grupu **„Prvo popiši"** — stanje 0 bez popisa je nepoznato (pravilo iz „Popis zaliha") |
| D5 | Zahtev za dopunu | dokument sa stavkama i statusom **Nacrt → Poslat → Delimično stiglo → Stiglo / Otkazan** (`text` + `CHECK`, ne enum — §10 Korak 0.4) |
| D6 | Logistika | **vidi poslate zahteve i upisuje prijem** (bez ijedne cene). Ovo je prvi modul gde Logistika piše nešto osim popisa → **menja zaključanu rečenicu u §3** („Logistika — samo stanje/naziv/slike") u „…i prijem robe po zahtevu za dopunu". Potvrditi izričito. |
| D7 | Prijem i stanje | prijem **povećava `stock_quantity`** kroz postojeći RPC `apply_stock_delta` (`lib/stock.ts` obrazac, service role) — **ne** stampuje `stock_counted_at` (prijem nije „prebrojao sam", isto kao auto-skidanje) |
| D8 | Obaveštenja | `restock_sent` → Logistici („Stigao zahtev za dopunu: N artikala"), `restock_received` → Adminu i Menadžeru. Kroz postojeći `notifyUsers`/`notifyRoles`, best-effort |

### 0.3 Otvorena pitanja (pitati na početku N1)

1. **N-0** (gore) — ako je DA, stati i napraviti drugi plan.
2. Kako se danas javlja drugu šta fali (poruka, poziv, papir)? Od toga zavisi da li je „Kopiraj spisak" (N1) dovoljan i da li N2/N3 uopšte trebaju.
3. Da li drug sam odlučuje šta naručuje od svojih dobavljača (pa je zahtev samo **predlog**), ili je zahtev **obavezujući**? Predlog plana: **predlog** — zato prijem sme da bude manji od traženog bez greške.
4. Da li drug zaista koristi app (nalog Logistike još ne postoji — `docs/backlog.md`)? Ako ne, N3 radi Admin/Menadžer umesto njega.

### 0.4 Šta se NE dira

Zamrznute cene i `order_items` · finansije (fakture, uplate, troškovi) · cene u katalogu ·
`syncOrderStock` i pravilo auto-skidanja · popis (`stock_counted_at`) · RLS politike postojećih
tabela (Logistika i dalje čita samo `product_variants_public`) · webhook.

---

## 1. Faze i koraci

> **N1 ima vrednost sam za sebe i nema migraciju.** Ako se posle N1 pokaže da je „Kopiraj spisak
> za druga" dovoljan, N2–N3 se ne rade — to je legitiman kraj modula.

### N1 — Predlog dopune (samo čitanje, bez migracije)

**Cilj:** ekran „šta treba dopuniti" koji gleda brzinu prodaje, ne samo prag.

**Fajlovi**
- `db/restock.ts` **(novo, server-only)** — `getRestockSuggestions({ coverDays, windowDays })`: aktivne varijante (Admin/Menadžer → `product_variants`, Logistika → `product_variants_public`) + prodaja po `sku` iz `order_items` za poslednjih `windowDays` (30) i 90 dana, kroz `selectAll`/`selectAllIn`; datumske granice kroz `rangeToUtcPrefilter` + `belgradeDate`
- `app/(app)/nabavka/page.tsx` **(novo)** — tri grupe: **Hitno** (procena < 7 dana do nule ili već ≤ 0) · **Uskoro** (< dani pokrivanja) · **Prvo popiši** (nepopisane sa prodajom); kolone: artikal, SKU, šifra dobavljača, stanje, prodato 30/90 dana, prosečno dnevno, dana do nule, **predlog količine** (izmenljiv u polju pre kopiranja)
- „Kopiraj spisak za druga" / „Štampaj" — obrazac spiska za druga iz Uplata (`byArticle`), **bez cena**, sa šifrom dobavljača (`supplier_sku`) jer po njoj drug naručuje
- `lib/nav.ts` — skinuti `soon` sa „Nabavka"; `roles` ostaje STAFF dok se ne potvrdi D6

**Odluke**
- Prodaja = komadi iz realizovanih **i otvorenih** porudžbina (Kreirano/Poslato/Isporučeno), bez Otkazano/Vraćeno — po imenu (`CANCELLED_STATUS_NAMES`).
- Varijanta bez prodaje u 90 dana se **ne predlaže** čak i na 0 (ne puniti magacin onim što ne ide) — ali je vidljiva u filteru „Sve ispod praga".
- Stavka bez `variant` (prodat SKU koji više nije u katalogu) se ignoriše uz napomenu ispod tabele.

**Rezultat**
`/nabavka` za Admina pokazuje predlog; zbir „prodato 30 dana" po SKU-u = isti SKU u izveštaju
„prodaja po artiklu" / alatu asistenta `artikal_prodaja` za isti period. „Kopiraj" daje čist tekst
bez ijedne cene.

> **PROMPT ZA SESIJU (N1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Nabavka.md (sekcije 0 i korak N1).
> PRVO mi postavi pitanje N-0 i pitanja iz §0.3 i potvrdi odluke D1–D8; ako je N-0 „DA" — stani.
> Uradi SAMO N1: db/restock.ts (getRestockSuggestions — prodaja po order_items.sku, bez
> Otkazano/Vraćeno po imenu, selectAll/selectAllIn, Belgrade granice) + /nabavka strana
> (requireRole admin+manager; grupe Hitno / Uskoro / Prvo popiši; predlog količine po formuli iz D2;
> „Kopiraj spisak za druga" bez ijedne cene, sa supplier_sku). Skini soon sa „Nabavka".
> Bez migracije. lint + tsc + rls:static + build, vizuelno u pravom AppShell-u (desktop + 360 px).
> ```

---

### N2 — Zahtev za dopunu (migracija)

**Cilj:** predlog postaje dokument koji se šalje i prati.

**Fajlovi**
- `supabase/migrations/2026MMDDHHMMSS_nabavka.sql` **(novo)**:
  - `restock_requests` (`id`, `code int` iz sekvence → prikaz `NAB-{code}`, `status text check (…D5…)`, `note`, `created_by`, `sent_at`, `closed_at`, `created_at`, `updated_at` + trigger)
  - `restock_request_items` (`id`, `request_id → restock_requests on delete cascade`, `variant_id → product_variants on delete restrict`, `sku text not null` + `product_name text not null` **snapshot** (kao `order_items`), `qty_requested int not null check (> 0)`, `qty_received int not null default 0 check (>= 0)`, `received_at`, `received_by`)
  - RLS: admin+manager `for all`; **logistics `select` samo zahteva sa `status <> 'nacrt'`** i njihovih stavki; **nijedna write politika za Logistiku** (prijem ide kroz server akciju + service role, obrazac `setStockCount`); svi pozivi u `(select …)`
  - **Nijedna cenovna kolona u ovim tabelama** — vrednost po VP se računa u letu samo za Admina/Menadžera
- `app/(app)/nabavka/actions.ts` **(novo)** — `createRequest(from suggestions)`, `updateRequestItems` (samo `nacrt`), `sendRequest` (→ `poslat`, `sent_at`, obaveštenje `restock_sent` Logistici), `cancelRequest`
- `lib/validation/restock.ts`, `lib/notifications.ts` (tipovi `restock_sent`: logistics; `restock_received`: admin, manager)
- `app/(app)/nabavka/zahtevi/page.tsx`, `zahtevi/[code]/page.tsx` **(novo)** — lista i detalj (`/nabavka/zahtevi/NAB-7`, prima i `7`, kao tiketi)

**Rezultat**
Iz predloga jednim klikom nastaje nacrt, menja se, šalje; Logistika (kad nalog postoji) dobija
push i vidi zahtev bez cena; Admin vidi vrednost po VP.

> **PROMPT ZA SESIJU (N2)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Nabavka.md (sekcije 0 i korak N2). N1 je gotov.
> Uradi SAMO N2 — migracija restock_requests + restock_request_items (sku/product_name SNAPSHOT,
> NIJEDNA cenovna kolona, status text+CHECK, šifra NAB-{code} iz sekvence), RLS: admin+manager
> sve, logistics SAMO select ne-nacrt zahteva, bez write politike za logistics, svaki
> current_app_role()/auth.uid() u (select …). Akcije create/update/send/cancel (zod, requireRole
> admin+manager), obaveštenje restock_sent Logistici kroz notifyRoles (best-effort).
> Rute /nabavka/zahtevi i /nabavka/zahtevi/[code]. Vrednost po VP renderuj SAMO za admin/manager.
> Dopuni rls:static proverom politika. NE pokreći db push. lint + tsc + rls:static + build.
> ```
> **Ručno posle N2:** `supabase db push`.

---

### N3 — Prijem robe

**Cilj:** ono što je stiglo odmah je na stanju, bez ručne forme.

**Fajlovi**
- `app/(app)/nabavka/actions.ts` — `receiveItems(requestId, [{itemId, qty}])`: `requireRole("admin","manager","logistics")`; Logistika sme samo na zahtevu u statusu `poslat`/`delimicno`; upis `qty_received` + `received_at/by`; stanje kroz **`apply_stock_delta`** (+qty) preko `createAdminClient()`; status zahteva se računa (`delimicno` / `stiglo`); obaveštenje `restock_received` Adminu i Menadžeru
- `app/(app)/nabavka/zahtevi/[code]/receive-form.tsx` **(novo)** — po stavci: traženo · već primljeno · polje „stiglo sada"
- `lib/nav.ts` — „Nabavka" dobija `roles: ALL` **tek ako je D6 potvrđen**; za Logistiku je sekundarna stavka
- `lib/stock.ts` — eventualno izdvojiti `applyStockDelta(items)` helper ako ga `syncOrderStock` već nema kao javnu funkciju

**Odluke**
- Prijem je **idempotentan po pozivu**: šalje se „stiglo sada", server sabira; dvoklik ne sme da duplira → akcija prima i `expected_received` (stanje koje je korisnik video) i odbija ako se ne poklapa (obrazac „server ne veruje klijentu" iz T3).
- Primljeno više od traženog je **dozvoljeno** (drug je doneo više) uz upozorenje, ne grešku.
- Ispravka greške u prijemu = negativna korekcija samo za Admina, uz obavezan razlog (kao Otkazano/Vraćeno).

**Rezultat**
Logistika upiše „stiglo 10" → `stock_quantity` varijante +10, zahtev prelazi u „Delimično
stiglo"/„Stiglo", Admin dobija push. Dvostruki klik ne dodaje 20.

> **PROMPT ZA SESIJU (N3)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Nabavka.md (sekcije 0 i korak N3). N1–N2 su gotovi.
> Uradi SAMO N3 — prijem robe: receiveItems (requireRole admin+manager+logistics, Logistika samo
> na poslatom/delimičnom zahtevu), upis kroz createAdminClient, stanje kroz postojeći RPC
> apply_stock_delta (+qty), NE stampuj stock_counted_at. Zaštita od duplog prijema
> (expected_received). Admin-only negativna korekcija uz obavezan razlog. Obaveštenje
> restock_received. Ako je D6 potvrđen: „Nabavka" roles ALL u lib/nav.ts. Bez nove migracije.
> lint + tsc + rls:static + build; vizuelno kao admin i kao logistics (AppShell, 360 px) —
> Logistika NE sme da vidi nijednu cenu.
> ```

---

### N4 — QA, dozvole i dokumentacija (zatvara modul)

- `scripts/rls-test.mjs` — **dopuna**: Logistika ne vidi nacrte, ne može insert/update u `restock_*` direktno, ne dobija nijednu cenu (nema kolona); kapije ruta i akcija.
- `CLAUDE.md` — zaključane odluke u §3 (uključujući izmenjenu rečenicu o Logistici, ako je D6 potvrđen) + beleška u §10.
- Plan označiti kao urađen i premestiti u `docs/arhiva/`.

**Provere:** predlog se poklapa sa prodajom po SKU-u · prijem menja stanje tačno jednom · nepopisana varijanta je u „Prvo popiši", ne u „Hitno" · 360 px · prazna stanja („Ništa ne treba dopuniti", „Nema zahteva").

> **PROMPT ZA SESIJU (N4)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Nabavka.md (korak N4). N1–N3 su gotovi.
> Uradi SAMO N4 — dopuni scripts/rls-test.mjs (restock_* za sve tri role + kapije), QA lista,
> zaključane odluke u CLAUDE.md (§3 + §10), plan u docs/arhiva/. lint + tsc + rls:static + build.
> ```

---

## 2. Pre produkcije (čeklista)

- [ ] `supabase db push` posle N2.
- [ ] Nalog Logistike kroz `/korisnici` (bez njega N3 radi Admin/Menadžer).
- [ ] Šifre dobavljača (`supplier_sku`) popunjene na varijantama koje se često dopunjuju — bez njih spisak za druga nosi samo naš SKU.

## 3. Namerno van opsega (v1)

Kupovina robe sa računom, nabavnom cenom i plaćanjem (v. N-0) · više dobavljača · narudžbenica u PDF-u · automatsko slanje zahteva bez klika · automatski zahtev iz crona (cron i dalje samo javlja nisko stanje) · predviđanje sezonalnosti · rezervacija robe u drugovom magacinu.
