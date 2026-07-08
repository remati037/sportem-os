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
