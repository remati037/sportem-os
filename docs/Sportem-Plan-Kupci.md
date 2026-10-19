# Sportem — Plan implementacije: Kupci

> Verzija 1.1 · 18.10.2026 · status: **u radu — odluke §0.2 i §0.3 potvrđene 18.10.2026; C1–C3 urađeni**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo

Stavka **Kupci** (`/kupci`, sekcija „Prodaja", trenutno „Uskoro") — **radni ekran za kupca**:
lista svih kupaca sa pretragom i filterima, i **profil kupca** na kome se na jednom mestu vidi
ko je, šta je kupovao, koliko je doneo, da li otkazuje i koji tiketi su vezani za njega.

Danas toga nema: kupac postoji samo kao ime na porudžbini i kao crveni flag „rizičan kupac".
Da bi se videla istorija jednog kupca, mora se ići porudžbinu po porudžbinu.

### 0.1 Odnos prema modulu Izveštaji (`docs/Sportem-Plan-Izvestaji.md`, R2)

R2 („Kupci" u Izveštajima) pravi **izvoze** (ponovni, top, rizični, neaktivni → CSV/PDF).
Ovaj modul je **radni ekran** (pretraga → jedan kupac → akcija). Oba stoje na **istoj funkciji
spajanja kupaca** (`db/customers.ts`, korak C1) — R2 je posle toga samo nekoliko definicija u
registru izveštaja i ne sme da pravi sopstveno spajanje. Ko god od njih krene prvi, pravi C1.

### 0.2 Odluke — POTVRĐENE 18.10.2026 (sve po predlogu)

| # | Tema | Predlog | Zašto |
|---|---|---|---|
| D1 | Ko je „jedan kupac" | **Grupa** porudžbina spojenih po **normalizovanom telefonu**, pa po **e-mailu**; bez oba → sam `customers` red | `customer_id` je nepouzdan: kupac bez telefona dobija nov `customers` red pri svakoj porudžbini (`db/customer-risk.ts`, komentar na vrhu). Isto pravilo već koristi „rizičan kupac" |
| D2 | Ime kupca | sa **najnovije** porudžbine (`ship_name`) | kupci menjaju ime primaoca; isto pravilo kao R2 |
| D3 | Pristup | **samo Admin i Menadžer** | profil pokazuje promet/zaradu i PII. Logistika već nema nijednu politiku na `customers`/`orders` |
| D4 | Novac | promet/zarada **isključivo iz zamrznutih `order_items`**, Otkazano/Vraćeno van prometa i zarade (po imenu), ali u broju porudžbina | §4 CLAUDE.md + pravilo Dashboarda |
| D5 | URL profila | `/kupci/{uuid}` — UUID **reprezentativnog `customers` reda** grupe (najnovijeg) | telefon/e-mail se **ne stavljaju u URL** (završavaju u istoriji, logovima, Sentry-ju) |
| D6 | Beleške i oznake | **da, u C3** (jedina migracija modula) | „ovaj uvek traži da se javi pre slanja" danas nema gde da stoji |
| D7 | Izmena podataka kupca | **ne** — kontakt je snapshot iz Woo-a, menja se na sajtu | app nije CRM za unos; webhook je izvor |
| D8 | Spajanje dva kupca ručno („to je ista osoba") | **van v1** | traži tabelu aliasa i menja sve zbirove; prvo videti koliko se stvarno javlja |

### 0.3 Pitanja — ODGOVORENA 18.10.2026 (sve po predlogu: fiksne oznake · 3 meseca · Menadžer piše · interni mejlovi isključeni)

1. **D6 — oznake:** fiksna lista (`Stalni kupac` · `Veleprodaja` · `Pazi — zvati pre slanja`) ili podesiva u `/podesavanja` kao tagovi tiketa? Predlog: **fiksna u v1**.
2. **„Neaktivan"** — posle koliko meseci bez kupovine? Predlog: **3**, podesivo u filteru.
3. Da li Menadžer sme da piše beleške/oznake (Admin sigurno)? Predlog: **da, oboje** (kao tiketi).
4. Interni mejlovi (`OUR_EMAILS` u `db/customer-risk.ts`) — isključiti iz liste kupaca? Predlog: **da**, iste adrese kao kod rizika.

### 0.4 Tri tehničke činjenice

**1. Normalizacija već postoji u bazi.** K4 je dodao `public.norm_phone()` i generisane kolone
`orders.ship_phone_norm` i `customers.phone_norm` sa indeksima — doslovna kopija `normalizePhone`
iz `lib/woo.ts`. Spajanje ide po njima, **ne po sirovom telefonu**.

**2. Bez paginacije svaka lista laže.** ~1.300 porudžbina i ~1.200 `customers` redova → preko
cap-a od 1000. Svi upiti kroz `selectAll` / `selectAllIn` iz `lib/supabase/paginate.ts`.

**3. Grupisanje se radi u JS-u u v1, ne u SQL-u.** Cela tabela porudžbina (bez stavki) je ~1.300
redova = dva paginirana upita; stavke se čitaju samo za zbirove kroz `selectAllIn`. To je bez
migracije i isti obrazac kao `computePeriodMetrics`. Ako K-plan (K6, `order_risk_counts`) prvi
prebaci rizik u SQL, C1 koristi tu funkciju za kolonu „otkazano". Prelazak celog grupisanja u
SQL funkciju (obrazac `offer_rule_stats`) je opcioni korak **C6**, samo ako `npm run perf` pokaže
da `/kupci` prelazi 400 ms.

### 0.5 Šta se NE dira

Zamrznute cene i `order_items` (samo čitanje) · webhook i `upsertCustomer` · `customers` šema
(osim ništa — C3 dodaje SAMO nove tabele) · RLS politike postojećih tabela · tok statusa ·
`syncOrderStock` · finansije · pravilo rizika (`db/customer-risk.ts` se samo poziva).

---

## 1. Arhitektura

```ts
// db/customers.ts  (server-only, RLS klijent korisnika)
export type CustomerKey = `p:${string}` | `e:${string}` | `c:${string}`; // telefon / e-mail / customers.id
export type CustomerGroup = {
  key: CustomerKey;            // NIKAD u URL-u ni na klijentu kao identitet — samo interno + beleške (C3)
  repId: string;               // customers.id najnovijeg reda → /kupci/{repId}
  name: string | null;         // ship_name sa najnovije porudžbine
  phone: string | null; email: string | null; city: string | null;
  orderIds: string[];
  orderCount: number;          // svi statusi
  cancelledCount: number;      // Otkazano + Vraćeno
  revenue: number; profit: number;   // bez otkazanih/vraćenih, iz order_items
  needsVpCount: number;        // porudžbine bez VP → zarada nepotpuna
  firstOrderAt: string; lastOrderAt: string;
};
export async function loadCustomerGroups(): Promise<CustomerGroup[]>;   // cache() po zahtevu
export async function getCustomerProfile(repId: string): Promise<CustomerProfile | null>;
```

**Algoritam spajanja (union-find, deterministički):** svaka porudžbina je čvor; spaja se sa
svima koje dele `ship_phone_norm` (ili `customers.phone_norm`), pa sa svima koje dele
`lower(trim(email))` (osim `OUR_EMAILS`). Tako „isti telefon, drugi mejl" i „isti mejl, drugi
telefon" završe u jednoj grupi. Ključ grupe = prvi telefon po abecedi, inače prvi mejl, inače
`c:` + najstariji `customers.id` — **stabilan** dok se ne pojavi nova porudžbina koja spaja dve
grupe (tada beleške iz C3 prate oba stara ključa — v. C3).

### Rute

| Ruta | Šta |
|---|---|
| `/kupci` | lista: pretraga (ime, telefon, e-mail, grad), filteri (ponovni · rizični · neaktivni · sa oznakom), sort (promet · zarada · broj porudžbina · poslednja kupovina), 25 po strani |
| `/kupci?q=…&filter=…&sort=…&strana=…` | sve stanje u URL-u (pretraga po telefonu ide u `q` — to je unos korisnika, ne identitet) |
| `/kupci/[id]` | profil (id = `repId`) |

---

## 2. Faze i koraci

### C1 — Spajanje kupaca + lista `/kupci` ✅ urađeno 18.10.2026 (beleška: CLAUDE.md §10 „Korak C1")

**Cilj:** lista svih kupaca koja se poklapa sa ručnim izvozom ponovnih kupaca.

**Fajlovi**
- `db/customers.ts` **(novo)** — `loadCustomerGroups()` (union-find iz §1), `listCustomers(filters)` (filtriranje/sort/strana u JS-u nad grupama)
- `app/(app)/kupci/page.tsx` **(novo)** — `requireRole("admin","manager")`, pretraga + filteri + tabela (desktop) / kartice (telefon), obrazac `/porudzbine`
- `lib/nav.ts` — skinuti `soon: true` sa stavke „Kupci"

**Odluke**
- Kolone liste: ime · grad · porudžbine (od toga otkazano) · promet · zarada · poslednja kupovina · badge „Rizičan" (≥1 otkazana/vraćena) · badge „Ponovni" (≥2 realizovane).
- Telefon i e-mail su **u pretrazi i na profilu**, ne u koloni liste (manje PII na ekranu koji se gleda preko ramena).
- Grupa bez ijedne realizovane porudžbine (sve otkazane) se prikazuje — to je upravo rizičan kupac.

**Rezultat**
`/kupci` sa filterom „ponovni" daje isti skup kao `ponovni-kupci-2026-09-08.csv` (59 kupaca na
taj dan; danas više) — isti broj porudžbina, promet i zarada po kupcu, 0 RSD razlike.
`npm run perf` (dodati sondu) < 400 ms.

> **PROMPT ZA SESIJU (C1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Kupci.md (sekcije 0, 1 i korak C1).
> PRVO mi postavi pitanja iz §0.3 i potvrdi odluke D1–D8 iz §0.2; tek onda kreni.
> Uradi SAMO C1: db/customers.ts (loadCustomerGroups — union-find po ship_phone_norm /
> customers.phone_norm, pa po lower(email) bez OUR_EMAILS; listCustomers) + /kupci strana
> (requireRole admin+manager, pretraga/filteri/sort/strana u URL-u, desktop tabela + mobilne kartice).
> Novac ISKLJUČIVO iz zamrznutih order_items; Otkazano/Vraćeno po imenu (CANCELLED_STATUS_NAMES)
> van prometa/zarade, ali u broju porudžbina. Svi upiti kroz selectAll/selectAllIn.
> Telefon/e-mail NIKAD u URL-u kao identitet. Skini soon sa „Kupci" u lib/nav.ts.
> Dodaj sondu u scripts/perf-bench.mjs. Bez migracije. lint + tsc + rls:static + build,
> vizuelna provera u pravom AppShell-u (desktop + 360 px).
> ```

---

### C2 — Profil kupca `/kupci/[id]` ✅ urađeno 18.10.2026 (beleška: CLAUDE.md §10 „Korak C2")

**Cilj:** sve o jednom kupcu na jednom ekranu.

**Fajlovi**
- `db/customers.ts` — `getCustomerProfile(repId)` (grupa kojoj `repId` pripada + porudžbine + top artikli)
- `db/tickets.ts` — `listTicketsForCustomers(customerIds)` (tiketi čiji je `customer_id` bilo koji red grupe)
- `app/(app)/kupci/[id]/page.tsx` **(novo)**

**Sadržaj profila (redom)**
1. Zaglavlje: ime, grad, `tel:` link, `mailto:` link, poslednja adresa, badge-ovi (Rizičan / Ponovni).
2. Kartice: porudžbine (od toga otkazano/vraćeno, %), promet, zarada, prosečna korpa, prva i poslednja kupovina.
3. Porudžbine kupca: broj (→ `/porudzbine/{woo}`), datum, status, vrednost, zarada — najnovije prvo.
4. Šta kupuje: artikli **po `sku`** (naziv iz `product_name` snapshot-a), komada, broj porudžbina.
5. Otkazivanja: razlozi iz `order_status_history.note` (kao alat `otkazivanja` u asistentu).
6. Tiketi: `RelatedTickets` (postojeća komponenta iz T6) sa `prefill.customer`.
7. Dugme „Pitaj asistenta" (`ask-button.tsx`) — „Analiziraj kupca {ime}: šta kupuje, koliko vredi, da li je rizičan".

**Odluke**
- Nepostojeći / tuđi `id` → `notFound()`.
- Napomena „zarada nepotpuna" kad grupa ima porudžbine bez VP (`needsVpCount > 0`).

**Rezultat**
Profil kupca sa 3+ porudžbine pokazuje iste cifre kao zbir njegovih porudžbina na `/porudzbine`;
tiket vezan za tog kupca se vidi na profilu.

> **PROMPT ZA SESIJU (C2)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Kupci.md (sekcije 0, 1 i korak C2). C1 je gotov.
> Uradi SAMO C2 — profil /kupci/[id] (id = repId iz C1): zaglavlje sa kontaktom, kartice,
> porudžbine, artikli po sku (product_name snapshot), razlozi otkazivanja iz order_status_history,
> tiketi kroz postojeći RelatedTickets (dodaj listTicketsForCustomers u db/tickets.ts) i
> „Pitaj asistenta". requireRole admin+manager, notFound za nepoznat id. Novac iz zamrznutih
> order_items. Bez migracije. lint + tsc + rls:static + build, vizuelno u AppShell-u (desktop + 360 px).
> ```

---

### C3 — Beleške i oznake (jedina migracija modula) ✅ urađeno 19.10.2026 (beleška: CLAUDE.md §10 „Korak C3")

**Cilj:** znanje o kupcu ostaje u app-u, ne u glavi.

**Fajlovi**
- `supabase/migrations/2026MMDDHHMMSS_kupci_beleske.sql` **(novo)**:
  - `customer_notes` (`id`, `customer_key text not null`, `body text not null`, `created_by uuid → auth.users on delete set null`, `created_at`, `updated_at` + trigger), index na `customer_key`
  - `customer_flags` (`customer_key text`, `flag text check (flag in (…fiksna lista iz §0.3…))`, `created_by`, `created_at`, PK `(customer_key, flag)`)
  - RLS: `*_staff_all` za admin+manager (obrazac tiketa), **nijedna politika za Logistiku**, svi pozivi u `(select …)` (K3 pravilo — inače `rls:static` pada)
- `app/(app)/kupci/actions.ts` **(novo)** — `addNote` / `editNote` / `deleteNote` (menja/briše **samo autor**, kao komentari tiketa), `setFlags` (zamena cele liste)
- `lib/validation/customers.ts` **(novo)** — zod
- `app/(app)/kupci/[id]/notes.tsx`, `flags.tsx` **(novo)**
- `app/(app)/porudzbine/[id]/page.tsx` — ispod imena kupca: oznake + poslednja beleška + link „Profil kupca"

**Odluke**
- **Ključ je `customer_key`, ne `customers.id`** — grupa se proteže preko više `customers` redova. Kad nova porudžbina spoji dve grupe, profil čita beleške **svih ključeva** koji su u toj grupi bili (računa se iz porudžbina grupe: svaki telefon i e-mail grupe je kandidat-ključ) — ništa se ne gubi i ne treba migracija podataka.
- Beleška je običan tekst kroz `Linkify` (bez markdown-a), kao komentar tiketa.
- Oznaka „Pazi — zvati pre slanja" se vidi i kao badge pored imena na **listi porudžbina** (`orders-bulk-table.tsx`), gde se biraju porudžbine za slanje — to je ceo smisao oznake. PDF liste za slanje se **ne menja** (štampa je za XExpress).

**Rezultat**
Beleška upisana na profilu vidi se i na detalju porudžbine istog kupca; Menadžer ne može da
izmeni Adminovu belešku; `npm run rls:static` prolazi sa novim politikama.

> **PROMPT ZA SESIJU (C3)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Kupci.md (sekcije 0, 1 i korak C3). C1–C2 su gotovi.
> Uradi SAMO C3 — beleške i oznake kupca. Migracija: customer_notes + customer_flags (ključ
> customer_key text, NE customers.id), RLS admin+manager, nijedna politika za logistics, svaki
> current_app_role()/auth.uid() u (select …). Akcije addNote/editNote/deleteNote (samo autor
> menja/briše — server proverava) i setFlags, zod. Profil čita beleške SVIH kandidat-ključeva grupe.
> Na detalju porudžbine: oznake + poslednja beleška + link na profil. Dopuni rls:static proverom
> politika nove migracije. NE pokreći db push — to radim ja. lint + tsc + rls:static + build.
> ```
> **Ručno posle C3:** `supabase db push`.

---

### C4 — Veze iz ostatka aplikacije + asistent

**Cilj:** do profila se stiže odakle god se kupac pojavi.

**Fajlovi**
- `app/(app)/porudzbine/[id]/page.tsx` — „Profil kupca" + „N. porudžbina ovog kupca" (iz grupe)
- `app/(app)/tiketi/[id]/linked-panel.tsx` — ime kupca vodi na `/kupci/{repId}`
- `lib/ai/tools/index.ts` — nov alat **`kupac_profil`** (samo čitanje, RLS klijent; vraća zbirove + top artikle + broj otkaza; telefon samo ako ga korisnik izričito traži, kao `porudzbina_detalj`) + `lib/ai/tool-labels.ts`
- `scripts/ai-check.ts` — dopuna: `kupac_profil` za 3 kupca = zbir njihovih porudžbina (0 RSD)

**Rezultat**
Sa detalja porudžbine i iz tiketa jedan klik do profila; asistent na „koliko je kupio Petar
Petrović" odgovara iz alata, cifra = profil.

> **PROMPT ZA SESIJU (C4)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Kupci.md (sekcije 0, 1 i korak C4). C1–C3 su gotovi.
> Uradi SAMO C4 — linkovi na profil kupca sa detalja porudžbine i iz panela vezanih zapisa tiketa,
> i AI alat kupac_profil (samo čitanje, RLS klijent, iste cifre kao profil; dopuni ai:check — 0 RSD).
> Bez migracije. lint + tsc + rls:static + build + npm run ai:check.
> ```

---

### C5 — QA, dozvole i dokumentacija (zatvara modul)

**Fajlovi**
- `scripts/rls-test.mjs` — **dopuna**: Logistika → 0 redova na `customer_notes`/`customer_flags` + odbijen insert; Menadžer → piše svoju belešku, ne menja tuđu (akcija); statička kapija da `/kupci`, `/kupci/[id]` i sve akcije zovu `requireRole("admin","manager")`
- `CLAUDE.md` — zaključane odluke modula u §3 + beleška u §10
- `docs/Sportem-Plan-Kupci.md` — korake označiti kao urađene, plan u `docs/arhiva/`

**Provere:** poklapanje sa ručnim izvozom (C1) · kupac bez telefona sa 2 porudžbine je JEDAN kupac (spojen po mejlu) · 360 px bez horizontalnog skrola · prazna stanja („Nema kupaca za ovu pretragu", „Još nema beležaka") · Logistika na `/kupci` → redirect.

> **PROMPT ZA SESIJU (C5)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Kupci.md (korak C5). C1–C4 su gotovi.
> Uradi SAMO C5 — dopuni scripts/rls-test.mjs (ne nova skripta) za customer_* tabele i kapije
> ruta, prođi QA listu, upiši zaključane odluke u CLAUDE.md (§3 + §10), označi plan kao urađen
> i premesti ga u docs/arhiva/. lint + tsc + rls:static + build.
> ```

---

### C6 — (opciono) grupisanje u SQL

Samo ako `npm run perf` za `/kupci` pređe 400 ms. Funkcija `customer_groups()` (`security invoker`,
statusi kao parametar, novac iz `order_items`) po obrascu K5/K6, uz `scripts/provera-c6.mjs` koja
poredi JS i SQL nad **svim** grupama — 0 razlike, isti članovi grupa.

---

## 3. Pre produkcije (čeklista)

- [ ] `supabase db push` posle C3 (bez toga beleške i oznake bacaju grešku; C1/C2 rade i bez nje).
- [ ] Klik-test kao Menadžer (treba nalog — `/korisnici`).

## 4. Namerno van opsega (v1)

- Ručno spajanje/razdvajanje kupaca (D8) · izmena kontakta kupca u app-u (D7) · slanje SMS/mejla kupcu iz app-a · segmenti za Meta publiku (eventualno modul Reklame) · lojalnost/popusti · blokiranje kupca u webhook-u (oznaka je samo upozorenje, nikad ne odbija porudžbinu) · pristup za Logistiku.
