# CLAUDE.md — Sportem app

> Ovaj fajl Claude Code čita na startu svake sesije. Sadrži sve što je potrebno da bilo koja sesija radi ispravno bez ponovnog objašnjavanja. **Kad se neka odluka promeni — upiši je ovde.**

---

## 1. Šta je projekat

**Sportem app** — PWA (web + instalabilna + full responsive), interni operativni sistem za ecommerce sportske opreme (`sportem.rs`, WordPress + WooCommerce). Jedno mesto za: porudžbine, katalog/inventar, finansije (zarada, profit, marža, fakture, isplate, poštarina, keš), troškove, dashboard, low stock, push. Zamenjuje dosadašnji Google Sheets + Make tok.

Vlasnici: **korisnik (Admin)** i **brat (Menadžer)**. **Drug (Logistika)** je dobavljač koji drži fizički magacin (roba se uzima po VP cenama).

**Izvori istine (`docs/`):**
- `docs/sportem-kontekst.md` — biznis kontekst, tokovi novca, ljudi, struktura baze, edge case-ovi. **Master dokument.**
- `docs/Sportem-Plan-Implementacije-v2.md` — plan implementacije po fazama i koracima (v2.0).
- `docs/Sportem-Dizajn-Sistem.md` — dizajn tokeni, boje, tipografija, komponente. Izvor istine za UI (Korak 0.2/0.3).

---

## 2. Workflow (kako se radi)

- **Jedan korak plana = jedna sesija.** Ne uzimati ceo plan odjednom — uzeti CLAUDE.md + tekst konkretnog koraka.
- Posle svakog koraka proveriti „Rezultat" (definiciju gotovog), pa commit. Ne prelaziti na sledeći korak dok rezultat ne stoji.
- **Skretanje sa plana** (druga biblioteka/šema) je dozvoljeno **samo ako ne dira zaključane odluke ni zamrznute cene.** Svaku izmenu odluke upisati u ovaj fajl.
- **Migracije baze uvek kroz `supabase/migrations`** — nikad ručne izmene šeme kroz Supabase dashboard (da lokalni i produkcioni ostanu u sync-u).
- Sav UI tekst na **srpskom** sa punim dijakriticima (č, ć, š, ž, đ).

---

## 3. Zaključane odluke (ne menjaju se bez izmene docs-a)

- PWA, online-only, push notifikacije u Fazi 1. **Email obaveštenja dodata u 1.9** (Resend) kao opcioni kanal po korisniku — v. „Korak 1.9 dopuna". (Ranije: „Email nije u Fazi 1" — odluka promenjena na zahtev korisnika.)
- **Tri role:**
  - **Admin** — sve (finansije, cene, fakture, reklame).
  - **Menadžer** — svi Sportem podaci (zarada, porudžbine, izveštaji), **bez izmene finansija**.
  - **Logistika** — samo stanje/naziv/slike artikala; **ne vidi MP, VP, profit ni bilo koje finansije — kolone se NE renderuju (ne blur, nego ih nema).**
- **Supabase je jedini izvor istine**; Sheets izlazi iz sistema. App je glavni katalog (cene/proizvodi se menjaju tu); WooCommerce se po potrebi ažurira ručno.
- **Sve porudžbine ulaze kroz WooCommerce webhook** — i XExpress i lične/keš prodaje. **U app-u nema ručnog kreiranja porudžbina.** (Keš/lična prodaja = porudžbina se samo označi `licno` + „Keš/Isplaćeno".)
- Webhook prati **`order.created` i `order.updated`** — otkazivanja/refund se sinhronizuju automatski.
- Statusi porudžbine su podesiva lista: **Kreirano → Poslato → Isporučeno → Otkazano / Vraćeno.** „Otkazano" i „Vraćeno" su **dva zasebna app statusa** (interno se razlikuju), ali **oba mapiraju na Woo `cancelled`** — v. „Razdvajanje Otkazano/Vraćeno". Pri prelasku u bilo koji od ta dva statusa **razlog (napomena) je obavezan**.
- Svaki proizvod ima bar jednu varijantu (i bez pravih varijanti — „default" varijanta); porudžbina uvek gađa varijantu **po SKU**.
- Poštarina/težina/broj paketa se popunjavaju na koraku **„Poslato"**, ne na kreiranju.
- **Faktura drugu = automatski izračunata cifra + spisak porudžbina/stavki u app-u. Bez PDF fakture.** (PDF postoji samo za listu za slanje — Korak 1.5.)
- Troškovi ne diraju fakturu; reklame se unose zbirno i ručno; bez ponavljajućih troškova.
- Meta integracija, XExpress API i auto-decrement inventara **NISU u Fazi 1.**
- **Auth: Supabase Auth** — 3 fiksna interna korisnika + 1 vendor, bez javne registracije, native RLS.

---

## 4. Centralni princip: zamrznute cene (snapshot) — NE DIRATI bez potvrde

Razlog: u Sheetsu se desio bag — promena cene je retroaktivno promenila zaradu starih porudžbina.

- **Katalog** (`product_variants`) drži *trenutne* MP, VP, zaradu.
- **Stavke porudžbine** (`order_items`) u trenutku kreiranja **kopiraju** tadašnju MP, VP, zaradu i **zamrznu ih**.
- Svi izveštaji/fakture/profit čitaju **isključivo** iz zamrznutih stavki, **nikad iz kataloga**.
- Edit MP na konkretnoj stavci (popust) menja **samo zamrznutu vrednost te stavke**; VP i katalog se ne diraju.
- Važi i za backfill (Korak 1.3) i za edit stavki (Korak 1.2).

**Edge case — nepoznat SKU:** stavka se kreira sa `sku` + `product_name` + `mp_at_sale`, `vp_at_sale` prazno → porudžbina dobija flag `needs_vp`; kad admin naknadno unese VP, flag se skida i profit postaje tačan.

---

## 5. Tehničke konvencije (poštovati svuda)

- **Timezone `Europe/Belgrade`** za sve — T+1 logiku uplata, cron, datume porudžbina, izveštaje. Cron na Vercelu je **UTC** → preračunati (koristiti `date-fns-tz` za logiku; cron postaviti na fiksni UTC i tolerisati ±1h zbog letnjeg računanja, ili dva cron unosa).
- **Cene: `integer` u RSD, bez decimala** (12500 = 12.500 RSD). **Bez float tipova bilo gde u finansijama.** Prikaz kroz `rsd()` helper (dizajn dok. sekcija 7).
- **Generisane kolone (Postgres):** `profit = mp_price - vp_price` (katalog) i `profit_at_sale = (mp_at_sale - vp_at_sale) * quantity` (stavke) kao `GENERATED ALWAYS AS ... STORED`. `profit_at_sale` je null dok nema VP.
- **Soft delete / arhiviranje:** proizvodi i varijante se **ne brišu** ako imaju istorijske porudžbine — dobijaju `archived_at`. Arhivirani ne izlaze u pretrazi/izboru, ali istorija i izveštaji ostaju netaknuti.
- **Webhook sigurnost:** provera WooCommerce HMAC potpisa (`x-wc-webhook-signature`) na svakom pozivu; odbaciti bez validnog potpisa; ruta ne sme otkriti ništa u error odgovorima.
- **Idempotentnost:** upsert po `woo_order_id` — ponovljeni webhook (Woo retry) ne pravi duplikate.
- **RLS je izvor sigurnosti, UI je samo higijena** — svaka provera pristupa mora postojati na nivou baze/servera, ne samo u navigaciji. Logistika vidi `products`/`product_variants` samo kroz restriktovani view (bez `mp_price`, `vp_price`, `profit`) ili column-level GRANT; sve finansijske tabele (orders, order_items, invoices, payouts, expenses) logistici potpuno nedostupne.
- **Validacija:** `zod` na svim server akcijama i API rutama, uz jedinstven error/toast obrazac.

---

## 6. Tehnološki stack

- **Framework:** Next.js (App Router) + TypeScript.
- **Stilizacija:** Tailwind CSS + shadcn/ui, prebojen po `docs/Sportem-Dizajn-Sistem.md` (Geist / Geist Mono, tnum brojevi, brend zelena `#1B7A45`).
- **Baza + Auth + Storage:** Supabase (Postgres, Supabase Auth, Storage za slike, native RLS). Migracije preko Supabase CLI.
- **Hosting + cron:** Vercel (auto-deploy sa GitHub-a na `main`, preview na PR, Vercel Cron).
- **PWA:** Serwist (service worker, manifest, push).
- **PDF (lista za slanje):** `@react-pdf/renderer` — radi na Vercel serverless. **Puppeteer/Chromium NE koristiti.**
- **Monitoring:** Sentry (besplatan tier) — greške servera i klijenta.

---

## 7. Struktura foldera

> Nastaje u Koraku 0.1 (`create-next-app`). Trenutno postoji samo `docs/`.

```
app/                 # Next.js App Router (rute, layout, server akcije)
components/           # UI komponente (shadcn/ui + brend obrasci)
lib/                 # helperi (rsd(), num(), getUser(), requireRole(), supabase klijenti)
db/                  # tipovi/upiti vezani za bazu
supabase/
  migrations/        # SVE izmene šeme idu ovde (nikad dashboard)
docs/                # kontekst, plan, dizajn sistem (izvori istine)
CLAUDE.md            # ovaj fajl
```

---

## 8. Komande

```bash
npm run dev            # lokalni dev server (Next.js)
supabase start         # lokalna Postgres instanca (razvoj bez produkcione baze)
supabase db push       # primeni migracije iz supabase/migrations
# testovi: dopuniti kad se postave (Korak 0.1+)
```

---

## 9. Zlatno pravilo (doslovno)

> **„Pre bilo koje izmene šeme baze pročitaj `docs/sportem-kontekst.md`; migracije samo kroz `supabase/migrations`; nikad ne diraj snapshot (zamrznute cene) logiku bez eksplicitne potvrde."**

---

## 10. Napomene / razrešene kontradikcije

- Dizajn dokument (sekcija 4, „Tabela") kao primer praznog stanja navodi „Dodaj ručnu prodaju" — **to je zastarelo.** Po zaključanoj odluci nema ručnog kreiranja porudžbina; prazno stanje glasi **„Nema porudžbina za ovaj period"** (bez akcije).
- Grana za produkciju/deploy je **`main`**.

**Korak 0.4 — razrešene odluke o bazi (potvrđene sa korisnikom):**
- **Cloud + CLI, BEZ Docker-a.** Ne koristi se `supabase start` / lokalni Postgres. Šema se piše kao migracioni fajl u `supabase/migrations` i šalje na cloud kroz `supabase db push` (poštuje pravilo „migracije samo kroz `supabase/migrations`", samo bez lokalne kopije). `supabase/seed.sql` se primenjuje jednokratno na cloud (`psql -f` ili SQL editor) — seed su test podaci, nije šema.
- **`role`, `delivery_method`, `payment_status` = `text` + `CHECK`** (ne Postgres enum) — lakše menjanje bez `ALTER TYPE` migracija. `order_statuses` ostaje lookup tabela (podesivo).
- **Adresa porudžbine = eksplicitne snapshot kolone** (`ship_name`, `ship_phone`, `ship_address`, `ship_city`, `ship_postal_code`, `ship_note`), ne JSON — čitljivije za PDF listu za slanje.
- **RLS je uključen deny-by-default** na svim tabelama u 0.4, ali **bez politika**. Politike po roli, restriktovani view za logistiku i Supabase Auth su **Korak 0.5**. `@supabase/*` klijentski paketi se instaliraju u 0.5 (0.4 nema runtime Supabase zavisnost).
- **Seed je razdvojen na trajno i privremeno:** `supabase/seed.sql` = trajni bootstrap config (statusi porudžbine + kategorije troškova) — ostaje i u produkciji. `supabase/dev-fixtures.sql` = lažni test podaci (katalog, kupci, porudžbine) sa fiksnim UUID-jevima. **Pre backfill-a (1.3) i uključivanja webhooka (1.2) OBAVEZNO pokrenuti `supabase/dev-fixtures-teardown.sql`** — briše samo fixtures po UUID-u, ne dira prave podatke (nasumični UUID) ni trajni config.

**Korak 0.5 — razrešene odluke o auth-u i RLS-u (potvrđene sa korisnikom):**
- **Rola se čita kroz `public.current_app_role()`** — SQL funkcija `SECURITY DEFINER` + prazan `search_path`, čita `profiles.role` za `auth.uid()`. Sve RLS politike je koriste. (Nije korišćen JWT custom-claim hook — funkcija je dovoljna za mali tim i ne traži dashboard config.)
- **Logistika i katalog = restriktovani view `product_variants_public`** (bez `mp_price`/`vp_price`/`profit`), `security_invoker = false`. Column-level GRANT po roli **nije izvodljiv** jer Supabase koristi jednu Postgres rolu `authenticated` za sve ulogovane korisnike — razlika po roli je samo kroz `current_app_role()`. Base `product_variants` čitaju samo Admin/Menadžer; Logistika gađa view. **Aplikacija za Logistiku bira view kao izvor.**
- **Menadžer = read-only na nivou RLS-a u Fazi 0.** Vidi sve Sportem podatke (porudžbine, finansije, katalog), ali write politike pokrivaju samo Admina. Ciljani write za Menadžera (npr. promena statusa u 1.4) dodaje se kad se grade ti ekrani. **Write kroz server ide preko service role klijenta** (`lib/supabase/admin.ts`) koji zaobilazi RLS (webhook, cron, invite, seed).
- **Nalozi:** prvi Admin se kreira **ručno u Supabase dashboardu** (Authentication → Add user) + poveže kroz `supabase/profiles.sql` (mapiranje po e-mailu). **Menadžera i Logistiku Admin dodaje IZ APLIKACIJE** — ekran `/korisnici` (admin-only) šalje invite kroz `auth.admin.inviteUserByEmail` i odmah upisuje `profiles` red sa rolom. Pozvani postavlja lozinku kroz `/auth/callback` → `/postavi-lozinku`.
- **Bez javne registracije:** `enable_signup=false` (config.toml lokalno + **na cloud-u u dashboardu**). Invite ne zavisi od signup-a. Za invite redirect na cloud-u dodati `NEXT_PUBLIC_APP_URL/auth/callback` u Auth → URL Configuration (Redirect URLs).
- **Zaštita ruta:** `proxy.ts` (Next 16 „proxy" konvencija — bivši `middleware.ts`) refreshuje sesiju i redirektuje neulogovane na `/prijava`; javne rute su `/prijava`, `/postavi-lozinku`, `/auth/*`. Helperi `getUser()`, `getProfile()`, `requireUser()`, `requireRole()` su u `lib/auth.ts` (logika sesije u `lib/supabase/middleware.ts`).
- **RLS test:** `npm run rls:test` (`scripts/rls-test.mjs`) — loguje se kao Logistika i dokazuje da cene/porudžbine/finansije vraćaju 0 redova, a view/proizvodi rade; Admin vidi sve. Kredencijali kroz env (`RLS_TEST_*`), preduslov su učitani dev-fixtures + test nalozi.

**Korak 0.6 — Sentry (server + client), potvrđeno sa korisnikom:**
- **Ručno wiring** (bez `@sentry/wizard`): `instrumentation.ts` (`register()` + `onRequestError`), `instrumentation-client.ts` (`onRouterTransitionStart`), `sentry.server.config.ts`, `sentry.edge.config.ts`, `app/global-error.tsx`. `next.config.ts` je wrap-ovan `withSentryConfig`.
- **Obim:** greške (server+client) + performance tracing na **0.1 (10%)**; **Session Replay isključen** (client bundle + free-tier kvota). Uključiti `replayIntegration` kasnije ako zatreba vizuelni debug.
- **Env:** `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (tajna, samo build) u Vercel; `SENTRY_ORG`/`SENTRY_PROJECT` (nisu tajna) čitaju se u `next.config.ts`. Bez auth tokena upload source-map-a se tiho preskače.
- **Test:** verifikovano preko privremene rute `/sentry-test` (server greška stigla u dashboard), pa uklonjena. `tunnelRoute: "/monitoring-tunnel"` zaobilazi ad-blocker-e.

**Korak 0.7 — PWA skelet (Serwist), potvrđeno sa korisnikom:**
- **Biblioteka:** `@serwist/next` (v9, webpack plugin) + `serwist`. **Build MORA biti `next build --webpack`** (`package.json` skripta izmenjena) — Serwist radi kroz webpack, a Next 16 podrazumevano gradi Turbopack-om koji NE pokreće plugin (tada tiho nema `sw.js`). Dev ostaje `next dev` (Turbopack); SW je **isključen u dev-u** (`disable` na `NODE_ENV==="development"`). PWA se testira samo kroz `npm run build && npm start` ili Vercel deploy. (NIJE korišćen `@serwist/turbopack` — ostaje zaključana biblioteka.)
- **`next.config.ts` nesting:** `withSentryConfig(withSerwist(nextConfig), {...})` — Serwist unutra, Sentry spolja.
- **Online-only keš (ustav):** `app/sw.ts` NE koristi `defaultCache`. Vlastiti konzervativni `runtimeCaching`: samo `/_next/static/*` (CacheFirst) i brend asseti `/icons/*` + manifest (SWR). `cacheOnNavigation: false`, bez precache navigacionog fallback-a → navigacije, Supabase, `/api/*` i Sentry tunel idu **network-only**. Nikad se ne servira zastarela finansijska/auth stranica offline. Push handler NIJE ovde (Korak 1.9). SW se **auto-registruje** (plugin) — nema ručne registracije.
- **Manifest:** `app/manifest.ts` → `/manifest.webmanifest` (`name`/`short_name` „Sportem", `display: standalone`, `theme_color: #1B7A45`, `background_color: #F5F7F5`, `lang: sr`). `themeColor` ide u **`viewport`** export u `layout.tsx` (Next 16), + `metadata.appleWebApp`.
- **Ikonice:** privremeni **„S" monogram** (beli „S" na zelenoj `#1B7A45`), generisan skriptom `scripts/generate-icons.mjs` (`sharp`) — `npm run icons`. Izlaz: `public/icons/icon-192|512.png`, `public/icons/maskable-512.png`, `app/icon.png`, `app/apple-icon.png`. **Zamenljivo kad stigne pravi logo** — zameniti SVG izvor u skripti i ponovo pokrenuti; imena/dimenzije ostaju iste.
- **`proxy.ts`:** matcher isključuje `sw.js`, `manifest.webmanifest`, `swe-worker-*.js` (dostupni bez auth-a — inače SW/manifest padnu na redirect ka `/prijava`).
- **Gitignore:** generisani `public/sw.js`, `public/sw.js.map`, `public/swe-worker-*.js` se NE commit-uju (build artefakti); i u ESLint global-ignores.

**Korak 1.2 — WooCommerce webhook + edit stavki (potvrđeno sa korisnikom):**
- **Ruta:** `app/api/webhooks/woo/route.ts` — `order.created` i `order.updated` gađaju ISTU rutu. HMAC-SHA256 (base64) nad sirovim telom, `timingSafeEqual`; helperi u `lib/woo.ts` (`verifyWooSignature`, `normalizePhone`, `parseRsd`, loose zod šema, status mapping). `/api/webhooks` je u `PUBLIC_PATHS` (`lib/supabase/middleware.ts`) — inače bi POST bio redirektovan na `/prijava`.
- **Stavke se upisuju SAMO pri prvom prijemu porudžbine.** `order.updated` NIKAD ne dira `order_items`, iznose, adresu ni kupca — sinhronizuje samo `woo_status` + otkazivanje. Woo izmene stavki admin unosi ručno kroz edit. (Odluka korisnika — štiti snapshot i admin popuste.)
- **Otkazivanje:** Woo `cancelled|refunded|failed|trash` → app „Otkazano/Vraćeno" + `cancelled_at`. Ako je porudžbina fakturisana ILI `payment_status != 'neuplaceno'` → status se NE menja, postavlja se `needs_review` + `review_reason` (kolone dodate migracijom `20260709150000_orders_webhook.sql`, uz `woo_status` za dijagnostiku). `completed` u Woo NE pomera app status (Poslato/Isporučeno vodi app).
- **mp_at_sale = round(line.total / quantity)** — stvarno naplaćeno posle popusta (fallback `price`); `vp_at_sale` = trenutni `vp_price` varijante po SKU lookup-u. `goods_total` = Σ line totals (može odstupati od Woo `total - shipping_total` kod kupona na nivou korpe — prihvatljivo, profit ide iz stavki). `delivery_method` default `'xexpress'`; lične/keš prodaje se ručno označavaju (1.4). `cod_amount` samo za `payment_method='cod'`.
- **Status lookup po IMENU** iz `order_statuses` („Kreirano", „Otkazano/Vraćeno") — nikad hardkodovan UUID. Telefon kupca normalizovan (`+381`/`00381`/`381` → `0…`) pre dedup-a po `customers.phone`.
- **Greške:** pogrešan potpis → 401 prazno; nevalidan payload → 200 + Sentry (da Woo ne retry-uje); interna greška → 500 (Woo retry; idempotentno). Woo „ping" (`webhook_id=N` form-encoded ili JSON) → 200. Nema DB transakcije — na fail inserta stavki order se briše pa Woo retry ponovi ceo tok.
- **Edit stavki (Admin):** `app/(app)/porudzbine/actions.ts` — izmena `mp_at_sale`/količine, brisanje, dodavanje iz kataloga (snapshot trenutnih cena), unos VP (`setItemVp` auto-sinhronizuje `needs_vp`). Sve blokirano kad je `invoice_id` postavljen. Upiti u `db/orders.ts`; minimalni UI lista + detalj (pun UX u 1.4).
- **Test:** `npm run woo:test` (`scripts/woo-webhook-test.mjs`) — 30 provera (snapshot, idempotentnost, needs_vp, otkazivanje, needs_review guard, potpis, ping, dedup telefona); traži `npm run dev` + `WOO_WEBHOOK_SECRET` u `.env.local`. **Pre uključivanja pravog webhooka:** teardown dev-fixtures (woo_order_id 1001/1002 sudar) + isti secret u Woo i Vercel env; URL `https://app.sportem.rs/api/webhooks/woo`.

**Korak 1.3 — Backfill istorijskih porudžbina (potvrđeno sa korisnikom):**
- **Izvor istine za istoriju = `docs/backfill/porudzbine.csv`** (finalni Sheets izvoz, 941 porudžbina, 02.02–08.07.2026). Woo REST API se koristi SAMO za `--reconcile` (poređenje) jer Woo NE nosi VP/zaradu. Skripta: `scripts/woo-backfill.mjs`; komande `npm run backfill` (dry-run, default) i `npm run backfill:apply`.
- **VP rekonstrukcija (zamrznute cene):** `mp_at_sale = Cena` (po komadu iz CSV-a), `vp_at_sale = round(Cena − Zarada/Količina)` — `Zarada po proizvodu` je PO STAVCI (već ×kol), `Cena` PO KOMADU. Reprodukuje CSV zaradu 0 RSD greške na svih 1571 stavki. Prazna `Zarada` (145 stavki) → `vp_at_sale` null + `needs_vp`. NIKAD iz današnjeg kataloga.
- **CSV brojevi su mešani** (`parseRsd` razlikuje): srpske hiljade „3.000"→3000 vs decimale „4990.00"→4990. `Cena`/`Zarada` nikad nemaju decimale; samo `Ukupna cena porudžbine` ih ponegde ima (koristi se samo za dijagnostiku; čuvamo `goods_total = Σ Cena×kol`).
- **Mapiranje statusa** (lookup po imenu): `Completed`→Isporučeno · `Poslato`→Poslato · `Processing`→Kreirano · `Returned`/`Cancelled`→Otkazano/Vraćeno. **delivery_method:** `BEX`/`X Express`/prazno→`xexpress`; `Miša`/`Marko`/`Vozač`→`licno`.
- **Tri toka novca (izolacija iz budućih finansija):** `licno`+plaćeno→`payment_status='kes'`, bez fakture; `xexpress`+`Completed`+plaćeno→`uplaceno` + `invoice_id` sintetičke fakture **`ISTORIJA-BACKFILL`** (isključuje iz novih faktura i „drug mi duguje"); `xexpress` otvoreno (Processing/Poslato)→`neuplaceno`, bez fakture → **teče u živi app**; otkazano→cancelled_at. Reverzibilnost: `delete orders where invoice_id=<backfill>` + otvorene po `woo_order_id` opsegu (1594–2796).
- **Datumi:** `ordered_at` iz CSV „Datum" (Europe/Belgrade→UTC, CET/CEST preko `Intl`); `delivered_at`/`paid_at` ≈ `ordered_at` (CSV nema tačan datum isporuke — aproksimacija).
- **Idempotentnost** po `woo_order_id`; ponovni `--apply` → 0 novih. `--reconcile` (traži `WOO_API_URL`+ključeve) prijavljuje Woo-only (najnovije koje fale) i DB-only; `--apply-gap` uveze Woo-only webhook-mapiranjem (VP iz kataloga jer su skorašnje).
- **Verifikacija:** dry-run kontrolni zbir zarade (app-mapiranje == CSV „Zarada") = **0 RSD razlike** (dokazano). 2 porudžbine (`#1807`, `#2239`) imaju stvarno Sheets neslaganje `Ukupna cena` vs Σstavke — informativno, ne dira profit. **Pre `--apply`:** teardown dev-fixtures (higijena).

**Korak 1.6 — Finansije (payout / faktura / poštarina / neto profit), potvrđeno sa korisnikom:**
- **Podeljen na 3 pod-koraka**, svaki svoj commit, grana `korak-1.6-finansije`: **1.6a** uplate (payout T+1) + spisak za druga; **1.6b** faktura drugu + „drug mi duguje"; **1.6c** saldo poštarine + neto profit + overview. Sav kod pod `app/(app)/finansije/` (`db/finance.ts`, `lib/validation/finance.ts`, `actions.ts`, rute `uplate/**`, `fakture/**`, `postarina/**`). Sve **Admin-only** za write; Menadžer čita, Logistika ništa (RLS).
- **Migracija `20260710120000_finansije.sql` (u 1.6a):** nova tabela **`postage_settlements`** (append-only ledger poravnanja poštarine — `amount int` sa **predznakom**, `balance_before` snapshot salda, `created_by`; RLS select admin+manager / write admin) + **view `order_profit`** (`security_invoker=true`, `Σ profit_at_sale` po `order_id`; grant select `authenticated`). Ostale finance tabele/kolone već postoje iz 0.4. **1.6c nema migraciju.**
- **Zamrznute cene (ustav):** sve cifre isključivo iz `order_items.profit_at_sale` kroz `order_profit` view — **nikad iz kataloga**. 1.6 NE piše `order_items`. Zarada po porudžbini se čita zasebnim upitom nad view-om + JS map (`profitByOrder`), ne PostgREST embed nad view-om.
- **Status po IMENU** (`deliveredStatusId()` → `APP_STATUS.delivered`), nikad hardkodovan UUID. Eligibility se **rekompjutuje server-side** u akcijama (`assertLinkable`/`assertInvoiceable`) — ne veruje se klijentskoj listi (guard za stale/konkurentno).
- **Uplate (1.6a):** predlog = svi isporučeni+neuplaćeni xexpress, **pred-čekiran T−1 radni dan**; vezivanje → `payment_status='uplaceno'` + `paid_at` + `payout_id`. Brisanje/izmena: FK je `SET NULL`, akcija **eksplicitno** vraća `payment_status`/`paid_at`; fakturisane vezane porudžbine se ne smeju od-vezati. Spisak za druga (byOrder/byArticle) — Kopiraj/Štampaj, **bez PDF-a**.
- **Faktura (1.6b):** **broj fakture = ručni unos** (jedinstvenost `invoices.invoice_number UNIQUE` → `23505` → srpska poruka). Kandidati: xexpress+Isporučeno+`uplaceno`+`invoice_id null`+`needs_vp=false`; `total_amount = Σ profit` (snapshot u trenutku izdavanja). Izdavanje postavlja `invoice_id` → stavke se zaključavaju (`assertEditable` u porudžbinama). „Drug mi duguje" = Σ istih kandidata. `needs_vp` porudžbine tvrdo isključene + vidljivo upozorenje. Brisanje re-otvara kandidate; **`placeno` faktura i `ISTORIJA-BACKFILL` zaštićeni**.
- **Saldo poštarine (1.6c):** prolazna stavka (NIJE profit). `gross = Σ(shipping_charged − shipping_actual)` (oba NOT NULL), `settled = Σ postage_settlements.amount`, `balance = gross − settled` (može biti negativan → schema BEZ `min(0)`). „Poravnaj keš" = settlement `amount = balance` (UI pred-popuni) → saldo 0; `balance_before` snima saldo u tom trenutku.
- **Neto profit (1.6c):** `zarada = Σ profit_at_sale` za realizovane porudžbine (status=Isporučeno, `payment_status IN ('uplaceno','kes')`, `needs_vp=false`) u izabranom **mesecu** (filter po Belgrade datumu na `delivered_at`), `troskovi = Σ expenses.amount` (0 do 1.7), `neto = zarada − troskovi`. Keš prodaje ulaze u zaradu ali nikad u payout/fakturu.
- **Overview:** `/finansije` je pravi pregled (3 kartice: Drug mi duguje / Saldo poštarine / Neto profit sa izborom meseca `?mesec=YYYY-MM`); tabovi vode na pod-rute (`finance-tabs.tsx`).
- **Vreme — odstupanje od §5:** NE koristi se `date-fns-tz`. Sva Belgrade logika kroz `Intl` + `timeZone: "Europe/Belgrade"` (`lib/format.ts`, `lib/date-belgrade.ts`: `belgradeDate`, `todayBelgrade`, `previousWorkingDay`). Mesečne granice: širok UTC pred-filter + tačan JS filter po `belgradeDate` (bez konverzije UTC granica). Konzistentno s kodbazom, bez nove zavisnosti.

**Korak 1.7 — Troškovi (potvrđeno sa korisnikom):**
- **Grana `korak-1.7-troskovi`.** Kod: `app/(app)/troskovi/**` (`actions.ts`, `page.tsx`, `expense-dialog.tsx`, `expense-actions.tsx`, `category-manager.tsx`, `attachment-input.tsx`), `db/expenses.ts`, `lib/validation/expenses.ts`, `lib/storage.ts` (dopuna). Sve **Admin-only** za write; Menadžer čita; Logistika nema pristup (RLS iz 0.4/0.5). Nav stavka `/troskovi` (STAFF, sekundarni meni) je već postojala.
- **Tabele/šema već postoje** iz `20260708164149_init_schema.sql` (`expenses` uklj. `attachment_path`, `expense_categories`, indeksi, `updated_at` trigger) + RLS iz `20260708172800_rls_policies.sql` (select admin+manager / write admin) + seed kategorije (Reklame, Pakovanje, Ostalo). **Nema migracije za tabele.**
- **Migracija `20260710140000_storage_expense_attachments.sql`:** novi **privatni** Storage bucket **`expense-attachments`** (`public=false`, limit 5 MiB, mime slike **+ `application/pdf`**). Politike na `storage.objects` scoped `bucket_id`: **select admin+manager** (privatan — NE svi authenticated, za razliku od javnog `product-images`), insert/update/delete admin. Prikaz priloga isključivo kroz **signed URL** (`createSignedUrl`, 1h) — nikad javni URL; helperi `uploadExpenseAttachment`/`deleteExpenseAttachment`/`expenseAttachmentUrl` u `lib/storage.ts` (bez `sharp` — prilog može biti PDF).
- **Neto profit integracija je „besplatna":** `getNetoProfit()` u `db/finance.ts` već sumira `Σ expenses.amount` po mesecu (filter na `date` kolonu, bez TZ konverzije) — čim ima redova, kartica „Neto profit" na `/finansije` je živa. Akcije rade `revalidatePath("/troskovi")` **i** `revalidatePath("/finansije")`. **Troškovi ulaze u neto profit, nikad u fakturu; ne diraju `order_items` ni snapshot.**
- **UI:** filter po mesecu (`?mesec=YYYY-MM`, kao overview finansija), zbir + desktop tabela / mobilne kartice, dijalog za dodaj/izmeni (FormData zbog priloga, kao katalog), lagani inline CRUD kategorija (`category-manager.tsx`, obrazac iz `katalog/category-dialog.tsx`); brisanje kategorije → `ON DELETE SET NULL` (trošak ostaje bez kategorije). Prilog se otvara sinhrono otvorenim tab-om + signed URL (izbegava popup blocker).
- **Pre produkcije:** `supabase db push` (kreira bucket + politike) + live klik-test. Vreme/mesečni filter isti pristup kao 1.6 (`Intl` Europe/Belgrade, bez `date-fns-tz`).

**Status sync app → WooCommerce (potvrđeno sa korisnikom):**
- **Prvi write ka Woo-u.** Do sada je Woo bio samo izvor webhook-a (Woo→app, jednosmerno); sada promena statusa u app-u **gura** status i u WooCommerce preko Woo REST API-ja (PUT `/orders/{woo_order_id}`, Basic auth iz `WOO_API_URL`/`WOO_CONSUMER_KEY`/`WOO_CONSUMER_SECRET` — isti obrazac kao GET u `scripts/woo-backfill.mjs`). Klijent: `lib/woo-client.ts` (`updateWooOrderStatus`, `server-only`, 10s AbortController timeout).
- **Mapiranje app→Woo** (`wooStatusForApp()` u `lib/woo.ts`, uz `APP_STATUS`): `Kreirano`/`Poslato`→`processing` (Woo nema poseban „poslato" status), `Isporučeno`→`completed`, `Otkazano/Vraćeno`→`cancelled`; custom (ne-seed) status → `null` (ne gura se). Keš/lične (`licno`) prodaje se **takođe** guraju (`markCashSale`→`completed`).
- **Best-effort (app = izvor istine):** push je u `app/(app)/porudzbine/actions.ts` kroz `pushWooStatus()` helper — **posle** uspešnog DB update-a + `order_status_history` inserta. Woo greška (nedostaje env / mreža / timeout / ne-2xx) → `Sentry.captureException` + vraća `false`; **nikad** ne obara ni rollback-uje app promenu. Upozorenje „(WooCommerce nije ažuriran — proveri kasnije.)" putuje kroz postojeću `success` poruku akcije (bez izmena UI komponenti). Pozvano u `changeOrderStatus`, `markCashSale`, `markOrdersShipped` (bulk broji `wooFailed`). `resolveReview`/`updateShipping` NE guraju (ne menjaju `status_id`).
- **Nema petlje app→Woo→webhook→app:** webhook `syncExistingOrder` reaguje samo na otkazane Woo statuse; `processing`/`completed` samo osveže `woo_status`. Kod otkazivanja guard `!existing.cancelled_at` sprečava reobradu (app je već postavio `cancelled_at`). Bez migracije (koristi postojeći `orders.woo_order_id`).
- **Pre produkcije:** dodati `WOO_API_URL`/`WOO_CONSUMER_KEY`/`WOO_CONSUMER_SECRET` u **Vercel env** (do sada samo lokalno u backfill skripti); Woo consumer ključ mora imati **Write** dozvolu (do sada samo GET). Bez env-a push tiho postaje soft-fail (upozorenje na svakoj promeni statusa).

**Korak 1.9 — Push notifikacije (potvrđeno sa korisnikom):**
- **Grana `korak-1.9-push`.** Zavisnost **`web-push`** (VAPID sign/send, `@types/web-push`). Tabele `push_subscriptions` + `notification_log` i RLS **već postoje** iz 0.4/0.5 (`push_subscriptions_own`; `notification_log` RLS enabled bez politika = samo service-role) → **bez migracije**.
- **Server jezgro `lib/push.ts`** (`server-only`): `notifyRoles(type, referenceId, roles, payload)` — kroz `createAdminClient()` (bypass RLS) nađe pretplate korisnika traženih rola (dva upita: `profiles` po roli → `push_subscriptions` po `user_id`, jer nema direktnog FK), pa fan-out `webpush.sendNotification` (Promise.allSettled). **Redosled bitan:** pretplate se traže PRE dedup log-a — ako niko nije pretplaćen, ne „troši" se dedup ključ. **Dedup:** insert `(type, reference_id)` u `notification_log` → `23505` = već poslato, izlazi. Mrtvi endpoint (`410`/`404`) se **briše** iz `push_subscriptions` (self-cleanup). `notifyRoles` NIKAD ne baca (best-effort; Sentry). Bez VAPID ključeva → tiho no-op. NE dira snapshot/finansije.
- **Pretplata (per-uređaj):** authed rute `app/api/push/subscribe|unsubscribe/route.ts` (user-scoped `createClient()`, RLS `push_subscriptions_own`; NISU u `PUBLIC_PATHS`). Ručni „upsert" (delete po `subscription->>endpoint` + insert). Klijent hook `components/push/use-push.ts` (`navigator.serviceWorker.ready` + `pushManager`, `urlBase64ToUint8Array`, `Uint8Array<ArrayBuffer>` zbog TS), toggle `app/(app)/obavestenja/**` — **nova ruta dostupna SVIM rolama** (ne `/podesavanja` koji je admin-only), nav `/obavestenja` (Bell, `ALL`, sekundarni). Radi SAMO u prod build-u (SW isključen u dev-u).
- **SW handleri `app/sw.ts`** (posle `serwist.addEventListeners()`): `push` → `showNotification` (payload JSON, `icon`/`badge` = `/icons/icon-192.png`, `tag` dedup na uređaju, `data.url`); `notificationclick` → fokus postojećeg prozora + `client.navigate(url)` ili `openWindow`. Ne dira `runtimeCaching` (online-only ustav).
- **Okidač nova porudžbina:** u `insertOrder()` (`app/api/webhooks/woo/route.ts`), u `else` grani (NE za odmah-otkazane), best-effort `notifyRoles("new_order", String(order.id), ["admin","manager"], …)` sa linkom `/porudzbine/{id}`. `reference_id = woo_order_id` → dedup na Woo retry.
- **Cron (jedan dnevni, Hobby-friendly):** `app/api/cron/notifikacije/route.ts` (GET, guard `Authorization: Bearer ${CRON_SECRET}` → 401 prazno). `vercel.json` cron `0 18 * * *` (UTC ≈ 19–20h Beograd; ruta bira dan/datum interno preko `todayBelgrade` + `getUTCDay` obrazac iz `date-belgrade.ts`). `/api/cron` dodat u `PUBLIC_PATHS` (sam se autentifikuje, kao `/api/webhooks`). Okidači: **svaki dan** low stock (`ALL` role, replika `getLowStockVariants` logike sa admin klijentom) + isporučeno-neuplaćeno (`STAFF`); **ned(0)/sre(3)** podsetnik za slanje (`STAFF`); **1./15.** podsetnik na fakturu (`STAFF`, isti kandidati kao „drug mi duguje"). Status po IMENU (`APP_STATUS.delivered`). Srpska množina helper `plural()`.
- **Ciljanje po roli:** Admin+Menadžer sve; **Logistika SAMO low stock** (zaključana odluka). Pretplata je per-uređaj (svaki browser/telefon zasebno).
- **Env:** VAPID ključevi generisani i upisani u `.env.local` (`node -e "require('web-push').generateVAPIDKeys()"`); `CRON_SECRET` (openssl rand -hex 32) u `.env.local` + `.env.example`. **Pre produkcije:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`CRON_SECRET`/`NEXT_PUBLIC_APP_URL` u **Vercel env**; QA push na realnim uređajima (bratov Android) je deo 1.10. Verifikovano: cron auth (401/200) + izbor okidača po danu radi (live smoke test).

**Korak 1.9 dopuna — preference obaveštenja + email kanal (Resend), potvrđeno sa korisnikom:**
- **Odluka promenjena:** korisnik može da bira **koja** obaveštenja prima, **da li uopšte** (master prekidač), i **kanal** (push / email / oba) po tipu. Time je **email dodat u Fazu 1** (ranije eksplicitno isključen) — kanal je opcioni i per-korisnik.
- **Migracija `20260711120000_notification_preferences.sql`:** tabela `notification_preferences` (`user_id` PK → auth.users, `enabled` bool master, `prefs` jsonb `{ "<type>": {push,email} }`, `updated_at` trigger). RLS `notification_preferences_own` (svaki korisnik svoj red; service-role u fan-out-u zaobilazi). **Pre produkcije `supabase db push`** — bez toga email/čuvanje preferenci ne rade (push i dalje radi jer fan-out pada na default kad tabele nema).
- **Default (postojeći korisnici bez reda):** sve uključeno, **kanal = push** (email off dok se ručno ne uključi). `lib/notifications.ts` (deljeno klijent/server): `NOTIFICATION_TYPES` (5 tipova + role), `DEFAULT_CHANNEL = {push:true,email:false}`, `resolveChannel()`.
- **Email `lib/email.ts` (Resend, `server-only`):** `sendEmail(to, subject, body, url)` + `emailConfigured()`. Bez `RESEND_API_KEY` tiho no-op (kao VAPID). `EMAIL_FROM` default `obavestenja@sportem.rs`. HTML je brend-neutralan inline template. Email adresa se čita iz auth-a (`auth.admin.getUserById`) — `profiles` je ne drži.
- **`notifyRoles` prošireno:** za svakog korisnika role → master `enabled` guard → `resolveChannel(prefs, type)`; kanal se broji samo ako je konfigurisan (VAPID/RESEND). Dedup log se piše tek kad ima primaoca na nekom kanalu. Push kao pre; email po korisniku (`getUserById` → `sendEmail`). Sve i dalje best-effort.
- **UI `/obavestenja`:** dve sekcije — „Ovaj uređaj" (postojeći `PushSettings`, per-uređaj pretplata) + „Šta i kako da stiže" (`notification-preferences.tsx`: master prekidač + tabela tip × [Push][Email] checkbox-i, filtrirano po roli — Logistika samo „Nisko stanje"). Čuva se kroz server akciju `savePreferences` (`actions.ts`, zod, upsert sopstvenog reda). Statična „Šta ćeš dobijati" lista uklonjena (zamenjena preferencama).
- **Pre produkcije (dopuna):** `supabase db push`; `RESEND_API_KEY` + `EMAIL_FROM` u **Vercel env** (+ verifikovan domen na resend.com); bez toga email tiho ne šalje.

**Razdvajanje „Otkazano" / „Vraćeno" + obavezan razlog (potvrđeno sa korisnikom):**
- **Jedan status „Otkazano/Vraćeno" razdvojen na DVA:** „Otkazano" i „Vraćeno". Interno se razlikuju (operativno bitno), ali **oba mapiraju na Woo `cancelled`** (Woo ne razlikuje). Migracija `20260712140000_split_cancel_return_status.sql`: **preimenuje** postojeći red `…0a04` → „Otkazano" (crvena `#DC2626`) i **dodaje** „Vraćeno" `…0a05` (amber `#D97706`, sort 5). Stare porudžbine ostaju na `…0a04` (sada „Otkazano") — razlika ranije nije praćena, nema migracije podataka. `seed.sql` usklađen za sveže baze. **Pre produkcije: `supabase db push`.**
- **`lib/woo.ts`:** `APP_STATUS.cancelled = "Otkazano"`, novi `APP_STATUS.returned = "Vraćeno"`. Helper `CANCELLED_STATUS_NAMES` + `isCancelStatusName(name)` — „otkazna" logika (`cancelled_at`, gašenje toka, blokada bulk „Poslato", Woo `cancelled` push) važi za OBA. `wooStatusForApp`: i `returned` → `"cancelled"`.
- **Obavezan razlog:** pri prelasku u „Otkazano" ili „Vraćeno" napomena je **obavezna** — server (`changeOrderStatus`) vraća grešku ako je `note` prazan (server je izvor istine); upisuje se u `order_status_history.note`. UI: brza dugmad „Otkaži" i „Vrati" otvaraju **`ReasonDialog`** (`components/patterns/reason-dialog.tsx`, novi `components/ui/textarea.tsx`) sa obaveznim tekstom (potvrda onemogućena dok je prazno); ručna promena statusa isto zahteva razlog (placeholder „Razlog (obavezno)", „Sačuvaj" onemogućen). `order-status-control.tsx` NE uvozi `lib/woo` (server-only) — obaveznost se računa iz `flow.cancelled`/`flow.returned` id-jeva (novo `FlowIds.returned`, razrešeno u `[id]/page.tsx`).
- **Webhook auto-otkaz** (`app/api/webhooks/woo/route.ts`, `syncExistingOrder`): Woo `refunded` → „Vraćeno"; `cancelled`/`failed`/`trash` → „Otkazano". Webhook ne piše `order_status_history`, pa nema pitanja razloga tamo.
- **Nedirano:** snapshot/zamrznute cene; `db/customer-risk.ts` (rizik po `cancelled_at`, ne po nazivu — radi za oba); `db/finance.ts` (po „Isporučeno" + `payment_status`). Skripte `woo-backfill.mjs` (`Returned→Vraćeno`, `Cancelled→Otkazano`) i `woo-webhook-test.mjs` usklađene po nazivu.

**Vraćanje/otkazivanje PLAĆENE ili FAKTURISANE porudžbine — izričita Admin potvrda (potvrđeno sa korisnikom):**
- **Ranije ćorsokak:** ručni prelazak u „Otkazano"/„Vraćeno" na porudžbini koja je `invoice_id != null` ILI `payment_status != 'neuplaceno'` je samo postavljao `needs_review=true` i vraćao grešku; dugme „Razreši" (`resolveReview`) je čistilo oznaku ali **nije menjalo status** → status nikad nije mogao da pređe u Vraćeno/Otkazano (npr. plaćena backfill porudžbina). **Rešeno:** umesto mrtve „za proveru" oznake, `changeOrderStatus` sada vraća `requiresForce: true`; klijent (`order-status-control.tsx`) otvara dijalog „Plaćena porudžbina" → **„Ipak nastavi"** ponovo šalje akciju sa `force=true`.
- **`force` je Admin-only** (dira novac; Menadžer dobija grešku). Šema `changeOrderStatusSchema` ima `force` (bool/„true"). Razlog (`note`) i dalje **obavezan** i prosleđuje se kroz force round-trip.
- **Oznaka „plaćeno" se NE dira** (odluka korisnika): force menja samo `status_id` + `cancelled_at`, i čisti `needs_review`/`review_reason`. `payment_status`, `paid_at`, `payout_id`, `invoice_id` i snapshot ostaju netaknuti (novac je stvarno primljen; povraćaj je van app-a). Porudžbina automatski ispada iz neto profita jer status više nije „Isporučeno".
- **Webhook auto-otkaz je netaknut** — `syncExistingOrder` i dalje koristi `needs_review` za automatski (Woo→app) otkaz fakturisane/uplaćene; `ResolveReviewButton` ostaje za te slučajeve. Force put je samo za **namerne** ručne Admin akcije.

**Jasnija prazna stanja (Dashboard + Fakture), potvrđeno sa korisnikom:**
- **Dashboard** (`app/(app)/page.tsx`): kad izabrani period nema realizovanih porudžbina (`metrics.brojPorudzbina === 0`), ispod metrika stoji objašnjenje da metrike broje samo **isporučeno + plaćeno** (predlog: probaj drugi mesec) + link na `/finansije/uplate` ako ima isporučenih-neplaćenih. Podrazumevani period ostaje tekući mesec; logika računanja nedirana.
- **Fakture** (`app/(app)/finansije/fakture/page.tsx`): kad nema kandidata, „Za fakturisanje" boks objašnjava da faktura nastaje od isporučenih porudžbina **označenih kao plaćene** + link na Uplate. (Istorijske plaćene su namerno zaključane u `ISTORIJA-BACKFILL`.)

**Uplate: broj pored datuma = OTKUP, ne `cod_amount` (potvrđeno sa korisnikom):**
- Ekran uplata je prikazivao `cod_amount` (NULL na backfill/ne-COD porudžbinama → „0 RSD"). Sada se otkupnina računa iz podataka koji postoje: **`goods_total + (shipping_charged ?? 0)`** (vrednost robe + naplaćena poštarina). Helper `otkupOf` u `db/finance.ts`; `PayoutCandidate.otkup`, `PayoutRow.linkedOtkup`, `PayoutDetail.otkupTotal` (zamenili `cod_amount`/`linkedCod`/`codTotal`). UI nazivi „COD" → „Otkup"/„Otkupnina". Za backfill porudžbine poštarina je NULL → otkup = vrednost robe; žive porudžbine imaju punu poštarinu iz webhooka. Bez migracije; `cod_amount` kolona ostaje ali se ne koristi u uplatama. Način unosa iznosa uplate (ručno) netaknut.

**Dashboard metrike po datumu KREIRANJA (promenjena odluka, potvrđeno sa korisnikom):**
- **Ranije:** Dashboard kartice (Zarada / Neto profit / Broj porudžbina / Marža) su brojale samo *realizovane* (Isporučeno + plaćeno) po `delivered_at`. **Sada:** broje **sve porudžbine kreirane u periodu (`ordered_at`), OSIM statusa Otkazano/Vraćeno** — bez gledanja isporuke/plaćanja. Otkazana/vraćena automatski ispada (filter po statusu). Izmena je isključivo u `getDashboardMetrics` (`db/dashboard.ts`): isključeni status id-jevi preko `CANCELLED_STATUS_NAMES` (po imenu), filter na `ordered_at`, JS suženje po `belgradeDate(ordered_at)`. Zarada/promet/marža i dalje iz zamrznutih `order_items`. `needs_vp` porudžbine ulaze u broj (profit 0 dok nema VP). Tekstovi na `app/(app)/page.tsx` usklađeni (hint „Kreirano u periodu"; prazno-stanje bez „isporučeno+plaćeno").
- **NEDIRANO:** `getNetoProfit` (mesečni „Neto profit" na `/finansije`) ostaje **realizovan** (Isporučeno + `payment_status IN uplaceno/kes`, po `delivered_at`) — finansijski pregled = stvarno naplaćen novac, namerno različit od Dashboarda.

**URL porudžbine = Woo broj (potvrđeno sa korisnikom):**
- Ruta `/porudzbine/[id]` sada prima **`woo_order_id`** (npr. `/porudzbine/2419`) umesto UUID-a. **UUID ostaje rezerva**: `getOrderDetail(param)` (`db/orders.ts`) bira `woo_order_id` kad je param numerički (`/^\d+$/`), inače `id` — stari linkovi/push istorija i retke porudžbine bez Woo broja rade dalje. Svi linkovi koriste `${o.woo_order_id ?? o.id}` (lista, fakture, uplate, rizičan kupac); webhook push koristi `order.id` (Woo broj). **Mutacije (server akcije) i dalje idu preko internog UUID `order_id` iz FormData** — menja se samo URL/route i linkovi. `getOrderStatusHistory` se poziva sa `order.id` (UUID). `revalidateOrder` osvežava samo listu (detalj je `force-dynamic`).

**Jednokratni data-cleanup (uplate):** obrisane sve `payouts` sa `payout_date` 12–13.07.2026 (korisnik ručno peglao stare porudžbine → čist start). FK `payout_id on delete set null` → 39 vezanih porudžbina otkačeno, ali ostaju `uplaceno` (`paid_at` netaknut). Nije kod — jednokratna operacija kroz service-role.

**Neto profit usklađen sa Dashboardom (promenjena odluka, potvrđeno sa korisnikom):**
- **Ranije:** Finansije mesečni „Neto profit" (`getNetoProfit`) = realizovano (Isporučeno + `payment_status IN uplaceno/kes`, po `delivered_at`). **Sada:** ISTA osnova kao Dashboard — sve porudžbine kreirane u mesecu (`ordered_at`), OSIM Otkazano/Vraćeno, bez gledanja isporuke/plaćanja. Dashboard i Finansije neto se sada poklapaju.
- **Deljena funkcija `db/metrics.ts` → `computePeriodMetrics({from,to})`** (jedini izvor istine za period-metrike): isključi `CANCELLED_STATUS_NAMES`, filter po `ordered_at`, Σ `order_items.profit_at_sale`, promet, `expenses` po `date`, marža. `getDashboardMetrics` (`db/dashboard.ts`) i `getNetoProfit` (`db/finance.ts`, preko `monthBounds` → `firstDay/lastDay`) je pozivaju — **nema dupliranja, nema cikličnog import-a** (metrics ne uvozi dashboard/finance). `paid_at` se **nigde** ne koristi za statistiku (samo prikaz na detalju porudžbine).

**Poštarina na detalju uplate:** `getPayoutDetail` (`db/finance.ts`) vraća i `postageTotal = Σ shipping_charged` vezanih porudžbina (poštarina naplaćena kupcima, deo otkupa). Kartica „Poštarina" na `/finansije/uplate/[id]` (grid 4 kartice: Uplaćeno / Σ otkupnina / Poštarina / Razlika).

**Jednokratni data-fix (stare neplaćene pre juna):** 15 porudžbina kreiranih pre 1.6.2026 (`ordered_at` u maju), xexpress, Isporučeno, `neuplaceno` → postavljeno `uplaceno` + `paid_at = delivered_at` (bez uplate; `delivered_at`/`status`/`delivery_method` netaknuti). Skida ih sa „isporučeno-neuplaćeno" liste i payout kandidata. Junske/julske (33) ostavljene `neuplaceno` po odluci korisnika. Service-role, nije kod. Reverzibilno (`neuplaceno` + `paid_at=null` po istom filteru).

**XExpress fakture poštarine (rekonsilijacija, potvrđeno sa korisnikom):**
- **Šta:** XExpress šalje fakturu ~svakih 10 dana (zbir stvarnih poštarina po specifikaciji + **20% PDV**), Sportem plaća. Kupcima se naplaćuje sam određena poštarina (`shipping_charged`). Nova funkcionalnost u tabu **Finansije → Poštarina**: napraviš XExpress fakturu, odabereš porudžbine sa specifikacije, uneseš stvarnu poštarinu (**osnovicu, bez PDV-a**) po porudžbini → P&L: **naplaćeno kupcima vs (osnovica + 20% PDV)** = zarada / gubitak / poklapa se.
- **Odluke:** (1) **Auto PDV** — unosi se osnovica, app dodaje 20%; helper `withPdv(base,20)` u `db/finance.ts`, round PDV-a **po porudžbini** (da global saldo i P&L fakture tačno rekonsiluju). (2) **Izvor istine = polje porudžbine** — unos piše u postojeći `orders.shipping_actual`; faktura vezuje porudžbine kroz novi FK `orders.xexpress_invoice_id`. (3) **Ostaje prolazna stavka** — ne dira Neto profit/Dashboard/`order_items`/snapshot. (4) **Bez priloga** (PDF specifikacije).
- **PROMENJENA ODLUKA — global „Saldo poštarine" sad sa PDV-om:** `getSaldoPostarine` gross = `Σ(shipping_charged − withPdv(shipping_actual))` (ranije bez PDV-a). Utiče samo na retke porudžbine sa unetim `shipping_actual`. „Poravnaj keš" i `postage_settlements` **nedirani** (i dalje keš izravnanje ukupnog salda).
- **Migracija `20260721120000_xexpress_invoices.sql`:** tabela `xexpress_invoices` (`invoice_number` opcion + parcijalni UNIQUE, `invoice_date`, `period_from/to`, `vat_rate int default 20` snapshot, `created_by`, `updated_at` trigger) + kolona `orders.xexpress_invoice_id` (FK `on delete set null`) + index. RLS obrazac iz `postage_settlements` (select admin+manager / write admin). **Pre produkcije: `supabase db push`.**
- **Kod:** `db/finance.ts` (`withPdv`, `getEligibleXexpressOrders`, `listXexpressInvoices`, `getXexpressInvoiceDetail`, tipovi `Xexpress*`); `lib/validation/finance.ts` (`xexpressInvoiceSchema`/`updateXexpressInvoiceSchema`); `app/(app)/finansije/actions.ts` (`createXexpressInvoice`/`updateXexpressInvoice`/`deleteXexpressInvoice`, **Admin-only**, eligibility rekompjut server-side, order update kroz `createAdminClient()` kao `updateShipping`); rute `finansije/postarina/fakture/{nova,[id],[id]/izmena}` + `xexpress-invoice-form.tsx` (create+edit) + `xexpress-invoice-actions.tsx`. Sekcija „XExpress fakture" dodata na `/finansije/postarina`. Brisanje/odvezivanje čisti `shipping_actual` nazad na null (saldo se vraća). Kandidati: xexpress + `shipping_charged` not null + `xexpress_invoice_id` null.
