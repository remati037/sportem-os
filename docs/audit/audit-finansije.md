# Audit finansijskog dela — Sportem OS

Datum: 2026-07-31 · Grana: `main` (9c3c4c9)

Obim: `db/finance.ts`, `db/metrics.ts`, `db/dashboard.ts`, `db/expenses.ts`,
`app/(app)/finansije/**`, `app/(app)/troskovi/**`, `app/(app)/page.tsx`,
`lib/validation/{finance,expenses}.ts`, `lib/{date-belgrade,period,format}.ts`,
migracije `*finansije*`, `*payout_invoice_link*`, `*xexpress*`,
+ dodirne tačke u `app/(app)/porudzbine/actions.ts` i `app/api/cron/notifikacije/route.ts`.

## Šta je PROVERENO i ISPRAVNO (da se ne traži ponovo)

- **Zamrznute cene (§4 CLAUDE.md) — nema kršenja.** `grep` za `mp_price`/`vp_price`
  po `db/finance.ts`, `db/metrics.ts`, `db/dashboard.ts` i celom `app/(app)/finansije/**`
  vraća 0 pogodaka. Sve zarade idu kroz `order_profit` view (Σ `order_items.profit_at_sale`)
  ili direktno iz `order_items`. Katalog se u finansijama ne dodiruje nigde.
- **Timezone — nije nađen nijedan bag.** `belgradeDate`, `todayBelgrade`,
  `previousWorkingDay` (`lib/date-belgrade.ts`), `rangeToUtcPrefilter` +
  `presetBounds` (`lib/period.ts`) i `monthBounds` (`db/finance.ts:756`) su
  matematički tačni. Široki UTC pred-filter (`from−1d` … `to+2d`) pouzdano pokriva
  Belgrade UTC+1/+2, a tačno suženje je u JS-u po `belgradeDate` — korektno u
  `computePeriodMetrics` (`db/metrics.ts:66-69`). `expenses.date`, `payouts.payout_date`,
  `postage_settlements.settled_at` su `date` kolone i porede se kao string —
  ispravno, TZ konverzija tu ne treba.
- **Statusi svuda po IMENU** (`APP_STATUS`, `CANCELLED_STATUS_NAMES`), nigde
  hardkodovan seed UUID.
- **RLS**: `invoices`, `payouts`, `expenses`, `expense_categories`,
  `postage_settlements`, `xexpress_invoices` — select `admin|manager`,
  write samo `admin`. Logistika nema nijednu politiku → potpun deny. Ispravno.
- **Eligibility se rekompjutuje server-side** u `assertLinkable` i `assertInvoiceable`
  (ne veruje se klijentskoj listi). Izuzetak: `assertXexpressLinkable` — v. S6.

---

# Kritično

## K1 · `profitByOrder` — nechunkovan `.in()` bez provere greške → zarada tiho 0

**Fajl:** `db/finance.ts:272-284`
**Pozivaoci:** `:113` (`listPayouts`), `:317` (`getInvoiceablePayouts`), `:258`
(`getPayoutSpisak`), `:162` (`getPayoutDetail`), `:446` (`getInvoiceDetail`).
**Status:** POTVRĐENO (pročitan kod).

```ts
const { data } = await supabase            // ← nema `error`
  .from("order_profit")
  .select("order_id, profit")
  .in("order_id", orderIds);               // ← nema chunkovanja, nema .range()
```

Ovo je **tačno isti bag koji je već fiksiran u `computePeriodMetrics`**
(`db/metrics.ts:79-96`, konstante `PAGE`/`IN_CHUNK`) — samo nije primenjen ovde.

Dva načina pucanja:

1. **Dužina URL-a.** UUID u `.in()` zauzima ~39 znakova (36 + navodnici + zarez).
   1000 ID-jeva ≈ 39 KB query stringa → PostgREST/gateway odbija (414/400).
   `data` je `null`, greška se ne proverava → `map` prazan → **svi profiti 0**.
2. **Default cap 1000 redova.** Čak i kad URL prođe, PostgREST vraća najviše 1000
   redova → profit delimičan, bez ikakvog signala.

**Konkretan scenario (`listPayouts`, `:113`):**
`rows.flatMap((p) => p.orders.map((o) => o.id))` skuplja porudžbine **SVIH uplata
ikad**. Pri ~2 uplate nedeljno × ~15 porudžbina → 1000 ID-jeva za ~8 meseci rada,
a backfill (941 porudžbina) već sad podiže bazu. Kad se pređe granica, kolona
**„Zarada" na `/finansije/uplate` prikaže 0 RSD za SVAKU uplatu** (ili nasumično
delimično), bez greške i bez upozorenja. Isto pogađa `getInvoiceablePayouts` →
„Za fakturisanje" cifra i `PayoutInvoiceCandidate.profit` u dijalogu za fakturu.

**Rešenje:** izdvojiti helper iz `db/metrics.ts:79-96` i primeniti ga ovde:
petlja po `IN_CHUNK = 200` + `if (error) throw`. Alternativno, agregirati u SQL-u
(RPC koja prima `payout_id` i vraća Σ profit) umesto povlačenja redova.

---

## K2 · `issueInvoice` — total fakture računat nechunkovano → moguća faktura na 0 RSD

**Fajl:** `app/(app)/finansije/actions.ts:280-297`
**Status:** POTVRĐENO.

```ts
const { data: orderRows } = await supabase       // ← nema error, cap 1000
  .from("orders").select("id").in("payout_id", payout_ids);
const orderIds = (...).map(o => o.id);
const { data: profitRows } = await supabase      // ← nema error, nema chunka, cap 1000
  .from("order_profit").select("profit").in("order_id", orderIds);
const total = (... ?? []).reduce((sum, r) => sum + (r.profit ?? 0), 0);
```

**Scenario:** dijalog „Nova faktura" **pred-čekira SVE nefakturisane uplate**
(`issue-invoice-panel.tsx:42-45`). Ako se fakturisanje odloži par meseci
(a podsetnik ide 1. i 15.), skup lako pređe 1000 porudžbina. Tada:
`profitRows === null` → `total = 0` → **izda se faktura sa `total_amount = 0 RSD`**,
a uplate i porudžbine se pritom **zaključaju** (`payouts.invoice_id` +
kaskadno `orders.invoice_id` → `assertEditable` blokira izmenu stavki).
Sportem tada šalje drugu fakturu na 0 dinara.

Ublažavajuće: `getInvoiceDetail` (`:451`) računa `computedTotal` i detalj fakture
prikaže upozorenje o nesaglasnosti (`fakture/[id]/page.tsx:80-85`) — ali
`computedTotal` ide kroz **isti pokvaren `profitByOrder`** (K1), pa i ono može
pokazati 0 = 0 i ćutati. Oporavak je moguć samo kroz `deleteInvoice` (radi dok
faktura nije `placeno`).

Napomena: `.in("id", orderIds)` update na `:328-331` ima isti problem dužine URL-a,
ali **proverava `error`** i radi rollback — to je ispravno rešeno.

**Rešenje:** chunkovati oba upita + `if (error) return { error: ... }` (nikad ne
izdavati fakturu ako neki upit padne). Paginirati i `orders` upit (`.range()`).

---

## K3 · `getSaldoPostarine` — nepaginiran upit → saldo poštarine se tiho „zamrzne"

**Fajl:** `db/finance.ts:485-506`
**Status:** POTVRĐENO.

```ts
const { data: shipRows } = await supabase          // ← nema error, nema .range(), nema .order()
  .from("orders").select("shipping_charged, shipping_actual")
  .not("shipping_charged","is",null)
  .not("shipping_actual","is",null)
  .not("xexpress_invoice_id","is",null);
const gross = (...).reduce((sum,o)=> sum + (o.shipping_charged - withPdv(o.shipping_actual)), 0);
```

**Scenario:** XExpress šalje fakturu ~svakih 10 dana; pri ~15 porudžbina dnevno
to je ~150 porudžbina po fakturi → **granica od 1000 se dostiže posle ~7 faktura
(≈ 2 meseca rada)**. Od tog trenutka `gross` se računa samo nad prvih 1000
redova — a pošto **nema `ORDER BY`**, koji su to redovi je nedeterministički i
može se menjati između dva učitavanja stranice. „Trenutni saldo poštarine" na
`/finansije/postarina` je od tada trajno pogrešan i nestabilan.

**Posledica koja košta keš:** `settlePostage` (`actions.ts:423`) čita baš taj
saldo, pred-popunjava ga u dijalogu (`settlement-dialog.tsx:42`) i snima ga kao
`balance_before`. Admin klikne „Poravnaj keš" i **fizički preda/primi pogrešnu
sumu keša**, a ledger zabeleži pogrešan snapshot.

**Rešenje:** paginirati (`.range()` petlja kao u `db/metrics.ts:50-63`) + `error`
check; bolje — pomeriti agregaciju u SQL (view ili RPC), jer se ovde iz baze
vuku hiljade redova samo da bi se sabrala dva broja.

---

## K4 · `listXexpressInvoices` — redovi porudžbina capped na 1000 → pogrešan P&L po fakturi

**Fajl:** `db/finance.ts:650-663`
**Status:** POTVRĐENO.

```ts
const { data: orderRows } = await supabase        // ← nema error, nema paginacije
  .from("orders").select("xexpress_invoice_id, shipping_charged, shipping_actual")
  .in("xexpress_invoice_id", list.map(i => i.id));
```

Čim ukupan broj porudžbina na svim XExpress fakturama pređe 1000 (isti tajming
kao K3), redovi se seku — tabela na `/finansije/postarina` prikazuje **umanjen
`order_count`, `naplaceno`, `ukupno` i `rezultat`** za deo faktura (najverovatnije
najstarije). Vlasnik gleda „rezultat +12.000" na fakturi koja je stvarno „−3.000".

Dodatno: pošto K3 i K4 seku **različite skupove**, Σ `rezultat` po fakturama više
ne mora da odgovara globalnom saldu — a dokumentovana definicija je da to mora
biti isto (`db/finance.ts:479-483`).

**Rešenje:** paginirati + `error` check; ili agregirati u SQL-u po `xexpress_invoice_id`.

---

# Ozbiljno

## O1 · PDV stopa: globalni saldo koristi fiksnih 20%, faktura koristi snapshot

**Fajl:** `db/finance.ts:496` vs `db/finance.ts:673` (i `:544` `pnlFrom`)
**Status:** POTVRĐENO.

- `getSaldoPostarine` zove `withPdv(o.shipping_actual)` — **default `rate = 20`**
  (`db/finance.ts:48`), bez obzira na fakturu kojoj porudžbina pripada.
- `listXexpressInvoices`/`getXexpressInvoiceDetail` zovu `pnlFrom(rows, inv.vat_rate)`
  — koriste snapshot iz `xexpress_invoices.vat_rate`.

Kolona `vat_rate` je uvedena baš zbog buduće promene stope
(`20260721120000_xexpress_invoices.sql`, komentar „snapshot za slučaj izmene stope").
Čim se ijedna faktura sačuva sa stopom ≠ 20, **globalni saldo i zbir P&L-ova se
razilaze**, a „Poravnaj keš" opet plaća pogrešnu cifru.

Isto i na klijentu: `xexpress-invoice-form.tsx:23` ima `const VAT_RATE = 20`, pa
izmena fakture sa drugom stopom prikazuje pogrešan PDV pre snimanja.

**Rešenje:** u `getSaldoPostarine` povući `vat_rate` kroz join na
`xexpress_invoices` i računati po njemu; formi proslediti `invoice.vat_rate`
(default 20 za novu).

## O2 · Menadžer menja finansijske iznose kroz `updateShipping` (zaobilazi RLS)

**Fajl:** `app/(app)/porudzbine/actions.ts:746-770` (guard na `:750`)
**Status:** POTVRĐENO.

```ts
await requireRole("admin", "manager");     // ← Menadžer sme
const supabase = createAdminClient();      // ← service role, zaobilazi RLS
await supabase.from("orders").update(patch).eq("id", order_id);  // patch sadrži
                                           // shipping_charged i shipping_actual
```

Krši zaključanu odluku iz CLAUDE.md §3: „**Menadžer** — svi Sportem podaci, **bez
izmene finansija**". Konkretne posledice:

1. `shipping_charged` ulazi u `otkupOf` (`db/finance.ts:39`) → menja
   `PayoutCandidate.otkup`, `PayoutRow.linkedOtkup`, `PayoutDetail.otkupTotal` i
   `difference` **retroaktivno**, i za uplate koje su davno zatvorene i
   fakturisane.
2. `shipping_actual` **nema nikakav guard na `xexpress_invoice_id`** — Menadžer
   (i Admin) može da promeni osnovicu poštarine na porudžbini koja je već na
   izdatoj XExpress fakturi → tiho se menjaju P&L te fakture i globalni saldo
   poštarine.
3. Šema dozvoljava prazno → `null` (`lib/validation/orders.ts:100-106`,
   `optionalNonNegInt`). Brisanje `shipping_charged` na fakturisanoj porudžbini je
   izbacuje iz `getSaldoPostarine` (uslov „oba NOT NULL"), ali je **ostavlja u
   `pnlFrom` sa `?? 0`** → Σ P&L faktura ≠ globalni saldo. POTVRĐENO na nivou koda.

**Rešenje:** razdvojiti akciju — `weight_grams`/`package_count` ostaju admin+manager,
`shipping_charged`/`shipping_actual` samo admin; blokirati izmenu `shipping_actual`
kad je `xexpress_invoice_id != null` (osnovica se tada menja isključivo kroz
izmenu XExpress fakture).

## O3 · `updatePayout` sme da doda porudžbinu na VEĆ FAKTURISANU uplatu → zarada trajno ispada

**Fajl:** `app/(app)/finansije/actions.ts:154-190`
**Status:** POTVRĐENO (kod), SUMNJA da je dostižno kroz UI.

Guard na `:157-163` proverava `invoice_id` **samo za `toUnlink`** skup. Za `toLink`
se zove `assertLinkable` (`:56-75`), koji traži samo
`xexpress + Isporučeno + neuplaceno + payout_id null` — **ne proverava da li sama
uplata već ima `invoice_id`**.

**Scenario:** uplata P je na fakturi F (`payouts.invoice_id = F`). Poziv
`updatePayout` sa `order_ids` proširenim za novu porudžbinu O:
- O dobija `payout_id = P`, `payment_status = 'uplaceno'`, ali `invoice_id = NULL`
  (kaskada iz `issueInvoice:328` se ne ponavlja);
- P više nije kandidat za fakturu (`getInvoiceablePayouts` filtrira
  `.is("invoice_id", null)`, `:306`);
- O nije ni na jednoj fakturi i **nikad ne može biti** → njena zarada trajno
  ispada iz „Za fakturisanje" (drug je nikad ne plati).

Kroz postojeći UI nije dostižno (`payout-actions.tsx:57` uvek šalje nepromenjen
`orderIds`), ali server akcija je javna („use server").

**Rešenje:** na početku `updatePayout` odbiti izmenu ako uplata ima `invoice_id != null`
(ili, ako se izmena mora dozvoliti, kaskadno postaviti `invoice_id` novim porudžbinama).

## O4 · `updatePayout` ne proverava greške pri (od)vezivanju porudžbina

**Fajl:** `app/(app)/finansije/actions.ts:179-190`
**Status:** POTVRĐENO.

```ts
if (toUnlink.length > 0) { await supabase.from("orders").update({...}).in("id", toUnlink); }
if (toLink.length   > 0) { await supabase.from("orders").update({...}).in("id", toLink);   }
revalidatePayouts(id);
return { error: null, success: "Uplata izmenjena." };   // ← uvek zeleno
```

Header uplate je već izmenjen (`:168-177`, tu se `error` proverava). Ako update
porudžbina padne (RLS, mreža, predugačak URL kod velikog `toLink`), korisnik
dobija „Uplata izmenjena." dok porudžbine ostaju u pogrešnom `payment_status`-u.
Uporedi sa `createPayout:113-117` gde rollback POSTOJI — obrazac je već tu, samo
nije primenjen.

## O5 · XExpress fakture: petlja update-a bez rollbacka → poluvezana faktura

**Fajl:** `app/(app)/finansije/actions.ts:507-517` (create), `:568-578` (update)
**Status:** POTVRĐENO.

```ts
for (const o of orders) {
  const { error } = await admin.from("orders").update({...}).eq("id", o.order_id);
  if (error) return { error: "Vezivanje porudžbina nije uspelo." };   // ← faktura ostaje
}
```

Ako pukne na N-toj porudžbini: faktura je već kreirana (`:496-500`), porudžbine
1..N−1 su vezane sa upisanom osnovicom, N..kraj nisu. Korisnik vidi grešku,
pokuša ponovo → broj fakture je `UNIQUE` (23505) pa dobije „Broj fakture već
postoji", a u bazi ostaje **poluvezana faktura koja iskrivljuje i P&L i globalni
saldo poštarine**. `issueInvoice` (`:322-337`) ima uredan rollback — isti obrazac
treba i ovde. Bonus: petlja je i N zasebnih round-tripova (100 porudžbina = 100
upita).

## O6 · MP/VP/Zarada na spisku za druga se ne slažu kad postoji `needs_vp`

**Fajl:** `db/finance.ts:248-260`, view u `supabase/migrations/20260710120000_finansije.sql`
**Status:** POTVRĐENO.

```ts
mp += it.mp_at_sale * it.quantity;
vp += (it.vp_at_sale ?? 0) * it.quantity;   // ← stavka bez VP se broji kao VP=0
...
profit += profitMap.get(o.id) ?? 0;         // ← iz order_profit = sum(profit_at_sale)
```

Postgres `sum()` **ignoriše NULL** i vraća NULL samo ako su SVE vrednosti NULL.
Zato za porudžbinu sa 2 stavke (jedna sa VP, jedna `needs_vp`):
`profit` = zarada samo prve stavke, `mp` = obe stavke, `vp` = samo prva.
Na `/finansije/uplate/[id]` stoje kartice MP / VP / Zarada — i **MP − VP ≠ Zarada**.
Isto ide u „Kopiraj"/„Štampaj" spisak koji drug kuca u kasi
(`spisak-view.tsx:36-40`) → **VP ukupno je potcenjen**.

Uz to: komentar u migraciji (`20260710120000_finansije.sql`) tvrdi
„profit je null za porudžbinu sa bar jednom needs_vp stavkom" — **to je netačno**
za `sum()`. Posledica je ozbiljnija otkad `needs_vp` više ne blokira fakturu
(samo upozorava, `db/finance.ts:345-349`): delimično opremljena porudžbina ulazi
u fakturu sa potcenjenom zaradom, a niko to ne vidi kao grešku.

**Rešenje:** u `getPayoutSpisak` odvojeno izbrojati stavke bez VP i prikazati ih
(npr. „VP ukupno 120.000 RSD (3 stavke bez VP)"), i ispraviti komentar u migraciji.

## O7 · Porudžbine „uplaćeno bez uplate-reda" nemaju nijedan ekran

**Status:** POTVRĐENO (logika), SUMNJA na tačan broj (nisam čitao bazu).

Posle prelaska na fakturisanje po uplatama, porudžbina sa
`payment_status = 'uplaceno'` **i** `payout_id IS NULL` je nevidljiva svuda:

- `getUnpaidDeliveredXexpress` (`db/finance.ts:64`) traži `payment_status = 'neuplaceno'` → ispada;
- `getInvoiceablePayouts` ide od `payouts` → ispada (nema uplate-reda);
- „Za fakturisanje" i „Drug mi duguje" je ne vide.

CLAUDE.md dokumentuje da takvih ima najmanje **54** (39 otkačenih pri
jednokratnom čišćenju uplata + 15 iz junskog data-fixa) i da je ispadanje
namerno. Ali **ne postoji nijedan ekran ni izveštaj koji ih uopšte izlistava** —
njihova zarada je faktički otpisana, a vlasnik nema način ni da vidi koliko je to.

**Rešenje:** filter/izveštaj „uplaćeno bez uplate" na `/porudzbine` ili
`/finansije/uplate` (Σ zarade + lista), pa svesna odluka: fakturisati ili otpisati.

## O8 · `getUnpaidDeliveredXexpress` nepaginiran + cron broji drugačije

**Fajl:** `db/finance.ts:56-82`; cron `app/api/cron/notifikacije/route.ts:135-144`
**Status:** POTVRĐENO.

`getUnpaidDeliveredXexpress` nema `.range()` ni `error` check → cap 1000. Hrani
i dijalog „Nova uplata" i karticu „Isporučeno, neuplaćeno" na Dashboardu
(`db/dashboard.ts:63` koristi `unpaid.length`). Ako se zaostane sa uplatama
preko 1000 porudžbina, kartica laže, a kandidati nestaju iz dijaloga bez poruke.

Nekonzistentnost: cron `deliveredUnpaidCount` koristi pravi `count: "exact"`
(dakle bez capa) ali **drugačiji filter** — ima `.not("delivered_at","is",null)`,
a nema `.is("payout_id", null)`. Za isti pojam postoje dva broja koji se mogu
razići (npr. porudžbine bez `delivered_at`, ili `neuplaceno` sa zaostalim
`payout_id`).

**Rešenje:** jedan deljeni upit/definicija; za brojač koristiti `count: "exact", head: true`
umesto `.length` niza.

## O9 · „Razlika" (uplata vs otkupnina) se ne vidi na detalju uplate

**Fajl:** `db/finance.ts:161,174,178-180` (računa se) vs
`app/(app)/finansije/uplate/[id]/page.tsx:68-74` (ne prikazuje se)
**Status:** POTVRĐENO.

`getPayoutDetail` vraća `otkupTotal`, `postageTotal` i
`difference = amount − otkupTotal`, ali stranica renderuje pet drugih kartica:
Uplaćeno / MP ukupno / VP ukupno / Poštarina / Zarada. **Nema ni Σ otkupnine ni
razlike.**

To je najvažnija provera cele sekcije — „da li je XExpress uplatio pun otkup ili
je nešto zakinuto". Vidljiva je samo u trenutku kreiranja
(`new-payout-dialog.tsx:157-172`), a posle nikad — pa se manjak od npr. 3.400 RSD
na uplati od pre dve nedelje ne može ni otkriti ni ući u trag.

Uz to, CLAUDE.md izričito opisuje drugačiji ekran: „Kartica „Poštarina" na
`/finansije/uplate/[id]` (grid 4 kartice: Uplaćeno / Σ otkupnina / Poštarina /
Razlika)" — kod i dokumentacija se razilaze.

---

# Sitno

- **S1 · Mrtav kod.** `getNetoProfit` (`db/finance.ts:776`) i `getDrugMiDuguje`
  (`:370`) nemaju **nijednog pozivaoca** (provereno `grep`-om po celom repou) —
  ostali su posle brisanja `/finansije` overview-a. U `monthBounds` (`:756`)
  se `gteUtc`/`ltUtc` računaju i nikad ne koriste. `PayoutDetail.difference`
  i `otkupTotal` se računaju a ne prikazuju (v. O9).
- **S2 · Tri implementacije granica meseca.** `monthBounds` (`db/finance.ts:756`),
  `monthDateBounds` (`db/expenses.ts:29`), `presetBounds("mesec")`
  (`lib/period.ts:44-48`) — isti posao tri puta, rizik da se raziđu.
- **S3 · `expenses` upit nepaginiran i bez `error` checka.** `db/metrics.ts:99-104`
  i `db/expenses.ts:41-47` — cap 1000 troškova po periodu. Nije hitno (Reklame
  se unose zbirno), ali je ista klasa tihe greške kao K1–K4.
- **S4 · `paid_at` se puni trenutkom unosa, ne datumom uplate.**
  `app/(app)/finansije/actions.ts:110` i `:188` upisuju `new Date().toISOString()`
  umesto `payout_date`. Na detalju porudžbine „Plaćeno" pokazuje kad je Admin
  kucao podatak, a ne kad je novac stigao. (Za statistiku se `paid_at` više ne
  koristi, pa je efekat samo prikaz.)
- **S5 · Poravnanje poštarine se ne može datirati unazad.** `settlement-dialog.tsx`
  nema polje za datum, a `settlePostage` (`actions.ts:426-431`) ne šalje
  `settled_at` → uvek `current_date` (default iz migracije). Keš primljen u
  petak a unet u ponedeljak dobija pogrešan datum u ledgeru.
- **S6 · `assertXexpressLinkable` ne rekompjutuje pravu eligibility.**
  `app/(app)/finansije/actions.ts:453-477` proverava samo `delivery_method` i
  postojeći link. `getEligibleXexpressOrders` (`db/finance.ts:605-620`) filtrira i
  po statusu (Isporučeno/Vraćeno) i po `xexpressHistoryBoundary` — akcija to ne
  ponavlja, pa direktan poziv može zakačiti „Kreirano" porudžbinu ili pred-granicnu
  istoriju. `assertLinkable`/`assertInvoiceable` rade to ispravno; ovde je izostavljeno.
- **S7 · `id` bez zod validacije u brisanjima.** `deletePayout` (`:203`),
  `deleteInvoice` (`:377`), `deleteXexpressInvoice` (`:588`, nema ni provere
  praznog stringa) primaju goli `string` umesto `uuid(...)` šeme koju koristi
  ostatak modula.
- **S8 · Odvezivanje sa XExpress fakture ne vraća `shipping_charged`.**
  `actions.ts:561-567` i `:591-594` čiste samo `shipping_actual`. Vrednost koju je
  forma upisala u `shipping_charged` ostaje i dalje utiče na `otkupOf` u uplatama.
- **S9 · `getEligibleXexpressOrders` nepaginiran** (`db/finance.ts:610-619`) —
  cap 1000. Sortirano `ordered_at desc`, pa se vide najnovijih 1000; dok granica
  istorije nije postavljena (pre prve fakture), najstariji kandidati su nevidljivi.
- **S10 · Faktura ne pamti stvarni period.** `issueInvoice` (`actions.ts:303-304`)
  upisuje `period_from = period_to = invoice_date`, pa se na detalju ne vidi koji
  period uplata faktura pokriva (a `period_from/to` kolone postoje baš za to).
- **S11 · `VAT_RATE = 20` hardkodovan na klijentu** (`xexpress-invoice-form.tsx:23`)
  iako faktura nosi `vat_rate`; izmena fakture sa drugom stopom pokazala bi
  pogrešan PDV pre snimanja (v. O1).
- **S12 · Prazno polje u XExpress formi tiho postaje 0.**
  `xexpress-invoice-form.tsx:131-133`: `Number(chargeds[id]) || 0`. Zaboravljena
  osnovica se snima kao 0 RSD umesto da se prijavi greška — a 0 osnovica u P&L
  izgleda kao „čista zarada na poštarini".
- **S13 · Nema upozorenja na duplu uplatu za isti dan.** `payouts` nema nikakvo
  ograničenje na `payout_date`; dva puta unet isti izvod pravi dve uplate (druga
  bez porudžbina, jer su već vezane) → „Za fakturisanje" broji „N nefakturisanih
  uplata" veće nego što jeste. Prazne uplate filtrira `getInvoiceCandidates:333`,
  ali baner na `fakture/page.tsx:74` broji `candidates.payouts.length` — tu je već
  filtrirano, pa je efekat samo na listi uplata.
- **S14 · Period bez gornje granice širine.** `resolvePeriod` (`lib/period.ts:104-116`)
  prihvata bilo koji `?od`/`?do` sa `od ≤ do`. `?od=2000-01-01&do=2099-12-31` na
  `force-dynamic` Dashboardu pokreće punu paginiranu pretragu `orders` +
  chunkovani prolaz kroz `order_items` pri svakom renderu.

---

# Predlozi funkcionalnosti

Poređano po tome koliko realno nedostaje vlasniku ovakvog ecommerce-a.

1. **Izvoz (CSV/Excel) svega finansijskog.** Trenutno nema nijednog izvoza —
   uplate, fakture, troškovi, XExpress specifikacije se ne mogu izneti ni
   knjigovođi ni u tabelu. Najveći praktični nedostatak.
2. **Poređenje perioda.** Dashboard prikazuje jedan period bez konteksta.
   „Ovaj mesec vs prošli mesec" (Δ i %) i „vs isti mesec prošle godine" —
   `computePeriodMetrics` se već poziva sa proizvoljnim `{from,to}`, pa je to
   drugi poziv i jedna kolona u UI-u.
3. **Zarada po proizvodu / kategoriji / SKU-u.** Sve postoji u zamrznutim
   `order_items` (`sku`, `mp_at_sale`, `vp_at_sale`, `profit_at_sale`), ali nijedan
   ekran to ne agregira. Top 20 artikala po zaradi i po marži direktno vodi
   odluke o nabavci.
4. **Keš prodaje nemaju svoj ekran.** `payment_status = 'kes'` ulazi u zaradu, ali
   se nigde ne izlistava — nema dnevnika keša ni provere „koliko keša je primljeno
   u julu". Potreban je bar filter + zbir.
5. **Starost potraživanja (aging) za „isporučeno, neuplaćeno".** Sad je to samo
   broj na kartici. Podela 0–7 / 8–14 / 15–30 / 30+ dana od `delivered_at`
   odmah pokazuje šta je zaglavilo kod XExpress-a.
6. **Rekonsilijacioni izveštaj poštarine.** Σ `rezultat` po XExpress fakturama vs
   globalni „Saldo poštarine" — kad se te dve cifre raziđu (a razići će se, v. K3/K4/O1),
   danas to niko ne može primetiti.
7. **Zaključavanje perioda / revizioni trag.** Nijedna finansijska izmena se ne
   loguje (za razliku od statusa porudžbine, koji ima `order_status_history`).
   Uplata, faktura i XExpress faktura se menjaju i brišu bez traga o tome ko i kada.
8. **Trend grafikon (zarada / neto / marža po mesecima).** Sve cifre postoje;
   fali samo 12 poziva `computePeriodMetrics` i jedan sparkline.
9. **Budžet po kategoriji troškova + ponavljajući troškovi.** Trenutno se svaki
   mesec ručno unosi isto (Reklame, Pakovanje). CLAUDE.md kaže „bez ponavljajućih
   troškova" — vredi preispitati, jer je to čist ručni rad svakog meseca.
10. **Marža po porudžbini u listi porudžbina.** Zarada se već zbraja na listi;
    marža po porudžbini bi odmah pokazala prodaje ispod praga isplativosti.
11. **Prosečna vrednost korpe i stopa otkaza/povrata.** Podaci postoje
    (`goods_total`, `cancelled_at`, razdvojeni statusi Otkazano/Vraćeno), ekran ne.
12. **PDV pregled.** Danas se PDV pojavljuje samo kao ulazni na XExpress poštarini.
    Ako Sportem jeste u sistemu PDV-a, obračun izlaznog PDV-a po prometu potpuno
    nedostaje; ako nije — vredi to zapisati u CLAUDE.md da se ne traži ponovo.
