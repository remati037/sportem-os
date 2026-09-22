# Sportem OS — audit UX / UI / PWA / pristupačnosti

Obim: `components/**`, `app/layout.tsx`, `app/globals.css`, `app/(app)/layout.tsx`, `loading.tsx`,
`global-error.tsx`, `lib/nav.ts`, `lib/format.ts`, svi `page.tsx`, PWA (`app/sw.ts`, `app/manifest.ts`,
`components/pwa/**`, `components/push/**`, `/obavestenja`), auth ekrani, `/podesavanja`, `/korisnici`, `/stil`.

Metod: čitanje koda + provera ruta preko `curl` (nisam bio ulogovan, ništa nije menjano) + izračunati
kontrastni odnosi. Svaki nalaz je označen **[POTVRĐENO]** (video u kodu / izračunato) ili **[SUMNJA]**
(verovatno, ali traži proveru na uređaju ili sa podacima).

Referenca za „dizajn traži…" je `docs/Sportem-Dizajn-Sistem.md` (§ = sekcija tog dokumenta).

---

## Šta je dobro (da se ne pokvari)

- **Dijakritika je besprekorna.** Skenirao sam ceo repo tražeći srpske reči bez č/ć/š/ž/đ u korisničkim
  stringovima — nema nijednog propusta. Jedini „goli" pogoci su DB vrednosti (`uplaceno`) i reči koje
  stvarno nemaju kvačice.
- **Token disciplina je odlična u TSX-u.** Nula pojava Tailwind default palete (`gray-500`, `slate-…`)
  u `app/**` i `components/**`. `globals.css` je 1:1 sa dizajn dokumentom, a shadcn semantički sloj je
  uredno alijasiran na brend tokene.
- **Rola Logistika je stvarno zaštićena, ne samo sakrivena.** `db/catalog.ts:44-45` bira
  `product_variants_public` za Logistiku, pa cene **ne stižu ni u payload klijenta** — nije „ne renderuje se",
  nego ih nema. Provereno kroz sve render tačke katalog liste, detalja, mobilnih kartica i formi.
- **Menadžer gejt je dosledan.** Sve write komponente u finansijama su iza `isAdmin`; nema „dugme se vidi pa puca".
- `reduced-motion`, `tnum`, `env(safe-area-inset-bottom)` u bottom nav-u i sheet-u — implementirano po dizajnu.
- Online-only SW je konceptualno tačno napisan (bez `defaultCache`, navigacije network-only) i update-toast
  tok (`skipWaiting:false` → „Osveži") je uredan.

---

# KRITIČNO

### 1. Na telefonu se ne može odjaviti
`components/layout/sidebar.tsx:57-61` + `components/layout/app-shell.tsx:8-18` — **[POTVRĐENO]**
`signOut` se u celom repou poziva **samo** iz sidebar-a, koji je `hidden … md:flex`. `AppShell` na
mobilnom renderuje samo sadržaj + bottom nav — **nema headera uopšte**: nema imena korisnika, role,
identiteta app-a, ni odjave. `/podesavanja` (jedino logično mesto) nema dugme za odjavu.
*Zašto smeta:* troje ljudi deli uređaje/naloge; brat ili drug ne mogu da se izloguju sa telefona bez
brisanja podataka pretraživača. Takođe se ne vidi „ko sam ja / u kojoj sam roli", što je bitno kad
Logistika i Admin koriste isti telefon.
*Predlog:* mobilni sticky header (ime + rola + „⋮" sa Odjavom), ili sekcija „Nalog" na `/podesavanja`
sa dugmetom Odjava za sve role.

### 2. Popis zalihe: prazno polje se tiho snima kao 0 i markira kao popisano
`app/(app)/katalog/stock-count-control.tsx:64-75` (i isto kroz čekboks, `:113-118`) — **[POTVRĐENO, provereno lično]**
`Number("") === 0`, `Number.isInteger(0) && 0 >= 0` prolazi validaciju, a `parsed !== stockQuantity`
(0 ≠ 12) → `save(true, 0)`. Dakle: logistika obriše cifru da otkuca novu, slučajno skroluje ili tapne
drugde (blur) → varijanta koja je imala 12 komada postaje **0 sa `stock_counted_at` postavljenim**.
Odmah ulazi u „Nisko stanje", Dashboard listu i dnevni push. Nema upozorenja.
Pošto je input `type="number"`, i nevalidan unos („12a") vraća `""` → isti put ka nuli.
*Predlog:* `if (qty.trim() === "") { setQty(String(stockQuantity)); return; }` pre parsiranja;
u čekboksu prazan string tretirati kao `stock_quantity: undefined`.

### 3. Popis: potvrda nepromenjenog broja ne radi ništa i ne kaže ništa
`app/(app)/katalog/stock-count-control.tsx:73` — **[POTVRĐENO]** `if (parsed === stockQuantity) return;`
Najčešći slučaj u magacinu je „prebrojao sam, stvarno ih ima 8, isto kao što piše". Korisnik otkuca 8,
blur → **ništa**: nema toasta, badge „Fali količina" ostaje, `stock_counted_at` ostaje `null`. Čovek je
siguran da je popisao, a u bazi nije. Jedini ispravan put je čekboks od 16px pored polja.
Dodatno **[SUMNJA]** trka: posle `save()` lokalni `qty` je nov a prop `stockQuantity` star dok
`router.refresh()` ne završi — unos stare vrednosti u tom prozoru se tiho ne snima.
*Predlog:* ako je varijanta nepopisana → snimi i pri nepromenjenoj cifri; ako je već popisana → makar
toast „Stanje potvrđeno."

### 4. Popis nema nikakvu potvrdu uspeha
`app/(app)/katalog/stock-count-control.tsx:54-61` — **[POTVRĐENO]** Na grešci ide `toast.error`, na
uspehu samo `router.refresh()`. `setStockCount` čak **vraća** `success: "Popisano."` (`katalog/actions.ts:402`)
koje se nigde ne prikazuje, dok svaka druga akcija u kodbazi radi `toast.success`.
*Zašto smeta:* u magacinu sa slabim signalom korisnik nema pojma da li je cifra ušla. Uz nalaz 3, popis
je tok u kojem se ne zna ni da li je snimljeno ni da li je preskočeno.

### 5. XExpress faktura: prazno polje briše poštarinu iz Woo-a i pomera otkupninu
`app/(app)/finansije/postarina/fakture/xexpress-invoice-form.tsx:130-137` + `app/(app)/finansije/actions.ts:507-517`
— **[POTVRĐENO, provereno lično]** `Number(chargeds[id]) || 0` → prazno polje postaje **0**, i server to
upisuje u `orders.shipping_charged`/`shipping_actual`. Zod (`nonNegInt`) ne hvata jer 0 jeste validno.
Posledice: (a) `shipping_charged` koji je stigao iz Woo webhook-a se **prepisuje nulom**, a `otkupOf()`
(`db/finance.ts:39`) računa otkupninu kao `goods_total + shipping_charged` → menjaju se iznosi na Uplatama;
(b) `shipping_actual = 0` znači „XExpress nam ništa nije naplatio" → saldo poštarine se veštački napumpa.
*Predlog:* ne slati polja koja su prazna; blokirati snimanje uz „N izabranih porudžbina nema unetu osnovicu".

### 6. XExpress faktura: sekvencijalni upis bez transakcije i bez rollback-a
`app/(app)/finansije/actions.ts:506-517` (isto `:568-578`) — **[POTVRĐENO, provereno lično]**
Vezivanje ide `for` petljom UPDATE-ova; ako 40. pukne, vraća se „Vezivanje porudžbina nije uspelo.",
ali je faktura **već kreirana** i 39 porudžbina već izmenjeno (sa prepisanim `shipping_charged`).
Korisnik vidi samo grešku i ne zna da je pola posla prošlo. `createPayout` (`:113-117`) ima rollback — ovde ga nema.
Uz to, za specifikaciju od ~100 porudžbina to je ~100 round-tripova; dugme se samo zasivi bez „Čuvam…".
*Predlog:* batch upsert / RPC, rollback (obriši fakturu) na grešku, pending tekst na dugmetu.

### 7. „Štampaj" na fakturi je praktično uvek pokvaren
`app/(app)/finansije/fakture/[id]/invoice-print.tsx:49` — **[POTVRĐENO, provereno lično]**
`window.open("", "_blank", "noopener,width=800,height=900")` — po HTML spec-u, kad je `noopener` u
`windowFeatures`, `window.open` **vraća `null`**. Znači „Štampaj" uvek pada u `if (!win)` i baca toast
„Štampa nije uspela (blokiran pop-up)" iako pop-up nije blokiran. Identičan kod u
`app/(app)/finansije/uplate/[id]/spisak-view.tsx:54` **nema** `noopener` i radi.
*Predlog:* skloniti `noopener` (kao u spisku) ili preći na skriveni `<iframe>` + `print()`.

### 8. „Označi plaćeno" je nepovratno, bez potvrde, na dugmetu od 32px
`app/(app)/finansije/fakture/[id]/invoice-actions.tsx:62` — **[POTVRĐENO]** `markInvoicePaid` prebacuje
fakturu u `placeno`; `deleteInvoice` (`actions.ts:387`) odbija brisanje plaćene fakture i **ne postoji
akcija koja vraća `placeno` → `izdato`**. Jedan promašen tap na telefonu trajno zaključava fakturu i
sve njene porudžbine/stavke.
*Predlog:* `ConfirmDialog` („Ovo se ne može opozvati.") + admin akcija „Vrati na izdato".

### 9. Bulk „Označi poslato" gura N porudžbina u WooCommerce bez potvrde
`app/(app)/porudzbine/orders-bulk-table.tsx:161` — **[POTVRĐENO]** Izvršava se odmah na `onSelect`,
dok pojedinačno „Označi poslato" na detalju **ima** `ConfirmDialog` (`order-status-control.tsx:126-136`).
Jedan promašen tap u dropdown meniju (stavke ~32px, susedne stavke su „Otkazano"/„Vraćeno") gura
desetine porudžbina u „Poslato" i u Woo.
*Predlog:* `ConfirmDialog` sa brojem („Označiti 14 porudžbina kao poslato?").

### 10. Bulk slanje: desetine sekundi bez ijednog znaka da app radi
`app/(app)/porudzbine/orders-bulk-table.tsx:109-120` + `actions.ts:563-595` — **[POTVRĐENO]**
`markOrdersShipped` je sekvencijalna petlja: po porudžbini DB update + insert istorije + `pushWooStatus`
(HTTP ka Woo, 10s AbortController timeout **po pozivu**). Za 30 porudžbina to je 30 uzastopnih HTTP
poziva. UI za to vreme pokazuje samo `disabled` dugme — nema spinnera, progresa, „Obrađujem 12/30".
Na telefonu izgleda kao da se app zaledio → korisnik tapka ponovo ili ubija tab, a akcija se nastavlja.
*Predlog:* spinner + brojač u traci selekcije; paralelizovati Woo push (`Promise.allSettled` sa limitom).

### 11. Nema `not-found.tsx` ni ijednog `error.tsx`
**[POTVRĐENO]** (`find app -name "error.tsx" -o -name "not-found.tsx"` → prazno)
- 404 (npr. `/porudzbine/99999`) = default Next ekran **na engleskom**, bez navigacije, ćorsokak.
- Svaka greška u server komponenti (Supabase pao, upit pukao) eskalira u `app/global-error.tsx`, koji
  zamenjuje **ceo dokument** — korisnik gubi sidebar/bottom nav i mora ručno nazad. `global-error.tsx`
  uz to ne nosi Geist font varijable (one su na `<html>` u root layout-u) → renderuje se sistemskim fontom,
  i koristi ad-hoc `<button>` umesto `<Button>`.
*Predlog:* `app/(app)/not-found.tsx` i `app/(app)/error.tsx` na srpskom, unutar shell-a, sa
`ErrorState` komponentom koja već postoji i nigde se ne koristi kao boundary.

### 12. Bez interneta korisnik vidi dinosaurusa
`app/sw.ts` — **[POTVRĐENO]** App je namerno online-only i navigacije su network-only, što je ispravna
odluka. Ali **nema offline fallback stranice**: u instaliranom PWA (standalone, bez URL trake) gubitak
signala daje sistemski „nema veze" ekran koji izgleda kao da je app crkao. Za magacin sa slabim signalom
to je svakodnevno.
*Predlog:* precache jedne `/offline` stranice + `fallbacks` samo za navigacije: „Nema internet veze.
Sportem radi samo onlajn — proveri vezu i pokušaj ponovo." + dugme „Pokušaj ponovo". Ne narušava ustav
(ne servira se nijedan podatak, samo poruka).

### 13. Nema `Checkbox` komponente — svi bulk tokovi su mete od 16px
**[POTVRĐENO]** `components/ui/` nema `checkbox.tsx`; 16 sirovih `<input type="checkbox" className="size-4">`:
`porudzbine/orders-bulk-table.tsx:245,265,320`, `orders-filter-bar.tsx:251,261`,
`finansije/fakture/issue-invoice-panel.tsx:144`, `finansije/uplate/new-payout-dialog.tsx:189`,
`finansije/postarina/fakture/xexpress-invoice-form.tsx:266`, `katalog/catalog-table.tsx:226,235,244`,
`katalog/stock-count-control.tsx:109`, `obavestenja/notification-preferences.tsx:61,86,94`.
Dizajn § 8 traži **min 40px**. Ovo pogađa baš one tokove koji se rade masovno i na telefonu: označi
poslato, izaberi uplate za fakturu, izaberi porudžbine za XExpress specifikaciju, popiši zalihu.
Na `orders-bulk-table.tsx:320` čekboks uz to leži iznad overlay linka cele kartice — promašaj od 3-4px
otvara detalj porudžbine umesto da čekira.
*Predlog:* `components/ui/checkbox.tsx` sa hit-zonom 40px (`<label className="flex size-10 items-center justify-center -m-3">`),
pa zameniti svih 16 mesta.

### 14. Korisnik bez `profiles` reda upada u beskonačnu redirect petlju
`lib/supabase/middleware.ts:60-64` + `app/(app)/layout.tsx:10-11` — **[POTVRĐENO, provereno lično]**
Middleware šalje **ulogovanog** korisnika sa `/prijava` na `/`; `(app)/layout` kad `getProfile()` vrati
`null` (`lib/auth.ts:39` — auth korisnik postoji, ali nema red u `profiles`) šalje nazad na `/prijava`
→ `ERR_TOO_MANY_REDIRECTS`, **bez mogućnosti odjave** (a odjave ionako nema na mobilnom, nalaz 1).
To stanje aplikacija sama proizvodi: `app/(app)/korisnici/actions.ts:65-70` eksplicitno dopušta ishod
„pozivnica poslata, ali upis role nije uspeo".
*Predlog:* kad je sesija validna a profil nedostaje → stranica „Nalog nije podešen — javi se
administratoru" sa dugmetom Odjava, umesto redirecta.

### 15. Preimenovanje statusa tiho lomi finansije, dashboard i cron
`app/(app)/podesavanja/status-settings.tsx:143-177` — **[POTVRĐENO]** Cela aplikacija radi lookup
statusa **po imenu** (`db/finance.ts:19,596`, `db/dashboard.ts:54`, `api/cron/notifikacije/route.ts:103`,
`lib/woo.ts:125-165`) — što je namerna odluka iz CLAUDE.md („nikad hardkodovan UUID"). Ali forma u
Podešavanjima dozvoljava Adminu da „Isporučeno" preimenuje u „Dostavljeno", posle čega uplate, fakture,
Dashboard metrike i cron obaveštenja **prestanu da rade bez ijedne greške** — samo se sve isprazni.
Nema upozorenja, a `Trash2` (brisanje statusa) je odmah pored.
*Predlog:* zaključati preimenovanje seed statusa (Kreirano/Poslato/Isporučeno/Otkazano/Vraćeno) —
dozvoliti samo boju i redosled, uz caption „sistemski status"; ili bar blokirajući dijalog upozorenja.

### 16. Lozinka može da završi u URL-u i istoriji pretraživača
`app/(app)/podesavanja/profile-settings.tsx:59-66` i `:87-98` — **[POTVRĐENO mehanizam / SUMNJA učestalost]**
Obe forme nemaju `action`, oslanjaju se isključivo na `onSubmit` + `preventDefault()`. Dok React nije
hidriran (spor mobilni net, prvi ulazak u PWA), pritisak na „Go" na tastaturi izvede **native GET** →
`/podesavanja?password=…&confirm=…` upisano u istoriju pretraživača i u Vercel logove.
*Predlog:* `method="post"` + server action kao `action` (progressive enhancement), ili držati dugme
`disabled` dok se komponenta ne hidrira.

---

# OZBILJNO

## Mobilni UX (375px)

- `app/(app)/page.tsx:225-234` — **[POTVRĐENO, provereno lično]** **Horizontalni scroll na Dashboardu.**
  `rsd()` vraća **non-breaking space** (U+00A0 — hexdump: `…30 30 a0 52 53 44`), pa je „184.300 RSD"
  jedan neprelomiv token. Kartica na 375px ima ~123px sadržaja, a taj tekst na `text-2xl` bold je
  ~145-150px → preliva se preko kartice i preko viewporta. Milionske cifre su gore.
  *Predlog:* `text-xl` na mobilnom + `[overflow-wrap:anywhere]`, ili valuta u eyebrow labeli umesto u broju.
- `app/(app)/podesavanja/status-settings.tsx:71-97` — **[POTVRĐENO]** Red statusa se preliva na 375px:
  `flex items-center gap-3` bez `flex-wrap` — pilula + „redosled: N" + heks + 2 ikon-dugmeta (32px)
  ≈ 350-380px na 327px prostora.
- `app/(app)/obavestenja/notification-preferences.tsx:72-76` vs `:80-101` — **[POTVRĐENO]** Zaglavlje
  „Push/Email" **ne stoji iznad svojih čekboksa**: zaglavlje i svaki red su zasebni grid kontejneri sa
  `grid-cols-[1fr_auto_auto]`, ali su `auto` kolone u zaglavlju `w-12` (48px) a u redovima 20px →
  kolone se ne poklapaju i `mx-auto` nema efekta. Korisnik ne zna koji čekboks je koji kanal.
- `app/(app)/obavestenja/notification-preferences.tsx:85-100` — **[POTVRĐENO]** čekboksi `size-5` (20px)
  kao jedine mete u tabeli 6 redova × 2 kanala.
- `app/(app)/korisnici/page.tsx:50-59` — **[POTVRĐENO]** zaglavlje se gnječi: `justify-between` sa
  `whitespace-nowrap` dugmetom (~160px) ostavlja opisu ~150px → lomi se u 4-5 redova.
- `app/(app)/period-filter.tsx:43-69` — **[SUMNJA]** red sa dva `input[type=date]` + dugme verovatno
  prelazi 327px na iOS-u (Safari renderuje date input ~140px, Chrome Android znatno uže); nema
  `flex-wrap` ni `min-w-0`.
- `lib/nav.ts:32` + `components/layout/bottom-nav.tsx:32` — **[POTVRĐENO]** Logistika ima **jednu**
  primarnu nav stavku → „Katalog" se `flex-1` rasteže preko pola ekrana pored „Više", što izgleda kao greška.
- `app/(app)/porudzbine/orders-bulk-table.tsx:243-250` — **[POTVRĐENO]** „Izaberi sve na strani" postoji
  **samo u desktop tabeli** (`hidden … md:block` na `:239`). Na telefonu nema select-all — 25 tapova po 16px.
- `app/(app)/porudzbine/orders-bulk-table.tsx:150-177` — **[POTVRĐENO]** Traka „Izabrano: N" + „Akcije"
  je običan `div` na **vrhu** liste, nije sticky. Odčekiraš dole → moraš da skroluješ nazad na vrh.
  *Predlog:* `sticky bottom-0` iznad bottom nav-a (uz safe-area).
- `app/(app)/porudzbine/orders-filter-bar.tsx:153-170` — **[POTVRĐENO]** Na 375px: `px-6` (48px) →
  327px sadržaja; `Select w-28` (112px) + „Filteri" (~105px) + gap-ovi → polju za pretragu ostaje **~90px**.
  Placeholder je odsečen, unos neupotrebljiv. *Predlog:* pretraga u svom redu na mobilnom.
- `app/(app)/finansije/uplate/[id]/page.tsx:80`, `fakture/[id]/page.tsx:97`,
  `postarina/fakture/[id]/page.tsx:85`, `uplate/[id]/spisak-view.tsx:106` — **[POTVRĐENO]** Tabele na
  detaljnim stranama **nemaju mobilnu kartičnu varijantu** (za razliku od listi). XExpress detalj ima
  6 kolona sa `whitespace-nowrap` → garantovan horizontalni skrol, a najvažnija kolona („Rezultat") je van ekrana.
- `app/(app)/finansije/postarina/fakture/xexpress-invoice-form.tsx:256-317` — **[POTVRĐENO]** Najteži
  svakodnevni unos je najlošije prilagođen: po redu čekboks + dva `type="number"` (`h-8`, `w-24`) unutar
  `max-h-128` skrol-boksa **unutar** stranice koja i sama skroluje (ugnježdeni skrol na dodir).
  50-150 redova × 2 unosa. Nema „označi sve", nema „primeni isti iznos na sve izabrane", nema `<form>`/Enter.
- `app/(app)/finansije/uplate/new-payout-dialog.tsx:175` i `fakture/issue-invoice-panel.tsx:134` —
  **[POTVRĐENO]** Lista kandidata je `max-h-72` skrol unutar dijaloga koji i sam skroluje; na 375px vidiš
  ~6 od 40+ redova, a dugme „Sačuvaj" je **ispod** liste u istom skrolu → tri nivoa skrolovanja.
  *Predlog:* sticky `DialogFooter`, bez sopstvenog `max-h` na mobilnom, `90vh` → `90dvh`.
- Gutter je nekonzistentan: `px-6 py-10` bez mobilnog stepenovanja na 14 ekrana
  (`porudzbine/page.tsx:83`, `finansije/uplate|fakture|postarina/page.tsx`, `troskovi/page.tsx:76`,
  `katalog/[id]/page.tsx:35`, `korisnici`, `podesavanja`, `obavestenja`) vs `px-4 sm:px-6` na 7 ekrana.
  Na 375px se gubi 16px korisne širine baš tamo gde su tabele i unosi.

## Tap mete ispod 40px (dizajn § 8: „min 40px … brat radi sa telefona")

Ovo je sistemski, ne pojedinačno — 48 pojava `size="sm"|"icon-sm"|h-8`:

- `components/ui/dialog.tsx:65` i `components/ui/sheet.tsx:81` — **[POTVRĐENO]** „X" za zatvaranje je
  gola ikonica `size-4` bez paddinga → meta **~16px**, u **svakom** dijalogu u aplikaciji.
- `components/ui/dropdown-menu.tsx:64` — **[POTVRĐENO]** `py-1.5 text-sm` → red ~30px. To je „⋮" meni
  (Izmeni/Arhiviraj/Obriši) i bulk meni, gde su destruktivne stavke direktno uz bezopasne.
- `components/patterns/row-actions.tsx:27` — **[POTVRĐENO]** trigger `size="icon-sm"` = 32px.
- `app/(app)/porudzbine/[id]/order-status-control.tsx:132,146,165,181,194` — **[POTVRĐENO]** svih 5
  dugmadi brzog toka („Poslato", „Isporučeno", „Otkaži", „Vrati", „Keš") su `size="sm"` = 32px. To su
  najvažnije dnevne akcije u celoj aplikaciji, na telefonu. `:207,218,237` (ručna promena) isto h-9/sm.
- `app/(app)/katalog/stock-count-control.tsx:102,108` — **[POTVRĐENO]** input `h-8` (32px, gazi `h-10`
  iz `Input`) + čekboks `size-4` (16px). Glavna kontrola za logistiku, 50× po smeni.
- `app/(app)/porudzbine/orders-pagination.tsx:66,89-124` i `components/patterns/data-table-pagination.tsx:46,69-104`
  — **[POTVRĐENO]** `SelectTrigger h-8` + **četiri** `icon-sm` (32px) na `gap-1.5` (6px razmaka).
- `app/(app)/troskovi/page.tsx:112-126` — **[POTVRĐENO]** strelice za mesec `p-1` oko `size-4` = **24×24px**;
  glavna navigacija po periodu.
- `app/(app)/finansije/**` — **[POTVRĐENO]** sve akcije na detaljima su `size="sm"` (32px), među njima
  i „Obriši": `payout-actions.tsx:86,139`, `invoice-actions.tsx:62,69`, `xexpress-invoice-actions.tsx:37,44`,
  `spisak-view.tsx:90,93`, `invoice-print.tsx:84,87`, `postarina/page.tsx:111`.
- `app/(app)/finansije/finance-tabs.tsx:20,28` — **[POTVRĐENO]** `h-9` (36px); jedina navigacija između
  tri finansijska ekrana na telefonu.
- `app/(app)/period-filter.tsx:31,46,56,63` — **[POTVRĐENO]** preset linkovi `py-1.5` (~30px) i date
  inputi `px-2 py-1 text-sm` (~28px).
- `app/(app)/porudzbine/[id]/page.tsx:71-76` — **[POTVRĐENO]** „Nazad na porudžbine" je tekstualni link
  `text-sm` bez paddinga (~20px) — glavni izlaz sa detalja.
- `components/ui/select.tsx:34` — **[POTVRĐENO]** default trigger je `h-9` (36px) umesto 40px iz § 4,
  plus `w-fit` i `text-sm`. Zato ga 8 mesta ručno gazi sa `h-10`, dok `import-wizard.tsx:200` (h-9) i
  paginacije (h-8) ostaju manji. Ima i mrtve `dark:` klase u light-only app-u.

## Kontrast — izračunato, ne procenjeno

**[POTVRĐENO]** Dizajn § 8 tvrdi da tokeni zadovoljavaju AA. Za tri slučaja to ne stoji:

| Kombinacija | Odnos | Status |
|---|---|---|
| `ink-faint #8A988F` na `surface` | **3.01:1** | pada (potreban 4.5) |
| `ink-faint` na `surface-2` | **2.91:1** | pada i prag za veliki tekst |
| `sent` pill (Poslato) | **4.25:1** | pada |
| `warning` pill (Neuplaćeno / Nisko / Treba VP) | **3.95:1** | pada |
| ink, ink-soft, belo/green, info, success, danger, aktivni nav | 4.67–15.42 | prolazi |

`ink-faint` nije samo dekoracija — nosi `.eyebrow` (sva zaglavlja tabela finansija), `MobileCardField`
labele (`mobile-card-list.tsx:65,87`), ime kupca i datum na mobilnoj kartici porudžbine, labele
„Naplaćeno"/„Osnovica" u XExpress formi, objašnjenje računa salda (`postarina/page.tsx:93`).
Dizajn izričito kaže „Ne koristiti `ink-faint` za važan tekst" — a koristi se.
*Predlog:* zaglavlja i labele na `ink-soft` (5.65:1); `ink-faint` samo za placeholder. Zatamniti
`warning` i `sent` za jedan korak.

### Statusne pilule su jedini deo app-a koji vizuelno „nije Sportem" — i najgori po kontrastu
`supabase/seed.sql:12` + `supabase/migrations/20260712140000_split_cancel_return_status.sql:19` +
`app/(app)/porudzbine/status-pill.tsx:6-13` — **[POTVRĐENO, izračunato]**
Boje statusa u bazi su **Tailwind default paleta**, ne Sportem tokeni: `#6B7280` (gray-500),
`#2563EB` (blue-600), `#16A34A` (green-600), `#DC2626` (red-600), `#D97706` (amber-600).
Dizajn § 1/§ 6 propisuje `info #3D6B8C`, `sent #0E7C86` (tirkiz, ne plava), `success #1B7A45`,
`danger #B23B30`, `warning #A86A12`. Pilula je najvidljiviji element aplikacije.
`StatusPill` uz to pravi pozadinu kao **10% alfe** iste boje umesto soft tokena, pa kontrast pada:

| Status | Odnos | |
|---|---|---|
| Vraćeno `#D97706` | **2.86:1** | pada i prag 3:1 |
| Isporučeno `#16A34A` | **2.95:1** | pada i prag 3:1 |
| Otkazano `#DC2626` | **4.14:1** | pada |
| Kreirano `#6B7280` | **4.27:1** | pada |
| Poslato `#2563EB` | **4.50:1** | granično |

*Predlog:* migracija koja usklađuje `order_statuses.color` sa tokenima + `StatusPill` da koristi soft
pozadine iz § 1 umesto `${hex}1A`. Fallback `#6B7280` na `:6` zameniti `var(--info)`.

## Tipografija ne prati sopstveni dizajn sistem
**[POTVRĐENO]** Jedino `/stil` koristi tačne vrednosti; ceo proizvod je stepenik-dva manji:

| Uloga | Dizajn | Stvarno |
|---|---|---|
| `h1` | 1.75rem / 28px | `text-xl` (1.25rem) na **15 od 21** mesta |
| `h2` | 1.375rem / 22px | `text-sm` (0.875rem!) na 8 mesta, `text-base` na 4 |
| display (stat broj) | 2.25rem / 36px | `text-2xl` (1.5rem) — `page.tsx:136,228`, `troskovi/page.tsx:109`, `postarina/page.tsx:87` |

*Zašto smeta:* `h2` od 14px je iste veličine kao telo teksta → nema hijerarhije, ekrani izgledaju kao
zid teksta. Veliki dashboard broj (poenta stat kartice, § 4) je za trećinu manji nego što treba, baš
na telefonu gde se čita u prolazu.

## Povratna informacija i potvrde

- **Pending tekst nedostaje na najsporijim akcijama** — **[POTVRĐENO]**
  `xexpress-invoice-form.tsx:334`, `new-payout-dialog.tsx:216`, `payout-actions.tsx:130`,
  `settlement-dialog.tsx:127`, `issue-invoice-panel.tsx:164`, `troskovi/expense-dialog.tsx:160`
  imaju samo `disabled`, bez „Čuvam…". Ista kodbaza to radi ispravno u `product-form.tsx:216` i
  `variant-form.tsx:245`. U `expense-dialog.tsx:157` „Otkaži" **nije** disabled → dijalog se može
  zatvoriti usred slanja slike od 5 MB.
- `components/patterns/confirm-dialog.tsx:55-59` i `reason-dialog.tsx:83-87` — **[POTVRĐENO]**
  Dijalog se zatvara **pre** poziva `onConfirm`, pa se pending nikad ne vidi u dijalogu. Dupli klik
  nije moguć (dijalog je zatvoren), ali korisnik nema pojma da nešto radi dok se čeka DB + Woo push (do 10s).
- **Native `confirm()` umesto postojećeg `ConfirmDialog`** — **[POTVRĐENO]**
  `porudzbine/[id]/order-items-editor.tsx:241`, `katalog/variants-table.tsx:106`,
  `katalog/product-actions.tsx:73`, `troskovi/expense-actions.tsx:81`, `troskovi/category-manager.tsx:154`.
  U PWA standalone modu sistemski popup („localhost says…") izgleda kao defekt.
- `app/(app)/katalog/category-dialog.tsx:141-149` — **[POTVRĐENO]** Brisanje kategorije **bez ikakve
  potvrde**, dugme `icon-sm` (32px) odmah do polja za preimenovanje; briše kategoriju sa svih proizvoda.
  Skoro identična komponenta za troškove (`category-manager.tsx:153`) **ima** potvrdu — asimetrija.
- `app/(app)/finansije/postarina/settlement-dialog.tsx` — **[POTVRĐENO]** Poravnanje se snima bez
  potvrde, a `postage_settlements` je append-only bez ijedne akcije za brisanje/izmenu. Pogrešan iznos
  trajno pomera saldo, a UI nigde ne kaže da se ispravlja suprotnim unosom.
- `app/(app)/katalog/stock-count-control.tsx:60` — **[POTVRĐENO]** `router.refresh()` posle **svakog**
  popisa, iako akcija već radi `revalidatePath` i strana je `force-dynamic` → pun re-fetch proizvoda +
  varijanti + kategorija po unetoj cifri. 50 varijanti = 50 punih refresh-eva na slabom signalu, uz
  `disabled` polje (`:92,111`) koje zatvara/otvara tastaturu.

## Auth, obaveštenja i administracija

- `app/prijava/page.tsx` — **[POTVRĐENO]** **Nema „Zaboravljena lozinka".** Jedini put je da Admin ručno
  postavi lozinku kroz `/korisnici`; ako Admin zaboravi svoju — nema puta iz aplikacije.
  *Predlog:* `resetPasswordForEmail` kroz isti `/auth/callback` → `/postavi-lozinku` tok koji već postoji.
- `lib/supabase/middleware.ts:52-56` + `app/prijava/actions.ts:41` — **[POTVRĐENO]** **Deep link se gubi
  posle prijave.** Middleware ne pamti `?next=`, a `signIn` uvek vodi na `/` (ili `/katalog`). Push
  obaveštenja vode na `/porudzbine/{id}` — ako je sesija istekla (čest slučaj na telefonu), korisnik
  sleti na Dashboard i mora ručno da traži porudžbinu. Time push gubi pola vrednosti.
- `app/(app)/obavestenja/push-settings.tsx:39-40` + `components/push/use-push.ts:51` — **[POTVRĐENO]**
  **Zaglavljeno „Provera podrške…" bez izlaza.** `navigator.serviceWorker.ready` je Promise koji
  **nikad ne rejektuje** ako SW nije registrovan — u dev-u i pri neuspeloj registraciji u produkciji
  ekran zauvek stoji na toj poruci, bez objašnjenja i bez dugmeta.
  *Predlog:* `Promise.race` sa 3-5s timeout-om → „Obaveštenja još nisu spremna na ovom uređaju."
- `components/push/use-push.ts:69` — **[POTVRĐENO]** „**Nedostaje VAPID ključ (konfiguracija).**" ide
  direktno u toast krajnjem korisniku. Bratu/logistici to ne znači ništa.
- `app/(app)/obavestenja/notification-preferences.tsx:93-100` — **[POTVRĐENO]** **Email kanal se može
  uključiti iako ništa ne stiže.** Bez `RESEND_API_KEY` `lib/email.ts` je tihi no-op, a UI pokazuje
  čekiran „Email" i „Sačuvano.". Isto za „Push" kad uređaj nije pretplaćen — sekcija iznad kaže
  „isključena", a tabela ispod tvrdi da push stiže. Kontradikcija na istom ekranu.
- `app/(app)/korisnici/page.tsx:107-134` — **[POTVRĐENO]** Za „Pozvan — čeka" korisnika **nema „Pošalji
  ponovo" ni uklanjanja naloga.** Ako pozivnica završi u spamu ili istekne, Admin nema akciju (obilazni
  put je da mu kroz „Izmeni" ručno postavi lozinku i saopšti je usmeno).
- `app/postavi-lozinku/page.tsx:39-62` — **[POTVRĐENO]** Postavljanje lozinke naslepo, dva puta, bez
  „prikaži lozinku" i bez inline provere poklapanja — greška stiže tek posle round-tripa. To je **prvi
  ekran** koji novi član tima vidi.
- `app/(app)/stil/page.tsx:213-257` i `komponente/page.tsx:66-103` — **[POTVRĐENO]** `/stil` rute nemaju
  `requireRole` (jedine u `(app)` grupi bez guarda) i nisu u nav-u, a prikazuju tabelu sa **MP / VP /
  Zarada** kolonama. Logistika ih može otvoriti → direktna suprotnost zaključanoj odluci i § 9
  („kolone se ne renderuju"). Podaci su lažni, ali princip je prekršen.
  *Predlog:* `requireRole("admin")` ili gejt na `NODE_ENV !== "production"`.

## Prazna stanja i poruke grešaka

- `app/(app)/porudzbine/page.tsx:105-110` — **[POTVRĐENO]** Prazno stanje nema akciju (§ 4/§ 8 traže
  „poruka + akcija"); sa 3 postavljena filtera jedini izlaz je ručno resetovanje kroz panel.
  Naslov uz to glasi „Nema porudžbina za **ovaj period**" i kad nikakav datumski filter nije postavljen.
- `app/(app)/katalog/catalog-table.tsx:258-265` — **[POTVRĐENO]** Isti tekst kad je katalog prazan i
  kad su filteri preterali; nema „Poništi filtere" ni „Dodaj proizvod". Za Logistiku fali pozitivan
  slučaj: kad je „Fali količina" uključeno a rezultata nema, poruka treba da bude „Sve varijante su popisane."
- `app/(app)/troskovi/page.tsx:131-136` — **[POTVRĐENO]** prazno stanje bez „Dodaj trošak".
- `app/(app)/porudzbine/actions.ts:601` i `:727` — **[POTVRĐENO]** „Nijedna porudžbina nije označena
  poslato (sve preskočene)." ne kaže **zašto**, iako server zna razlog (već poslato / otkazano / za proveru).
  Kod otkazivanja je razlog „plaćena/fakturisana → traži se force potvrda" — korisnik to ne sazna.
- `app/(app)/finansije/actions.ts` (14 mesta: `:102,116,177,224,314,336,432,503,516,549,566,577,595,599`)
  — **[POTVRĐENO]** Sve DB greške vraćaju generičku poruku bez uzroka i **ne šalju se u Sentry**.
  Kad brat na telefonu dobije „Vezivanje porudžbina nije uspelo.", nema šta da uradi ni šta da javi.
- `app/(app)/katalog/uvoz/import-wizard.tsx:245-252` — **[POTVRĐENO]** Kad `phase === "done"`, uvek se
  renderuje zeleni `success` okvir sa `CheckCircle2` — i kad tekst unutra glasi „Uvoz zaustavljen."
  Zelena kvačica + poruka o prekidu = korisnik misli da je prošlo.
- **[POTVRĐENO]** U celom app-u **nula** pojava `aria-live`, `role="alert"`, `role="status"`. Sonner ima
  svoj interni live region, ali inline greške (`FormMessage`, `{state.error}`) se ne najavljuju.

## Broj klikova / trenje u svakodnevnom radu

- **Poštarina je odvojena od „Poslato"** — `porudzbine/[id]/order-status-control.tsx:125-137` +
  `shipping-form.tsx:54-104` — **[POTVRĐENO]** iako CLAUDE.md kaže da se poštarina popunjava „na koraku
  Poslato", to su dva razdvojena mesta na stranici: otvori → skroluj → „Poslato" → potvrdi → skroluj
  dole → 4 polja → „Sačuvaj". Za 20 porudžbina dnevno = 80+ interakcija.
  **Bulk „Označi poslato" uopšte ne nudi poštarinu**, a bulk unosa poštarine nema nigde — posle bulk
  slanja 20 porudžbina moraš da otvaraš svaku. Pošto `getSaldoPostarine` i XExpress fakture zavise od
  `shipping_charged`, ovo je operativna rupa.
- **Pretraga po broju porudžbine ne radi po defaultu** — `db/orders.ts:126` + `porudzbine/page.tsx:44-50`
  — **[POTVRĐENO]** `if (searchField === "all" && /^\d+$/.test(term))`, a podrazumevano polje je `"name"`.
  Ukucaš „2419" → 0 rezultata, iako porudžbina postoji. Broj je najčešći način traženja (kupac zove i kaže broj).
- **Katalog gubi filtere pri povratku** — `katalog/catalog-table.tsx:101-105` — **[POTVRĐENO, provereno lično]**
  `search`, `categoryId`, `lowStockOnly`, `zeroStockOnly` su lokalni React state; `uncountedOnly` se čita
  iz `?popis=fali` ali se nikad ne upisuje nazad. Strana je `force-dynamic` → povratak sa detalja
  proizvoda re-montira komponentu: izgubljena pretraga, filter, i strana paginacije.
  Tok „popiši 50 varijanti" postaje: filtriraj → uđi → nazad → **filtriraj ponovo** → skroluj do iste tačke.
  Najveći pojedinačni gubitak vremena u celoj aplikaciji. *Predlog:* filteri u `searchParams`, kao što
  `/troskovi` već radi sa `?mesec=`.
- **Uplata se ne može ispraviti** — `finansije/uplate/[id]/payout-actions.tsx:57` — **[POTVRĐENO]**
  `order_ids: orderIds` („linkage se ne menja odavde"). Server **ume** da re-veže, ali UI to ne izlaže:
  ako zaboraviš da čekiraš jednu porudžbinu, jedini put je obriši-pa-napravi-novu — a brisanje je
  zabranjeno ako je bilo šta fakturisano (`actions.ts:213`) → **ćorsokak**.
- `finansije/uplate/new-payout-dialog.tsx:216` + `lib/validation/finance.ts:37` — **[POTVRĐENO]**
  Uplata sa **nula** porudžbina je dozvoljena, a takva je nevidljiva za fakturisanje
  (`getInvoiceCandidates` traži `linkedCount > 0`) i ne može joj se dodati nijedna → „zombi" red.
- **Nema bulk popisa, skenera ni „sledeće varijante"** — **[POTVRĐENO odsustvo]** Za jednu varijantu sa
  liste treba ~6-7 tapova; ×50 ≈ 350 tapova bez ijedne potvrde. Nema „potvrdi sve prikazane",
  Enter ne pomera fokus na sledeće polje (`stock-count-control.tsx:96-101` samo radi `blur`),
  nema unosa/skeniranja SKU koji skače na varijantu, nema brojača napretka.
- `finansije/uplate/new-payout-dialog.tsx:175-209` i `issue-invoice-panel.tsx` — **[POTVRĐENO]** nema
  pretrage ni „označi sve/poništi sve" u listama kandidata.
- `porudzbine/[id]/order-items-editor.tsx:418-430` — **[POTVRĐENO]** „Dodaj stavku" nudi `Select` sa
  **svim** aktivnim varijantama, bez pretrage i bez limita (PostgREST tiho seče na 1000). Sa nekoliko
  stotina SKU-ova na telefonu je neupotrebljivo.

## Upload slika (katalog + troškovi)
`app/(app)/katalog/image-input.tsx:29-36` + `app/(app)/troskovi/attachment-input.tsx:19-23` —
**[POTVRĐENO]** `MAX_IMAGE_BYTES` postoji, ali se proverava **tek na serveru**. Fotografija sa telefona
je rutinski 4-8 MB: korisnik je pošalje preko mobilnog interneta, čeka 20-40s, dobije „Slika je veća od
5 MB." i **gubi ceo unos forme**. Nema trake progresa ni spinnera. Nema `capture="environment"` za brzo
slikanje računa. **[SUMNJA]** `accept` ne pokriva `image/heic`/`heif` (iPhone) — Safari obično konvertuje,
ali nije garantovano.

## Pristupačnost — ostalo

- `app/(app)/porudzbine/[id]/shipping-form.tsx:108-115` — **[POTVRĐENO]** `Field` renderuje `<Label>`
  **bez `htmlFor`**, `Input` nema `id`. Nijedno od 4 polja nije povezano sa labelom: tap na labelu ne
  fokusira polje, čitač ekrana čita „edit text" bez imena.
- `app/(app)/porudzbine/orders-filter-bar.tsx:153-161` — **[POTVRĐENO]** glavno polje pretrage nema ni
  `<Label>` ni `aria-label` (samo placeholder, koji nestaje pri kucanju); `SelectTrigger` bez `aria-label`.
- Čekboksi bez `aria-label`: `new-payout-dialog.tsx:189`, `issue-invoice-panel.tsx:144`,
  `xexpress-invoice-form.tsx:266` — **[POTVRĐENO]** (u prva dva `<label>` obavija red pa postoji ime;
  u XExpress formi čekboks nema **nikakvo** dostupno ime). `orders-bulk-table.tsx:266` to radi ispravno.
- `components/ui/dialog.tsx:68` — **[POTVRĐENO]** `<span className="sr-only">Close</span>` — **engleski**,
  u svakom dijalogu. `sheet.tsx:84` ispravno koristi „Zatvori".
- `app/(app)/katalog/uvoz/import-wizard.tsx:157-169` — **[POTVRĐENO]** `<input type="file" className="hidden">`
  → `display:none` znači da element **nije fokusabilan**, a `<label>` bez `tabindex`/`role` se ne može
  aktivirati tastaturom. Korak „Učitaj CSV" je nedostupan bez miša. Uz to je `<span>` stilizovan kao
  lažno dugme umesto `Button`.
- `app/layout.tsx:36-37` — **[POTVRĐENO]** `maximumScale: 1, userScalable: false` blokira pinch-zoom
  (WCAG 1.4.4). Razumljivo je zašto (sprečava iOS auto-zoom na fokus), ali se to rešava sa `text-base`
  na inputima, ne gašenjem zumiranja. Korisnik koji ne vidi dobro SKU u magacinu ne može da uveća.
- `components/ui/table.tsx:56-67` — **[POTVRĐENO]** `TableHead` bez `scope="col"`.
- `app/(app)/katalog/catalog-table.tsx:129-134` — **[POTVRĐENO]** kolona sa slikom ima `header: ""` →
  `<th>` bez pristupačnog imena.
- `components/patterns/data-table-column-header.tsx:26` — **[POTVRĐENO]** sortabilni header ne postavlja
  `aria-sort` na `<th>`; stanje sortiranja se ne najavljuje.

## Srpski jezik i terminologija
Dijakritika je čista; problemi su terminološki:

- `app/(app)/porudzbine/[id]/page.tsx:252-256` — **[POTVRĐENO]** „WooCommerce status: **processing**" —
  sirov engleski interni string direktno korisniku.
- `app/(app)/finansije/fakture/page.tsx:145` — **[POTVRĐENO]** „**ISTORIJA-BACKFILL**" kao broj fakture u listi.
- `app/(app)/finansije/uplate/page.tsx:73`, `new-payout-dialog.tsx:122`, `uplate/[id]/page.tsx:52` —
  **[POTVRĐENO]** „**T−1**" je interni žargon u vidljivom UI-ju.
- `app/(app)/katalog/uvoz/page.tsx:24` i `import-wizard.tsx:231` — **[POTVRĐENO]** „Pregled (**dry-run**)".
- `app/(app)/finansije/**` — **[POTVRĐENO]** „**Σ** otkup" (matematički simbol u UI tekstu).
- **Srpska množina nije obrađena** — **[POTVRĐENO]** „2 porudžbin**a**", „2 nefakturisan**ih** uplat**a**"
  (`uplate/page.tsx:126`, `fakture/page.tsx:74`, `issue-invoice-panel.tsx:128,151`, `actions.ts:343`),
  iako `plural()` helper već postoji u cron obaveštenjima.
- **Nekonzistentni navodnici** — **[POTVRĐENO]** `„Poslato".` (otvara srpski, zatvara engleski) u
  `orders-bulk-table.tsx:194`, `order-status-control.tsx:227,267`, `order-items-editor.tsx:241,285`;
  `finansije/actions.ts:59,365` koristi `“`. Ispravno `„…"` je u `orders-filter-bar.tsx:190,256`.
- **Nekonzistentna terminologija:** „Dostava" (`spisak-view.tsx:37,67`) vs „Poštarina" (svuda drugde);
  „Otkup"/„Otkupnina" naizmenično.
- `app/(app)/katalog/page.tsx:35` — **[POTVRĐENO]** podnaslov „Proizvodi, varijante, **cene** i stanje."
  se renderuje i Logistici, kojoj su sve cene (ispravno) uklonjene → „gde su cene?"
- `app/(app)/finansije/uplate/page.tsx:60-64` i `postarina/page.tsx:224` — **[SUMNJA]** prazno stanje
  govori Menadžeru „evidentiraj uplatu", a on nema to dugme.
- **Mešanje persiranja i „ti"** — **[POTVRĐENO]** Vi: `korisnici/page.tsx:54-56` („Pozovite…"),
  `edit-user-dialog.tsx:72-74`, `postavi-lozinku/page.tsx:32`, `prijava/actions.ts:10-11`.
  Ti: `page.tsx:113` („probaj drugi period"), `push-settings.tsx:74`, `podesavanja/actions.ts:89-90`.
  *Predlog:* za interni alat od 3 osobe — svuda „ti".
- **[POTVRĐENO]** „**Rola**" (engleski kalk) na ekranu Korisnici (`korisnici/page.tsx:68,84,87,126`) vs
  „**Uloga**" u Profilu (`profile-settings.tsx:56`). Isti pojam, dva imena.
- **[POTVRĐENO]** „Najmanje 8 **karaktera**" (`postavi-lozinku/page.tsx:48`, `prijava/actions.ts:11`) vs
  „bar 8 **znakova**" (`podesavanja/actions.ts:44`). Uz to su i pragovi različiti: `korisnici/actions.ts:86`
  traži 6, `podesavanja/actions.ts:44` traži 8.
- **[POTVRĐENO]** „**E-mail**" (`korisnici`, `prijava`) vs „**Email**" (`profile-settings.tsx:56`,
  `notification-preferences.tsx:75`).
- `app/(app)/obavestenja/push-settings.tsx:63` i `obavestenja/page.tsx:40` — **[POTVRĐENO]** reč „**push**"
  izložena korisniku. *Predlog:* „obaveštenja na telefonu".
- `app/(app)/page.tsx:232` — **[POTVRĐENO]** `capitalize` daje „**Ova Nedelja**" (Tailwind kapitalizuje
  svaku reč) — u srpskom se ne piše veliko slovo na svakoj reči. *Predlog:* `first-letter:uppercase`.

## Dizajn sistem — ostala odstupanja

- **Minus se boji u `warning` umesto `danger`** — **[POTVRĐENO]** `postarina/page.tsx:88,169,191`,
  `postarina/fakture/[id]/page.tsx:71,132`, `xexpress-invoice-form.tsx:223`, `settlement-dialog.tsx:106`,
  `new-payout-dialog.tsx:162`. § 1 kaže „gubitak/minus saldo → `danger`". Sada `warning` istovremeno
  znači „neuplaćeno", „treba VP" i „gubitak" → gubi se signal.
- **Selektovan red nema vizuelno stanje** — `orders-bulk-table.tsx:262,312` — **[POTVRĐENO]** § 4
  izričito traži „leva zelena traka 3px + `green-soft` pozadina". Sada je jedini signal sam čekboks;
  na 375px kroz 25 kartica se ne vidi šta je izabrano.
- `components/ui/dialog.tsx:56` — **[POTVRĐENO]** `DialogContent` koristi `bg-background` (= `paper #F5F7F5`)
  i `rounded-lg` (16px); § 1/§ 3 za modale traže `surface` (#FFFFFF) i `radius-xl` (20px). Sivi modal
  na sivoj pozadini se slabo odvaja.
- `components/ui/skeleton.tsx:7` — **[POTVRĐENO]** `bg-accent` = `green-soft` → skeleton je zelen.
  Dizajn princip 2: „Zelena = akcija. Ne boji se njom dekoracija."
- `components/ui/table.tsx:61` — **[POTVRĐENO]** `TableHead` nema `surface-2` pozadinu, `eyebrow` stil ni
  sticky (§ 4). `DataTable` to nadoknađuje ručno (`data-table.tsx:141`), ali ~10 ručno pisanih tabela ne.
- `app/(app)/katalog/product-form.tsx:199-209` — **[POTVRĐENO]** ad-hoc `<textarea>` sa ručno prepisanim
  klasama iako `components/ui/textarea.tsx` postoji. `:156-172` ručno sklopljena pilula umesto `Badge`
  (sa „X" od 12px unutra).
- `app/(app)/period-filter.tsx:63` i `app/global-error.tsx:26` — **[POTVRĐENO]** ad-hoc `<button>` umesto `Button`.
- `app/(app)/obavestenja/notification-preferences.tsx:64,91,99` — **[POTVRĐENO]** `accent-[#1B7A45]`
  (hardkodovan hex) umesto tokena.
- `app/(app)/finansije/**` — **[POTVRĐENO]** kad je vrednost 0 prikazuje se goli `"0"` bez valute
  (`postarina/page.tsx:42`, `xexpress-invoice-form.tsx:222`, `settlement-dialog.tsx:108`), dok su svi
  ostali iznosi „1.234 RSD".
- `app/(app)/finansije/postarina/page.tsx:39` + `settlement-dialog.tsx:64-67` — **[POTVRĐENO]** ime
  partnera „Simić" hardkodovano na dva mesta.
- `app/(app)/page.tsx:213-235` vs `app/(app)/stil/page.tsx:149-169` — **[POTVRĐENO]** **Dashboard ne
  prati sopstvenu „Stat karticu".** § 4 (i `/stil`) definišu: eyebrow + `display` 2.25rem + **delta**
  u `success`/`danger` sa strelicom. `MetricCard` koristi `text-2xl`, `hint` u `text-xs`, i **nigde u
  aplikaciji nema poređenja sa prethodnim periodom**, iako je delta deo specifikacije.
- `app/(app)/podesavanja/status-settings.tsx:122` — **[POTVRĐENO]** default boja novog statusa je
  `#6B7280` (Tailwind `gray-500`) — hladna siva koja ne postoji u paleti; dizajn izričito traži zeleni
  undertone („ne bolnički sivo").
- `app/(app)/podesavanja/status-settings.tsx:93` — **[POTVRĐENO]** native `confirm()` za brisanje statusa.
- `app/(app)/podesavanja/status-settings.tsx:158-162` — **[POTVRĐENO]** heks `Input` nema labelu ni `id`
  (`Label htmlFor="color"` pokazuje na swatch), pa je za čitač ekrana bezimen; nema ni klijentske
  provere formata — greška stiže tek sa servera.
- `app/(app)/podesavanja/page.tsx:33` + `profile-settings.tsx:54,85` — **[POTVRĐENO]** `h2` „Profil"
  sadrži još dva `h2` unutar sebe → izlomljena hijerarhija naslova za čitač ekrana.
- `app/(app)/stil/page.tsx:181` — **[POTVRĐENO doc drift]** „Vraćeno" je prikazano kao `warning`, a
  `docs/Sportem-Dizajn-Sistem.md` § 6 kaže `is-danger` i ima samo 4 statusa. `/stil` prati noviju odluku
  (razdvajanje Otkazano/Vraćeno), **dokument nije ažuriran** — treba dopuniti tabelu § 6 na 5 redova.
- `app/(app)/podesavanja/profile-settings.tsx:15-19` — **[POTVRĐENO]** `ROLE_LABEL` dupliran lokalno
  iako postoji `lib/roles.ts:4`.

## Performanse koje se osećaju kao UX

- `app/(app)/katalog/catalog-table.tsx:116-119` — **[POTVRĐENO, provereno lično]** O(n²) filter:
  `products.find((p) => p.id === r.id)` **unutar** `.filter()`, jer `toRow` ne prenosi `category_id`.
  Pri 500-1000 proizvoda to je do 10⁶ poređenja **po pritisku tastera** u pretrazi, na telefonu.
- **[POTVRĐENO]** Sve stranice su `force-dynamic`, a jedini `loading.tsx` je `app/(app)/loading.tsx`
  koji uvek pokazuje **TableSkeleton** — i na Dashboardu (stat kartice), i na formama, i na podešavanjima.
  Svaka navigacija je server round-trip sa lažnom tabelom kao skeletonom.
- `db/finance.ts:97,301,387,518,605` — **[SUMNJA]** nijedan od upita (`listPayouts`, `listInvoices`,
  `listPostageSettlements`, `getUnpaidDeliveredXexpress`, `getEligibleXexpressOrders`) nema paginaciju
  ni filter po periodu, a stranice nemaju pretragu. Za godinu dana = 250+ redova na jednoj strani i
  tiho odsecanje na PostgREST default limitu.
- `app/(app)/porudzbine/orders-filter-bar.tsx:88-94` — **[SUMNJA]** debounce 300ms, a svaki upis pokreće
  pun server render koji uz listu radi i `getOrdersSummary` (skenira do 20.000 redova + gradi indeks
  rizika). `router.replace` unutar iste rute ne mora da okine `loading.tsx` → lista sekundu-dve stoji
  sa starim podacima bez ikakvog signala.

---

# SITNO

- `app/(app)/porudzbine/page.tsx:59` + `orders-filter-bar.tsx:115-122` — **[POTVRĐENO]** server podržava
  `needs_review=1` i badge se prikazuje, ali u filter panelu **nema kontrole** za njega, niti ga
  `activeCount` broji → ako se postavi kroz URL, aktivan filter je nevidljiv.
- `app/(app)/porudzbine/orders-bulk-table.tsx:239-307` — **[POTVRĐENO]** lista ne prikazuje **način
  isporuke** (XExpress/Lično) ni **status plaćanja**, iako oba postoje kao filteri. Pri pripremi za
  slanje se ne vidi koje su lične prodaje → selektuju se greškom.
- `app/(app)/porudzbine/orders-bulk-table.tsx:72,79-102` — **[POTVRĐENO]** selekcija se **čuva preko
  promene strane**: 5 na strani 1 + 3 na strani 2 → „Izabrano: 8", akcija pogađa svih 8 od kojih 5 nije
  vidljivo. Nije bag, ali je skrivena posledica bez nagoveštaja.
- `app/(app)/porudzbine/orders-pagination.tsx:58-125` — **[POTVRĐENO]** renderuje se i kad ima samo jedna
  strana → tri grupe teksta i 4 mrtva dugmeta koja troše ekran na mobilnom.
- `app/(app)/porudzbine/[id]/page.tsx:199-205` vs `order-items-editor.tsx:165,186-188` — **[POTVRĐENO]**
  kartica „Iznosi" **skriva** „Zarada" ne-adminu, ali tabela stavki odmah ispod prikazuje VP i Zaradu
  svima, a i zbir na listi (`page.tsx:97`). Po zaključanoj odluci Menadžer *sme* da vidi zaradu — skrivanje
  na `:199` je višak koji zbunjuje.
- `app/(app)/porudzbine/[id]/page.tsx:109` — **[POTVRĐENO]** „Razreši" je `variant="subtle"` (zeleno na
  zelenom) unutar crvenog `danger-soft` callout-a.
- `app/(app)/porudzbine/[id]/shipping-form.tsx:54-104` — **[POTVRĐENO]** nije `<form>`: nema submit na
  Enter (tastatura na telefonu nudi „Go" koje ne radi), nema upozorenja o nesačuvanim izmenama, i
  prikazuje se i za `licno` porudžbine gde poštarina/paketi nemaju smisla.
- `app/(app)/katalog/stock-count-control.tsx:104-107` — **[POTVRĐENO]** datum popisa je samo u `title`
  atributu → na telefonu se **nikad** ne vidi kad je nešto poslednji put brojano.
- `app/(app)/katalog/catalog-table.tsx:266-308` — **[POTVRĐENO]** mobilna kartica ne prikazuje SKU, iako
  pretraga eksplicitno pokriva SKU. Logistika koja traži po šifri sa papira ne vidi da li je pogodila red.
- `app/(app)/katalog/variants-table.tsx:286-299` — **[POTVRĐENO]** mobilna kartica ne prikazuje VP, desktop
  tabela prikazuje — nedosledan skup podataka po veličini ekrana za istu rolu.
- `app/(app)/finansije/uplate/[id]/page.tsx:68-74` — **[POTVRĐENO]** `getPayoutDetail` računa `otkupTotal`
  i `difference`, ali stranica **ne prikazuje razliku** između uplaćenog i Σ otkupnine — baš kontrolu
  koju dijalog za kreiranje ističe. Posle snimanja se više ne može proveriti da li se uplata slaže.
  (CLAUDE.md opisuje 4 kartice „Uplaćeno / Σ otkupnina / Poštarina / Razlika" — kod je odlutao od dokumenta.)
- `app/(app)/finansije/uplate/new-payout-dialog.tsx:139-148` — **[SUMNJA]** iznos se kuca ručno iako app
  zna `Σ otkup` izabranih; u 95% slučajeva je isti broj. *Predlog:* dugme „Uzmi Σ otkup".
- `app/(app)/finansije/uplate/new-payout-dialog.tsx:53-62` — **[SUMNJA]** preselekcija se okida u renderu
  na svaku promenu `targetDay`; ručno odčekirani redovi se mogu tiho vratiti pri promeni datuma.
- `app/(app)/finansije/uplate/page.tsx:89-93` — **[SUMNJA]** badge „Fakturisano" nije link; sa uplate
  nema puta do fakture kojoj pripada.
- `app/(app)/finansije/fakture/[id]/page.tsx:87-96` — **[SUMNJA]** detalj fakture nabraja porudžbine ali
  ne i **uplate** od kojih je sklopljena, iako je novi model „faktura = skup uplata".
- `app/(app)/finansije/fakture/issue-invoice-panel.tsx:138-155` — **[POTVRĐENO]** kandidat-red ne pokazuje
  koje su porudžbine ni link na uplatu, a izdavanje trajno zaključava stavke.
- `app/(app)/finansije/fakture/page.tsx:86-102` — **[SUMNJA]** lista „Čeka VP" je inline niz brojeva
  razdvojenih zarezima; pri 30+ porudžbina zid brojeva bez imena kupca (iako `BlockedOrder` nosi `ship_name`).
- `app/(app)/finansije/postarina/page.tsx:182,277` — **[POTVRĐENO]** `MobileCard` dobija `ariaLabel` bez
  `href`, a komponenta ga koristi samo uz `href` → prop je mrtav; navigacija je ručno umotana u `<Link>`.
- `app/(app)/finansije/uplate/page.tsx:127,130-132` — **[POTVRĐENO]** isti iznos stoji dva puta na kartici.
- `app/(app)/finansije/postarina/settlement-dialog.tsx:94-100` — **[POTVRĐENO]** `type="number"` bez
  filtriranja unosa: „1234,5" prolazi kroz UI, pa zod vraća grešku tek posle klika.
- `app/(app)/troskovi/expense-dialog.tsx:104-113` — **[POTVRĐENO]** polje „Iznos" nema `inputMode="numeric"`,
  za razliku od `variant-form.tsx:172,186,199`.
- `app/(app)/porudzbine/orders-refresh.tsx:20-27` — **[POTVRĐENO]** tiho auto-osvežavanje na 60s: lista se
  pomeri pod prstom dok korisnik čekira, a nova porudžbina se pojavi bez signala.
  *Predlog:* traka „Stiglo je N novih porudžbina — prikaži".
- `app/(app)/porudzbine/orders-bulk-table.tsx:104-107` — **[POTVRĐENO]** `openPdf` nema nikakvu povratnu
  informaciju: prazan tab, PDF se renderuje sekundama; na grešci korisnik dobija goli tekst bez UI-ja.
  **[SUMNJA]** `window.open` iz Radix `onSelect` je kandidat za blokadu pop-up-a na iOS-u.
  **[SUMNJA]** pri `per_page=100` URL nosi 100 UUID-jeva (~3,7 KB) — blizu praktičnih granica kod nekih proxy-ja.
- `app/(app)/katalog/uvoz/import-wizard.tsx:189-217` — **[SITNO]** red mapiranja `w-48` + `w-56` se na
  375px lomi u tri reda po polju (12 polja = veoma dugačak ekran). Admin-only, verovatno sa računara.
- `app/(app)/katalog/catalog-table.tsx:224-250` — **[SITNO]** tri native čekboks filtera + `Input max-w-xs`
  + `Select w-48` se na 375px lome u ~5 redova iznad liste, bez mogućnosti sklapanja.
  *Predlog:* filter-čipovi (pilule, `radius-pill`, 36-40px) — bliže dizajnu i lakše za palac.
- `app/(app)/porudzbine/orders-filter-bar.tsx:172-306` — **[SUMNJA]** Radix `Sheet` se ne integriše sa
  istorijom pretraživača → hardversko „Nazad" na Androidu verovatno napušta stranicu umesto da zatvori panel.
- `/stil` i `/stil/komponente` — **[POTVRĐENO]** nemaju `requireRole` (jedine `(app)` rute bez guarda) i
  nisu u nav-u. Interna dizajn-stranica je dostupna u produkciji svakoj roli, uključujući Logistiku.
- `app/manifest.ts` — **[POTVRĐENO]** nema `shortcuts` (dugi pritisak na ikonicu → „Porudžbine", „Popis"),
  nema `screenshots` (bogatiji install prompt), nema `id`. Ikonice su i dalje privremeni „S" monogram.
- **[POTVRĐENO]** Nema `beforeinstallprompt` UI-ja — instalacija PWA se oslanja na to da korisnik zna za
  „Dodaj na početni ekran" u meniju pretraživača. Za drugu iz magacina to je barijera.
- `app/manifest.ts:13` — **[SUMNJA]** `start_url: "/"`, a Logistika nema Dashboard → svako otvaranje
  instalirane app-e je redirect hop na `/katalog`.
- `hooks/use-action-toast.ts` — **[POTVRĐENO]** „jedinstven obrazac" se koristi samo na 2 mesta
  (`prijava`, `postavi-lozinku`); ostalih 88 `toast.*` poziva je ad-hoc.
- `requireRole` (`lib/auth.ts:49`) — **[POTVRĐENO]** pogrešna rola → tihi `redirect("/")` bez ijedne
  poruke. Menadžer koji otvori admin link (npr. `/katalog/uvoz`) samo „padne" na Dashboard i ne zna zašto.
- `app/(app)/page.tsx:232` — **[POTVRĐENO]** `truncate` na hintu: „Troškovi 128.500 RSD" u kartici od
  123px postaje „Troškovi 12…". *Predlog:* `line-clamp-2`.
- `app/(app)/page.tsx:151` — **[POTVRĐENO]** „Vidi ceo katalog" je `text-xs` link bez paddinga (~16px meta).
- `app/(app)/page.tsx:180-182` — **[POTVRĐENO]** „3 / 5" bez objašnjenja; čitač ekrana čita „3 kroz 5".
  *Predlog:* `aria-label="Stanje 3, prag 5"`.
- `app/(app)/period-filter.tsx:12-16` — **[POTVRĐENO]** **nema prečice za prethodni period**; „Prošli
  mesec" traži dva native date pickera (~8-10 dodira). *Predlog:* `‹ ›` strelice oko labele perioda —
  najveća ušteda klikova na tom ekranu.
- `app/(app)/period-filter.tsx:43` — **[POTVRĐENO]** `action="/"` hardkodovano u komponenti generičkog
  imena → ponovna upotreba na drugoj ruti tiho vodi na Dashboard.
- `app/(app)/period-filter.tsx:49` — **[POTVRĐENO]** `max={period.to}` na „Od" je iz server-rendera; kad
  korisnik prvo pomeri „Do" unapred, „Od" i dalje blokira kasniji datum dok se forma ne pošalje.
- `app/(app)/podesavanja/profile-settings.tsx:35` — **[POTVRĐENO]** jedan `useTransition` za obe forme →
  dok se čuva ime, i „Promeni lozinku" je disabled (i obrnuto).
- `app/(app)/korisnici/invite-user-dialog.tsx:82-86` — **[POTVRĐENO]** nema „Otkaži" u footeru (samo X
  od ~16px), dok `status-settings.tsx:179` ima.
- `app/(app)/korisnici/edit-user-dialog.tsx:65` — **[POTVRĐENO]** „Izmeni" je `size="sm"` (32px) i jedina
  akcija u mobilnoj kartici.
- `app/prijava/page.tsx:59-67` — **[SUMNJA]** nema `autoFocus` na e-mailu ni `autoCapitalize="none"`/
  `spellCheck={false}`; `type="email"` pokriva tastaturu, ali neki Android tastature i dalje kapitalizuju.
- `app/prijava/actions.ts:30-32` — **[SUMNJA]** svaka greška (uključujući mrežnu / rate-limit) mapira se
  u „Pogrešan e-mail ili lozinka." — pri padu mreže korisnik misli da greši lozinku.
- `components/push/use-push.ts:126` + `push-settings.tsx:17` — **[POTVRĐENO]** `refresh` se izvozi ali se
  ne koristi; u stanju „denied" poruka kaže „…pa osveži", a nema dugmeta „Proveri ponovo".
- `app/(app)/obavestenja/push-settings.tsx:45` — **[POTVRĐENO]** navodnici `„…“` (nemački zatvarajući)
  dok ostatak kodbaze koristi `„…"`.
- `app/layout.tsx:49` — **[SUMNJA]** `Toaster position="top-right"` na 375px pada preko zaglavlja i
  „Osveži" dugmeta na Dashboardu. *Predlog:* `top-center` na mobilnom.
- `app/(app)/loading.tsx:13` — **[POTVRĐENO]** `StatCardSkeleton` i `FormSkeleton` **postoje** u
  `components/patterns/loading.tsx` i nigde se ne koriste — Dashboard i forme dobijaju `TableSkeleton`.

---

# Predlozi funkcionalnosti (iz UX ugla)

Poređano po odnosu korist/trošak.

1. **Mobilni header sa nalogom i odjavom.** Rešava nalaz 1 i usput daje mesto za globalnu pretragu.
2. **`components/ui/checkbox.tsx` sa metom od 40px** → jedna izmena popravlja sve bulk tokove (nalaz 13).
3. **Filteri kataloga i finansija u URL.** Rešava najveći gubitak vremena pri popisu i omogućava
   deljenje linka („pogledaj ove porudžbine").
4. **Režim popisa za magacin.** Jedan ekran: lista varijanti sa velikim poljima, `Enter`/„Sledeća"
   pomera fokus, brojač „popisano 12 / 50", „Potvrdi sve prikazane", i unos/skeniranje SKU (`BarcodeDetector`
   je dostupan u Chrome-u na Androidu) koji skače pravo na varijantu. Ovo je jedini tok koji drug koristi
   i trenutno je najskuplji po tapu.
5. **Poštarina u istom koraku kao „Poslato"** (pojedinačno i bulk, sa „ista poštarina za sve").
   Zatvara operativnu rupu oko `shipping_charged`.
6. **Globalna pretraga (⌘K / lupa u headeru).** Trenutno svaki ekran ima svoju; ne postoji način da se
   sa bilo kog mesta nađe porudžbina po broju/telefonu ili proizvod po SKU. Uz nalaz „pretraga po broju
   ne radi po defaultu", ovo je čest realan zastoj („kupac zove i kaže broj").
7. **In-app pregled obaveštenja.** `notification_log` postoji ali se **nikad ne čita u UI**. Ako push
   promakne (telefon ugašen, obaveštenja isključena), događaj je nepovratno propušten. Ekran
   „Obaveštenja → Istorija" je jeftin i zatvara rupu.
8. **Offline stranica + indikator veze** (nalaz 12), plus mali „nema veze" banner koji sprečava slanje
   forme koja bi svakako pukla.
9. **Undo za bezopasne akcije** (promena statusa, popis) kroz toast sa „Poništi" u roku od 5s — sprečava
   veliki deo štete od promašenog tapa na 32px dugmadi. `order_status_history` već pamti šta je bilo.
10. **Prvi ulazak / pomoć.** Novi korisnik (drug, tehnički slab) posle prijave sleće na `/katalog` bez
    ijednog objašnjenja šta se od njega očekuje. Jedan kratak „šta radiš ovde" blok na vrhu kataloga za
    rolu Logistika (i link „Uključi obaveštenja") bio bi dovoljan.
11. **Istorija promena van porudžbina.** Cene i zalihe se menjaju bez traga; `order_status_history`
    postoji samo za porudžbine.
12. **„Zaboravljena lozinka" + `?next=` posle prijave.** Prvo rešava realan operativni rizik (Admin
    zaključan iz sopstvenog sistema), drugo vraća push obaveštenjima punu vrednost — trenutno svaki
    klik na obaveštenje sa isteklom sesijom završi na Dashboardu.
13. **Delta u stat karticama** (poređenje sa prethodnim periodom) — deo je specifikacije § 4, nikad
    implementiran, a to je jedina stvar koja Dashboard čini upotrebljivim „u prolazu".

---

# Ocena po ekranu

Skala: ✅ solidno · ⚠️ upotrebljivo uz trenje · ❌ blokira realan rad

| Ekran | Desktop | Mobilni | Glavni razlog |
|---|---|---|---|
| **App shell / nav** | ✅ | ❌ | nema headera ni odjave na telefonu (1); redirect petlja bez profila (14) |
| **Dashboard** `/` | ✅ | ❌ | iznos sa NBSP preliva karticu → horizontalni scroll; stat broj 24px umesto 36px; period filter mete ~28px |
| **Porudžbine — lista** | ✅ | ❌ | pretraga ~90px široka; nema select-all; traka akcija nije sticky; čekboks 16px iznad overlay linka |
| **Porudžbine — detalj** | ⚠️ | ❌ | svih 5 glavnih dugmadi 32px; poštarina odvojena od „Poslato"; labele bez `htmlFor` |
| **Katalog — lista** | ⚠️ | ⚠️ | filteri se gube pri povratku; O(n²) pretraga; nema SKU na kartici |
| **Katalog — detalj / popis** | ⚠️ | ❌ | prazno polje → 0 (2); nepromenjena cifra se ne snima (3); nema potvrde (4); meta 16-32px |
| **Katalog — uvoz CSV** | ⚠️ | — | nedostupno tastaturom; greška u zelenom okviru; admin-only, radi se sa računara |
| **Finansije — uplate** | ✅ | ⚠️ | dijalog u tri skrola; nema pretrage/označi-sve; uplata se ne može ispraviti |
| **Finansije — fakture** | ⚠️ | ⚠️ | „Štampaj" ne radi (7); „Plaćeno" nepovratno bez potvrde (8) |
| **Finansije — poštarina / XExpress** | ⚠️ | ❌ | prazno polje briše poštarinu (5); nema rollback-a (6); 6 kolona bez mobilne kartice; ugnježdeni skrol |
| **Troškovi** | ✅ | ⚠️ | strelice meseca 24px; nema pending teksta pri uploadu; prazno stanje bez akcije |
| **Obaveštenja** | ⚠️ | ⚠️ | zaglavlje kolona ne stoji iznad čekboksa; „Provera podrške…" bez izlaza; email se pali iako ne šalje |
| **Podešavanja** | ⚠️ | ⚠️ | nema odjave; preimenovanje statusa lomi sistem (15); lozinka u URL-u (16); red statusa se preliva |
| **Korisnici** | ✅ | ⚠️ | nema „pošalji pozivnicu ponovo" ni uklanjanja; zaglavlje se gnječi; „Rola" vs „Uloga" |
| **Prijava / Postavi lozinku** | ⚠️ | ⚠️ | nema „Zaboravljena lozinka"; deep link se gubi; lozinka naslepo bez „prikaži" |
| **`/stil`** | ✅ | ✅ | jedini ekran koji tačno prati dizajn dokument — ali **bez role guarda**, van nav-a, i pokazuje MP/VP/Zarada Logistici |
| **PWA / offline** | ⚠️ | ❌ | nema offline stranice (12); nema install prompta; privremene ikonice |
| **404 / greška** | ❌ | ❌ | nema `not-found.tsx` ni `error.tsx`; engleski 404; global-error guta shell (11) |
