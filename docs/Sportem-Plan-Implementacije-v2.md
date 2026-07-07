# Sportem App — Plan implementacije v2.0 (konačni)

**Proizvod:** Sportem app (PWA — interni operativni sistem) · **Brend:** Sportem
**Verzija plana:** 2.0 · **Status:** spreman za predaju Claude Code-u
**Prateći dokumenti:** `Sportem-Dizajn-Sistem.md` (tokeni, komponente) · `sportem-kontekst.md` (biznis kontekst)

---

## Šta je novo u v2.0 (u odnosu na v1.0)

1. **Korak 0.0 — CLAUDE.md**: fajl koji Claude Code čita na startu svake sesije; bez njega gubiš kontekst između sesija.
2. **Webhook prati i `order.updated`**: otkazivanje/refund u WooCommerce-u automatski menja status u app-u (zaključana odluka).
3. **Razrešena kontradikcija „ručna prodaja"**: sve porudžbine (i keš/lične) ulaze kroz WooCommerce; u app-u se samo označe `licno` + „Keš/Isplaćeno". Nema ručnog kreiranja porudžbine u app-u. Prazno stanje tabele iz dizajn dokumenta glasi „Nema porudžbina za ovaj period" (bez akcije „Dodaj ručnu prodaju").
4. **Faktura drugu = cifra + spisak u app-u** (bez PDF fakture; zaključana odluka).
5. **Edit stavki porudžbine** (kupac doda artikal / promeni količinu) — dodato u 1.2, samo Admin.
6. **Tehničke konvencije** (sekcija ispod): timezone, tipovi cena, PDF biblioteka, webhook sigurnost, arhiviranje.
7. **Seed podaci i lokalni razvoj** dodati u 0.4; **Sentry monitoring** u 0.6; prošireni QA kriterijumi u 1.10.

---

## Kako raditi sa Claude Code-om (workflow)

1. **Jedan korak plana = jedna Claude Code sesija/task.** Ne daj mu ceo plan odjednom — daj mu CLAUDE.md (uvek u repo-u) + tekst konkretnog koraka.
2. **Prompt šablon po koraku:**
   > „Radimo Korak X.Y iz plana (zalepi ceo korak: opis, zadaci, rezultat). Pročitaj CLAUDE.md. Implementiraj, pa mi pokaži šta si uradio i kako da verifikujem Rezultat."
3. **Posle svakog koraka:** proveri „Rezultat" (definiciju gotovog) svojim rukama, pa commit. Ne prelazi na sledeći korak dok rezultat ne stoji.
4. **Kad Claude Code predloži skretanje sa plana** (druga biblioteka, druga šema): dozvoli samo ako ne dira zaključane odluke i zamrznute cene. Sve promene odluka upiši u CLAUDE.md.
5. **Migracije baze uvek kroz `supabase/migrations`** — nikad ručne izmene šeme kroz Supabase dashboard (da lokalni i produkcioni ostanu u sync-u).

---

## Zaključane odluke (ne menjaju se bez izmene ovog dokumenta)

- PWA (web + instalabilna + full responsive), online-only, push notifikacije u Fazi 1. Email nije u Fazi 1.
- Tri role: **Admin** (sve) / **Menadžer** (svi Sportem podaci, bez izmene finansija) / **Logistika** (samo stanje/naziv/slike artikala; **ne vidi MP, VP, profit ni bilo koje finansije — kolone se ne renderuju, ne blur**).
- Sopstvena baza (Supabase) je jedini izvor istine; Sheets izlazi iz sistema.
- **Sve porudžbine ulaze kroz WooCommerce webhook** — i XExpress i lične/keš prodaje. U app-u nema ručnog kreiranja porudžbina.
- Webhook prati **`order.created` i `order.updated`** (otkazivanja/refund se sinhronizuju automatski).
- **Zamrznute cene (snapshot)** — centralni princip, vidi sekciju ispod.
- App je glavni katalog (cene i proizvodi se menjaju tu); WooCommerce se po potrebi ažurira ručno.
- Statusi porudžbine su podesiva lista: Kreirano → Poslato → Isporučeno → Otkazano/Vraćeno.
- Svaki proizvod ima bar jednu varijantu (i bez pravih varijanti — „default" varijanta); porudžbina uvek gađa varijantu po SKU.
- Poštarina/težina/broj paketa se popunjavaju na koraku „Poslato", ne na kreiranju.
- **Faktura drugu = automatski izračunata cifra + spisak porudžbina/stavki u app-u.** Bez PDF fakture.
- Troškovi ne diraju fakturu; reklame se unose zbirno i ručno; bez ponavljajućih troškova.
- Meta integracija, XExpress API i auto-decrement inventara NISU u Fazi 1.
- Auth: Supabase Auth — 3 fiksna interna korisnika + 1 vendor, bez javne registracije, native RLS.

---

## Centralni princip: zamrznute cene (snapshot)

Razlog: u Sheetsu se desio bag — promena cene je retroaktivno promenila zaradu starih porudžbina.

- **Katalog** (`product_variants`) drži *trenutne* MP, VP, zaradu.
- **Stavke porudžbine** (`order_items`) u trenutku kreiranja **kopiraju** tadašnju MP, VP, zaradu i zamrznu ih.
- Svi izveštaji/fakture/profit čitaju **isključivo** iz zamrznutih stavki, nikad iz kataloga.
- Edit MP na konkretnoj stavci (popust) menja samo zamrznutu vrednost te stavke; VP i katalog se ne diraju.
- Ovaj princip važi i za backfill (1.3) i za edit stavki (1.2).

---

## Tehnološki stack

- **Framework:** Next.js (App Router) + TypeScript.
- **Stilizacija:** Tailwind CSS + shadcn/ui, prebojen po `Sportem-Dizajn-Sistem.md`.
- **Baza + Auth + Storage:** Supabase (Postgres, Supabase Auth, Storage za slike, native RLS). Migracije preko Supabase CLI.
- **Hosting + cron:** Vercel (auto-deploy sa GitHub-a, Vercel Cron).
- **PWA:** Serwist (service worker, manifest, push).
- **Validacija:** zod na svim server akcijama i API rutama.
- **PDF (lista za slanje):** `@react-pdf/renderer` — radi na Vercel serverless bez headless browsera. (Puppeteer/Chromium NE koristiti — težak za Vercel.)
- **Monitoring:** Sentry (besplatan tier) — greške servera i klijenta.

## Tehničke konvencije (Claude Code ih poštuje svuda)

- **Timezone: `Europe/Belgrade`** za sve — T+1 logiku uplata, cron poslove, datume porudžbina, izveštaje. Cron izrazi na Vercelu su UTC → preračunati (npr. nedelja 20:00 Beograd = nedelja 18:00/19:00 UTC zavisno od letnjeg računanja; koristiti date-fns-tz za logiku, cron postaviti na fiksni UTC i tolerisati ±1h pomeranje, ili dva cron unosa).
- **Cene: `integer` u RSD, bez decimala** (12500 = 12.500 RSD). Bez float tipova bilo gde u finansijama. Prikaz kroz `rsd()` helper iz dizajn dokumenta.
- **Generisane kolone u Postgres-u:** `profit = mp_price - vp_price` (katalog) i `profit_at_sale = (mp_at_sale - vp_at_sale) * quantity` (stavke) kao `GENERATED ALWAYS AS ... STORED`.
- **Soft delete / arhiviranje:** proizvodi i varijante se **ne brišu** ako imaju istorijske porudžbine — dobijaju `archived_at`. Arhivirani ne izlaze u pretrazi/izboru, ali istorija i izveštaji ostaju netaknuti.
- **Webhook sigurnost:** provera WooCommerce HMAC potpisa (`x-wc-webhook-signature`) na svakom pozivu; odbaciti bez validnog potpisa; ruta ne sme da otkriva ništa u error odgovorima.
- **Idempotentnost:** upsert po `woo_order_id` — ponovljeni webhook (Woo retry) ne pravi duplikate.
- **RLS je izvor sigurnosti, UI je samo higijena** — svaka provera pristupa mora da postoji na nivou baze/servera, ne samo u navigaciji.
- **Sav UI tekst na srpskom**, sa punim dijakriticima (č, ć, š, ž, đ).

---

## Preduslovi (pre Faze 0)

1. **GitHub** privatni repo.
2. **Vercel** nalog povezan sa repo-om.
3. **Supabase** projekat (Postgres, Auth, Storage bucket za slike).
4. **WooCommerce**: admin pristup na `sportem.rs`, REST API ključevi (consumer key/secret), mogućnost dodavanja webhook-a + webhook secret.
5. **Domen** `app.sportem.rs` (DNS pristup).
6. **Brend materijali**: logo, potvrđen hex zelene (`#1B7A45` sa sajta), font odluke iz dizajn dokumenta.
7. **Izvozni podaci**: Sheets katalog (SKU/naziv/opis/MP/VP) i istorijske porudžbine (za backfill, uključujući VP koje su tada važile).
8. **Lista korisnika**: mejlovi + role — Admin (ti), Menadžer (brat), Logistika (drug).
9. **Sentry** nalog (besplatan).

---

# FAZA 0 — Postavka projekta

Cilj: skelet aplikacije, deploy radi, baza i auth povezani, brend i PWA postavljeni.

### Korak 0.0 — CLAUDE.md i kontekst repo-a
- **Opis:** Fajl u root-u repo-a koji Claude Code automatski čita — mora da sadrži sve što je potrebno da bilo koja sesija radi ispravno bez ponovnog objašnjavanja.
- **Zadaci:**
  - Kreirati `CLAUDE.md` sa: kratkim opisom projekta, zaključanim odlukama, principom zamrznutih cena, tehničkim konvencijama (timezone, integer cene, soft delete, RLS pravilo za logistiku), strukturom foldera, komandama (`npm run dev`, `supabase db push`, testovi).
  - U repo staviti i `docs/` folder sa: `Sportem-Plan-Implementacije-v2.md`, `Sportem-Dizajn-Sistem.md`, `sportem-kontekst.md`.
  - U CLAUDE.md upisati pravilo: „Pre bilo koje izmene šeme baze pročitaj docs/kontekst; migracije samo kroz supabase/migrations; nikad ne diraj snapshot logiku bez eksplicitne potvrde."
- **Rezultat:** Nova Claude Code sesija zna sve bitno čim se otvori; docs u repo-u.

### Korak 0.1 — Inicijalizacija projekta
- **Zadaci:**
  - `create-next-app` sa TypeScript, App Router, ESLint.
  - Struktura foldera: `app/`, `components/`, `lib/`, `db/`, `supabase/`.
  - Prettier + ESLint, `.env.example` (svi ključevi popisani sa opisom), `README`.
  - Inicijalni commit i push.
- **Rezultat:** Prazan app radi lokalno (`npm run dev`).

### Korak 0.2 — Dizajn sistem i brend tokeni
- **Opis:** Implementacija tokena **1:1 iz `Sportem-Dizajn-Sistem.md`** (taj dokument je izvor istine — boje, tipografija Geist/Geist Mono, radijusi, senke, bazne klase, tnum brojevi).
- **Zadaci:**
  - CSS varijable u `globals.css` (sekcija 5.1 dizajn dokumenta), Tailwind config (5.2), fontovi kroz `next/font` (5.3), bazne klase (5.4).
  - `rsd()` i `num()` helperi (sekcija 7).
  - Test stranica sa svim komponentama (dugmad, kartice, pilule, input, tabela) radi vizuelne potvrde.
- **Rezultat:** Test stranica potvrđuje light/clean/premium izgled iz dizajn dokumenta.

### Korak 0.3 — UI komponente (shadcn/ui)
- **Zadaci:**
  - Inicijalizovati shadcn/ui, mapirati HSL temu (sekcija 5.5 dizajn dokumenta).
  - Komponente: Button, Card, Input, Select, Dialog, Toast, Tabs, Table, Badge, Dropdown, Skeleton.
  - Reusable obrasci: data tabela (sortiranje, pretraga, sticky header, desno poravnate `.num` kolone), forma sa zod validacijom, prazno stanje, loading skeleton, error stanje.
- **Rezultat:** Biblioteka komponenti u brendu, spremna za sve ekrane.

### Korak 0.4 — Baza, migracije i seed (Supabase)
- **Zadaci:**
  - Supabase projekat + env ključevi; Supabase CLI i migracioni tok (`supabase/migrations`); **lokalni razvoj kroz `supabase start`** (lokalna Postgres instanca) da se ne razvija direktno na produkcionoj bazi.
  - Šeme (sve cene `integer` RSD):
    - `profiles` — user_id (FK auth), full_name, role (`admin`/`manager`/`logistics`).
    - `categories` — name, sort_order.
    - `products` — name, description, brand, image, category_id, `archived_at`.
    - `product_variants` — sku (unique), product_id, variant_name, mp_price, vp_price, profit (generated), stock_quantity, low_stock_threshold (def 5), supplier_sku, weight_grams, image, `archived_at`.
    - `customers` — name, phone (unique, dedup), email, adresa (poslednja poznata).
    - `order_statuses` — name, sort_order, color (podesivo).
    - `orders` — woo_order_id (unique), customer_id, status_id, invoice_id (nullable), payout_id (nullable), delivery_method (`xexpress`/`licno`), payment_status (`neuplaceno`/`uplaceno`/`kes`), adresa snapshot (json ili kolone), goods_total, shipping_charged, shipping_actual, cod_amount, package_count, weight_grams, needs_vp (bool flag), datumi: created_at, shipped_at, delivered_at, paid_at, cancelled_at.
    - `order_items` — order_id, variant_id (nullable — za nepoznat SKU), **snapshot:** sku, product_name, quantity, mp_at_sale, vp_at_sale (nullable), profit_at_sale (generated, null dok nema VP).
    - `invoices` — invoice_number, period_from, period_to, total_amount, status (`nefakturisano` ne postoji kao red — faktura nastaje tek kad se izda), created_at.
    - `payouts` — amount, payout_date, delivery_date (T+1 izvedeno), notes.
    - `expense_categories` + `expenses` — amount, date, category_id, description, attachment (Storage path).
    - `push_subscriptions` — user_id, subscription json, created_at.
    - `notification_log` — type, reference_id, sent_at (sprečava duplikate).
  - Prva migracija + **seed skripta**: početni statusi, kategorije troškova (Reklame, Pakovanje, Ostalo), 3 test proizvoda sa varijantama, test porudžbine — da se svaki ekran može razvijati i testirati bez produkcionih podataka.
- **Rezultat:** Sve tabele postoje, migracije rade lokalno i na produkciji, seed puni bazu za razvoj.

### Korak 0.5 — Autentifikacija i role (Supabase Auth + RLS)
- **Zadaci:**
  - Supabase Auth, sign-in stranica u brendu, bez javne registracije; 4 korisnika kreirana ručno (3 interna + vendor).
  - RLS politike po roli na **svim** tabelama. Ključno: logistika vidi `products`/`product_variants` samo kroz **restriktovani view** (bez mp_price, vp_price, profit) ili column-level GRANT; sve finansijske tabele (orders, order_items, invoices, payouts, expenses) logistici potpuno nedostupne.
  - Middleware zaštita ruta; helper funkcije `getUser()`, `requireRole()` za server akcije.
  - **Test RLS-a:** automatizovan test ili skripta koja se loguje kao logistika i potvrđuje da SELECT na cene pada.
- **Rezultat:** Svaka rola vidi tačno svoj opseg; finansije nedostupne logistici na nivou baze, dokazano testom.

### Korak 0.6 — Deploy, okruženje i monitoring (Vercel + Sentry)
- **Zadaci:**
  - GitHub → Vercel auto-deploy na `main`; preview deploy na PR.
  - Env varijable (Supabase, webhook secret, kasnije VAPID) u Vercel.
  - `app.sportem.rs` DNS → Vercel.
  - Sentry integracija (server + client), test da greška stiže u dashboard.
- **Rezultat:** Produkcioni URL radi, login online, greške se vide u Sentry-ju.

### Korak 0.7 — PWA skelet (Serwist)
- **Zadaci:**
  - Serwist (service worker, caching), `manifest.json` („Sportem", standalone, theme boje iz tokena).
  - Ikonice 192/512 + maskable, splash u brendu.
  - Test instalacije na Android (bratov telefon) i desktop.
- **Rezultat:** „Add to Home Screen" radi; app standalone.

### Korak 0.8 — Layout i navigacija po rolama
- **Zadaci:**
  - Sidebar (desktop) / bottom nav (mobilni) po dizajn dokumentu.
  - Navigacija filtrirana po roli: Admin (sve), Menadžer (sve osim izmene finansija), Logistika (samo Katalog/Stanje).
  - Standard za server akcije: zod validacija + jedinstven error/toast obrazac.
- **Rezultat:** Navigacioni skelet kroz prazne ekrane, ispravno gejtovan po roli.

---

# FAZA 1 — MVP

Cilj: ceo dnevni i dvonedeljni operativni tok na jednom mestu. Sheets izlazi iz upotrebe.

### Korak 1.1 — Katalog (proizvodi, varijante, SKU)
- **Zadaci:**
  - CRUD za kategorije, proizvode, varijante (arhiviranje umesto brisanja kad postoje istorijske stavke).
  - Varijanta: SKU (unique), naziv, MP, VP, zarada (generated), stanje, low stock prag, dobavljačeva šifra, težina, slika.
  - **SKU grupisanje:** osnova = proizvod, sufiks posle crtice = varijanta (`SM021-4` → pod `SM021`); proizvodi bez varijanti dobijaju „default" varijantu.
  - **Import iz Sheets-a:** jednokratni CSV/XLSX uvoz sa mapiranjem kolona i grupisanjem po osnovi SKU; **dry-run pregled** pre upisa; izveštaj o preskočenim/problematičnim redovima.
  - Upload slika u Supabase Storage (kompresija/resize na uploadu).
  - Pretraga/filter: naziv, SKU, kategorija, low stock; logistika vidi svoju restriktovanu verziju istog ekrana.
- **Rezultat:** Kompletan katalog u app-u, uvezen iz Sheets-a; cene i stanje se menjaju ovde.

### Korak 1.2 — Porudžbine: WooCommerce webhook + zamrznute cene
- **Zadaci:**
  - API ruta za webhook sa HMAC proverom potpisa; registrovati u Woo-u **dva webhooka: `order.created` i `order.updated`**, oba ka istoj ruti.
  - `order.created` (status „processing"): upsert u `orders` (woo_order_id, kupac, adresa snapshot, iznosi, datum), dedup kupca po telefonu.
  - `order.updated`: ako je porudžbina u Woo-u otkazana/refundirana → status u app-u ide u „Otkazano/Vraćeno" (uz zapis kada i zašto). Ako je porudžbina već fakturisana/uplaćena, ne menjati automatski — flagovati za ručnu odluku admina (upozorenje na dashboardu).
  - Za svaku stavku: po SKU naći varijantu i **kopirati MP, VP, zaradu u `order_items`** (snapshot).
  - **Edge case — nepoznat SKU:** stavka se kreira sa sku + product_name + mp_at_sale, `vp_at_sale` prazno → porudžbina flag `needs_vp`; kad admin naknadno unese VP (na stavci ili poveže varijantu), flag se skida.
  - **Edit stavki (samo Admin):** izmena mp_at_sale (popust), izmena količine, brisanje stavke, dodavanje stavke iz kataloga (snapshot u trenutku dodavanja). Sve izmene menjaju samo zamrznute vrednosti te porudžbine — katalog netaknut. Blokirati edit ako je porudžbina već fakturisana.
  - **Idempotentnost:** ponovljeni webhook za isti woo_order_id ažurira, ne duplira.
- **Rezultat:** Porudžbine (i otkazivanja) ulaze automatski sa zamrznutim cenama; problematične jasno flagovane; admin može da koriguje stavke bez rizika po istoriju.

### Korak 1.3 — Backfill istorijskih porudžbina
- **Zadaci:**
  - Skripta povlači istorijske porudžbine kroz WooCommerce REST API (paginacija, biran period).
  - `orders` + `order_items` sa **cenama koje su tada važile** (VP iz Sheets istorije ako ga Woo ne nosi), nikad iz današnjeg kataloga.
  - Mapiranje starih statusa, delivery_method (`xexpress`/`licno`), i oznaka **fakturisano/uplaćeno** — da stare porudžbine ne uđu u „drug mi duguje" ni u novu fakturu.
  - Dedup kupaca po telefonu; nepoznat SKU / bez VP → `needs_vp`.
  - **Idempotentan uvoz** po woo_order_id + obavezan **dry-run** pre upisa.
  - Verifikacija: zbir istorijske zarade iz app-a = kontrolni zbir iz Sheets-a za isti period.
- **Rezultat:** Istorija u bazi sa tačnim zamrznutim ciframa; bez duplikata i dvostrukih dugovanja.

### Korak 1.4 — Statusi i lista porudžbina
- **Zadaci:**
  - Lista: filteri po statusu, načinu isporuke, datumu, kupcu, payment_status, `needs_vp`; pretraga po broju/imenu/telefonu.
  - Detalj: stavke (zamrznute cene), kupac, adresa, iznosi, istorija promena statusa (ko i kada).
  - Promena statusa kroz tok; statusi/boje podesivi u podešavanjima.
  - **Keš/lična prodaja:** porudžbina se označi `licno` + akcija „Keš/Isplaćeno" → odmah `delivered_at` + `paid_at` + payment_status `kes`. Ne ulazi u fakturu, prati se u izveštajima.
- **Rezultat:** Sve porudžbine na jednom mestu; tok i keš prodaja jasno vidljivi.

### Korak 1.5 — Logistika i slanje (PDF + korak „Poslato")
- **Zadaci:**
  - Selekcija porudžbina za slanje (nedelja/sreda uveče) → **PDF za štampu** kroz `@react-pdf/renderer`: po porudžbini ime, telefon, adresa, otkupnina (COD), artikli, broj paketa. Format A4 pogodan za štampanje i nošenje.
  - Korak „Poslato": tu se popunjavaju **naplaćena poštarina, stvarna poštarina (može i naknadno po XExpress specifikaciji), težina, broj paketa**.
  - Brat prijavi pošiljke u XExpress aplikaciji → u app-u bulk označavanje „Poslato" (`shipped_at`).
- **Rezultat:** PDF iz app-a zamenjuje Sheets skriptu; podaci o paketu upisani na pravom koraku.

### Korak 1.6 — Finansije (payout, faktura, poštarina, keš)
- **Opis:** Srce sistema — tri toka novca. Sve cifre iz zamrznutih stavki.
- **Zadaci:**
  - **Uplate (payouts), T+1 po Beogradu:** dnevni unos iznosa koji je XExpress uplatio; app predloži porudžbine isporučene na T−1 radni dan (uplata ponedeljak → isporučeno petak); admin potvrdi/koriguje vezivanje; porudžbine → „uplaćeno" (`paid_at`). Prikaz razlike ako se zbir COD-a vezanih porudžbina ne poklapa sa uplatom.
  - **Spisak za druga:** za svaku uplatu generisati spisak (porudžbina + artikli + količine) koji drug kuca u kasi — pregled u app-u + dugme za kopiranje/štampu.
  - **Faktura drugu (2 nedelje):** automatski Σ `profit_at_sale` za porudžbine: XExpress + isporučeno + uplaćeno + nefakturisano + bez `needs_vp`. Ekran fakture = broj, period, ukupna cifra + **spisak porudžbina sa zaradom po porudžbini** (bez PDF-a). Izdavanjem fakture porudžbine dobijaju `invoice_id` (ne mogu ponovo ući u fakturu). Porudžbine sa `needs_vp` se ne fakturišu dok se VP ne unese — jasno upozorenje.
  - **„Drug mi duguje"** = Σ nefakturisane zarade (isporučeno + uplaćeno) — uvek vidljivo.
  - **Saldo poštarine** (prolazna stavka, nije profit): Σ(naplaćeno − stvarno), van fakture, zaseban prikaz sa istorijom i mogućnošću „reset/poravnato keš" zapisa.
  - **Neto profit** = zarada − troškovi (period).
- **Rezultat:** Faktura se sklapa automatski iz zamrznutih zarada; „drug mi duguje", saldo poštarine i keš prodaja tačni i odvojeni.

### Korak 1.7 — Troškovi
- **Zadaci:**
  - CRUD kategorija i troškova (iznos, datum, kategorija, opis, prilog u Storage).
  - Reklame zbirno i ručno kao kategorija.
  - Troškovi ulaze u neto profit, nikad u fakturu.
- **Rezultat:** Troškovi evidentirani i kategorizovani.

### Korak 1.8 — Dashboard
- **Zadaci:**
  - Stat kartice: zarada, neto profit, broj porudžbina, prosečna marža (period).
  - **„Drug mi duguje"** i **saldo poštarine**.
  - Low stock lista (varijante ≤ prag).
  - Porudžbine koje čekaju: `needs_vp`, spremno za slanje, isporučeno-a-neuplaćeno, otkazano-posle-fakture (upozorenje iz 1.2).
  - Filteri po periodu (dan/nedelja/mesec/custom).
- **Rezultat:** Sve ključne cifre na jednom ekranu, u svakom trenutku.

### Korak 1.9 — Push notifikacije
- **Zadaci:**
  - VAPID ključevi, čuvanje subscription-a po korisniku, slanje kroz server.
  - Vercel Cron (UTC preračunat na Beograd) + okidači: nova porudžbina, podsetnik za pripremu slanja (nedelja/sreda uveče), low stock, isporučeno-a-neuplaćeno, podsetnik na fakturu (2 nedelje).
  - `notification_log` — bez duplikata; notifikacije poštuju role (logistika samo low stock).
- **Rezultat:** Tim dobija podsetnike na vreme, na svim uređajima.

### Korak 1.10 — Bezbednost, QA i lansiranje
- **Zadaci:**
  - Prolaz kroz sve API rute/server akcije: autorizacija + zod validacija; ponovni RLS test za logistiku (automatizovano).
  - **Finansijska verifikacija na realnim podacima:** jedan ceo dvonedeljni ciklus paralelno sa Sheets-om — faktura, „drug duguje", saldo poštarine, keš prodaja moraju da se poklope sa Sheets ciframa.
  - QA na realnim uređajima (bratov Android, tvoj desktop): webhook (kreiranje + otkazivanje), PDF štampa, push, cron, import kataloga, backfill.
  - Test edge case-ova: nepoznat SKU, otkazivanje fakturisane porudžbine, dupli webhook, porudžbina sa popustom.
  - Posle 1–2 čista paralelna ciklusa: **gašenje Make scenarija i Sheets toka**.
  - Lansiranje + Sentry alarmi uključeni.
- **Rezultat:** MVP u produkciji, finansijski verifikovan; Sheets van sistema.

---

# FAZA 2/3 — Proširenja

### Korak 2.1 — XExpress API integracija
- Automatsko kreiranje pošiljki, realni statusi isporuke nazad u app, auto cenovnik poštarine po težini.

### Korak 2.2 — Auto-decrement inventara
- Skidanje stanja varijante na definisan status; pravila za zajednički magacin (drug ima i druge kupce) — korekcije i usklađivanje.

### Korak 2.3 — Meta Ads integracija
- Povlačenje potrošnje/rezultata kampanja, vezivanje za period i neto profit; opciono workflow za vizuale/opise (Higgsfield + Claude).

### Korak 2.4 — Normalizacija prljavih podataka iz Woo-a
- Normalizacija telefona (pouzdaniji dedup), parsiranje adresa za etikete i XExpress.

---

## Definicija gotovog po fazama

- **Faza 0:** App se deplojuje na `app.sportem.rs`, login radi, baza + RLS + seed postavljeni, brend implementiran, PWA instalabilna, Sentry živ, CLAUDE.md u repo-u.
- **Faza 1 (MVP):** Porudžbine (i otkazivanja) ulaze webhook-om sa zamrznutim cenama; katalog uvezen; backfill završen i verifikovan; PDF slanje, finansije (payout/faktura/poštarina/keš), troškovi, dashboard i push rade; jedan paralelan ciklus se poklopio sa Sheets-om; Sheets ugašen.
- **Faza 2/3:** XExpress API, auto-decrement, Meta Ads, normalizacija — uživo.

## Zavisnosti

- 1.2 zavisi od 1.1 (katalog mora postojati da snapshot uhvati MP/VP).
- 1.3 zavisi od 1.1 i 1.2; pokrenuti pre nego što finansije/dashboard krenu „uživo".
- 1.5 i 1.6 zavise od 1.2 i 1.4.
- 1.6 (faktura) zavisi od tačnog `profit_at_sale` i rešenih `needs_vp` flagova.
- 1.9 zavisi od 0.7 (Serwist).
- Cela Faza 1 zavisi od 0.5 (RLS — skrivanje finansija od logistike).
- 2.1 i 2.2 zavise od stabilne Faze 1.

---

*Kraj plana — v2.0 · Sportem App*
