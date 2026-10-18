# Sportem — Plan implementacije: Reklame (Meta Ads)

> Verzija 1.0 · 18.10.2026 · status: **nacrt — odluke iz §0.3 i ručni korak M0 pre ičega**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo

### 0.1 Šta je danas

Reklame su **samo kategorija troška** („Reklame" u `expense_categories`), unete **zbirno i
ručno** (`CLAUDE.md` §3, `docs/sportem-kontekst.md` §7). Meta integracija je izričito
**Faza 2/3** (`sportem-kontekst.md` §10). Zato se ne zna koja kampanja donosi porudžbine, a
koja samo troši — vidi se samo ukupan iznos na kraju meseca.

### 0.2 Šta gradimo

Stavka **Reklame** (`/reklame`, sekcija „Novac", trenutno „Uskoro"), **samo čitanje sa Meta-e**:

1. **Potrošnja po kampanji i danu** povučena sa Meta Ads naloga (Marketing API, *Insights*).
2. **Šta kaže Meta** — prikazi, klikovi, CTR, CPC, kupovine i ROAS po Meta pikselu.
3. **Šta kaže sajt** — porudžbine koje su stvarno stigle sa te kampanje (UTM / Woo *Order
   Attribution*), sa **zaradom iz zamrznutih `order_items`**, pa: **zarada − potrošnja** i
   **trošak po porudžbini**. Ovo je cifra koja odlučuje — Meta broji „kupovine" po svom modelu
   pripisivanja i obično preteruje; app broji stvarne porudžbine i stvarnu zaradu.
4. **Prenos u troškove** — jednim klikom, mesečni zbir Meta potrošnje postaje jedan red u
   `expenses` (kategorija „Reklame"), pa Neto profit ostaje tačan bez duplog unosa.

**Promena zaključane odluke:** pokretanje ovog modula menja §3 „Meta integracija … NISU u Fazi 1"
→ upisati u `CLAUDE.md` kao promenjenu odluku (u M5, ili odmah na početku M1).

### 0.3 Odluke — PREDLOG (potvrditi sa korisnikom pre M1)

| # | Tema | Predlog | Zašto |
|---|---|---|---|
| D1 | Smer | **samo čitanje** sa Meta-e — app nikad ne pravi, pauzira ni menja kampanje | manji rizik, manje dozvola (`ads_read`) |
| D2 | Pristup | **Admin i Menadžer** čitaju; Logistika nema ni stavku ni RLS politiku | potrošnja i zarada su finansije |
| D3 | Novac | potrošnja se čuva kao **integer u najmanjoj jedinici valute naloga** (para/cent) + valuta; prikaz u RSD | §5 — bez float-a u finansijama; Meta vraća decimalni string |
| D4 | Valuta naloga | **ako je RSD** → direktno. **Ako je EUR** → u RSD po **srednjem kursu NBS na dan potrošnje**, kurs se čuva uz red (snapshot, kao zamrznute cene) | vidi otvoreno pitanje 1 |
| D5 | Troškovi | sinhronizacija **ne piše** u `expenses` sama; dugme „Prenesi mesec u troškove" pravi/menja **jedan** red po mesecu, uz oznaku izvora | zaključano: „reklame se unose zbirno i ručno" — ostaje zbirno, samo bez prepisivanja |
| D6 | Atribucija porudžbine | **poslednji klik po UTM-u** iz Woo *Order Attribution* (`utm_source`, `utm_campaign`, …) | jedini podatak koji je Sportem-ov, ne Meta-in |
| D7 | Spajanje UTM ↔ kampanja | `utm_campaign={{campaign.id}}` u URL-u oglasa (Meta dinamički parametar) → spajanje po **ID-u**; naziv kampanje samo kao rezerva | nazivi se menjaju, ID ne |
| D8 | Sinhronizacija | **dnevni cron** + „Sinhronizuj sada" (obrazac modula Ponude); poslednjih **7 dana se uvek ponovo povlači** (Meta naknadno koriguje cifre) | Hobby plan = jedan dnevni cron po unosu |
| D9 | Istorija | prvi sync povlači **od 02.02.2026** (početak podataka u app-u) | poređenje sa porudžbinama ima smisla samo odatle |

### 0.4 Otvorena pitanja (pitati na početku M1)

1. **Valuta Meta ad naloga** (Ads Manager → Podešavanja naloga)? Ako je EUR — prihvatljiv kurs NBS na dan potrošnje, ili ručno unet mesečni kurs (kao na izvodu kartice)?
2. Koliko ad naloga? Plan pretpostavlja **jedan**; više naloga = kolona `account_id` svuda (predviđena u šemi, UI tek ako treba).
3. Da li oglasi već imaju UTM parametre? Ako nemaju — korak M0.3 (ručno) i atribucija važi tek od tog dana; ranije porudžbine ostaju „nepoznat izvor".
4. Da li „Prenesi u troškove" treba da **zameni** postojeći ručni red „Reklame" za taj mesec, ili da ga ostavi i doda novi? Predlog: **zameni samo red koji je napravilo dugme** (oznaka izvora), ručne ne dira.

### 0.5 Dve tehničke činjenice

**1. Webhook danas ne čuva atribuciju.** `app/api/webhooks/woo/route.ts` ne čita `meta_data`.
WooCommerce (≥ 8.5) beleži *Order Attribution* u meta polja porudžbine (`_wc_order_attribution_*`).
**Neprovereno:** da li ih webhook/REST payload ovog sajta stvarno nosi u `meta_data` — proverava se
u M0.4 na jednoj stvarnoj porudžbini pre ijedne linije koda. Ako ih nema, rezerva je mali
WordPress snippet koji ih izlaže (van app-a) ili atribucija ostaje samo Meta-ina.

**2. Meta cifre se menjaju unazad.** Insights za protekle dane se koriguju još danima (kasna
konverzija, filtriranje nevažećih klikova) → upsert po `(campaign_id, date)` i ponovno povlačenje
poslednjih 7 dana pri svakom syncu. Tabela je ogledalo, ne ledger.

### 0.6 Šta se NE dira

Zamrznute cene i `order_items` (samo čitanje) · fakture, uplate, poštarina · `computePeriodMetrics`
(troškovi ulaze u neto **samo kroz `expenses`**, kao i danas) · tok statusa · `syncOrderStock` ·
RLS politike postojećih tabela. Webhook se dira **samo aditivno** u M3 (upis atribucije pri prvom
prijemu porudžbine; `order.updated` je i dalje ne dira) — nijedno postojeće polje ni grana se ne menja.

---

## 1. Arhitektura

| Sloj | Šta |
|---|---|
| `lib/meta/client.ts` (server-only) | `META_ACCESS_TOKEN` (System User token, `ads_read`), `META_AD_ACCOUNT_ID`, verzija Graph API-ja u **jednoj konstanti** (proveriti aktuelnu u M1); GET `/{act_id}/insights?level=campaign&time_increment=1&fields=campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions,action_values`; paginacija po `paging.next`; timeout 15 s; token se nikad ne loguje ni ne vraća u poruci greške (obrazac `lib/offers/client.ts`) |
| `lib/meta/sync.ts` | kampanje → upsert; insights od `max(poslednji dan − 7, D9)` do juče → upsert; `ad_sync_state.last_error`; nikad ne baca (Sentry) — obrazac `lib/offers/sync.ts` |
| tabele | `ad_campaigns`, `ad_insights_daily`, `ad_sync_state` (M1) + kolone atribucije na `orders` (M3) |
| agregacije | SQL funkcije `security invoker` (obrazac `offer_rule_stats`) — `ad_campaign_stats(from, to)` i `ad_daily_stats(from, to, campaign)`; spajanje sa porudžbinama i zaradom u SQL-u (cap 1000) |
| UI | `/reklame` (pregled + tabela kampanja), `/reklame/[id]` (kampanja po danima) |

---

## 2. Faze i koraci

### M0 — RUČNO (korisnik), pre M1

1. **Meta Business Suite → Podešavanja preduzeća → Korisnici sistema:** napravi *System User* (uloga *Employee*), dodeli mu ad nalog sa dozvolom **„Pregled učinka"** i generiši token sa dozvolom **`ads_read`** (bez isteka). Zapiši **ID ad naloga** (`act_…`) i **valutu** naloga.
2. Token i ID u `.env.local` i u **Vercel env** kao `META_ACCESS_TOKEN` i `META_AD_ACCOUNT_ID` (tajna — ne u repo, ne u chat).
3. **UTM u oglasima** (Ads Manager → oglas → *URL parameters*): `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}` — za sve aktivne oglase. Od tog dana atribucija radi.
4. Napravi jednu probnu porudžbinu kroz link iz oglasa (ili sa `?utm_source=facebook&utm_campaign=TEST`) i javi njen broj — M3 počinje proverom da li payload nosi atribuciju.

---

### M1 — Baza + sinhronizacija

**Fajlovi**
- `supabase/migrations/2026MMDDHHMMSS_reklame.sql` **(novo)**:
  - `ad_campaigns` (`id text` = Meta ID, `account_id text`, `name`, `status`, `objective`, `updated_at`)
  - `ad_insights_daily` (`campaign_id → ad_campaigns`, `date date`, `currency text`, `spend_minor bigint`, `fx_rate_micro bigint` (RSD po jedinici × 10⁶, null za RSD nalog), `spend_rsd int` (zaokruženo, snapshot), `impressions int`, `clicks int`, `link_clicks int`, `meta_purchases int`, `meta_purchase_value_minor bigint`, PK `(campaign_id, date)`)
  - `ad_sync_state` (`last_synced_at`, `last_error`)
  - RLS: select admin+manager, **nijedna write politika** (piše samo service role — obrazac Ponude), nijedna za Logistiku, svi pozivi u `(select …)`
- `lib/meta/client.ts`, `lib/meta/sync.ts` **(novo)**; kurs (ako D4 = EUR) — `lib/meta/fx.ts`
- `app/api/cron/meta-sync/route.ts` **(novo)** — GET, `Bearer CRON_SECRET`; `vercel.json` cron (npr. `0 5 * * *`)
- `scripts/meta-check.mjs` **(novo, samo čita)** — poredi zbir `spend` za poslednjih 30 dana iz baze sa direktnim Insights pozivom na nivou naloga (`level=account`) → razlika ≤ 1 RSD po danu

**Rezultat**
Posle „Sinhronizuj sada" tabela ima svaku kampanju po danu od 02.02.2026; `meta-check` = 0 razlike;
bez tokena sync tiho vraća „nije podešeno" (kao Resend/VAPID).

> **PROMPT ZA SESIJU (M1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Reklame.md (sekcije 0, 1 i korak M1). M0 je urađen.
> PRVO mi postavi pitanja iz §0.4 i potvrdi odluke D1–D9; tek onda kreni.
> Uradi SAMO M1: migracija ad_campaigns / ad_insights_daily / ad_sync_state (novac kao integer:
> spend_minor + fx_rate_micro + spend_rsd snapshot, NIKAD float), RLS select admin+manager,
> bez write politika, bez logistics, svaki current_app_role() u (select …).
> lib/meta/client.ts (server-only, token nikad u log/poruku, verzija Graph API-ja u jednoj
> konstanti — proveri aktuelnu), lib/meta/sync.ts (upsert, poslednjih 7 dana uvek ponovo,
> nikad ne baca), cron ruta + vercel.json, scripts/meta-check.mjs. Obrazac: modul Ponude
> (lib/offers/*). Dopuni rls:static. NE pokreći db push. lint + tsc + rls:static + build.
> ```
> **Ručno posle M1:** `supabase db push`, pa „Sinhronizuj sada" / `node scripts/meta-check.mjs`.

---

### M2 — Ekran `/reklame` (šta kaže Meta)

**Fajlovi**
- `db/ads.ts` **(novo)** — čita kroz SQL funkcije (`ad_campaign_stats`, `ad_daily_stats` — dodati u M1 migraciju ili zasebnu migraciju M2)
- `app/(app)/reklame/page.tsx`, `app/(app)/reklame/[id]/page.tsx` **(novo)**; `lib/nav.ts` — skinuti `soon`
- Period: postojeći filter (`lib/period.ts`), celi beogradski dani

**Sadržaj:** KPI red (potrošnja · prikazi · klikovi · CTR · CPC · Meta kupovine · Meta ROAS) →
grafikon **dva panela** (potrošnja po danu / Meta kupovine po danu — nikad dve y-ose, odluka iz
Ponuda) → tabela kampanja (sortiranje, mobilne kartice) → detalj kampanje po danima.
Svuda natpis „po Meta-i" uz Meta cifre, da se ne mešaju sa sajtom (M3).

> **PROMPT ZA SESIJU (M2)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Reklame.md (korak M2). M1 je gotov i sinhronizovan.
> Uradi SAMO M2 — /reklame i /reklame/[id] (requireRole admin+manager), SQL agregacije
> ad_campaign_stats/ad_daily_stats (security invoker), KPI + grafikon u dva panela (inline SVG,
> obrazac /ponude) + tabela kampanja. Skini soon sa „Reklame". Meta cifre označene „po Meta-i".
> lint + tsc + rls:static + build, vizuelno u AppShell-u (desktop + 360 px).
> ```

---

### M3 — Atribucija: šta kaže sajt

**Cilj:** po kampanji stvarne porudžbine i stvarna zarada.

**Fajlovi**
- **Prvo provera** (M0.4): sirovi payload probne porudžbine — postoje li `_wc_order_attribution_*` u `meta_data`? Ako ne → stati i dogovoriti rezervu (§0.5).
- `supabase/migrations/2026MMDDHHMMSS_orders_attribution.sql` — na `orders`: `attr_source_type`, `attr_utm_source`, `attr_utm_medium`, `attr_utm_campaign`, `attr_utm_content` (sve `text null`) + index na `attr_utm_campaign`
- `lib/woo.ts` — loose zod šema dobija opcioni `meta_data`; helper `attributionFromMeta()`
- `app/api/webhooks/woo/route.ts` — `insertOrder` upisuje atribuciju (**samo pri prvom prijemu**, kao stavke); nevalidna/odsutna atribucija → null, **nikad ne obara webhook**
- `scripts/woo-attribution-backfill.mjs` **(novo)** — dry-run default, `--apply`: Woo REST GET porudžbina od datuma iz M0.3 → upiše samo `attr_*` kolone (ništa drugo), idempotentno
- SQL `ad_campaign_stats` proširen: po kampanji porudžbine sa `attr_utm_campaign = campaign_id` (rezerva: = naziv), bez Otkazano/Vraćeno **po imenu**, promet i **zarada iz `order_items`**, `zarada − spend_rsd`, `spend_rsd / porudžbine`
- `/reklame` — kolone „Porudžbine (sajt)", „Zarada (sajt)", „Zarada − potrošnja", „Trošak po porudžbini"; red **„Bez kampanje / nepoznato"** za ostale porudžbine

**Odluke**
- `needs_vp` porudžbine ulaze sa zaradom nepotpunom + napomena (kao svuda).
- Porudžbine pre uključenja UTM-a se **ne pogađaju** — idu u „nepoznato".
- `scripts/woo-webhook-test.mjs` dopuniti slučajem sa i bez `meta_data` (postojećih 30+ provera mora da prolazi).

> **PROMPT ZA SESIJU (M3)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Reklame.md (sekcija 0.5 i korak M3). M1–M2 su gotovi.
> PRVO proveri payload probne porudžbine (broj ti dajem) — ima li _wc_order_attribution_* u meta_data.
> Ako nema, STANI i javi. Ako ima: migracija attr_* kolona na orders; webhook ih upisuje SAMO u
> insertOrder (order.updated ih ne dira), nikad ne obara webhook; backfill skripta (dry-run default,
> piše samo attr_*). ad_campaign_stats proširen porudžbinama i zaradom iz ZAMRZNUTIH order_items,
> bez Otkazano/Vraćeno po imenu. Dopuni woo:test. NE pokreći db push. lint + tsc + rls:static + build.
> ```
> **Ručno posle M3:** `supabase db push`, `npm run woo:test`, backfill dry-run → `--apply`.

---

### M4 — Troškovi, Dashboard, asistent

**Fajlovi**
- `app/(app)/reklame/actions.ts` — `transferMonthToExpenses(month)` (**Admin-only**): jedan red u `expenses` (kategorija „Reklame" po **imenu**, opis „Meta — {mesec}", iznos = Σ `spend_rsd`), sa oznakom izvora (`description` prefiks ili nova kolona — odlučiti; nova kolona = mala migracija); ponovni klik **menja** isti red, ne pravi novi; ručne redove ne dira (otvoreno pitanje 4)
- `/reklame` — baner „Oktobar: Meta potrošnja X, u troškovima Y" kad se razlikuju
- `lib/ai/tools/index.ts` — alat **`reklame_pregled`** (period → potrošnja, Meta i sajt cifre po kampanji) + `ai:check` dopuna
- Dashboard — **ne dira se** u v1 (neto već uključuje troškove; posebna kartica tek ako korisnik traži)

> **PROMPT ZA SESIJU (M4)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Reklame.md (korak M4). M1–M3 su gotovi.
> Uradi SAMO M4 — „Prenesi mesec u troškove" (Admin-only, jedan red po mesecu, kategorija
> „Reklame" po imenu, ponovni klik menja isti red, ručne redove ne dira), baner o razlici,
> AI alat reklame_pregled (samo čitanje) + ai:check. computePeriodMetrics NE diraj — troškovi
> ulaze u neto samo kroz expenses. lint + tsc + rls:static + build + npm run ai:check.
> ```

---

### M5 — QA, dozvole i dokumentacija (zatvara modul)

- `scripts/rls-test.mjs` — **dopuna**: Logistika 0 redova na `ad_*` i iz agregacija; Menadžer čita, insert odbijen; kapije `/reklame`, akcija, cron (401 bez `CRON_SECRET`).
- `CLAUDE.md` — **promenjena odluka** u §3 (Meta integracija sada postoji, samo čitanje) + zaključane odluke modula + beleška u §10.
- Plan u `docs/arhiva/`.

**Provere:** `meta-check` 0 razlike · zbir „Zarada (sajt)" svih kampanja + „nepoznato" = zarada perioda na Dashboardu (isti period, isto pravilo) · token se ne vidi ni u jednom odgovoru/logu · 360 px · prazna stanja („Meta nije podešena", „Nema potrošnje u periodu").

> **PROMPT ZA SESIJU (M5)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Reklame.md (korak M5). M1–M4 su gotovi.
> Uradi SAMO M5 — dopuni scripts/rls-test.mjs (ad_* + kapije + cron 401), QA lista (zbir sajt
> zarade po kampanjama + „nepoznato" = Dashboard zarada za isti period), upiši promenjenu
> odluku o Meta integraciji i zaključane odluke u CLAUDE.md, plan u docs/arhiva/.
> lint + tsc + rls:static + build.
> ```

---

## 3. Pre produkcije (čeklista)

- [ ] M0 urađen (token, ID naloga, valuta, UTM u svim oglasima).
- [ ] `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` u Vercel env.
- [ ] `supabase db push` posle M1 i M3.
- [ ] Prvi sync i `meta-check`.

## 4. Namerno van opsega (v1)

Upravljanje kampanjama iz app-a (pauza, budžet, novi oglas) · Google / TikTok reklame · nivo
oglasa i grupe oglasa (samo kampanja; `utm_content` se čuva za kasnije) · Meta Conversions API
(slanje porudžbina Meta-i) · publike/segmenti iz kupaca · automatsko knjiženje troškova bez klika ·
kreativa (Higgsfield) i tekstovi oglasa.
