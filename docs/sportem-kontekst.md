# Sportem — kontekst projekta

Master dokument. Sadrži sve o biznisu, tokovima novca, ljudima, odlukama i arhitekturi. Namenjen da se učita kao kontekst projekta.

---

## 1. Šta je Sportem

Ecommerce sportske opreme. Vlasništvo: korisnik i njegov brat. Sajt: https://sportem.rs — WordPress + WooCommerce (shop flow). Marketing: Meta Ads (trenutno usporeno), vizuali preko Higgsfielda, opisi reklama uz pomoć Claude-a.

Cilj projekta: jedinstvena aplikacija („Sportem app") koja na jednom mestu drži sve podatke (zarada, profit, marža, logistika, inventar, reklame/troškovi, isplate, izveštaji, low stock, katalog, kupci, dashboard) i diže poslovanje na viši nivo. Trenutno se sve vuče ručno kroz Google Sheets + Make automatizacije, što stvara greške i gubitak vremena.

---

## 2. Ljudi i role

- **Korisnik (Admin)** — pun pristup svemu. Vodi finansije, cene, fakture, reklame.
- **Brat (Menadžer)** — vidi sve Sportem podatke: zaradu, broj porudžbina, reklame, izveštaje. Fizički prijavljuje pošiljke na XExpress aplikaciji i vozi lične dostave.
- **Drug (Logistika)** — dobavljač od kog se roba uzima po VP cenama. Drži fizički magacin. U aplikaciji sme samo da menja stanje (količine), naziv, slike artikala. **Ne vidi MP, VP, profit ni bilo koje Sportem finansije.**

---

## 3. Kako posao trenutno funkcioniše

- Porudžbina padne na WooCommerce (status „processing"). Trenutno Make scenario na novu porudžbinu dodaje red u Google Sheets. **Ovo se menja:** ide WooCommerce webhook → upis direktno u bazu aplikacije.
- Porudžbine se šalju **ponedeljkom i četvrtkom** preko XExpress kurirske službe.
- U nedelju i sredu uveče korisnik označi porudžbine za slanje → skripta pravi **PDF za štampu** → brat ide po papirima i ručno prijavljuje porudžbine na XExpress aplikaciji.
- XExpress integracija ostaje **ručna** u Fazi 1 (brat prijavi, pa se u aplikaciji porudžbine obeleže kao „Poslato"). API integracija je kasnija faza.
- Roba se uvek šalje direktno iz drugovog magacina (Sportem nema svoj stok).
- Povremeno brat vozi porudžbine po Beogradu ili kupac lično preuzme u magacinu i plati keš → to ne ide na račun nego direktno u zaradu.

---

## 4. Tok novca (tri odvojena toka)

Sve porudžbine idu kroz WooCommerce; razlikuju se samo po načinu isporuke.

### Tok A — XExpress porudžbina
1. Kupac plaća otkupninu = roba (MP) + naplaćena poštarina.
2. XExpress uplaćuje **celu otkupninu drugu** na račun firme.
3. Drug plaća XExpress-u stvarnu dostavu (na 10 dana, po njihovoj specifikaciji/fakturi).
4. Drug plaća **korisniku** zaradu (MP − VP) na 2 nedelje, po fakturi koju korisnik napravi.
5. Kod druga ostaje: VP (njegova nabavna) + razlika u poštarini.

Uplata ide po principu **T+1**: ako leže pare u ponedeljak → odnose se na pošiljke isporučene u petak. Ako leže utorak → isporučene u ponedeljak, itd.

### Tok B — lična / keš prodaja
- Korisnik uzme pun keš (MP) odmah, a drugu odmah keš da VP.
- Porudžbina se obeleži „Keš/Isplaćeno" → odmah isporučeno + plaćeno.
- **Ne ulazi u fakturu** — stavka je zatvorena u trenutku prodaje, prati se samo radi izveštaja.

### Poštarina (prolazna stavka, NIJE profit)
- Brat na osnovu težine doda poštarinu na otkupninu (npr. 1.500 roba + 400 dostava = 1.900 otkup).
- Razlika između naplaćene i stvarne poštarine (npr. 400 naplaćeno − 350 stvarno = +50) je Sportem-ova, ali se rešava **van fakture**: plus → drug donese keš za taj plus; minus → korisnik doda drugu da pokrije XExpress.
- App prati ovaj saldo odvojeno.

### Faktura drugu (na 2 nedelje)
- Korisnik pravi fakturu sam, šalje je drugu, drug uplaćuje na firmu korisnika.
- Iznos = zbir zarada (MP − VP) za porudžbine koje su: XExpress + isporučeno + uplaćeno + još nefakturisano.
- Troškovi i poštarina NE ulaze u fakturu.

### Ključne cifre koje app mora uvek da zna
- **Drug mi duguje** = nefakturisana zarada (isporučeno + uplaćeno). Iznos za sledeću fakturu.
- **Neto profit** = zarada − troškovi.
- **Saldo poštarine** = naplaćeno − stvarno.

---

## 5. Sistem šifara (SKU)

- Osnova šifre = proizvod; sufiks posle crtice = varijanta.
- Primer bez varijante: `SM015` (Gumene trake).
- Primer sa varijantama: `SM021-4` (HEX bučice 5 kg) — sve HEX bučice dele osnovu `SM021`, razlikuje ih sufiks.
- Posledica za import: varijante se automatski grupišu po osnovi šifre.
- SKU u WooCommerce-u je isti kao u Sheets katalogu i dolazi kroz webhook (na osnovu njega se stavka porudžbine spaja sa varijantom i VP cenom).

---

## 6. Proizvodi i inventar

- ~200 različitih proizvoda, ~360 sa varijacijama (boje, kilaže, dužine).
- Stanje se prati **po varijanti** (svaka varijanta ima svoju količinu).
- Svaka varijanta ima: SKU, naziv, MP cenu, VP cenu, zaradu (MP − VP, računa se sama), stanje, low stock prag (default 5, podesiv po proizvodu), dobavljačevu šifru, težinu (za XExpress kasnije), sliku.
- Magacin je **zajednički** (drugov), drug ima i druge kupce. U Fazi 1 inventar se ažurira **ručno** (bilo ko ovlašćen), bez automatskog skidanja na Sportem porudžbine. Auto-decrement je kasnija faza.

---

## 7. Zaključane odluke

- PWA (web + instalabilna + full responsive), online-only, push notifikacije u Fazi 1.
- Tri role: Admin / Menadžer / Logistika (opisane gore).
- Sopstvena baza kao izvor istine; WooCommerce webhook upisuje porudžbine. Sheets izlazi iz sistema.
- Sve dosadašnje Sheets skripte postaju funkcionalnosti u aplikaciji.
- Auth: Supabase Auth (ne Clerk) — 3 fiksna interna korisnika, jedan vendor, native RLS.
- App je glavni katalog (tamo se menjaju cene, dodaju proizvodi); WooCommerce se po potrebi ažurira ručno.
- Statusi porudžbine su podesiva lista. Početni: Kreirano → Poslato → Isporučeno → Otkazano/Vraćeno.
- Svaki proizvod ima bar jednu varijantu (i oni bez pravih varijanti dobijaju „default" varijantu) — radi uniformnosti, porudžbina uvek gađa varijantu po SKU.
- Poštarina/težina/broj paketa se popunjavaju na koraku „Poslato" (ne na kreiranju).
- Troškovi se plaćaju „iz svog džepa", ne diraju fakturu; reklame se unose zbirno i ručno; bez ponavljajućih troškova za sad.
- Meta integracija NIJE u Fazi 1 — reklame su samo jedna kategorija troška.

---

## 8. Centralni princip: zamrznute cene (snapshot)

Razlog: u Sheetsu se desio bag — kad je podignuta cena/zarada, promenila se i za stare porudžbine. Rešenje:

- **Katalog** (`product_variants`) drži *trenutne* MP, VP, zaradu.
- **Stavke porudžbine** (`order_items`) u trenutku kreiranja **kopiraju** tadašnju MP, VP, zaradu i zamrznu ih.
- Svi izveštaji/fakture/profit čitaju iz zamrznutih stavki, nikad iz kataloga. Promena cene dira samo nove porudžbine. Stare ostaju netaknute.
- Editovanje MP na konkretnoj porudžbini (popust) menja samo zamrznutu vrednost te stavke; VP i katalog se ne diraju.

---

## 9. Struktura baze (sažeto)

- **profiles** — korisnici + role (admin/manager/logistics).
- **categories** — kategorije proizvoda.
- **products** — proizvod (roditelj): name, description, brand, image, category_id.
- **product_variants** — sku (unique), variant_name, mp_price, vp_price, profit (generated mp−vp), stock_quantity, low_stock_threshold (def 5), supplier_sku, weight_grams, image.
- **customers** — name, phone (unique, dedup), email.
- **order_statuses** — name, sort_order, color (podesivo).
- **orders** — woo_order_id, customer_id, status_id, invoice_id, payout_id, delivery_method (xexpress/licno), payment_status, adresa snapshot, goods_total, shipping_charged, shipping_actual, cod_amount, package_count, weight, datumi (created/shipped/delivered/paid).
- **order_items** — ZAMRZNUTE CENE: sku/product_name (snapshot), quantity, mp_at_sale (editabilno), vp_at_sale, profit_at_sale (generated).
- **invoices** — invoice_number, period, total_amount (Σ profit_at_sale), status.
- **payouts** — amount, payout_date, delivery_date (T+1), notes.
- **expense_categories** + **expenses** — amount, date, category, description, attachment.

RLS: Admin sve; Menadžer svi Sportem podaci; Logistika samo stanje + identitet artikla (cene MP/VP/profit skrivene preko restriktovanog viewa / column GRANT-ova).

---

## 10. Faze

**Faza 1 (moduli):** 1) Temelj (Supabase, auth, role, migracije) · 2) Katalog · 3) Porudžbine (webhook + snapshot) · 4) Logistika/slanje (PDF, korak „Poslato") · 5) Finansije (payouts, faktura, saldo poštarine, lična prodaja) · 6) Troškovi + Dashboard · 7) Push.

**Faza 2/3:** Meta Ads integracija · XExpress API (realni statusi, auto cenovnik poštarine/težina) · auto-decrement inventara · normalizacija prljavih adresa/telefona iz Woo.

---

## 11. Edge case

Kad SKU sa Woo-a ne nađe varijantu (nov proizvod neunet u app): stavka se kreira sa sku + product_name + mp_at_sale, ali vp_at_sale ostaje prazno → porudžbina se flaguje „treba VP" da profit bude tačan čim admin unese VP.
