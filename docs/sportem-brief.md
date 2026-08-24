# Sportem OS — kompletan brief

> **Namena ovog dokumenta.** Ovo je jedan fajl koji sadrži sve o Sportem aplikaciji: biznis, ljude, tokove novca, tehničku arhitekturu, sva pravila i formule, istoriju odluka, stanje danas, poznate bagove i planirane korake. Ubacuje se u Claude projekat kao izvor konteksta — kad se postavi bilo koje pitanje o Sportemu, odgovor treba da dolazi odavde.
>
> **Stanje na dan:** 01.08.2026. · **Grana:** `main` @ `9c3c4c9` (+ nekomitovan rad na automatskom skidanju zaliha)
> **Kodbaza:** ~20.000 linija TS/TSX, 956 linija SQL migracija, 34 rute, 55 server akcija, 18 tabela.

---

## Sadržaj

1. [Šta je Sportem](#1-šta-je-sportem)
2. [Ljudi i role](#2-ljudi-i-role)
3. [Operativni ritam](#3-operativni-ritam)
4. [Tokovi novca](#4-tokovi-novca)
5. [Ustav — pravila koja se ne krše](#5-ustav--pravila-koja-se-ne-krše)
6. [Tehnološki stack i struktura repoa](#6-tehnološki-stack-i-struktura-repoa)
7. [Model podataka](#7-model-podataka)
8. [Sigurnost, auth i RLS](#8-sigurnost-auth-i-rls)
9. [Integracije](#9-integracije)
10. [Ekran po ekran](#10-ekran-po-ekran)
11. [Poslovna pravila i formule](#11-poslovna-pravila-i-formule)
12. [Istorija odluka i promena odluka](#12-istorija-odluka-i-promena-odluka)
13. [Stanje sistema danas](#13-stanje-sistema-danas)
14. [Poslovna slika iz podataka](#14-poslovna-slika-iz-podataka)
15. [Poznati bagovi i tehnički dug](#15-poznati-bagovi-i-tehnički-dug)
16. [Šta NIJE urađeno](#16-šta-nije-urađeno)
17. [Predlozi novih funkcionalnosti](#17-predlozi-novih-funkcionalnosti)
18. [Predloženi redosled rada](#18-predloženi-redosled-rada)
19. [Operativni podsetnici](#19-operativni-podsetnici)
20. [Rečnik pojmova](#20-rečnik-pojmova)
21. [Kako odgovarati na pitanja o Sportemu](#21-kako-odgovarati-na-pitanja-o-sportemu)

---

## 1. Šta je Sportem

**Biznis:** ecommerce sportske/fitnes opreme u Srbiji. Sajt `sportem.rs` — WordPress + WooCommerce. Vlasništvo: korisnik (Marko) i njegov brat. Marketing: Meta Ads (trenutno usporeno), vizuali kroz Higgsfield, tekstovi uz pomoć Claude-a.

**Sportem app (interno „Sportem OS"):** PWA — web aplikacija, instalabilna na telefon, potpuno responzivna, **online-only** (nema offline režima za podatke). To je interni operativni sistem koji na jednom mestu drži:

- porudžbine (ulaze automatski iz WooCommerce-a)
- katalog i inventar (proizvodi, varijante, SKU, cene, stanje)
- finansije (zarada, marža, uplate, fakture, poštarina, keš)
- troškove
- dashboard sa ključnim ciframa
- nisko stanje i push/email obaveštenja

**Šta zamenjuje:** dosadašnji tok Google Sheets + Make automatizacije. Taj tok je pravio greške (najpoznatija: promena cene retroaktivno menjala zaradu starih porudžbina) i trošio vreme.

**Produkcioni URL:** `app.sportem.rs` (Vercel, auto-deploy sa `main`).

**Obim:** ~219 proizvoda / 372 varijante, ~1045 porudžbina, ~960 kupaca, promet reda 300k–1M RSD mesečno.

---

## 2. Ljudi i role

Tri role u sistemu (`profiles.role`: `admin` / `manager` / `logistics`). Nema javne registracije — korisnike dodaje Admin iz aplikacije (`/korisnici` → invite e-mailom).

| Rola | Ko je | Šta sme |
|---|---|---|
| **Admin** | Korisnik (Marko) | Sve. Finansije, cene, fakture, troškovi, korisnici, izmena porudžbina i stavki. |
| **Menadžer** | Brat | Vidi sve Sportem podatke (porudžbine, zarada, izveštaji, katalog sa cenama). **Ne menja finansije.** Fizički prijavljuje pošiljke u XExpress aplikaciji i vozi lične dostave. |
| **Logistika** | Drug (dobavljač) | **Samo katalog bez cena.** Vidi naziv, SKU, sliku, stanje, prag niskog stanja, težinu. **Ne vidi MP, VP, profit ni bilo koje finansije — te kolone mu ne stižu ni u payload, ne postoji „blur".** Jedina write akcija: popis zaliha (unos količine). |

**Ključno o Logistici:** drug je dobavljač od koga se roba uzima po VP cenama i on drži fizički magacin. Magacin je **zajednički** — drug ima i druge kupce, Sportem nema svoj stok. Zato drug ima nalog u aplikaciji samo za stanje artikala.

**Navigacija po roli** (`lib/nav.ts` — filtriranje je higijena, prava zaštita je RLS):

| Stavka | Admin | Menadžer | Logistika |
|---|:-:|:-:|:-:|
| Dashboard `/` | ✅ | ✅ | ❌ |
| Porudžbine `/porudzbine` | ✅ | ✅ | ❌ |
| Katalog `/katalog` | ✅ | ✅ | ✅ (bez cena) |
| Finansije `/finansije` | ✅ | ✅ (čita) | ❌ |
| Troškovi `/troskovi` | ✅ | ✅ (čita) | ❌ |
| Korisnici `/korisnici` | ✅ | ❌ | ❌ |
| Obaveštenja `/obavestenja` | ✅ | ✅ | ✅ |
| Podešavanja `/podesavanja` | ✅ | ✅ | ✅ |

---

## 3. Operativni ritam

**Dnevno:**
- Porudžbine padnu na WooCommerce (status `processing`) → webhook ih odmah upiše u app → push obaveštenje „Nova porudžbina" Adminu i Menadžeru.
- XExpress uplaćuje novac drugu; drug uplaćuje Sportemu → Admin unosi uplatu (payout) u `/finansije/uplate`.
- Uveče (19–20h po Beogradu) cron šalje dnevna obaveštenja: nisko stanje, isporučeno-a-neuplaćeno.

**Nedeljno (dva puta):**
- **Nedelja i sreda uveče:** Admin označi porudžbine za slanje → app generiše **PDF listu za štampu** (`/api/porudzbine/lista-za-slanje`). Cron tim danima šalje podsetnik „Podsetnik za slanje".
- **Ponedeljak i četvrtak:** brat nosi papire, **ručno prijavljuje pošiljke u XExpress aplikaciji** (nema API integracije), pa se u app-u porudžbine bulk-označe „Poslato".

**Na 10 dana:**
- XExpress šalje drugu fakturu poštarine (specifikacija + 20% PDV). Admin je unosi u `/finansije/postarina/fakture` da bi rekonsilijovao naplaćeno vs. stvarno.

**Na 2 nedelje:**
- Admin pravi **fakturu drugu** (`/finansije/fakture`) — iznos = zbir zarada iz uplata koje još nisu fakturisane. Drug uplaćuje na račun firme. Cron 1. i 15. u mesecu šalje podsetnik.

**Povremeno:**
- Brat vozi porudžbine po Beogradu ili kupac lično preuzme u magacinu i plati keš → porudžbina se u app-u označi kao **lična + keš**.

---

## 4. Tokovi novca

Sve porudžbine ulaze kroz WooCommerce. Razlikuju se po načinu isporuke (`delivery_method`: `xexpress` ili `licno`).

### Tok A — XExpress porudžbina (glavni tok)

1. Kupac plaća **otkupninu** kuriru = vrednost robe (MP) + naplaćena poštarina.
2. XExpress uplaćuje **celu otkupninu drugu** na račun njegove firme.
3. Drug plaća XExpress-u stvarnu dostavu (na 10 dana, po njihovoj specifikaciji + 20% PDV).
4. Drug plaća **Sportemu zaradu** (MP − VP) na 2 nedelje, po fakturi koju Admin napravi u app-u.
5. Kod druga ostaje: VP (njegova nabavna cena) + razlika u poštarini.

**T+1 pravilo uplata:** ako pare legnu u ponedeljak → odnose se na pošiljke isporučene u **petak** (prethodni radni dan). Utorak → ponedeljak, itd. App pred-čekira kandidate po tom pravilu, ali Admin može da koriguje.

### Tok B — lična / keš prodaja

- Korisnik uzme pun keš (MP) odmah od kupca, i drugu odmah keš da VP.
- U app-u se porudžbina označi akcijom **„Keš/Isplaćeno"** → odmah `delivered_at` + `paid_at` + `payment_status = 'kes'` + status Isporučeno.
- **Ne ulazi u fakturu** — stavka je zatvorena u trenutku prodaje. Prati se samo radi izveštaja i zarade.

### Poštarina — prolazna stavka, NIJE profit

- Brat na osnovu težine doda poštarinu na otkupninu (npr. 1.500 roba + 400 dostava = 1.900 otkup).
- Razlika između **naplaćene** (`shipping_charged`) i **stvarne** poštarine (`shipping_actual`, osnovica) je Sportem-ova, ali se rešava **van fakture**:
  - plus → drug donese keš za taj plus
  - minus → Sportem doda drugu da pokrije XExpress
- App prati taj saldo odvojeno (`/finansije/postarina`) i ima akciju **„Poravnaj keš"** koja upisuje settlement i vraća saldo na 0.
- **Od uvođenja XExpress faktura, stvarna poštarina se poredi kao osnovica + 20% PDV.**

### Faktura drugu

- Admin je pravi sam u app-u, šalje drugu, drug uplaćuje.
- **Iznos = Σ zarada (MP − VP) iz uplata koje još nisu ni na jednoj fakturi.** (Ranije: po pojedinačnim porudžbinama — promenjeno, v. sekciju 12.)
- **Nema PDF fakture** — faktura je cifra + spisak u app-u.
- Troškovi i poštarina **ne ulaze** u fakturu.

### Tri cifre koje app mora uvek da zna

| Cifra | Definicija | Gde se vidi |
|---|---|---|
| **Drug mi duguje** | Σ zarade nefakturisanih uplata | `/finansije/fakture` |
| **Neto profit** | zarada − troškovi (za period) | Dashboard |
| **Saldo poštarine** | Σ(naplaćeno − stvarno sa PDV-om) − Σ poravnanja | `/finansije/postarina` |

---

## 5. Ustav — pravila koja se ne krše

Ovo su tvrda pravila. Svako odstupanje traži eksplicitnu potvrdu korisnika.

### 5.1 Zamrznute cene (snapshot) — najvažnije pravilo

**Razlog postojanja:** u Sheetsu se desio bag — podizanje cene je retroaktivno promenilo zaradu starih porudžbina, pa istorija više nije bila tačna.

- **Katalog** (`product_variants`) drži *trenutne* MP, VP, zaradu.
- **Stavke porudžbine** (`order_items`) u trenutku kreiranja **kopiraju** tadašnju MP, VP i **zamrznu ih** (`mp_at_sale`, `vp_at_sale`, `profit_at_sale`).
- Svi izveštaji, fakture, dashboard, profit — čitaju **isključivo** iz zamrznutih stavki, **nikad iz kataloga**.
- Edit MP na konkretnoj stavci (popust) menja **samo** zamrznutu vrednost te stavke; VP i katalog se ne diraju.
- Važi i za backfill istorije i za ručnu izmenu stavki.

**Provereno auditom:** nijedno čitanje `mp_price`/`vp_price` iz kataloga u finansijskoj logici. Ustav se poštuje svuda, uključujući najnoviji kod.

**Edge case — nepoznat SKU:** kad SKU sa Woo-a ne nađe varijantu (nov proizvod neunet u app), stavka se kreira sa `sku` + `product_name` + `mp_at_sale`, a `vp_at_sale` ostaje prazno → porudžbina dobija flag `needs_vp`. Kad Admin naknadno unese VP, flag se skida i profit postaje tačan.

### 5.2 Ostala tvrda pravila

- **Cene su `integer` u RSD, bez decimala** (12500 = 12.500 RSD). **Nema float tipova nigde u finansijama.** Prikaz kroz `rsd()` helper.
- **Timezone `Europe/Belgrade` za sve** — T+1 logika, cron, datumi porudžbina, izveštaji, mesečne granice. Implementirano kroz `Intl` + `timeZone: "Europe/Belgrade"` (`lib/format.ts`, `lib/date-belgrade.ts`, `lib/period.ts`), **ne** kroz `date-fns-tz`.
- **Migracije samo kroz `supabase/migrations`** — nikad ručne izmene šeme kroz Supabase dashboard. Cloud + CLI, **bez Docker-a** (ne koristi se `supabase start`).
- **RLS je izvor sigurnosti, UI je samo higijena.** Svaka provera pristupa mora postojati na nivou baze ili servera, ne samo u navigaciji.
- **Statusi se traže po IMENU, nikad po hardkodovanom UUID-u** (`APP_STATUS` u `lib/woo.ts`).
- **Soft delete:** proizvodi i varijante se ne brišu ako imaju istorijske porudžbine — dobijaju `archived_at`.
- **Idempotentnost webhook-a:** upsert po `woo_order_id`, ponovljeni Woo retry ne pravi duplikate.
- **Sav UI tekst na srpskom sa punim dijakriticima** (č, ć, š, ž, đ). Provereno — nijedan string bez njih.
- **`zod` validacija na svim server akcijama i API rutama.**
- **Nema ručnog kreiranja porudžbina u app-u** — sve ulazi kroz WooCommerce webhook, uključujući keš/lične prodaje.
- **Svaki proizvod ima bar jednu varijantu** (i bez pravih varijanti — „default" varijanta); porudžbina uvek gađa varijantu po SKU.

### 5.3 SKU sistem

- Osnova šifre = proizvod; sufiks posle crtice = varijanta.
- Bez varijante: `SM015` (Gumene trake).
- Sa varijantama: `SM021-4` (HEX bučice 5 kg) — sve HEX bučice dele osnovu `SM021`.
- Posledica za CSV uvoz: varijante se automatski grupišu po osnovi šifre.
- SKU u WooCommerce-u je identičan onom u app katalogu — na osnovu njega webhook spaja stavku sa varijantom i VP cenom.

---

## 6. Tehnološki stack i struktura repoa

### Stack

| Sloj | Izbor | Napomena |
|---|---|---|
| Framework | **Next.js 16.2.10** (App Router) + TypeScript 5 + React 19 | |
| Build | **`next build --webpack`** | OBAVEZNO — Serwist radi kroz webpack; Turbopack tiho ne generiše `sw.js` |
| Stilizacija | Tailwind CSS 4 + shadcn/ui (radix-ui) | prebojeno po `docs/Sportem-Dizajn-Sistem.md` |
| Baza / Auth / Storage | **Supabase** (Postgres, Supabase Auth, Storage, native RLS) | migracije kroz Supabase CLI, cloud bez Docker-a |
| Hosting + cron | **Vercel** (auto-deploy sa `main`, preview na PR, Vercel Cron) | |
| PWA | **Serwist 9** (`@serwist/next`) | online-only keš |
| PDF | **`@react-pdf/renderer`** | Puppeteer/Chromium se NE koristi |
| Monitoring | **Sentry** (`@sentry/nextjs`), tracing 0.1, Session Replay isključen | tunnel `/monitoring-tunnel` |
| Push | **`web-push`** (VAPID) | |
| Email | **Resend** | opcioni kanal po korisniku |
| Validacija | **zod 4** | |
| Tabele | TanStack Table 8 | |
| Forme | react-hook-form + @hookform/resolvers | |
| CSV | papaparse | |
| Slike | sharp (resize na uploadu, generisanje ikonica) | |

### Struktura foldera

```
app/
  (app)/                    # zaštićene rute (AppShell + auth)
    page.tsx                # Dashboard
    porudzbine/             # lista, detalj [id], akcije
    katalog/                # lista, detalj [id], uvoz/
    finansije/              # uplate/, fakture/, postarina/
    troskovi/
    korisnici/              # admin-only
    obavestenja/
    podesavanja/
    stil/                   # dizajn showcase (BEZ role guarda — poznat nalaz)
  api/
    webhooks/woo/           # ulaz porudžbina
    cron/notifikacije/      # dnevni cron
    push/subscribe|unsubscribe/
    porudzbine/lista-za-slanje/  # PDF
  auth/callback/
  prijava/ · postavi-lozinku/
  sw.ts · manifest.ts · layout.tsx · global-error.tsx
components/
  ui/                       # shadcn primitivi
  patterns/                 # data-table, confirm-dialog, reason-dialog, empty-state…
  layout/                   # app-shell, sidebar, bottom-nav
  push/ · pwa/ · auth/
db/                         # upiti nad bazom (server-only)
  orders.ts · finance.ts · catalog.ts · metrics.ts · dashboard.ts
  expenses.ts · customer-risk.ts · catalog-types.ts
lib/
  auth.ts · roles.ts · nav.ts · format.ts · period.ts · date-belgrade.ts
  woo.ts · woo-client.ts · push.ts · email.ts · notifications.ts
  stock.ts · storage.ts · image-url.ts · actions.ts · utils.ts
  supabase/ (client, server, admin, middleware)
  validation/ (catalog, orders, finance, expenses, push, uuid)
supabase/
  migrations/               # 15 migracija — JEDINI put za izmenu šeme
  seed.sql                  # trajni bootstrap (statusi + kategorije troškova)
  dev-fixtures.sql · dev-fixtures-teardown.sql · profiles.sql
scripts/
  woo-backfill.mjs · woo-webhook-test.mjs · rls-test.mjs
  generate-icons.mjs · fix-goods-total.mjs
docs/                       # izvori istine
proxy.ts                    # Next 16 „proxy" (bivši middleware) — zaštita ruta
```

### Komande

```bash
npm run dev             # lokalni dev (Turbopack; SW isključen u dev-u)
npm run build           # next build --webpack  ← OBAVEZNO webpack
npm start
npm run lint · format · format:check
npm run icons           # generisanje PWA ikonica (sharp)
npm run rls:test        # dokaz da Logistika ne vidi cene/finansije
npm run woo:test        # 30+ provera webhook-a (traži npm run dev)
npm run backfill        # dry-run istorijskog uvoza
npm run backfill:apply  # stvarni uvoz
supabase db push        # primena migracija na cloud
```

### Dizajn sistem (sažeto)

Tema: **light · clean · premium**. Sadržaj (brojevi, tabele, statusi) je glavni junak; zelena se troši štedljivo, samo na akcijama.

| Token | Hex | Upotreba |
|---|---|---|
| `paper` | `#F5F7F5` | pozadina app-a |
| `surface` | `#FFFFFF` | kartice, paneli |
| `surface-2` | `#FAFBFA` | header tabele, alt redovi |
| `ink` | `#15211B` | primarni tekst |
| `ink-soft` | `#5A6B62` | sekundarni tekst |
| `ink-faint` | `#8A988F` | placeholder, caption |
| `border` | `#E4E9E5` | hairline borderi |
| `green` | `#1B7A45` | **brend zelena** — primarno dugme, akcenat |
| `green-deep` | `#145C34` | hover/active |
| `green-soft` | `#E7F2EB` | tint pozadina, selektovan red |

Statusne boje: `info` `#3D6B8C` · `sent` `#0E7C86` · `success` `#1B7A45` · `warning` `#A86A12` · `danger` `#B23B30`.

Font: **Geist** (UI) + **Geist Mono** (SKU, brojevi porudžbina, fakture). Svi brojevi koriste `tnum` (tabularne cifre) i poravnati su desno. Tap mete min. **40px** (dokument to traži — u praksi se često krši, v. sekciju 15).

---

## 7. Model podataka

18 tabela, sve sa uključenim RLS-om. Sve cene `integer` RSD.

### 7.1 Katalog

**`categories`** — `id`, `name`, `sort_order`, `created_at`

**`products`** — `id`, `name`, `description`, `brand`, `image` (Storage path), `category_id` → categories (SET NULL), `attribute_names text[]` (npr. `{Boja, Dužina}`), `archived_at` (soft delete), `created_at`, `updated_at`

**`product_variants`** — srce kataloga:
| Kolona | Tip | Napomena |
|---|---|---|
| `product_id` | uuid → products (RESTRICT) | |
| `sku` | text **UNIQUE** | spaja Woo stavku sa varijantom |
| `variant_name` | text | |
| `mp_price` | int | maloprodajna |
| `vp_price` | int | veleprodajna |
| `profit` | int **GENERATED** | `mp_price - vp_price` STORED |
| `stock_quantity` | int not null default 0 | **sme u minus** |
| `low_stock_threshold` | int not null default 5 | |
| `supplier_sku`, `weight_grams`, `image` | | |
| `attributes` | jsonb | npr. `{"Boja":"Crvena"}` |
| `stock_counted_at` | timestamptz | **null = količina nikad uneta** („Fali količina") |
| `stock_counted_by` | uuid → auth.users | |
| `archived_at` | timestamptz | soft delete |

**View `product_variants_public`** (`security_invoker = false`) — ono što Logistika sme da vidi: `id, product_id, sku, variant_name, stock_quantity, low_stock_threshold, supplier_sku, weight_grams, image, archived_at, attributes, stock_counted_at`. **Nema `mp_price`, `vp_price`, `profit`.**

### 7.2 Porudžbine

**`customers`** — `name`, `phone` (**UNIQUE**, dedup), `email`, `address`, `city`, `postal_code`

**`order_statuses`** — podesiva lookup tabela. Seed (fiksni UUID-jevi):

| UUID (skraćeno) | Ime | Sort | Boja |
|---|---|---|---|
| `…0a01` | Kreirano | 1 | `#6B7280` |
| `…0a02` | Poslato | 2 | `#2563EB` |
| `…0a03` | Isporučeno | 3 | `#1B7A45` |
| `…0a04` | Otkazano | 4 | `#DC2626` |
| `…0a05` | Vraćeno | 5 | `#D97706` |

**`orders`**:
| Grupa | Kolone |
|---|---|
| Identitet | `id`, `woo_order_id bigint UNIQUE`, `customer_id`, `status_id` |
| Veze | `invoice_id`, `payout_id`, `xexpress_invoice_id` (sve SET NULL) |
| Tok | `delivery_method` (`xexpress`\|`licno`), `payment_status` (`neuplaceno`\|`uplaceno`\|`kes`) |
| Adresa (snapshot) | `ship_name`, `ship_phone`, `ship_address`, `ship_city`, `ship_postal_code`, `ship_note` |
| Iznosi | `goods_total`, `shipping_charged`, `shipping_actual`, `cod_amount`, `package_count`, `weight_grams` |
| Flagovi | `needs_vp`, `needs_review`, `review_reason`, `woo_status`, `stock_applied` |
| Datumi | `ordered_at`, `shipped_at`, `delivered_at`, `paid_at`, `cancelled_at` |

**`order_items`** — **ZAMRZNUTE CENE**:
- `order_id` → orders (CASCADE), `variant_id` → product_variants (SET NULL, **nullable** za nepoznat SKU)
- `sku`, `product_name` (snapshot), `quantity`
- `mp_at_sale` int not null (editabilno = popust), `vp_at_sale` int **nullable**
- `profit_at_sale` int **GENERATED** `(mp_at_sale - vp_at_sale) * quantity` STORED — **null dok nema VP**

**`order_status_history`** — `order_id`, `from_status_id`, `to_status_id`, `changed_by` (null = sistem/webhook), `note` (obavezan pri otkazivanju/vraćanju), `created_at`

### 7.3 Finansije

**`payouts`** — uplate od druga: `amount`, `payout_date`, `delivery_date` (T+1 izvedeno), `notes`, `invoice_id` → invoices (SET NULL; **null = nefakturisana, kandidat za fakturu**)

**`invoices`** — fakture drugu: `invoice_number text UNIQUE` (ručni unos), `period_from`, `period_to`, `total_amount` (Σ profit u trenutku izdavanja), `status` (`izdato`\|`placeno`)

**`postage_settlements`** — append-only ledger poravnanja poštarine: `amount int` **sa predznakom** (+ = drug doneo keš, − = Sportem dodao drugu), `settled_at`, `balance_before` (snapshot salda), `notes`, `created_by`

**`xexpress_invoices`** — fakture poštarine od XExpress-a: `invoice_number` (opciono, parcijalni UNIQUE), `invoice_date`, `period_from/to`, `vat_rate int default 20` (snapshot stope), `notes`, `created_by`

**View `order_profit`** (`security_invoker = true`) — `select order_id, sum(profit_at_sale) as profit from order_items group by order_id`. Jedini put do zarade po porudžbini.

### 7.4 Troškovi

**`expense_categories`** — `name`, `sort_order`. Seed: Reklame, Pakovanje, Ostalo.
**`expenses`** — `amount`, `date`, `category_id` (SET NULL), `description`, `attachment_path` (privatni Storage)

### 7.5 Korisnici i obaveštenja

**`profiles`** — `id` → auth.users (CASCADE), `full_name`, `role` (`admin`\|`manager`\|`logistics`, text + CHECK)
**`push_subscriptions`** — `user_id`, `subscription jsonb`, unique po `(user_id, endpoint)`
**`notification_log`** — `type`, `reference_id`, `sent_at`; **unique `(type, reference_id)`** = dedup obaveštenja
**`notification_preferences`** — `user_id` PK, `enabled bool` (master prekidač), `prefs jsonb` `{"<type>": {push, email}}`, `updated_at`

### 7.6 RPC funkcije

- **`public.current_app_role()`** — `SECURITY DEFINER`, `search_path = ''`, vraća `profiles.role` za `auth.uid()`. Koriste je sve RLS politike.
- **`public.apply_stock_delta(p_items jsonb)`** — `SECURITY DEFINER`, jedan atomični `UPDATE product_variants set stock_quantity = stock_quantity + delta`. Grant samo `service_role`. *(Nekomitovano — migracija još nije na produkciji.)*

### 7.7 Storage bucket-i

| Bucket | Javnost | Sadržaj | Pristup |
|---|---|---|---|
| `product-images` | javan | slike proizvoda/varijanti | čitaju svi authenticated; piše Admin |
| `expense-attachments` | **privatan** (5 MiB, slike + PDF) | prilozi troškova | select admin+manager, write admin; prikaz **isključivo kroz signed URL (1h)** |

### 7.8 Migracije hronološki

| Fajl | Šta donosi |
|---|---|
| `20260708164149_init_schema` | cela osnovna šema, 14 tabela, RLS deny-by-default |
| `20260708172800_rls_policies` | `current_app_role()`, view `product_variants_public`, sve politike po roli |
| `20260709100000_storage_product_images` | javni bucket slika |
| `20260709140000_variant_attributes` | `products.attribute_names`, `product_variants.attributes` |
| `20260709150000_orders_webhook` | `woo_status`, `needs_review`, `review_reason` |
| `20260709160000_order_status_history` | istorija promena statusa |
| `20260710120000_finansije` | `postage_settlements`, view `order_profit` |
| `20260710140000_storage_expense_attachments` | privatni bucket priloga |
| `20260711120000_notification_preferences` | preference obaveštenja |
| `20260712120000_low_stock_default_5` | ujednačavanje praga na 5 |
| `20260712140000_split_cancel_return_status` | „Otkazano/Vraćeno" → dva statusa |
| `20260721120000_xexpress_invoices` | XExpress fakture + `orders.xexpress_invoice_id` |
| `20260722120000_payout_invoice_link` | `payouts.invoice_id` (faktura po uplatama) |
| `20260731120000_stock_count` | `stock_counted_at/by` + backfill popisa |
| `20260731140000_order_stock_decrement` | `orders.stock_applied` + `apply_stock_delta` **← NIJE NA PRODUKCIJI** |

---

## 8. Sigurnost, auth i RLS

### Auth

- **Supabase Auth**, bez javne registracije (`enable_signup = false`).
- Prvi Admin kreiran ručno u Supabase dashboardu + povezan kroz `supabase/profiles.sql`.
- Ostale korisnike Admin dodaje **iz aplikacije** (`/korisnici`) → `auth.admin.inviteUserByEmail` + upis `profiles` reda sa rolom. Pozvani postavlja lozinku kroz `/auth/callback` → `/postavi-lozinku`.
- Zaštita ruta: **`proxy.ts`** (Next 16 konvencija, bivši `middleware.ts`) — refreshuje sesiju, redirektuje neulogovane na `/prijava`. Javne rute: `/prijava`, `/postavi-lozinku`, `/auth/*`, `/api/webhooks`, `/api/cron`, `sw.js`, `manifest.webmanifest`.
- Helperi: `getUser()`, `getProfile()`, `requireUser()`, `requireRole()` u `lib/auth.ts`.
- **`getClaims()` kriptografski verifikuje JWT** (provereno), nije slepo dekodiranje.

### RLS model

Supabase koristi **jednu Postgres rolu `authenticated`** za sve ulogovane korisnike — zato se razlika po roli pravi kroz `current_app_role()`, a **column-level GRANT nije izvodljiv**. Otud restriktovani view za Logistiku.

| Tabela | SELECT | WRITE |
|---|---|---|
| `profiles` | svoj red ili Admin | Admin |
| `categories`, `products`, `order_statuses` | svi authenticated | Admin |
| `product_variants` | **admin + manager** | Admin |
| `product_variants_public` (view) | svi authenticated | — |
| `customers`, `orders`, `order_items`, `order_status_history` | admin + manager | Admin |
| `invoices`, `payouts`, `postage_settlements`, `xexpress_invoices` | admin + manager | Admin |
| `expenses`, `expense_categories` | admin + manager | Admin |
| `push_subscriptions`, `notification_preferences` | svoj red | svoj red |
| `notification_log` | RLS on, bez politika = **samo service-role** |

**Menadžer je read-only na nivou RLS-a.** Ciljani write (promena statusa, poštarina) ide kroz **service-role klijent** (`lib/supabase/admin.ts`) uz `requireRole()` guard na serveru. Service role zaobilazi RLS i koristi se za: webhook, cron, invite, popis Logistike, izmene statusa.

### Šta je audit potvrdio kao bezbedno

- Logistika ne dolazi do cena **nijednim putem** — ni kroz `product_variants` (RLS), ni kroz view (nema tih kolona), ni kroz PostgREST embed, ni kroz `order_profit` (`security_invoker = true`), ni kroz RPC, ni kroz storage, ni kroz PDF rutu (403).
- RLS uključen na **svih 18 tabela**, nijedna bez politike.
- Svih ~45 server akcija ima autorizaciju. Nema IDOR-a. Eskalacija role zatvorena.
- Service-role ključ nikad ne dospeva u klijentski bundle; nijedan `NEXT_PUBLIC_*` ne nosi tajnu.
- Nula `dangerouslySetInnerHTML`. CSRF pokriven. Open redirect na `/auth/callback` testiran — nije iskoristiv.
- **Nema kritičnih sigurnosnih nalaza.**

(Ozbiljni sigurnosni nalazi B1–B4 su u sekciji 15.)

---

## 9. Integracije

### 9.1 WooCommerce webhook (ULAZ — Woo → app)

**Ruta:** `app/api/webhooks/woo/route.ts`. Oba Woo webhook-a (`order.created`, `order.updated`) gađaju istu rutu.

- **Sigurnost:** HMAC-SHA256 (base64) nad **sirovim telom**, `timingSafeEqual`, header `x-wc-webhook-signature`, tajna `WOO_WEBHOOK_SECRET`.
- **Odgovori:** pogrešan potpis → **401 prazno** · nevalidan payload → **200 + Sentry** (da Woo ne retry-uje) · interna greška → **500** (Woo retry, idempotentno) · Woo „ping" → 200.
- **Stavke se upisuju SAMO pri prvom prijemu.** `order.updated` **nikad** ne dira `order_items`, iznose, adresu ni kupca — sinhronizuje samo `woo_status` i otkazivanje. Izmene stavki Admin unosi ručno. (Odluka korisnika — štiti snapshot i admin popuste.)
- **Snapshot pri kreiranju:** `mp_at_sale = round(line.total / quantity)` (stvarno naplaćeno posle popusta, fallback `price`); `vp_at_sale` = trenutni `vp_price` varijante pronađene po SKU. `goods_total` = Σ line totals.
- **Kupac:** telefon normalizovan (`+381`/`00381`/`381` → `0…`) pre dedup-a po `customers.phone`.
- **Otkazivanje:** Woo `refunded` → app **„Vraćeno"**; `cancelled`/`failed`/`trash` → app **„Otkazano"**; oba postavljaju `cancelled_at`.
- **Guard:** ako je porudžbina već fakturisana ILI `payment_status != 'neuplaceno'` → status se **ne menja**, postavlja se `needs_review` + `review_reason` (Admin odlučuje ručno).
- `completed` u Woo-u **ne pomera** app status — Poslato/Isporučeno vodi app.
- `delivery_method` default `'xexpress'`; lične/keš se ručno označavaju. `cod_amount` samo za `payment_method = 'cod'`.
- **Push:** nova porudžbina okida `notifyRoles("new_order", …)` sa `reference_id = woo_order_id` (dedup na retry).
- **Test:** `npm run woo:test` — 30+ provera (snapshot, idempotentnost, needs_vp, otkazivanje, needs_review guard, potpis, ping, dedup telefona, zalihe).

### 9.2 Status sync (IZLAZ — app → Woo)

**Klijent:** `lib/woo-client.ts` (`updateWooOrderStatus`, `server-only`, 10s timeout). PUT `/orders/{woo_order_id}`, Basic auth iz `WOO_API_URL` + `WOO_CONSUMER_KEY` + `WOO_CONSUMER_SECRET` (ključ mora imati **Write** dozvolu).

**Mapiranje** (`wooStatusForApp()`):

| App status | Woo status |
|---|---|
| Kreirano | `processing` |
| Poslato | `processing` (Woo nema poseban) |
| Isporučeno | `completed` |
| Otkazano | `cancelled` |
| Vraćeno | `cancelled` (Woo ne razlikuje) |
| custom (ne-seed) | `null` — ne gura se |

**Best-effort:** push ide **posle** uspešnog DB update-a i upisa u `order_status_history`. Woo greška → Sentry + upozorenje „(WooCommerce nije ažuriran — proveri kasnije.)" u poruci akcije. **Nikad ne obara ni rollback-uje app promenu** — app je izvor istine.

**Nema petlje** app→Woo→webhook→app: webhook reaguje samo na otkazane Woo statuse, a guard `!existing.cancelled_at` sprečava reobradu.

### 9.3 Backfill istorije

**Skripta:** `scripts/woo-backfill.mjs` · `npm run backfill` (dry-run) / `backfill:apply`.

- **Izvor istine = `docs/backfill/porudzbine.csv`** (finalni Sheets izvoz, 941 porudžbina, 02.02–08.07.2026). Woo REST API se koristi samo za `--reconcile` jer Woo **ne nosi VP ni zaradu**.
- **VP rekonstrukcija:** `mp_at_sale = Cena` (po komadu), `vp_at_sale = round(Cena − Zarada/Količina)`. Reprodukuje CSV zaradu sa **0 RSD greške** na svih 1571 stavki. Prazna zarada (145 stavki) → `vp_at_sale` null + `needs_vp`.
- **Izolacija iz živih finansija:** istorijske plaćene xexpress porudžbine su vezane za sintetičku fakturu **`ISTORIJA-BACKFILL`** (isključuje ih iz „drug mi duguje" i novih faktura); lične+plaćene → `payment_status='kes'` bez fakture; otvorene (Processing/Poslato) → `neuplaceno`, teku u živi app.
- Idempotentno po `woo_order_id`.

### 9.4 XExpress

**Nema API integracije** — brat ručno prijavljuje pošiljke u XExpress aplikaciji, pa se u app-u označe „Poslato". XExpress API je Faza 2.

Postoji samo **rekonsilijacija faktura poštarine** (`/finansije/postarina/fakture`): unosi se osnovica po porudžbini, app dodaje 20% PDV i poredi sa naplaćenim kupcima.

### 9.5 Push i email

**Push (`lib/push.ts`, `server-only`):**
- `notifyRoles(type, referenceId, roles, payload)` → kroz service-role nađe pretplate korisnika traženih rola, pa fan-out `webpush.sendNotification` (`Promise.allSettled`, `urgency=high`).
- **Redosled:** pretplate se traže PRE dedup log-a — ako niko nije pretplaćen, ne troši se dedup ključ.
- **Dedup:** insert `(type, reference_id)` u `notification_log` → `23505` znači „već poslato", izlazi.
- Mrtvi endpoint (`410`/`404`) se **briše** iz `push_subscriptions` (self-cleanup).
- **Nikad ne baca** (best-effort, Sentry). Bez VAPID ključeva → tiho no-op.
- SW handleri u `app/sw.ts`: `push` → `showNotification`; `notificationclick` → fokus prozora + navigacija.
- Pretplata je **per-uređaj** (svaki browser/telefon zasebno), toggle na `/obavestenja`. Radi **samo u prod build-u** (SW isključen u dev-u).

**Email (`lib/email.ts`, Resend):** `sendEmail(to, subject, body, url)`. Bez `RESEND_API_KEY` tiho no-op. `EMAIL_FROM` default `obavestenja@sportem.rs`. Adresa se čita iz auth-a (`auth.admin.getUserById`) — `profiles` je ne drži.

**Preference:** master prekidač `enabled` + po tipu izbor kanala (push / email / oba). Default za korisnike bez reda: **sve uključeno, kanal = push**.

**Tipovi obaveštenja** (`lib/notifications.ts`):

| Tip | Labela | Ko može dobiti |
|---|---|---|
| `new_order` | Nova porudžbina | admin, manager |
| `prep_reminder` | Podsetnik za slanje | admin, manager |
| `low_stock` | Nisko stanje | admin, manager, **logistics** |
| `delivered_unpaid` | Isporučeno a neuplaćeno | admin, manager |
| `invoice_reminder` | Podsetnik za fakturu | admin, manager |
| `risky_customer` | Rizičan kupac | admin, manager |

**Logistika u praksi dobija samo `low_stock`** (zaključana odluka).

### 9.6 Cron

**Jedan dnevni unos** (`vercel.json`): `0 18 * * *` UTC ≈ 19–20h po Beogradu (tolerisano ±1h zbog letnjeg računanja).

**Ruta:** `app/api/cron/notifikacije/route.ts` (GET, guard `Authorization: Bearer ${CRON_SECRET}` → 401 prazno). Ruta sama bira šta šalje po danu/datumu (Beograd):

| Kada | Šta |
|---|---|
| svaki dan | nisko stanje (sve role) + isporučeno-neuplaćeno (staff) |
| nedelja i sreda | podsetnik za pripremu slanja (staff) |
| 1. i 15. u mesecu | podsetnik na fakturu — broji nefakturisane uplate (staff) |

---

## 10. Ekran po ekran

### `/` — Dashboard (Admin, Menadžer)

- **Filter perioda:** dan / nedelja / mesec / custom (`lib/period.ts`, default tekući mesec).
- **Četiri metrike za period:** Zarada · Neto profit · Porudžbine · Marža.
  - **Osnova:** sve porudžbine **kreirane** u periodu (`ordered_at` po Beogradu).
  - **Porudžbine broje SVE** uključujući Otkazano/Vraćeno.
  - **Zarada / promet / marža isključuju Otkazano/Vraćeno.**
  - Sve iz zamrznutih `order_items`, troškovi iz `expenses` po `date`.
- **„Porudžbine koje čekaju"** i **„Niska zaliha"** liste; ispod liste stoji koliko varijanti nema unetu količinu + link `/katalog?popis=fali`.
- Kartice „Za fakturisanje" i „Saldo poštarine" su **uklonjene** sa Dashboarda (v. sekciju 12).
- `orders-refresh.tsx` radi `router.refresh()` svakih 60 s.

### `/porudzbine` — lista

- **Filteri u drawer-u** (desna ivica na desktopu, dno na telefonu): status, način isporuke, datum, `payment_status`, `needs_vp`, rizičan kupac.
- Pretraga po imenu / telefonu / broju porudžbine / atributu.
- Traka **„Za ovaj filter"**: Zarada / Promet / Marža. *(Danas prikazuje 0 RSD — bug Ž1.)*
- **Bulk akcije** kroz dropdown: „Označi poslato", promena statusa (do 200 porudžbina po potezu).
- Kursorska paginacija, badge-ovi statusa, „Rizičan kupac" flag.
- **PDF lista za slanje** — selekcija → `/api/porudzbine/lista-za-slanje` (A4, ime/telefon/adresa/otkupnina/artikli/paketi).

### `/porudzbine/[id]` — detalj

**URL prima Woo broj** (npr. `/porudzbine/2419`); UUID i dalje radi kao rezerva.

- Stavke sa **zamrznutim cenama**, kupac, adresa, iznosi, istorija statusa (ko i kada).
- **Izmena stavki (Admin):** izmena `mp_at_sale` (popust), količine, brisanje, dodavanje iz kataloga (snapshot trenutnih cena), unos VP (`setItemVp` auto-sinhronizuje `needs_vp`). **Sve blokirano kad je `invoice_id` postavljen.**
- **Brzi tok:** Poslato · Isporučeno · Otkaži · Vrati · Keš.
- **Otkazivanje i vraćanje traže obavezan razlog** (`ReasonDialog`) — server odbija prazan `note`.
- **Plaćena/fakturisana porudžbina:** prelazak u Otkazano/Vraćeno vraća `requiresForce: true` → dijalog „Ipak nastavi" šalje `force=true`. **`force` je Admin-only.** Force menja samo `status_id` + `cancelled_at`; **oznaka „plaćeno" se NE dira** (novac je stvarno primljen, povraćaj je van app-a).
- **Forma paketa:** naplaćena poštarina, stvarna poštarina, težina, broj paketa.
- Promena statusa gura status i u WooCommerce (best-effort).

### `/katalog` — lista i detalj

- Lista: pretraga, kategorija, paginacija, čekboks filteri **„Stanje 0"** i **„Fali količina"** (+ `?popis=fali` iz URL-a).
- **Popis se radi isključivo na detalju proizvoda** (`variants-table.tsx`) — kolona „Stanje" postaje kontrola za Admina i Logistiku.
- CRUD proizvoda, varijanti, kategorija; upload slika (resize kroz sharp); arhiviranje umesto brisanja kad postoje istorijske stavke.
- **`/katalog/uvoz`** — CSV uvoz sa mapiranjem kolona, grupisanjem po osnovi SKU i dry-run pregledom. **⚠ Trenutno destruktivan** — v. sekciju 15.
- **Logistika vidi isti ekran bez cenovnih kolona** (izvor je restriktovani view — cene ne stižu ni u payload).

### `/finansije` — redirect na `/finansije/uplate`

Overview stranica sa 3 kartice je **obrisana**. Tabovi: Uplate · Fakture · Poštarina.

**`/finansije/uplate`** — unos uplate (payout):
- Predlog kandidata = svi **isporučeni + neuplaćeni + xexpress**, pred-čekiran **T−1 radni dan**.
- Vezivanje → `payment_status = 'uplaceno'` + `paid_at` + `payout_id`.
- Detalj uplate: 4 kartice (Uplaćeno / Σ otkupnina / Poštarina / Razlika) + **Spisak uplate** (lista artikala „Naziv xKol" + zbirovi MP/VP/Dostava/Zarada) sa Kopiraj/Štampaj.
- Badge **„Fakturisano"** na uplatama koje su već na fakturi.
- Brisanje uplate vraća `payment_status`/`paid_at`; fakturisane vezane porudžbine se ne smeju odvezati.

**`/finansije/fakture`** — faktura drugu:
- **Kandidati su UPLATE** (`payouts` sa `invoice_id = null`), ne pojedinačne porudžbine.
- Broj fakture = **ručni unos** (UNIQUE → srpska poruka na `23505`).
- Izdavanje postavlja `payouts.invoice_id` **i kaskadno `orders.invoice_id`** → stavke se zaključavaju.
- Brisanje re-otvara kandidate; **`placeno` faktura i `ISTORIJA-BACKFILL` su zaštićeni**.
- `needs_vp` porudžbine unutar nefakturisane uplate daju vidljivo upozorenje (ne blokiraju).

**`/finansije/postarina`** — saldo + XExpress fakture:
- `gross = Σ(shipping_charged − withPdv(shipping_actual))`, `settled = Σ postage_settlements.amount`, `balance = gross − settled` (**sme biti negativan**).
- „Poravnaj keš" → settlement `amount = balance` → saldo 0; `balance_before` snima stanje.
- **XExpress fakture:** kandidati = **Isporučeno ILI Vraćeno** + `xexpress` + `xexpress_invoice_id = null`, najnovije prvo, sa pretragom. *(Vraćene se takođe šalju pa se plaća poštarina; Otkazane ne.)*
- Forma piše **i `shipping_charged` i `shipping_actual`** (pre-popunjeno iz porudžbine).
- **Watermark:** `min(ordered_at)` porudžbina koje su već na nekoj XExpress fakturi je granica — sve starije trajno nestaje iz liste kandidata. Prva faktura postavlja granicu.
- P&L po fakturi: naplaćeno kupcima vs. (osnovica + 20% PDV) = zarada / gubitak / poklapa se.

### `/troskovi` (Admin piše, Menadžer čita)

Filter po mesecu (`?mesec=YYYY-MM`), zbir, desktop tabela / mobilne kartice, dijalog za dodaj/izmeni sa prilogom (slika ili PDF, privatni bucket, signed URL), inline CRUD kategorija. Troškovi ulaze u **neto profit**, nikad u fakturu.

### `/korisnici` (Admin), `/obavestenja` (sve role), `/podesavanja` (sve role)

- Korisnici: invite e-mailom, izmena imena/e-maila/role/lozinke.
- Obaveštenja: „Ovaj uređaj" (push pretplata per-uređaj) + „Šta i kako da stiže" (master prekidač + tabela tip × [Push][Email], filtrirano po roli).
- Podešavanja: profil (ime, lozinka) + statusi porudžbine (ime, boja, redosled).

### `/stil`, `/stil/komponente`

Dizajn showcase. **Jedine rute pod `(app)` bez role guarda** — samo demo podaci, ali Logistika vidi demo tabelu sa kolonama MP/VP/Zarada.

---

## 11. Poslovna pravila i formule

### Otkupnina

```
otkup = goods_total + (shipping_charged ?? 0)
```
Računa se ovako jer `cod_amount` postoji samo za COD porudžbine i NULL je na backfill-u. Helper `otkupOf` u `db/finance.ts`.

### Saldo poštarine

```
withPdv(base) = base + round(base * vat_rate / 100)     // PDV zaokružen PO PORUDŽBINI
gross   = Σ(shipping_charged − withPdv(shipping_actual))  // oba NOT NULL
settled = Σ postage_settlements.amount
balance = gross − settled                                 // sme biti negativan
```

### Period metrike (jedini izvor istine: `db/metrics.ts` → `computePeriodMetrics({from, to})`)

```
inRange       = porudžbine sa belgradeDate(ordered_at) unutar [from, to]
brojPorudzbina = inRange.length                          // SVI statusi
realized      = inRange bez CANCELLED_STATUS_NAMES       // bez Otkazano/Vraćeno
zarada        = Σ order_items.profit_at_sale za realized
promet        = Σ (mp_at_sale × quantity) za realized
troskovi      = Σ expenses.amount po `date` u periodu
neto          = zarada − troskovi
marza         = zarada / promet
```

Koriste je i Dashboard (`getDashboardMetrics`) i Finansije (`getNetoProfit`) — **ne mogu se razići**.

### T+1 uplata

`previousWorkingDay(payout_date)` po Beogradu → kandidati su porudžbine isporučene tog dana. Pon → pet, uto → pon, itd. Admin može da koriguje.

### Nisko stanje

```
isVariantLowStock(v) = v.stock_counted_at != null
                    && v.stock_quantity <= v.low_stock_threshold
                    && v.archived_at == null
```
**Popisana nula JESTE nisko stanje. Nepopisana varijanta NIJE** (ona je „Fali količina").

### Popis zaliha

- Nivo = **varijanta** (tu stanje i živi). Proizvod u listi pokazuje zbirno.
- `stock_counted_at` se postavlja: (1) ručnim čekboksom „Popisano" ili unosom nove cifre, (2) čuvanjem forme varijante, (3) CSV uvozom **samo ako je kolona sa količinom mapirana**.
- **Automatsko skidanje zaliha NE stampuje popis** — promena stanja nije „pogledao sam".
- `setStockCount` je jedina katalog akcija dostupna Logistici; ide kroz service-role jer Logistika nema write RLS. Patch dira isključivo `stock_quantity` + `stock_counted_at/by` — **nikad cene**.
- Filter „Stanje 0" broji **samo popisanu nulu**; nepopisana nula pripada filteru „Fali količina".

### Automatsko skidanje zaliha *(nekomitovano, migracija nije na produkciji)*

- Roba je skinuta dok je porudžbina u **živom toku** (Kreirano / Poslato / Isporučeno); **vraća se** čim ode u Otkazano ili Vraćeno; povratak iz njih je **ponovo skida**. Prelazi unutar živog toka ne diraju stanje.
- Idempotentnost kroz uslovni UPDATE `orders.stock_applied` (`.eq("stock_applied", !next)`).
- **Stanje sme u minus** (nema clamp-a) — nepopisana varijanta je 0, pa minus pošteno znači „prodato više nego što je evidentirano".
- Postojeće porudžbine imaju `stock_applied = false` → otkazivanje stare porudžbine neće naduvati stanje.
- Best-effort: nikad ne baca, dopisuje „(Stanje u katalogu nije ažurirano — proveri.)".
- Stavke bez `variant_id` se **preskaču** — a to je danas 93% stavki.

### Rizičan kupac

Crveni flag + push ako je kupac (po telefonu ili e-mailu) ranije otkazao ili vratio porudžbinu. Radi po `cancelled_at`, ne po nazivu statusa — zato radi i za Otkazano i za Vraćeno. (`db/customer-risk.ts`)

### Otkazano vs. Vraćeno

Dva zasebna app statusa (operativno bitno), ali **oba mapiraju na Woo `cancelled`**. Zajednička „otkazna" logika kroz `CANCELLED_STATUS_NAMES` / `isCancelStatusName(name)`: `cancelled_at`, gašenje toka, blokada bulk „Poslato", Woo push, isključivanje iz zarade.

---

## 12. Istorija odluka i promena odluka

Ovo je najčešći izvor pitanja „zašto je ovako". Odluke koje su se **promenile** u odnosu na originalni plan:

| # | Odluka | Bilo | Sada | Zašto |
|---|---|---|---|---|
| 1 | **Email obaveštenja** | „nije u Fazi 1" | jeste — Resend, opcioni kanal po korisniku | korisnik je tražio izbor kanala po tipu obaveštenja |
| 2 | **Auto-decrement inventara** | „nije u Fazi 1" | implementirano (`lib/stock.ts`), čeka `db push` | stanje je bilo netačno čim stigne prva porudžbina |
| 3 | **`date-fns-tz`** | konvencija iz plana | **ne koristi se** — `Intl` + `timeZone` | manje zavisnosti, konzistentno s kodbazom |
| 4 | **„Otkazano/Vraćeno"** | jedan status | **dva** zasebna + obavezan razlog | operativno se razlikuju |
| 5 | **Dashboard metrike** | realizovano (Isporučeno + plaćeno, po `delivered_at`) | **sve kreirano u periodu** (`ordered_at`), bez otkazanih | jasnija slika prodaje |
| 6 | **Neto profit (Finansije)** | realizovano po `delivered_at` | ista osnova kao Dashboard | da se dve cifre ne razilaze |
| 7 | **Kartica „Porudžbine"** | bez otkazanih | **SVE**, uključujući otkazane | korisnik želi ukupan broj |
| 8 | **Fakturisanje** | po pojedinačnim porudžbinama | **po UPLATAMA** (`payouts.invoice_id`) | jednostavnije; stare „plaćene" bez uplate-reda namerno ispadaju |
| 9 | **`/finansije` overview** | 3 kartice | **obrisan**, redirect na Uplate | metrike su na Dashboardu |
| 10 | **Broj pored datuma na Uplatama** | `cod_amount` | **otkup** = `goods_total + shipping_charged` | `cod_amount` je NULL na backfill-u → prikazivalo „0 RSD" |
| 11 | **Saldo poštarine** | bez PDV-a | **sa 20% PDV** na stvarnoj poštarini | XExpress fakturiše sa PDV-om |
| 12 | **URL porudžbine** | UUID | **Woo broj** (`/porudzbine/2419`), UUID kao rezerva | čitljivo, poklapa se sa Woo-om |
| 13 | **Popis inline u listi kataloga** | postojao | **uklonjen** — samo na detalju proizvoda | lista ostaje čist prikaz |
| 14 | **Lokalni razvoj** | `supabase start` (Docker) | **cloud + CLI bez Docker-a** | jednostavnije |
| 15 | **Otkazivanje plaćene porudžbine** | ćorsokak (`needs_review` bez promene statusa) | **force potvrda** (Admin-only) | status nikad nije mogao da pređe u Vraćeno |

Odluke koje **stoje od početka:** PWA online-only · tri role · Supabase jedini izvor istine · sve porudžbine kroz Woo webhook · nema ručnog kreiranja porudžbina · faktura bez PDF-a · Meta Ads i XExpress API nisu u Fazi 1 · zamrznute cene · statusi po imenu.

**Jednokratne data operacije** (nisu kod, urađene kroz service-role):
- Obrisane sve `payouts` sa datumom 12–13.07.2026 (ručno peglanje) → 39 porudžbina otkačeno, ostale `uplaceno`.
- 15 porudžbina kreiranih pre 01.06.2026 (xexpress, Isporučeno, `neuplaceno`) → `uplaceno` + `paid_at = delivered_at`. Junske/julske (33) namerno ostavljene `neuplaceno`.

---

## 13. Stanje sistema danas

**Datum snimka:** 31.07.2026, iz produkcione baze.

| Podatak | Vrednost |
|---|---|
| Porudžbine | **1045** (941 backfill + 104 žive) |
| Stavke porudžbina | 1710 |
| Proizvodi / varijante | 219 / 372 |
| Kupci | 960 |
| Uplate / fakture | 23 / 3 |
| Troškovi | 19 unosa |
| Korisnici (`profiles`) | **2 — oba `admin`** (brat i drug još nemaju naloge) |
| Vremenski opseg | 02.02.2026 – 31.07.2026 |

**Statusi:** Isporučeno 923 · Otkazano 95 · Vraćeno 17 · Kreirano 8 · Poslato 2
**Plaćanje:** uplaćeno 802 · keš 123 · neuplaćeno 120

### Zdravlje podataka

| Provera | Rezultat |
|---|---|
| `needs_vp` / `needs_review` | **0 / 0** — čisto |
| Stavke bez VP | 0 |
| Duplikati `woo_order_id` | 0 |
| **Porudžbine u Woo-u kojih nema u app-u** | **0** — webhook ne gubi ništa |
| Varijante bez popisa | 0 |
| Varijante u minusu | 0 |
| **Stavke bez `variant_id`** | **1591 / 1710 (93%)** |
| Porudžbine bez `shipping_charged` | 890 |

**Rekonsilijacija sa WooCommerce-om:** 1045 u app-u, 1045 u Woo-u, **0 propuštenih, 0 viška**. Samo 4 neslaganja statusa, sva iz backfill-a.

### Dve stvari koje vrede pažnje

**a) 93% stavki nije povezano sa katalogom.** Svih 1571 backfill stavki ima `variant_id = null` (backfill nije spajao SKU sa varijantama), plus 20 živih stavki iz porudžbina #2797–#2816 (SKU-ovi tada nisu postojali u katalogu). Posledice: nema izveštaja „prodaja po artiklu" za feb–jul; automatsko skidanje zaliha te stavke **preskače**; nema akcije u app-u koja bi stavku naknadno povezala. Popravka je jednokratan `UPDATE` po SKU-u — SKU-ovi postoje na stavkama.

**b) Uplata datirana 03.08.2026** — u budućnosti. `payouts` nema proveru datuma; vredi proveriti da nije omaška.

### Ocena po oblastima (iz audita)

| Oblast | Ocena | Komentar |
|---|---|---|
| Sigurnost / RLS | ★★★★★ | Nema kritičnih nalaza |
| Zamrznute cene (ustav) | ★★★★★ | Poštovan svuda |
| Woo integracija | ★★★★☆ | Pouzdana i idempotentna; fale replay zaštita i pomirenje `refunded` posle `cancelled` |
| Finansijska logika | ★★★☆☆ | Formule i timezone tačni; agregacija ima tihe rupe koje rastu sa obimom |
| Katalog / uvoz | ★★☆☆☆ | CSV uvoz destruktivan; nema istorije kretanja zaliha |
| Arhitektura / testovi | ★★☆☆☆ | Nula testova, nema CI-ja, 38–46 upita bez provere greške |
| UX / mobilni | ★★☆☆☆ | Desktop solidan, mobilni znatno slabiji — 16 kritičnih nalaza, dva sa gubitkom podataka |

---

## 14. Poslovna slika iz podataka

Cifre iz produkcione baze, po Dashboard logici (sve po datumu kreiranja, bez Otkazano/Vraćeno).

| Mesec | Porudžbina | Zarada | Promet | Marža |
|---|---:|---:|---:|---:|
| 2026-02 | 147 | 138.808 | 607.970 | 22,8% |
| 2026-03 | 204 | 205.940 | 882.960 | 23,3% |
| 2026-04 | 191 | 235.899 | 1.034.100 | 22,8% |
| 2026-05 | 174 | 196.616 | 725.190 | 27,1% |
| 2026-06 | 109 | 139.508 | 493.620 | 28,3% |
| 2026-07 | 108 | 113.997 | 332.390 | 34,3% |

**Tri stvari koje se vide:**

1. **Promet je pao 45% od aprila** (1.034.100 → 332.390), ali je **marža porasla sa 22,8% na 34,3%**. Prodaje se manje, ali profitabilnije — poklapa se sa tim da je Meta Ads „trenutno usporeno".
2. **Zarada za 6 meseci: 1.030.768 RSD. Troškovi: 955.601 RSD. Neto ≈ 75.000 RSD za pola godine.** Od troškova je **596.722 RSD (62%) na Reklame**. App ima ovu cifru ali je nigde ne prikazuje kumulativno.
3. **Stopa otkaza/vraćanja raste: 5,2% → 14,3%** (skoro trostruko za pet meseci).

| Mesec | Otkazano/Vraćeno |
|---|---|
| 2026-02 | 8/155 = 5,2% |
| 2026-03 | 22/226 = 9,7% |
| 2026-04 | 22/213 = 10,3% |
| 2026-05 | 23/197 = 11,7% |
| 2026-06 | 19/128 = 14,8% |
| 2026-07 | 18/126 = 14,3% |

App **ne prikazuje ovu stopu nigde**, a razlozi otkazivanja se unose kao slobodan tekst pa se ne mogu izbrojati.

**Ostalo:**
- **Ponovljeni kupci: 6,8%** (65 od 960). Za potrošni asortiman (trake, prostirke) to je prostor za rad; app ima podatke ali nema nijedan ekran za kupce.
- **Top artikli po zaradi:** Platnene trake (SM177) 174.380 · Podesive bučice (SM195) 81.200 · Gumene trake (SM116) 63.700 · NBR Prostirka crna 33.980.
- **Najveće marže** na sitnoj robi (Hand grip 61%, Joga blok 49%); **najniže** na vinil bučicama (15–18%).
- **154 varijante sa zalihom nikad nisu prodate.** Magacin je drugov pa to nije zarobljen kapital, ali jeste asortiman koji ne radi.

Sve ove cifre postoje u zamrznutim `order_items` — fali samo ekran koji ih agregira.

---

## 15. Poznati bagovi i tehnički dug

Iz audita od 31.07.2026 (šest paralelnih dubinskih analiza + provera nad produkcionom bazom). Puni izveštaji: `docs/audit/*.md`, sažetak `docs/izvestaj-stanja.md`.

### 15.1 Živi bagovi — dešavaju se sada

**Ž1 · Zbir iznad liste porudžbina pokazuje 0 RSD** `[REPRODUKOVANO]` — `db/orders.ts:219-241` (`sumOrderItems`, `CHUNK = 500`)
Traka „Za ovaj filter" bez filtera prikazuje **0 RSD** umesto **1.169.773 RSD**. `.in()` sa 500 UUID-jeva pravi predugačak URL → `fetch failed`. Testirano nad pravom bazom: 200 UUID OK, 350 OK, **400 puca**, 500 puca. Greška se ne proverava (`const { data } = ...`), pa `data = null` → zbir 0. Nema poruke, nema Sentry zapisa.
**Popravka:** `CHUNK = 200` + paginacija + `if (error) throw`. Obrazac već postoji u `db/metrics.ts:80-96`.

**Ž2 · `SUMMARY_SCAN_CAP = 20000` i `RISK_SCAN_CAP = 5000` su iluzija** `[REPRODUKOVANO]`
Kod pretpostavlja da `.range(0, 19999)` zaobilazi PostgREST limit. **Ne zaobilazi.** Izmereno: bez `.range()` → 1000 redova; `.range(0, 4999)` → 1000; `.range(0, 19999)` → 1000; `.limit(5000)` → 1000. Projekat ima tvrd cap **1000 redova**. `getOrdersSummary` već danas vidi 1000 od 1045, a filter „rizičan kupac" gleda prvih 1000.

**Ž3 · Datumski filter liste je UTC, ostatak app-a Beograd** — `db/orders.ts:167-168`
**31 od 1045 porudžbina** pada u drugi dan po UTC-u nego po Beogradu; jedna prelazi granicu meseca. Lista i Dashboard daju različit broj za isti mesec. Funkcije za ispravku već postoje u `lib/period.ts`.

**Ž4 · Pretraga po broju porudžbine ne radi po defaultu** — `db/orders.ts:131`
Uslov `woo_order_id.eq.<term>` se dodaje samo kad je izabrano „sve". Ukucaš `2419` → prazan rezultat.

### 15.2 Bagovi koji čekaju prag (isti obrazac kao Ž1/Ž2)

| # | Mesto | Kad puca | Posledica |
|---|---|---|---|
| P1 | `profitByOrder` — `db/finance.ts:272` | >~350 porudžbina u svim uplatama (danas 118) | **Zarada svih uplata → 0 RSD**; hrani „Za fakturisanje" |
| P2 | `issueInvoice` — `finansije/actions.ts:280` | isto | **Faktura izdata na 0 RSD** uz zaključavanje uplata i stavki |
| P3 | `getSaldoPostarine` — `db/finance.ts:485` | >1000 fakturisanih pošiljki (danas 105) | Saldo trajno pogrešan i **nestabilan** (nema `ORDER BY`) |
| P4 | `listXexpressInvoices` — `db/finance.ts:650` | isto | P&L starijih XExpress faktura umanjen |
| P5 | `buildCancellationIndex` — `db/customer-risk.ts:64` | >1000 otkazanih (danas 112) | „Rizičan kupac" tiho prestaje da radi |
| P6 | `fetchVariants` — `db/catalog.ts:47` | ~200+ proizvoda (**danas 219 — na granici**) | Katalog prikaže proizvode **bez varijanti i cena** |
| P7 | `getUnpaidDeliveredXexpress` — `db/finance.ts:56` | >1000 | Kandidati za uplatu nestaju bez poruke |
| P8 | `getActiveVariantOptions` — `db/orders.ts:452` | >1000 varijanti | „Dodaj stavku" ne nudi sve artikle |
| P9 | `lowStockCount` u cron-u — `api/cron/notifikacije:112` | >1000 varijanti | Dnevni push šalje pogrešan broj |

**Jedna popravka za sve:** helper `lib/supabase/paginate.ts` sa `selectAll(query)` (`.range()` petlja + obavezan `error` check) i `chunked(ids, 200)`.

**P10 · `order_profit` view sumira preko NULL-ova.** Komentar u migraciji tvrdi da je profit null kad porudžbina ima `needs_vp` stavku — **nije tačno**: Postgres `sum()` preskače NULL. Porudžbina sa `[8000, NULL]` daje 8000. `issueInvoice` koristi `(r.profit ?? 0)` → porudžbina sa delimično nepoznatim VP tiho ulazi u fakturu umanjena. **Danas bezopasno** (0 stavki bez VP), postaje opasno prvog dana kad kroz webhook prođe nepoznat SKU.
Popravka: `case when count(*) filter (where profit_at_sale is null) > 0 then null else sum(profit_at_sale) end` + `issueInvoice` mora **tvrdo odbiti** porudžbinu sa `profit is null`.

### 15.3 CSV uvoz kataloga je destruktivan `[POTVRĐENO]`

**U1 · Uvoz bez kolone „Stanje" nulira zalihe celog kataloga** — `katalog/uvoz/actions.ts:241-250`
```ts
stock_quantity: d.stock_quantity ?? 0,           // uvek ide u UPDATE
low_stock_threshold: d.low_stock_threshold ?? 5, // gazi ručne pragove
weight_grams: d.weight_grams ?? null,            // briše težine
```
Kolona nije mapirana → `undefined` → `?? 0` → **eksplicitna nula u UPDATE**. Svih 372 varijante dobiju stanje 0, a `stock_counted_at` ostaje → sve izgleda „popisano" → **ceo katalog upada u nisko stanje**. Nepovratno (nema istorije stanja). Isto: `deriveVariantName` bez mapirane kolone pretvara „Crvena · 2.4 m" u **„4"**.

**U2 · Uvoz bez kolone „Kategorija" briše kategorije** — isti fajl, `:209-222`. `category_id = null` ide u UPDATE.

**U3 · Cene sa decimalama se množe sa 100** — `lib/validation/catalog.ts:129-134`
`v.replace(/\D/g, "")` skida sve što nije cifra: `"9.990"` → 9990 (tačno), ali `"4990.00"` → **499000**. Google Sheets podrazumevano formatira sa dve decimale. Backfill skripta ima ispravan `parseRsd` — uvoz kataloga tu logiku nema.
*Ublažavajuće: zamrznute cene starih porudžbina ostaju netaknute — ustav radi.*

Dodatno: uvoz radi ~560 sekvencijalnih upita bez transakcije; prekid na pola (nema `maxDuration` nigde) pravi **duplikate proizvoda** pri ponovnom pokretanju.

**Popravke po ceni:** (1) prekidač „Samo dodaj nove, ne diraj postojeće" · (2) graditi UPDATE patch **samo od mapiranih polja** · (3) preuzeti `parseRsd` + sanity guard „nova cena > 10× stara" · (4) `import_batches` + „Poništi poslednji uvoz".

### 15.4 Nekomitovano: automatsko skidanje zaliha

**Migracija NIJE na produkciji** (`orders.stock_applied` ne postoji) — ima vremena da se model popravi.

**Urađeno dobro (ne treba ponovo gledati):** `apply_stock_delta` je jedan `UPDATE ... + delta` (otporan na lost update) · `claimFlag` je pravi mutex (`.eq("stock_applied", !next)`) → Woo retry ne može duplo da skine · migracija je tehnički čista (`security definer` + `search_path=''`, `not null default false` bez rewrite-a) · snapshot i `stock_counted_at` se ne diraju.

**S1 · `claimFlag` i `applyDeltas` nisu atomični** — dva odvojena HTTP poziva.
- Proces umre između njih → `stock_applied = true`, roba **nije** skinuta; nikad se samo ne popravi.
- RPC uspe ali odgovor ne stigne (timeout/504 — realno na Vercelu) → `catch` vraća flag na `false` → **sledeći pokušaj skida drugi put**.
- Ista trka između `syncItemStock` i `syncOrderStock` (dva taba).
**Popravka:** jedna plpgsql funkcija `apply_order_stock(p_order_id, p_reserve)` koja u istoj transakciji radi `select ... for update`, flipne prekidač, pročita stavke i primeni UPDATE.

**S2 · Popis i rezervacija mere dve različite stvari, a pišu u istu kolonu**
Rezervacija je na **„Kreirano"**, a roba fizički odlazi tek na **„Poslato"** (pon/čet). U tom prozoru (do 4 dana) `stock_quantity` je umanjen ali je roba na polici. Logistika prebroji policu, ukuca stvarnu cifru → **rezervacija je izbrisana**. Greška se akumulira svake nedelje — i kvari tačno onaj problem koji je popis trebalo da reši.

| Opcija | Šta | Trud |
|---|---|---|
| A | Rezervisati na „Poslato" umesto „Kreirano" | mali |
| **B** | **Razdvojiti `stock_quantity` (fizički popis) i `reserved_quantity`; prikaz „raspoloživo = stanje − rezervisano"** | **srednji — preporuka** |
| C | Pri popisu prikazati „rezervisano N kom" i porediti sa svežom vrednošću | mali (krpa) |

**Ostalo oko zaliha:** neuspelo skidanje se nikad ne pokuša ponovo · brisanje porudžbine trajno gubi rezervaciju (`on delete cascade`, treba `before delete` trigger) · **`npm run woo:test` menja stanje prave varijante u produkcionoj bazi** (prekid na sredini ostavlja pogrešnu cifru) · **nema ledgera kretanja zaliha** — `stock_quantity` menja 5+ puteva bez ijednog traga · minus je dozvoljen u migraciji ali `variantSchema` ima `min(0)` → admin ne može ni cenu da promeni na varijanti u minusu.

### 15.5 Sigurnosni nalazi (ozbiljni, ne kritični)

**B1 · `apply_stock_delta` je „napunjen pištolj"** — `security definer` u `public` šemi, radi **neograničen UPDATE** nad `product_variants` bez ijedne unutrašnje provere. Jedina odbrana je jedan `revoke` red, a PostgREST je automatski izlaže kao RPC. Jedan pogrešan `grant` u budućnosti → svaki ulogovani korisnik uključujući Logistiku može jednim POST-om da sabotira magacin.
**Popravka PRE `db push`:** premestiti u `private` šemu ili dodati guard `if auth.role() <> 'service_role' then raise exception`.

**B2 · Menadžer menja finansijske iznose** — `porudzbine/actions.ts:746-768`. `updateShipping` propušta Menadžera i piše kroz service-role (zaobilazi Admin-write RLS). `shipping_charged` ulazi u otkupninu, `shipping_actual` je osnovica XExpress rekonsilijacije. Krši odluku „Menadžer — bez izmene finansija". Dodatno: **nema guarda na `xexpress_invoice_id`** — izmena tiho menja P&L već zaključene fakture.
**Odluka je korisnikova:** dokumentovati da je poštarina operativna, ili razdvojiti (težina/paketi → Admin+Menadžer, poštarina → samo Admin).

**B3 · `setStockCount` ne isključuje arhivirane i ne proverava da varijanta postoji** — `katalog/actions.ts:378-403`. Cene **jesu** bezbedne (fiksni ključevi, nema spread-a). Fale: `.is("archived_at", null)`, `.select("id")` provera, gornja granica na količinu.

**B4 · Sentry može primiti telefone kupaca** — `sendDefaultPii` jeste isključen, ali Postgres unique-violation na `customers.phone` nosi `Key (phone)=(064…)` u `error.details`, a webhook radi `captureException(error)`. Predlog: `beforeSend` scrubber.

**Sitno:** 12 akcija prima goli `id` bez zod `uuid()` · cron secret se poredi ne-konstantnim vremenom (webhook koristi `timingSafeEqual`) · webhook nema anti-replay · `prefs` jsonb bez ograničenja veličine · `/stil/*` bez role guarda · MIME priloga se veruje klijentu.

### 15.6 Arhitektura

**A1 · Nula automatizovanih testova.** Nema test framework-a, nijednog `.test.ts`, ni `test` skripte, ni CI-ja. Tri `.mjs` smoke skripte su vezane za **živu bazu** — to su integracioni alati, ne test suite. Nijedna funkcija koja računa novac (`otkupOf`, `withPdv`, `computePeriodMetrics`, `belgradeDate`, `previousWorkingDay`, `parseRsd`) nema test. Istorija to potvrđuje: bug „Zarada/Marža = 0" je stigao u produkciju i otkriven ručno — a **Ž1 je isti bug na drugom mestu i još je tamo**.
**Predlog:** Vitest, Traka A (unit, bez baze, <2 s — novčani helperi, Belgrade/DST, HMAC) = **60% vrednosti za 20% truda, ~4 h**. Traka B (integracioni, staging Supabase). CI: `typecheck + lint + format:check + test + npm audit` + `supabase db reset` job (dokazuje da migracije prolaze od nule — danas to niko ne proverava) + branch protection na `main` (80 commit-ova bez ijedne kapije).
**Jeftina provera:** `! grep -rn "const { data } = await supabase" db app lib` — danas prijavi **38 mesta**.

**A2 · 5 „high" ranjivosti** `[npm audit]` — `next` 16.2.10 (9 advisory-ja: middleware bypass, DoS i SSRF u Server Actions, cache confusion ×2, otkrivanje Server Function endpoint-a), `postcss`, `sharp` (libvips CVE).
**Fix je patch verzija:** `npm i next@16.2.12 eslint-config-next@16.2.12` → očekivano 0. *(Middleware bypass se odnosi na Turbopack build; produkcija se gradi webpack-om — ostali pogađaju.)*

**A3 · Ista logika kopirana:**

| Logika | Kopije | Rizik |
|---|---|---|
| Sumiranje zamrznute zarade | 3 (`metrics.ts` inline, `sumOrderItems`, `profitByOrder`) | **Najopasnije** — tri chunk-a (200/500/0), cifre se mogu razići |
| Lookup statusa po imenu | 11 mesta | zaseban round-trip i izvor greške |
| „Nisko stanje" pravilo | 3 kopije | menjano na tri mesta kad je dodat `stock_counted_at` |
| Granice meseca | 3 implementacije | `expenses` verzija nema UTC pred-filter |

*Otkazni statusi su dobro urađeni — jedan izvor.*
**Strukturni predlog:** preseliti agregaciju novca u Postgres — jedna funkcija `period_metrics(from, to)` sa `sum()` unutar baze uz `at time zone 'Europe/Belgrade'`. Jedan round-trip umesto 15+, nema row cap-a, nema chunk-ovanja, nema tri kopije formule.

**A4 · Greške baze se gutaju.** Obrazac `if (error) return { error: "..." }` ponovljen ~25 puta, **nigde bez Sentry-ja**. `syncNeedsVp` i `recomputeGoodsTotal` ne proveravaju grešku uopšte — a `goods_total` hrani otkupninu.

**A5 · Bulk akcije su tempirana bomba.** `markOrdersShipped` / `changeOrdersStatus` idu red po red: UPDATE + INSERT istorije + sync zaliha + **HTTP PUT ka Woo-u sa 10 s timeout-om**. Šema dozvoljava **200 porudžbina** = ~2 minuta. **Nijedna ruta nema `maxDuration`.** Bulk puca u pola posla bez transakcije.

**A6 · Nema generisanih Supabase tipova.** Nema `database.types.ts` → **23 `as unknown as` casta**. Nula `any` (disciplina se poštuje), ali svaki cast je mesto gde promena šeme neće oboriti `tsc`. Fix: `supabase gen types typescript --linked > db/database.types.ts`.

**A7 · Operativa:** ne postoji način da se iz repoa vidi koje su migracije primenjene (predlog `npm run db:status`) · nema rollback plana ni down-skripti · backup politika nije dokumentovana · cron je jedna tačka otkaza bez alarma (predlog: Sentry Cron Monitoring) · env je uredan (24 promenljive se poklapaju sa `.env.example`) · sve je `force-dynamic` (18/18) · `revalidatePath` je u velikoj meri pogrešno usmeren (27 poziva, 5 mrtvih na `/finansije` koji je redirect) · **nema `error.tsx` ni `not-found.tsx` nigde** iako se `notFound()` zove na 5 mesta.

**A8 · CLAUDE.md je postao changelog** — 55 KB, 10 sekcija uputstva + **19 hronološki nalepljenih dodataka** od kojih neki poništavaju gornje sekcije (email, auto-decrement, `date-fns-tz`, Otkazano/Vraćeno). Model čita ceo fajl na startu svake sesije; kontradikcije daju nedeterministično ponašanje.
**Predlog:** `CLAUDE.md` ≤150 linija sa samo onim što važi danas · `docs/odluke/NNN-*.md` (ADR-ovi) · `docs/CHANGELOG.md` za hronologiju. Pravilo: kad se odluka promeni — **prepiši je**, ne dodaj ispod.

### 15.7 UX i mobilni

App se koristi na telefonu (brat u pokretu, drug u magacinu), a **mobilna verzija je znatno slabija od desktop verzije**.

**Šta je dobro (ne pokvariti):** dijakritika besprekorna u celom repou · nula Tailwind default boja, `globals.css` 1:1 sa dizajn dokumentom · Logistika stvarno ne dobija cene (nisu u payload-u) · `reduced-motion`, `tnum`, `env(safe-area-inset-bottom)` implementirani · Menadžer gejt dosledan.

**Kritično:**

- **U1 · Popis tiho briše količinu** — `Number("") === 0` prolazi validaciju. Logistika obriše cifru da otkuca novu, tapne drugde (blur) → **varijanta sa 12 komada postaje 0 sa postavljenim `stock_counted_at`**. Odmah upada u nisko stanje i dnevni push. Isti put i za „12a".
- **U2 · Potvrda nepromenjenog broja ne radi ništa** — `if (parsed === stockQuantity) return;`. Najčešći slučaj u magacinu („prebrojao sam, ima 8, isto kao što piše") ne radi ništa: nema toasta, „Fali količina" ostaje, `stock_counted_at` ostaje null. **Popis uopšte nema toast uspeha.**
- **U3 · Prazno polje u XExpress fakturi briše poštarinu** — `Number(chargeds[id]) || 0` → prazno postaje 0 i upisuje se u `orders.shipping_charged`. Zod ne hvata (0 je validno). Otkupnina se menja, a `shipping_actual = 0` **veštački napumpa saldo poštarine**. Vezivanje ide `for` petljom bez transakcije i bez rollback-a.
- **U4 · „Štampaj" na fakturi nikad ne radi** — `window.open("", "_blank", "noopener,…")` po spec-u uvek vraća `null` kad je `noopener` u features. Uvek pada u „blokiran pop-up". Identičan kod u spisku uplata nema `noopener` i radi.
- **U5 · Na telefonu se ne može odjaviti** — `signOut` postoji samo u sidebar-u koji je `hidden md:flex`. Mobilni nema header: ni ime, ni rolu, ni izlaz.
- **U6 · Redirect petlja bez izlaza** — korisnik sa sesijom ali bez `profiles` reda: `ERR_TOO_MANY_REDIRECTS`. App sam proizvodi to stanje (`korisnici/actions.ts:65` dopušta „pozivnica poslata, ali upis role nije uspeo").
- **U7 · Preimenovanje statusa tiho lomi sistem** — sve radi lookup **po imenu**, a Podešavanja dozvoljavaju preimenovanje „Isporučeno" → „Dostavljeno". Posle toga uplate, fakture, Dashboard i cron **prestanu da rade bez ijedne greške**.
- **U8 · Nepovratne akcije bez potvrde** — „Označi plaćeno" trajno zaključava fakturu (nema puta nazad), dugme 32px. Bulk „Označi poslato" izvršava se **odmah na `onSelect`** i gura desetine porudžbina u Woo, dok ista pojedinačna akcija **ima** `ConfirmDialog`.
- **U9 · Nema `not-found.tsx` ni ijednog `error.tsx`** — 404 je Next-ov engleski ekran bez navigacije; greška u server komponenti eskalira u `global-error.tsx` koji zamenjuje ceo dokument.
- **U10 · Bez interneta korisnik vidi dinosaurusa** — nema offline fallback stranice. U instaliranom PWA gubitak signala izgleda kao da je app crkao. Jedna precache-ovana `/offline` stranica ne narušava ustav.
- **U11 · Lozinka može završiti u URL-u** — forme u `/podesavanja` nemaju `action`; dok React nije hidriran, „Go" izvede native GET → `/podesavanja?password=…` u istoriji i Vercel logovima.

**Najveći gubitak vremena u svakodnevnom radu:**
- **Katalog gubi filtere pri povratku** — pretraga/kategorija/filteri su lokalni React state, strana je `force-dynamic` → povratak sa detalja re-montira komponentu. Tok „popiši 50 varijanti" postaje: filtriraj → uđi → nazad → filtriraj ponovo. (`/troskovi` već radi ispravno kroz `?mesec=`.)
- **Poštarina je odvojena od koraka „Poslato"** — dokumentacija kaže da se popunjava tu, ali su to dva mesta. Za 20 porudžbina dnevno = 80+ interakcija. **Bulk „Poslato" uopšte ne nudi poštarinu.**
- **Popis nema režim za magacin** — ~6-7 tapova po varijanti; ×50 ≈ **350 tapova** bez ijedne potvrde. Nema „potvrdi sve prikazane", Enter ne pomera fokus, nema skeniranja SKU-a, nema brojača.
- **Uplata se ne može ispraviti** — UI uvek šalje nepromenjen `orderIds`. Zaboravljena porudžbina → obriši-pa-napravi-novu, a brisanje je zabranjeno ako je bilo šta fakturisano → **ćorsokak**. Server ume da re-veže, samo nije izloženo.
- **Bulk slanje: desetine sekundi bez ijednog znaka** — 30 porudžbina = 30 uzastopnih poziva ka Woo-u. UI pokazuje samo zasivljeno dugme.

**Sistemska odstupanja:**
- **Tap mete:** dizajn traži min 40px; realnost je **48 pojava `size="sm"` / `h-8`**. „X" za zatvaranje dijaloga je ~16px u *svakom* dijalogu. Svih 5 dugmadi brzog toka na detalju porudžbine su 32px. Popis: input 32px + čekboks 16px, 50× po smeni. **Nema `components/ui/checkbox.tsx`** — 16 sirovih `<input type="checkbox" className="size-4">` nose sve bulk tokove.
- **Kontrast (izračunato):** `ink-faint` na belom 3,01:1 ✗ · `warning` pilula 3,95:1 ✗ · `sent` pilula 4,25:1 ✗ za 12px bold · „Vraćeno"/„Isporučeno" pilule 2,86 / 2,95:1 ✗. Statusne boje dolaze iz `seed.sql` kao **Tailwind default heksovi**, ne kao brend tokeni.
- **Tipografija je stepenik-dva ispod sopstvenog dokumenta:** `h1` je `text-xl` umesto 1,75rem na **15 od 21 mesta**; stat broj na Dashboardu je 24px umesto 36px. Jedini tačan ekran je `/stil`.
- **Mobilni prelivi (375px):** Dashboard ima horizontalni scroll (`rsd()` vraća **non-breaking space** pa je „184.300 RSD" jedan neprelomiv token) · pretraga na listi porudžbina ostaje ~90px · „Izaberi sve" postoji samo u desktop tabeli · traka „Izabrano: N" nije sticky · tabele na detaljima finansija nemaju mobilnu kartičnu varijantu · Logistika ima jednu nav stavku koja se `flex-1` rasteže preko pola ekrana.

**Ocena po ekranu** (✅ solidno · ⚠️ trenje · ❌ blokira rad):

| Ekran | Desktop | Mobilni |
|---|:-:|:-:|
| App shell / nav | ✅ | ❌ |
| Dashboard | ✅ | ❌ |
| Porudžbine — lista | ✅ | ❌ |
| Porudžbine — detalj | ⚠️ | ❌ |
| Katalog — lista | ⚠️ | ⚠️ |
| Katalog — detalj / popis | ⚠️ | ❌ |
| Katalog — uvoz CSV | ⚠️ | — |
| Finansije — uplate | ✅ | ⚠️ |
| Finansije — fakture | ⚠️ | ⚠️ |
| Finansije — poštarina / XExpress | ⚠️ | ❌ |
| Troškovi | ✅ | ⚠️ |
| Obaveštenja | ⚠️ | ⚠️ |
| Podešavanja | ⚠️ | ⚠️ |
| Korisnici | ✅ | ⚠️ |
| Prijava / Postavi lozinku | ⚠️ | ⚠️ |
| PWA / offline | ⚠️ | ❌ |
| 404 / greška | ❌ | ❌ |

---

## 16. Šta NIJE urađeno

**Namerno van obima Faze 1:**
- **XExpress API integracija** (automatsko kreiranje pošiljki, realni statusi, auto cenovnik po težini) — brat i dalje ručno prijavljuje.
- **Meta Ads integracija** — reklame su samo kategorija troška, unose se zbirno i ručno.
- **Normalizacija prljavih adresa/telefona iz Woo-a.**
- **PDF fakture** — faktura je cifra + spisak u app-u.
- **Ručno kreiranje porudžbina** — sve ide kroz Woo.
- **Ponavljajući troškovi.**

**Nije završeno iz Faze 1:**
- **Korak 1.10 — QA i lansiranje:** push na realnim uređajima nije testiran; **paralelni ciklus sa Sheets-om nije odrađen**; Make scenariji i Sheets tok formalno nisu ugašeni.
- **Nalozi:** u bazi su samo 2 korisnika, **oba `admin`**. Brat (Menadžer) i drug (Logistika) još nemaju naloge — cela role-based logika je implementirana ali se u praksi ne koristi.
- **Migracija `20260731140000_order_stock_decrement` nije primenjena** — automatsko skidanje zaliha ne radi u produkciji.

**Nedostaje kao infrastruktura:** testovi, CI, generisani Supabase tipovi, `error.tsx`/`not-found.tsx`, offline stranica, rollback plan za migracije, dokumentovana backup politika, izvoz podataka (nema **nijednog** izvoza u celoj aplikaciji).

**Nikad implementirano a podrazumevalo se:** ekran za kupce, izveštaj prodaje po artiklu, poređenje perioda / trend, aging potraživanja, „Zaboravljena lozinka", globalna pretraga.

---

## 17. Predlozi novih funkcionalnosti

Poređano po odnosu vrednost/trud. Prve četiri su „podaci već postoje, fali ekran".

| # | Šta | Zašto | Trud |
|---|---|---|---|
| **F1** | **Prodaja po artiklu / kategoriji** — top artikli po komadima, prometu, zaradi, marži + „nije prodato N dana" | Direktno vodi odluke o nabavci. Sve je u `order_items`. **Najveći ROI** | view + strana |
| **F2** | **Poređenje perioda + trend** — „ovaj mesec vs prošli" (Δ i %), sparkline | `computePeriodMetrics` već prima proizvoljan `{from,to}` | mali |
| **F3** | **Izvoz CSV/Excel** — porudžbine za trenutni filter, uplate, fakture, troškovi, XExpress specifikacije | Nema **nijednog** izvoza; ništa se ne može dati knjigovođi | mali |
| **F4** | **Istorija kretanja zaliha (`stock_movements`)** | Preduslov za poverenje u bilo koji broj o zalihama | srednji |
| **F5** | **Delimično vraćanje / zamena** | Vraćanje je sve-ili-ništa, a realno se vrati 1 od 3 artikla. **Najveća rupa u modelu** | veći |
| **F6** | **„Rezervisano" na varijanti** — „na stanju 10 · rezervisano 3 · raspoloživo 7" | Rešava S2 i čini skidanje razumljivim Logistici | srednji |
| **F7** | **Pretraga po SKU / artiklu** — „nađi sve porudžbine sa artiklom X" | Povlačenje serije, reklamacije | mali |
| **F8** | **Bulk izmena cena** — „+10%", „marža na X%", „zaokruži na 90" uz obavezan dry-run | Danas varijanta-po-varijanta ili kroz rizičan CSV | srednji |
| **F9** | **Šifrarnik razloga otkazivanja/vraćanja** | Pretvara rastuću stopu otkaza u odgovor „zašto" | mali |
| **F10** | **Aging potraživanja** za „isporučeno, neuplaćeno" (0–7 / 8–14 / 15–30 / 30+) | Odmah pokazuje šta je zaglavilo kod XExpress-a | mali |
| **F11** | **Broj pošiljke (tracking) + link** uz korak „Poslato" | težina/paketi se već unose | mali |
| **F12** | **`printed_at`** — koje su porudžbine već bile na PDF listi | Sprečava dvostruko slanje | mali |
| **F13** | **Interna napomena + istorija komunikacije** (poziv/SMS/Viber, ishod, ko) | Kod otkupnina se puno zove; to znanje živi u glavi | srednji |
| **F14** | **Izvoz kataloga za Woo** (SKU, cena, stanje) | App je „glavni katalog", Woo se ažurira ručno; Woo klijent i Write ključ postoje | mali |
| **F15** | **Ekran keš prodaja** — 123 porudžbine sa `payment_status='kes'` se nigde ne izlistavaju | Nema dnevnika keša | mali |
| **F16** | **„Uplaćeno bez uplate-reda"** — filter/izveštaj | ≥54 takvih porudžbina je nevidljivo svuda | mali |
| **F17** | **Barkod/skener za popis** (`BarcodeDetector`) | 372 varijante kroz brojčano polje je sporo | srednji |
| **F18** | **Predlog za poručivanje** — stanje + prag + brzina prodaje → „ostalo za 6 dana" | Fiksni prag 5 je isti za trake i bučice od 20 kg | srednji |
| **F19** | **Revizioni trag finansija** | Uplata/faktura se menja i briše bez traga | srednji |
| **F20** | **Povezivanje stavke sa artiklom** | 20 živih + 1571 istorijskih stavki bez `variant_id`; otključava F1 za istoriju | mali |

---

## 18. Predloženi redosled rada

**Nedelja 1 — zaustavi krvarenje (~1,5 dan)**
1. `sumOrderItems` CHUNK 500 → 200 + paginacija + `error` check *(Ž1 — pogrešna cifra na ekranu)*
2. Popis: prazan string ≠ 0, snimi i nepromenjenu cifru, toast uspeha *(U1, U2 — gubitak podataka)*
3. XExpress forma: ne slati prazna polja *(U3)*
4. Prekidač „samo dodaj nove" u CSV uvozu *(privremena brana)*
5. `npm i next@16.2.12` *(5 CVE)*
6. `apply_stock_delta` premestiti iz `public` šeme — **pre `db push`** *(B1)*
7. Sitno a bolno: skloniti `noopener` sa „Štampaj" *(U4)* · `ConfirmDialog` na bulk „Poslato" i „Označi plaćeno" *(U8)* · zaključati imena seed statusa *(U7)*

**Nedelja 2 — temelj (~1,5 dan)**
8. Vitest + Traka A (novčani helperi, Belgrade vreme, HMAC) — ~4 h
9. CI: `typecheck + lint + test + npm audit` + branch protection na `main`
10. `supabase gen types` → brisanje 23 `as unknown as` castova
11. Mobilni header sa odjavom + `components/ui/checkbox.tsx` (40px) + `error.tsx` / `not-found.tsx` / `/offline` *(U5, U9, U10)*

**Nedelja 3 — sistemski (~1,5 dan)**
12. `selectAll()` + `chunked()` helper → zameniti svih 9 mesta *(P1–P9)*
13. `dbFail()` helper → sve akcije šalju grešku u Sentry *(A4)*
14. `order_profit` view: NULL umesto tihe nule + `issueInvoice` tvrdo odbija *(P10)*
15. Datumski filter liste na Belgrade *(Ž3)* + pretraga po broju *(Ž4)*
16. Filteri kataloga u URL *(najveći dnevni gubitak vremena)*

**Nedelja 4 — zalihe kako treba**
17. Odluka o modelu (preporuka: opcija B — `reserved_quantity`) *(S2)*
18. `apply_order_stock` kao jedna transakcija *(S1)*
19. `stock_movements` ledger *(F4)*
20. Tek onda `db push` + commit

**Zatim, po vrednosti:** F1 (prodaja po artiklu) → F3 (izvoz) → F2 (poređenje perioda) → F10 (aging) → F9 (razlozi otkaza).

**Paralelno:** restrukturirati CLAUDE.md *(A8)* — svaka naredna sesija radi bolje.

---

## 19. Operativni podsetnici

### Env varijable (24, sve se poklapaju sa `.env.example`)

| Grupa | Varijable |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| WooCommerce | `WOO_API_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`, `WOO_WEBHOOK_SECRET` |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| Cron | `CRON_SECRET` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| App | `NEXT_PUBLIC_APP_URL` (koristi se i kao VAPID `subject`) |
| RLS test | `RLS_TEST_ADMIN_EMAIL/PASSWORD`, `RLS_TEST_LOGISTICS_EMAIL/PASSWORD` |

### Pre produkcije — obavezni koraci

- **`supabase db push`** — najnovija migracija (`stock_applied` + `apply_stock_delta`) **nije primenjena**. Bez toga svaka promena statusa prijavljuje „Stanje u katalogu nije ažurirano". *(Prvo popraviti B1 i S1/S2.)*
- Woo consumer ključ mora imati **Write** dozvolu (do sada samo GET).
- U Woo-u registrovati **dva webhook-a** (`order.created`, `order.updated`) na `https://app.sportem.rs/api/webhooks/woo` sa istim secret-om kao u Vercel env-u.
- Resend: verifikovan domen + `RESEND_API_KEY` (bez toga email tiho ne šalje).
- Supabase Auth: `enable_signup = false` na cloud-u + `NEXT_PUBLIC_APP_URL/auth/callback` u Redirect URLs.
- Pre backfill-a i uključivanja webhook-a: pokrenuti `supabase/dev-fixtures-teardown.sql` (fixtures koriste `woo_order_id` 1001/1002 → sudar).

### Zamke koje se lako zaborave

- **`npm run build` MORA biti `--webpack`** — Turbopack tiho ne generiše `sw.js` i PWA prestane da radi.
- PWA i push rade **samo u prod build-u** (SW isključen u dev-u).
- Kad se migracija doda a `db push` zaboravi, PostgREST tiho vraća prazno umesto greške → **varijante nestanu iz kataloga**, nisko stanje prazno. Uvek `db push` odmah.
- `npm run woo:test` menja stanje **prave varijante u produkcionoj bazi**.
- Preimenovanje seed statusa u Podešavanjima **lomi ceo sistem** (lookup po imenu).

---

## 20. Rečnik pojmova

| Pojam | Značenje |
|---|---|
| **MP** | maloprodajna cena — ono što kupac plaća |
| **VP** | veleprodajna cena — ono što Sportem plaća drugu |
| **Zarada / profit** | MP − VP (po komadu), `profit_at_sale` = (MP − VP) × količina |
| **Marža** | zarada / promet |
| **Otkup / otkupnina** | ono što kupac plaća kuriru = roba + naplaćena poštarina |
| **Drug** | dobavljač i vlasnik magacina; u app-u rola **Logistika** |
| **„Drug mi duguje"** | Σ zarade nefakturisanih uplata — iznos sledeće fakture |
| **Uplata / payout** | novac koji je drug (preko XExpress-a) uplatio Sportemu |
| **Faktura** | Sportem → drugu, na 2 nedelje, iznos = Σ zarade nefakturisanih uplata |
| **XExpress faktura** | XExpress → drugu, na 10 dana, poštarina + 20% PDV (u app-u se rekonsiliuje) |
| **Zamrznute cene / snapshot** | kopija MP/VP u `order_items` u trenutku porudžbine — ustav sistema |
| **`needs_vp`** | porudžbina ima stavku bez VP (nepoznat SKU) — profit netačan dok Admin ne unese |
| **`needs_review`** | Woo otkazao/refundirao već fakturisanu ili plaćenu porudžbinu — traži ručnu odluku |
| **Popis** | „prebrojao sam" — `stock_counted_at`; razlikuje stvarnu nulu od neunete količine |
| **„Fali količina"** | varijanta koja nikad nije popisana (`stock_counted_at = null`) |
| **T+1** | uplata u dan D odnosi se na isporuke prethodnog radnog dana |
| **`ISTORIJA-BACKFILL`** | sintetička faktura koja izoluje uvezenu istoriju iz živih finansija |
| **Force potvrda** | Admin-only potvrda za otkazivanje/vraćanje plaćene ili fakturisane porudžbine |

---

## 21. Kako odgovarati na pitanja o Sportemu

Pravila za Claude u ovom projektu:

1. **Jezik: srpski, puni dijakritici** (č, ć, š, ž, đ). Isto važi za svaki predloženi UI tekst.
2. **Ustav se ne krši bez eksplicitne potvrde** — zamrznute cene, integer RSD, `Europe/Belgrade`, migracije samo kroz `supabase/migrations`, statusi po imenu, RLS kao izvor sigurnosti. Ako predlog dira nešto od toga, prvo to reci.
3. **Kad se odluka menja — prepiši je, ne dodaj ispod.** To je konkretno naučeno iz problema A8 (CLAUDE.md je postao changelog sa kontradikcijama).
4. **Cifre uvek iz zamrznutih stavki** (`order_items` / `order_profit` view), nikad iz kataloga.
5. **Jedan korak = jedna sesija.** Posle svakog koraka proveriti definiciju gotovog, pa commit.
6. **Pre svakog predloga proveri da li već postoji u sekciji 15 ili 17** — velika većina očiglednih ideja je već analizirana i ima procenu truda.
7. **Kontekst korisnika:** vlasnik biznisa koji sam razvija app uz rad, radi kroz Claude Code, nije full-time programer. Odgovori treba da budu konkretni, sa jasnim redosledom i cenom (trud), bez ponavljanja onoga što je već odlučeno.
8. **Ako je pitanje o brojevima biznisa** — koristi sekciju 14, ali napomeni da je snimak od 31.07.2026.
9. **Kad nešto nije u ovom dokumentu, reci to** umesto da pogađaš — kodbaza se menja, a ovo je snimak stanja na 01.08.2026.

---

*Kraj dokumenta. Izvori: `CLAUDE.md`, `docs/sportem-kontekst.md`, `docs/Sportem-Plan-Implementacije-v2.md`, `docs/Sportem-Dizajn-Sistem.md`, `docs/izvestaj-stanja.md`, `docs/audit/*.md`, kodbaza i produkciona baza na dan 31.07.2026.*
