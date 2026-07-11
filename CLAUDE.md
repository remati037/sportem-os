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

- PWA, online-only, push notifikacije u Fazi 1. Email nije u Fazi 1.
- **Tri role:**
  - **Admin** — sve (finansije, cene, fakture, reklame).
  - **Menadžer** — svi Sportem podaci (zarada, porudžbine, izveštaji), **bez izmene finansija**.
  - **Logistika** — samo stanje/naziv/slike artikala; **ne vidi MP, VP, profit ni bilo koje finansije — kolone se NE renderuju (ne blur, nego ih nema).**
- **Supabase je jedini izvor istine**; Sheets izlazi iz sistema. App je glavni katalog (cene/proizvodi se menjaju tu); WooCommerce se po potrebi ažurira ručno.
- **Sve porudžbine ulaze kroz WooCommerce webhook** — i XExpress i lične/keš prodaje. **U app-u nema ručnog kreiranja porudžbina.** (Keš/lična prodaja = porudžbina se samo označi `licno` + „Keš/Isplaćeno".)
- Webhook prati **`order.created` i `order.updated`** — otkazivanja/refund se sinhronizuju automatski.
- Statusi porudžbine su podesiva lista: **Kreirano → Poslato → Isporučeno → Otkazano/Vraćeno.**
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
