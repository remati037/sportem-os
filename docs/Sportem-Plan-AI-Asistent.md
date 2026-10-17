# Sportem — Plan implementacije: AI Asistent

> Verzija 1.0 · 18.10.2026 · status: **spreman za rad**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka.

---

## 0. Šta gradimo

Nova kartica **Asistent** (`/asistent`) — chat sa AI agentom koji zna Sportem: odgovara na pitanja
nad podacima („najprodavaniji artikal u septembru", „koliko smo prodali Nike lopti ove godine",
„koji kupci najviše vraćaju"), radi analizu i daje predloge / brainstorming (nabavka, akcije, reklame).

### Potvrđene odluke (ispitivanje 18.10.2026)

| Tema | Odluka |
|---|---|
| Modeli | **Samo Claude** (Anthropic API, jedan ključ). Izbor u chatu: **Opus 5.5** (podrazumevano, najpametniji) · **Sonnet 5.5** (balans) · **Haiku 5.5** (brz i jeftin) |
| Pristup | **Admin + Menadžer.** Logistika nema stavku, nema rute, nema RLS politiku (asistent vidi zaradu → po zaključanoj odluci Logistika ne sme) |
| Akcije | **Samo čitanje.** Asistent ne menja ništa u bazi — nijedan alat ne piše |
| Istorija | **Lična po korisniku** — svako vidi samo svoje razgovore; preimenovanje i brisanje |

### Ključni principi

1. **Brojevi dolaze iz alata, nikad iz „glave" modela.** Model ne sme da izmisli cifru — svaki podatak
   ide kroz alat koji čita bazu. System prompt to izričito traži, a odgovor navodi period i izvor.
2. **Zamrznute cene (§4).** Svaki alat koji računa promet/zaradu čita **isključivo `order_items`**
   (`mp_at_sale`, `profit_at_sale`), nikad katalog. Grupisanje artikala **po `sku` + `product_name`
   snapshot-u**, ne po `variant_id` (v. `docs/Sportem-Plan-Izvestaji.md` — `variant_id` je null na
   većini istorijskih stavki).
3. **Ista pravila kao ostatak app-a.** Otkazano/Vraćeno se isključuje **po IMENU**
   (`CANCELLED_STATUS_NAMES`), periodi su **Europe/Belgrade** (`lib/date-belgrade.ts`), paginacija i
   `.in()` parčad kroz `lib/supabase/paginate.ts`. Gde postoji gotova funkcija (`computePeriodMetrics`,
   `getLowStockVariants`, `getDrugMiDuguje`…), alat je **poziva**, ne prepisuje.
4. **Ključ je isključivo serverski.** `ANTHROPIC_API_KEY` samo u `server-only` modulu; nikad u klijentu,
   logu ni poruci greške.
5. **Best-effort, jasne greške.** Pad API-ja / limit / timeout → srpska poruka u chatu + Sentry; nikad
   ne ruši stranu.

### Šta se NE dira

Zamrznute cene i `order_items` (samo čitanje), finansije, tok statusa, webhook, `syncOrderStock`,
RLS politike postojećih tabela, obaveštenja.

---

## 1. Arhitektura

```
app/(app)/asistent/
  page.tsx                 # nov razgovor (prazno stanje + predlozi pitanja)
  [id]/page.tsx            # postojeći razgovor
  chat.tsx                 # klijent: poruke, unos, stream, izbor modela
  conversation-list.tsx    # leva kolona (desktop) / Sheet (telefon)
  actions.ts               # rename / delete razgovora
app/api/asistent/chat/route.ts   # POST, streaming (SSE) — jedina ruta koja zove Anthropic
lib/ai/
  client.ts                # server-only Anthropic klijent + AI_MODELS lista
  system-prompt.ts         # stabilan system prompt (keširan)
  tools/*.ts               # alati (betaZodTool), svaki samo čita
  usage.ts                 # potrošnja i limit
db/ai.ts                   # upiti nad ai_conversations / ai_messages
```

- **Petlja alata:** `client.beta.messages.toolRunner` (SDK) sa `betaZodTool` alatima i streamingom ka
  klijentu. Svaki alat dobija **RLS klijent korisnika** (`createClient()`), ne service-role — RLS
  ostaje izvor sigurnosti i za AI.
- **Istorija = pun sadržaj odgovora.** U `ai_messages.content` se čuva **ceo niz content blokova**
  (`jsonb`: tekst, `tool_use`, `tool_result`, thinking), ne samo tekst — razgovor se nastavlja
  append-only, bez prepravljanja ranijih poruka (Opus/Sonnet 5.5 odbijaju izmenjenu istoriju).
  UI prikazuje samo tekst + sažetak „Pogledao: prodaja po artiklima, 01–30.09.".
- **Promena modela usred razgovora je dozvoljena** — novi model samo ignoriše thinking blokove
  prethodnog (bez greške, bez troška). Model se pamti po poruci (`ai_messages.model`).
- **Prompt caching:** stabilan system prompt + sortiran, nepromenljiv spisak alata → keš prefiksa;
  datum „danas" ide u poruku korisnika, ne u system prompt (inače kvari keš).
- **Thinking:** adaptive, `display: "summarized"` — UI može da pokaže sklopivo „Razmišljanje".
  `effort` po modelu: Opus `medium` (podrazumevano), Sonnet `medium`, Haiku `low`.
- **Refusal fallback** uključen (`fallbacks: "default"`) za Opus/Sonnet 5.5.

---

## 2. Faze i koraci

### A1 — Baza + skelet (migracija #1, jedina u modulu)

- Migracija `ai_asistent.sql`:
  - `ai_conversations` (`id`, `user_id → auth.users`, `title`, `model`, `created_at`, `updated_at`,
    `archived_at`), index `(user_id, updated_at desc)`.
  - `ai_messages` (`id`, `conversation_id` cascade, `role` CHECK `user|assistant`, `content jsonb`,
    `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_micro_usd bigint`, `created_at`).
  - RLS: **samo vlasnik i samo admin/menadžer** —
    `user_id = (select auth.uid()) and (select public.current_app_role()) in ('admin','manager')`
    (omotano, inače `rls:static` pada — K3 pravilo). Logistika: nijedna politika.
- `npm i @anthropic-ai/sdk`; `lib/ai/client.ts` (`server-only`), `AI_MODELS` (id, srpski naziv, opis,
  cena za prikaz); env `ANTHROPIC_API_KEY` u `.env.example`.
- Nav stavka **„Asistent"** (ikona `Sparkles`, `STAFF`, sekundarna); `/asistent` sa `requireRole`.
- **Rezultat:** `db push` prolazi, strana se otvara Adminu/Menadžeru, Logistika dobija redirect.

### A2 — Chat bez alata (pun UX)

- `POST /api/asistent/chat` — `requireRole`, zod, kreira razgovor ako ne postoji, upisuje poruku
  korisnika, streamuje odgovor (SSE), na kraju upisuje odgovor + tokene.
- UI: **Enter šalje, Shift+Enter nov red**, auto-rast polja, dugme **Stop** (prekida stream),
  **Ponovi odgovor**, **Kopiraj**, markdown prikaz (tabele, liste, bold — `react-markdown` +
  `remark-gfm`, bez sirovog HTML-a), auto-skrol, vidljivo „piše…".
- **Izbor modela** u zaglavlju (pamti se poslednji izbor po korisniku u `localStorage`).
- Leva kolona: lista razgovora (najnoviji prvi), **Nov razgovor**, preimenuj, obriši (uz potvrdu),
  pretraga po naslovu. Na telefonu lista u `Sheet`-u.
- **Auto-naslov** posle prvog odgovora (Haiku 5.5, kratak poziv, best-effort).
- **Rezultat:** normalan chat sa istorijom radi; ništa još ne zna o podacima.

### A3 — Alati nad podacima (srce modula, samo čitanje)

Svaki alat: zod ulaz (period `od/do` kao `YYYY-MM-DD`, Belgrade), limit redova, vraća **kompaktan JSON**
(ne sirove redove) + `napomena` (npr. „5 porudžbina bez VP — zarada nepotpuna").

| Alat | Šta vraća |
|---|---|
| `prodaja_pregled` | promet, zarada, broj porudžbina, marža, troškovi, neto za period (`computePeriodMetrics`) |
| `top_artikli` | top N po komadima / prometu / zaradi, grupisano po `sku` (+ `product_name`), opcioni filter po nazivu/kategoriji |
| `artikal_prodaja` | prodaja jednog artikla (pretraga po nazivu/SKU) po danima/nedeljama/mesecima |
| `prodaja_po_vremenu` | serija po danu / nedelji / mesecu (trend, sezonalnost) |
| `kupci_top` | najbolji kupci (broj, promet), ponovljeni kupci, rizični (otkazivanja/vraćanja) |
| `porudzbine_pretraga` | lista porudžbina po filteru (status, period, kupac, način isporuke) — max 50 |
| `porudzbina_detalj` | jedna porudžbina po Woo broju |
| `zalihe` | nisko stanje, stanje 0, nepopisano, stanje artikla |
| `finansije_stanje` | drug mi duguje, saldo poštarine, nefakturisane uplate |
| `troskovi` | troškovi po kategoriji za period (reklame vs ostalo) |
| `otkazivanja` | stopa otkazivanja/vraćanja po periodu i artiklu, razlozi iz `order_status_history.note` |
| `ponude_statistika` | Sportem Offers po pravilu (`offer_rule_stats`) |

- **PII higijena:** alati vraćaju ime i grad kupca, telefon samo kad se izričito traži jedna
  porudžbina; adrese nikad u zbirnim alatima.
- System prompt: kratak opis biznisa (iz `docs/sportem-kontekst.md` — XExpress, drug/VP, keš prodaja,
  statusi), pravila (cifre samo iz alata, RSD format `12.500 RSD`, srpski sa dijakriticima, navedi period),
  i šta alati NE pokrivaju (reklame po kampanji, posete sajtu).
- UI: kartica „Pogledao…" ispod odgovora (koji alati i periodi su korišćeni).
- **Rezultat:** skripta `npm run ai:check` postavi 8 kontrolnih pitanja i uporedi cifre iz alata sa
  Dashboardom / Izveštajima — 0 RSD razlike.

### A4 — Predlozi, brainstorming i web

- **Predlozi pitanja** na praznom razgovoru (klik = pošalji): „Top 10 artikala ovog meseca",
  „Šta da naručim od druga?", „Uporedi ovaj i prošli mesec", „Ideje za akciju za vikend"…
- **Web pretraga** (Anthropic server tool `web_search`) kao **prekidač** u unosu („Pretraži web") — za
  cene konkurencije, trendove, ideje za reklame. Isključena podrazumevano (trošak + privatnost).
- **Brzi kontekst:** dugme „Pitaj asistenta" na detalju porudžbine i proizvoda otvara nov razgovor sa
  pred-popunjenim pitanjem („Analiziraj prodaju artikla SKU …").
- **Izvoz odgovora:** tabela iz odgovora → „Kopiraj kao CSV".

### A5 — Potrošnja i limit

- Cena po poruci računata iz `usage` (uklj. keš) i upisana u `ai_messages.cost_micro_usd` (integer,
  bez float-a — §5).
- `/asistent` prikazuje potrošnju ovog meseca (po korisniku + ukupno za Admina).
- **Mesečni limit** `AI_MONTHLY_LIMIT_USD` (env): na 80% upozorenje, na 100% ruta odbija sa jasnom
  porukom („Mesečni limit AI asistenta je potrošen"). Admin vidi limit u `/podesavanja`.
- Limit dužine razgovora: posle ~150k tokena predlog „Počni nov razgovor" (ili server-side compaction).

### A6 — QA, dozvole, dokumentacija

- `rls:test` dopuna: Logistika → 0 redova na `ai_*`; Menadžer ne vidi Adminove razgovore; kapije ruta
  (strana, API ruta, akcije) u `rls:static`.
- Telefon 360px, prazna stanja, greške (bez ključa, limit, mreža).
- `CLAUDE.md`: zaključane odluke modula + beleška po koraku.

### (Kasnije, van v1) Slobodni SQL upiti

Ako fiksni alati ne pokriju pitanja: alat `sql_upit` kroz Postgres funkciju sa **read-only
transakcijom**, `statement_timeout`, nad **whitelist view-ovima bez PII**. Traži posebnu migraciju i
odluku — ne radi se u v1.

---

## 3. Pre produkcije (čeklista)

- [ ] `supabase db push` (A1)
- [ ] `ANTHROPIC_API_KEY` + `AI_MONTHLY_LIMIT_USD` u **Vercel env**
- [ ] Ključ napravljen na console.anthropic.com sa **spending limitom** i na nalogu
- [ ] Vercel funkcija za `/api/asistent/chat`: `maxDuration` dovoljan za duže odgovore (Hobby: do 60 s
      → po potrebi Haiku/Sonnet za teška pitanja ili prelazak na Pro)

## 4. Namerno van opsega (v1)

Pisanje u bazu (tiketi, statusi, cene) · glasovni unos · prilozi/slike u chatu · deljenje razgovora
između korisnika · drugi provajderi (OpenAI/Gemini) · pristup za Logistiku · zakazani AI izveštaji.
