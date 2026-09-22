# Sigurnosni audit — Sportem OS

Datum: 2026-07-31 · Grana: `main` (+ nekomitovano: `lib/stock.ts`, `20260731140000_order_stock_decrement.sql`, izmene u `porudzbine/actions.ts` i `webhooks/woo/route.ts`)
Metod: statička analiza koda i migracija. Bez pokretanja servera, bez upisa u bazu, bez napada na produkciju.

Legenda: **POTVRĐENO** = pročitano u kodu i logički dokazano · **SUMNJA** = zavisi od runtime/konfiguracije koju nisam mogao proveriti bez pristupa produkciji.

---

## Kritično

**Nema nalaza koji ocenjujem kao kritičan.** Nijedan put koji sam ispitao ne dozvoljava anonimnom korisniku ni roli `logistics` da dođe do cena, profita, porudžbina ili finansija. Detalji dokaza su u sekciji „Pokriveno dobro".

---

## Ozbiljno

### O1. `apply_stock_delta` je „napunjen pištolj" — jedina zaštita je jedan `revoke` red
**Fajl:** `supabase/migrations/20260731140000_order_stock_decrement.sql:39-62`
**Tip:** Prekomerno privilegovana SQL funkcija / potencijalna eskalacija · **POTVRĐENO** (trenutno stanje je bezbedno)

Funkcija je `security definer` sa praznim `search_path`, vlasnik je `postgres` (BYPASSRLS u Supabase-u), i radi **neograničen `UPDATE` nad `public.product_variants`** za bilo koji `variant_id` i bilo koji `delta`. Unutar funkcije **nema nikakve provere autorizacije** — sva zaštita je u redu 61:

```sql
revoke all on function public.apply_stock_delta(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stock_delta(jsonb) to service_role;
```

**Ko:** trenutno niko (`authenticated` dobija `permission denied` na `supabase.rpc("apply_stock_delta")`). Ali funkcija je u `public` šemi, pa je PostgREST automatski izlaže kao RPC — čim bi neko (buduća migracija, ručni `grant`, Supabase „grant all on functions" šablon) dao EXECUTE roli `authenticated`, **svaki ulogovani korisnik uključujući Logistiku mogao bi proizvoljno da menja stanje celog kataloga jednim POST-om na `/rest/v1/rpc/apply_stock_delta`**.

**Scenario:** ulogovana Logistika → `POST /rest/v1/rpc/apply_stock_delta {"p_items":[{"variant_id":"…","delta":-99999}]}` → sabotaža stanja celog magacina, bez traga u `order_status_history` ni u `stock_counted_by`.

**Fiks (predlog):**
- Premestiti funkciju u nejavnu šemu (npr. `private.apply_stock_delta`) — PostgREST je tada uopšte ne vidi, pa `revoke` prestaje da bude jedina odbrana.
- Ili dodati unutrašnji guard: `if auth.role() <> 'service_role' then raise exception ... end if;`
- Dodati proveru u `scripts/rls-test.mjs` (kao Logistika pozvati RPC i tvrditi da vraća grešku) — da regresija ne prođe tiho.

---

### O2. Menadžer piše finansijski relevantna polja (`shipping_charged`, `shipping_actual`) kroz service-role
**Fajl:** `app/(app)/porudzbine/actions.ts:746-768` (`updateShipping`)
**Tip:** Prekoračenje matrice rola / zaobilaženje RLS-a · **POTVRĐENO**

```ts
await requireRole("admin", "manager");
...
const supabase = createAdminClient();          // zaobilazi RLS
const { order_id, ...patch } = parsed.data;    // shipping_charged, shipping_actual, weight_grams, package_count
await supabase.from("orders").update(patch).eq("id", order_id);
```

RLS na `orders` dozvoljava write **samo Adminu**; ovde se to zaobilazi service-role klijentom, a `requireRole` propušta i Menadžera. `shipping_charged` ulazi u **otkupninu na ekranu Uplata** (`otkupOf = goods_total + shipping_charged`, `db/finance.ts`) i u **globalni saldo poštarine**; `shipping_actual` je osnovica **XExpress rekonsilijacije** i takođe ulazi u saldo (`gross = Σ(shipping_charged − withPdv(shipping_actual))`). CLAUDE.md §3 kaže: „Menadžer — svi Sportem podaci, **bez izmene finansija**".

**Ko:** ulogovan Menadžer, kroz normalnu formu na detalju porudžbine ili direktnim pozivom server akcije.
**Scenario:** Menadžer upiše `shipping_actual = 1` na 200 porudžbina → saldo poštarine i P&L XExpress fakture postaju besmisleni; Admin to vidi kao „zaradu na poštarini".

**Fiks:** ili svesno dokumentovati odstupanje u CLAUDE.md („poštarina je operativna, ne finansijska"), ili razdvojiti: težina/broj paketa → Admin+Menadžer, `shipping_charged`/`shipping_actual` → samo Admin (`if (profile.role !== "admin") delete patch.shipping_*`).

---

### O3. `setStockCount` (Logistika + service role) ne isključuje arhivirane varijante i ne proverava da varijanta postoji
**Fajl:** `app/(app)/katalog/actions.ts:378-403`
**Tip:** Nedovoljna provera objekta uz zaobilaženje RLS-a · **POTVRĐENO**

Ovo je jedino mesto gde **Logistika piše u katalog**, i to kroz `createAdminClient()` (RLS zaobiđen; Logistika inače nema ni SELECT na `product_variants`, samo na restriktovani view).

Šta jeste dobro (proverio sam): `patch` ima **fiksne ključeve** (`stock_counted_at`, `stock_counted_by`, opciono `stock_quantity`) — nema spread-a korisničkog objekta, pa **Logistika ne može da dotakne `mp_price`/`vp_price`/`profit`/`sku`/`archived_at`**. Ulaz prolazi `stockCountSchema` (uuid + bool + `int >= 0`), a `product_id` ide samo u `revalidatePath` i validiran je kao uuid → nema path injection.

Šta nedostaje:
1. **Nema `.is("archived_at", null)`** — Logistika (i Admin) može da promeni stanje soft-obrisane varijante koja se nigde u UI ne prikazuje. Suprotno pravilu iz CLAUDE.md §5 („arhivirani ne izlaze u pretrazi/izboru").
2. **Nema provere postojanja** — `update … .eq("id", variant_id)` nad nepostojećim UUID-om pogađa 0 redova bez greške, a akcija vrati `success: "Popisano."`. Tiho lažno pozitivan rezultat.
3. **Nema gornje granice na `stock_quantity`** — vrednost > `int4` daje sirovu Postgres grešku 22003 (uhvaćena je i vraća generičku poruku, pa nije leak, ali je loš UX).

**Ko:** ulogovana Logistika (i Admin).
**Fiks:** dodati `.is("archived_at", null)` + `.select("id")` i vratiti grešku kad je 0 redova; `.max(1_000_000)` u `stockCountSchema`.

---

### O4. Sentry može da primi PII kupaca kroz Supabase greške
**Fajlovi:** `app/api/webhooks/woo/route.ts:58-62, 94`; `sentry.server.config.ts`; `instrumentation-client.ts`
**Tip:** Curenje PII u treću stranu · **SUMNJA** (zavisi od stvarnog oblika greške u runtime-u)

`sendDefaultPii` nije uključen (default `false`) → IP/kolačići/hederi se ne šalju. **To je pokriveno.** Ali:

- `Sentry.captureException(error)` u `catch` bloku webhook-a (linija 94) hvata i Supabase/Postgres greške. Postgres unique-violation na `customers.phone` (`upsertCustomer`, linija 138-146) nosi `details` oblika `Key (phone)=(0641234567) already exists.` → **telefon kupca odlazi u Sentry**.
- `Sentry.captureMessage("Woo webhook: nevalidan payload", { extra: { issues: parsed.error.issues.slice(0, 5) } })` — zod v4 issue objekti nose `path` i (za neke kodove) deo ulaza. Zavisno od greške, tu mogu završiti delovi Woo payload-a (ime/adresa).
- `lib/stock.ts:96`, `lib/push.ts:171`, `app/(app)/porudzbine/actions.ts:63` — isti obrazac `captureException(e)` nad DB greškama.

**Ko:** niko „ne napada" — ovo je pasivno curenje ka Sentry projektu; relevantno za GDPR/ličnu higijenu jer je reč o stvarnim kupcima.
**Fiks:** `beforeSend` u `sentry.server.config.ts` koji čisti `error.details`/`error.hint` i skida `extra.issues`; ili u webhook-u logovati samo `error.code` + `woo_order_id`, nikad ceo objekat.

---

## Sitno

### S1. Server akcije bez zod validacije (ID se prosleđuje kao sirov string)
**Tip:** Nedostatak validacije ulaza · **POTVRĐENO** · **Ko:** Admin (ili Menadžer gde je naznačeno)

Sve navedene imaju `requireRole`, i PostgREST parametrizuje upite (nema SQL injection), pa je stvarni uticaj nizak — ali odstupa od pravila CLAUDE.md §5 („zod na svim server akcijama"):

| Fajl:linija | Akcija | Rola |
|---|---|---|
| `app/(app)/katalog/actions.ts:106` | `deleteCategory(id)` | admin |
| `app/(app)/katalog/actions.ts:203/218/234` | `archiveProduct` / `unarchiveProduct` / `deleteProduct` | admin |
| `app/(app)/katalog/actions.ts:405/420/440` | `archiveVariant` / `unarchiveVariant` / `deleteVariant` | admin |
| `app/(app)/katalog/actions.ts:90` | `updateCategory` — `id` iz FormData bez uuid provere | admin |
| `app/(app)/porudzbine/actions.ts:246` | `deleteItem(itemId)` | admin |
| `app/(app)/porudzbine/actions.ts:504` | `resolveReview(orderId)` | admin + **manager** |
| `app/(app)/finansije/actions.ts:201/375/588` | `deletePayout` / `deleteInvoice` / `deleteXexpressInvoice` | admin |
| `app/(app)/podesavanja/actions.ts:120` | `deleteOrderStatus(id)` | admin |
| `app/(app)/podesavanja/actions.ts:102` | `upsertOrderStatus` — `id` iz FormData bez uuid provere | admin |
| `app/(app)/troskovi/actions.ts:135/201` | `deleteExpense` / `deleteExpenseCategory` | admin |
| `app/(app)/troskovi/actions.ts:216` | `getExpenseAttachmentUrl(path)` — `path` nevalidiran | admin + manager |

Napomena: `deleteXexpressInvoice` (`finansije/actions.ts:588-595`) prvo **briše `shipping_actual` na porudžbinama** pa tek onda pokušava brisanje fakture, i to bez provere da faktura postoji — mala logička rupa (ako je drugi korak pukne, podaci o poštarini su već očišćeni).

**Fiks:** trivijalan — `uuid()` iz `lib/validation/uuid.ts` na svaki `id` parametar.

### S2. Cron secret se poredi ne-konstantnim vremenom
**Fajl:** `app/api/cron/notifikacije/route.ts:24-28` · **POTVRĐENO**
`auth !== \`Bearer ${secret}\`` — obično JS poređenje stringova, dok webhook (`lib/woo.ts:27`) korektno koristi `timingSafeEqual`. Nedosledno. Praktična eksploatacija timing napada preko mreže na Vercelu je vrlo teška, ali fiks je jedan red (`crypto.timingSafeEqual` nad bufferima jednake dužine). Pozitivno: bez `CRON_SECRET` ruta vraća 401 (fail-closed) — to je ispravno.

### S3. Webhook nema zaštitu od replay napada
**Fajl:** `app/api/webhooks/woo/route.ts:36-53`, `lib/woo.ts:18-28` · **POTVRĐENO (dizajn), SUMNJA (uticaj)**
HMAC pokriva samo telo — nema timestamp-a ni nonce-a, pa je isti potpisani zahtev validan zauvek. Napadač koji jednom uhvati potpisan payload (npr. iz Woo logova, MITM na ne-TLS hop-u, ili kompromitovan Woo plugin) može ga ponovo slati.
Ublaženo: `insertOrder` je idempotentan po `woo_order_id`; `syncExistingOrder` ima guard `!existing.cancelled_at` pa ponovno otkazivanje ne prolazi dvaput; `stock_applied` prekidač sprečava dvostruko skidanje robe. Realan scenario je uzak: replay starog `cancelled` payload-a **pošto** Admin ručno vrati porudžbinu u živi tok → porudžbina se ponovo otkazuje i roba se vraća na stanje.
**Fiks:** odbaciti zahteve starije od ~5 min po `x-wc-webhook-delivery-id` / `date` hederu, ili voditi kratkotrajan ledger viđenih delivery ID-jeva.

### S4. Nepotpisan Woo „ping" prolazi pre provere potpisa
**Fajl:** `app/api/webhooks/woo/route.ts:42`, `lib/woo.ts:36-45` · **POTVRĐENO**
Bilo ko anoniman može poslati `{"webhook_id":1}` i dobiti `200`. Nema promene podataka (ruta odmah vraća prazan odgovor), pa je uticaj samo potvrda da ruta postoji + zaobilaženje 401 rate-limit signala. Ovo je svestan kompromis (bez toga Woo ne dozvoljava snimanje webhooka) i dokumentovan je u komentaru. Ostavio bih kako jeste; eventualno ograničiti na `Content-Length < 100`.

### S5. `next` parametar u `/auth/callback` nije validiran
**Fajl:** `app/auth/callback/route.ts:16, 22, 25` · **POTVRĐENO da NIJE iskoristivo kao open redirect**
`NextResponse.redirect(\`${origin}${next}\`)` sa korisničkim `next`. Testirao sam parsiranje: `//evil.com`, `/\evil.com`, `\\/evil.com` → host ostaje `app.sportem.rs` (WHATWG URL tretira sve kao putanju); `https://evil.com` → nevalidan host `app.sportem.rshttps` (praktično baca/kvari se). Dakle **nema open redirecta**. Ostaje kao higijena: ograničiti na `next.startsWith("/") && !next.startsWith("//")`. Isto važi za `type` koji se cast-uje u `EmailOtpType` bez validacije (`z.enum([...])` bi bio čistiji).

### S6. Neograničeni ulazi (mali DoS / rast baze)
- `app/(app)/obavestenja/actions.ts:18` — `prefs: z.record(z.string(), channelSchema)` bez ograničenja broja ključeva/veličine. **Svaki ulogovani korisnik** (uklj. Logistiku) može upisati proizvoljno velik jsonb u svoj `notification_preferences` red. **Fiks:** ograničiti ključeve na `NOTIFICATION_TYPES` (`z.enum`) i dodati `.refine(o => Object.keys(o).length <= 10)`.
- `app/(app)/katalog/uvoz/actions.ts:155, 174` — `items: ImportItem[]` bez gornje granice; Admin-only, ali `commitImport` radi po jedan upit po redu u petlji. **Fiks:** cap npr. 5000 redova.
- Nigde nema rate-limitinga (`signIn`, push rute, PDF ruta). Za `signIn` se oslanjamo na ugrađene Supabase Auth limite — prihvatljivo za tim od 4 osobe, ali vredi znati.

### S7. `/stil` i `/stil/komponente` nemaju role guard
**Fajlovi:** `app/(app)/stil/page.tsx`, `app/(app)/stil/komponente/page.tsx` · **POTVRĐENO**
Jedine stranice pod `(app)` bez `requireRole`. Sadrže samo dizajn-sistem demo (nema podataka), a layout i dalje traži sesiju, pa je uticaj nula — ali Logistika ih vidi. Ako nisu potrebne u produkciji, obrisati ili staviti iza `requireRole("admin")`.

### S8. MIME tip priloga troška se veruje klijentu
**Fajlovi:** `app/(app)/troskovi/actions.ts:41-46`, `lib/storage.ts:70-81` · **POTVRĐENO, nizak uticaj**
Za slike kataloga ovo nije problem (sharp re-enkoduje u webp → stvarna validacija sadržaja). Za priloge troškova se fajl upisuje sirov, sa `contentType: file.type` iz klijenta. Ublaženo: bucket ima `allowed_mime_types` na nivou Storage-a, privatan je, upload je Admin-only, ime je `crypto.randomUUID()` (nema path traversala), a signed URL služi sa **supabase.co domena — ne sa app.sportem.rs**, pa eventualni HTML/JS prilog ne bi bio stored XSS nad app sesijom. Ostaje higijena: proveriti magic bytes ili forsirati `Content-Disposition: attachment`.

### S9. `product_variants_public` zaobilazi RLS po dizajnu (`security_invoker = false`)
**Fajlovi:** `20260708172800_rls_policies.sql:35-42`, `20260731120000_stock_count.sql:42-47` · **POTVRĐENO, trenutno bezbedno**
View se izvršava kao vlasnik i `grant select` ide **svim** `authenticated` korisnicima. Danas ne sadrži nijednu finansijsku kolonu — proverio sam obe verzije definicije. Rizik je proceduralan: view se već dvaput menjao kroz `create or replace … select …` (dodati `attributes`, `stock_counted_at`); jedan nepažljivo dodat `mp_price` trenutno bi procureo Logistici, bez ikakvog drugog signala. **Fiks:** dodati u `scripts/rls-test.mjs` tvrdnju da `select *` nad view-om kao Logistika NE vraća ključeve `mp_price`/`vp_price`/`profit`.

### S10. `/monitoring-tunnel` nije u `PUBLIC_PATHS`
**Fajlovi:** `next.config.ts` (`tunnelRoute`), `lib/supabase/middleware.ts:10` · **POTVRĐENO, funkcionalno a ne bezbednosno**
Sentry tunel ruta prolazi kroz proxy i za neulogovane se redirektuje na `/prijava` → greške sa stranice prijave/postavljanja lozinke se ne prijavljuju. Nije rupa (obrnuto — zatvorenije je), samo slepa tačka u monitoringu.

---

## Pokriveno dobro

Ovo sam eksplicitno proveravao i **jeste** zatvoreno:

1. **Logistika ne može do cena — nijednim putem.**
   - `product_variants` SELECT politika: `current_app_role() in ('admin','manager')` (`20260708172800:78-80`).
   - Restriktovani view nema `mp_price`/`vp_price`/`profit`.
   - PostgREST embed `products?select=*,product_variants(*)` i dalje prolazi kroz RLS embed-ovane tabele → 0 redova.
   - `order_profit` view je `security_invoker = true` → nasleđuje RLS na `order_items` (`20260710120000:38-48`).
   - `apply_stock_delta` RPC: EXECUTE revoked za `authenticated`.
   - App sloj bira izvor po roli (`db/catalog.ts:42-52`) i ne renderuje kolone (`catalog-table.tsx:100`) — ali to je samo higijena, RLS je ispod.
2. **RLS je uključen na SVIM tabelama** — 18 `enable row level security` naspram 18 `create table`. Nema tabele bez RLS-a. `notification_log` namerno ostaje bez politika (samo service role) — to je deny-by-default, ispravno.
3. **Sve finansijske tabele nedostupne Logistici**: `orders`, `order_items`, `invoices`, `payouts`, `expenses`, `expense_categories`, `customers`, `postage_settlements`, `xexpress_invoices`, `order_status_history` — sve imaju `select … in ('admin','manager')` + `admin_write`.
4. **Storage politike su korektno diferencirane**: `product-images` javan, read za sve ulogovane, write Admin; `expense-attachments` **privatan**, read samo admin+manager, write Admin, prikaz isključivo kroz `createSignedUrl` (1h) sa korisničkim klijentom (dakle RLS se primenjuje i na potpisivanje).
5. **`current_app_role()`** je `security definer` + `set search_path = ''` + `revoke from public, anon` — imun na search_path napade i na rekurziju nad `profiles`.
6. **Auth je stvaran, ne dekorativan.** `getClaims()` u `@supabase/auth-js` (proverio sam `node_modules/.../GoTrueClient.js:5216-5276`) ili kriptografski verifikuje potpis (asimetrični ključ + `crypto.subtle.verify`), ili pada nazad na `getUser()` (mrežna provera). **Nema slepog dekodiranja JWT-a** — falsifikovan token ne prolazi.
7. **Dvoslojna zaštita ruta.** Middleware (`proxy.ts` → `updateSession`) redirektuje neulogovane, a **svaka** stranica pod `(app)` osim `/stil/*` dodatno zove `requireRole`/`getProfile`, plus `app/(app)/layout.tsx` traži sesiju. Zato ni izuzeci u matcher-u po ekstenziji (`.png`, `.svg`…) ne daju bypass — nema rute koja zavisi isključivo od middleware-a.
8. **Sve server akcije imaju autorizaciju.** Prošao sam kroz svih 10 fajlova sa `"use server"` i svih ~45 eksportovanih akcija: svaka ima `requireRole(...)` ili (kod `savePreferences`) `auth.getUser()` + upsert isključivo sopstvenog `user_id`. Izuzeci su namerni i ispravni: `signIn`, `signOut`, `setPassword` (auth tok).
9. **`requireRole` bezbedno prekida izvršavanje** — `redirect()` baca `NEXT_REDIRECT`, akcija ne nastavlja. Nema „provera pa ipak nastavi".
10. **Nema IDOR-a na resursima vezanim za korisnika.** `push_subscriptions`: RLS `user_id = auth.uid()` + rute dodatno rade `.eq("user_id", user.id)` (`subscribe/route.ts:44,52`, `unsubscribe/route.ts:33`). `notification_preferences`: RLS `own` + `user_id` iz sesije. `updateProfileName` (`podesavanja/actions.ts:52-70`) koristi service role ali patch-uje **samo `full_name`** na `.eq("id", session.userId)` — korisnik ne može sebi promeniti rolu. Ostali resursi (fakture, uplate, troškovi) nemaju model vlasništva jer su Admin-only.
11. **Eskalacija role je zatvorena.** RLS `profiles_admin_write` je Admin-only; jedini put do `role` kolone je `korisnici/actions.ts` iza `requireRole("admin")`, sa guard-ovima „ne možeš sebi skinuti admina" i „mora ostati bar jedan admin".
12. **Service-role klijent se nikad ne uvozi na klijent** — `lib/supabase/admin.ts` ima `import "server-only"`; grep potvrđuje da `SUPABASE_SERVICE_ROLE_KEY` postoji samo tamo i u `scripts/*.mjs` (Node CLI). Isto važi za `lib/push.ts`, `lib/email.ts`, `lib/storage.ts`, `lib/woo.ts`, `lib/woo-client.ts`, `lib/stock.ts`.
13. **Nijedan `NEXT_PUBLIC_*` ne nosi tajnu.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (namenjen klijentu, štiti ga RLS), `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (javna polovina para), `NEXT_PUBLIC_APP_URL`. `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `WOO_*` — svi bez `NEXT_PUBLIC_` prefiksa.
14. **`.env.local` nije u gitu** (`git ls-files | grep env` → samo `.env.example`, koji ima prazne vrednosti). `docs/backfill/*.csv` (PII kupaca) je takođe u `.gitignore`.
15. **Poruke grešaka ne cure ništa.** Sve akcije vraćaju generičke srpske stringove; webhook vraća prazna tela (401/400/500). `updateWooOrderStatus` ubacuje deo Woo odgovora u `Error`, ali ta greška ide **samo** u Sentry, nikad korisniku (`pushWooStatus` je hvata).
16. **XSS**: nula pojava `dangerouslySetInnerHTML`, `innerHTML`, `new Function`. Email šablon (`lib/email.ts:47-53`) eskejpuje `title`/`body`.
17. **CSRF**: Next 16 ugrađena Origin/Host provera na server akcijama (nema labavog `allowedOrigins` overrid-a u `next.config.ts`); push rute su JSON POST-ovi koji traže preflight, a Supabase auth kolačići su `SameSite=Lax`. Cross-site poziv ne prolazi.
18. **Webhook HMAC**: SHA-256 nad **sirovim telom pre `JSON.parse`**, `timingSafeEqual`, provera dužine pre poređenja, bez tajne → `false` (fail-closed).
19. **Snapshot (zamrznute cene) je netaknut** u celom novom kodu — `lib/stock.ts` čita `order_items` samo za `variant_id`/`quantity`, `apply_stock_delta` dira isključivo `stock_quantity`.
20. **Guard-ovi nad novcem se rekompjutuju server-side**, ne veruje se klijentskoj listi: `assertLinkable`, `assertInvoiceable`, `assertXexpressLinkable`, `assertEditable`, i `total_amount` fakture se sabira iz `order_profit` na serveru. `force` (otkazivanje plaćene porudžbine) je eksplicitno Admin-only uz obavezan razlog (`porudzbine/actions.ts:364-377`).
21. **Upload putanje su `crypto.randomUUID()`** u oba bucket-a → nema path traversala ni pogađanja tuđih objekata; veličina je ograničena i u kodu (5 MB) i na bucket-u.
22. **PDF „lista za slanje"** (`app/api/porudzbine/lista-za-slanje/route.tsx`) — jedina ruta koja servira PII kupaca; ima `getProfile()` + eksplicitno `403` za Logistiku, validira `ids` regexom na UUID i seče na 200, `Cache-Control: no-store`.

---

## Preporučeni redosled

1. **O1** — premestiti `apply_stock_delta` iz `public` šeme (ili dodati unutrašnji guard) **pre nego što migracija ode na produkciju**. Najjeftinije je sada.
2. **O2** — odlučiti (i upisati u CLAUDE.md) sme li Menadžer da menja poštarinu; ako ne — filtrirati patch po roli.
3. **O3** — tri reda u `setStockCount` (`archived_at` filter + `.select("id")` provera + `.max()` u šemi).
4. **O4** — `beforeSend` scrubber u Sentry konfiguraciji.
5. **S1** — mehanički prolaz: `uuid()` na sve `id` parametre server akcija.
6. **S9** — dopuniti `npm run rls:test` tvrdnjom o kolonama view-a (jeftina zaštita od budućih regresija).
