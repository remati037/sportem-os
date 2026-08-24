# Sportem — Plan implementacije: Tiketi (kanban za tim)

> Verzija 1.0 · 25.08.2026 · status: **odobren za implementaciju**
> Prati pravila iz `CLAUDE.md` (zaključane odluke, migracije, RLS, srpski UI, zamrznute cene).
> **Jedan korak = jedna sesija.** Za svaku sesiju: `CLAUDE.md` + tekst tog koraka + „PROMPT ZA SESIJU".

---

## 0. Šta gradimo (rezime odluka)

Interni **tiket sistem** (kanban board na desktopu, tabovi + lista na telefonu) za Sportem tim —
da se zadaci ne dogovaraju van aplikacije.

### Potvrđene odluke (ispitivanje 25.08.2026)

| Tema | Odluka |
|---|---|
| Pristup | **Samo Admin i Menadžer.** Logistika NEMA pristup (RLS ih ne pušta ni do jedne ticket tabele). |
| Dozvole | **Menadžer je ravnopravan Adminu** nad tiketima (pravi, menja, dodeljuje, briše). **Podešavanja (kolone/tagovi/prioriteti) = samo Admin.** |
| Kolone | **Podesive** u Podešavanjima (naziv, boja, redosled, „završna kolona", **WIP limit**). Start: Za rad · U toku · Čeka · Završeno. |
| WIP limit | **Soft** — kolona pocrveni i broji `4/3`, ali **pušta** pomeranje. |
| Dodela | **Više izvršilaca** po tiketu (M:N). Tiket može biti i nedodeljen. |
| Veze | Opciono: **porudžbina**, **proizvod/varijanta**, **kupac** — bilo koja, sve, ili nijedna (samostalni tiket). |
| Datumi | `created_at` (auto), **jedan rok (`due_date`, samo datum)**, `completed_at` (auto). |
| Šifra | **Auto brojač `SPT-1`, `SPT-2`…** (Postgres sequence). URL `/tiketi/SPT-42` (prima i `42`). |
| Prioriteti | **Podesivi** u Podešavanjima (naziv, boja, nivo, podrazumevani). Start: Nizak · Srednji · Visok · Hitno. |
| Tagovi | **Više po tiketu**, podesivi u Podešavanjima, sa **arhiviranjem** (skloni iz izbora, ostaje na starim tiketima). |
| Sadržaj tiketa | Naslov, opis (**običan tekst + auto-linkovi**), komentari, **checklist**, **istorija promena (audit)**, **procena vremena**, **zavisnost „čeka drugi tiket"**, **dugme Dupliraj**. |
| Zavisnost | **Vizuelno upozorenje, ne blokira.** Push kad se blokada oslobodi. |
| Desktop pomeranje | **Drag & drop + ručni redosled unutar kolone** (`@dnd-kit`) + dropdown kao rezerva. |
| Mobilni | **Tabovi po kolonama** (sa brojačem) + vertikalna lista kartica; status kroz meni (bez DnD). |
| Donji bar (telefon) | **Tiketi ulaze u bar, Katalog se seli u „Više"** (za Admina i Menadžera). Logistici Katalog ostaje u bar-u — nema drugu primarnu stavku. |
| Završeni | Ostaju u završnoj koloni; **auto-sakrivanje posle 14 dana** iza dugmeta „Prikaži arhivu". Ništa se ne briše. |
| Filteri | Pretraga (naslov/šifra), filteri (osoba, tag, prioritet), prekidač **„Samo moji"**, traka **„Probijen rok / rok danas"**. Sve u URL-u. |
| Obaveštenja | Dodeljen mi tiket · Rok danas/probijen · Nov komentar · Tiket završen (+ oslobođena blokada). |
| Auto-tiketi | **Samo rizičan kupac** → tiket „Pozovi i potvrdi", **nedodeljen**, prioritet **Visok**, tag **Poziv**, link na porudžbinu. Ništa drugo se ne pravi automatski. |
| Nema u v1 | Ponavljajući tiketi, prilozi/fajlovi, markdown opis, vreme (sat) u roku. |

### Šta se NE dira
Zamrznute cene (`order_items`), finansije, RLS politike postojećih tabela, snapshot logika,
webhook tok porudžbina (dodaje se samo jedan best-effort poziv), Logistika i njen restriktovani view.

---

## 1. Model podataka (jedna migracija)

Sve tabele idu u **jednu migraciju** `supabase/migrations/20260825120000_tiketi.sql`
(jedan `supabase db push` za ceo modul). Podrazumevane kolone/prioriteti/tagovi se upisuju
**u samoj migraciji** (fiksni UUID + `on conflict do nothing`) — ne u `seed.sql`, jer se seed
ne primenjuje na postojeću produkcionu bazu.

```
ticket_columns        id, name, color, sort_order, is_done bool, wip_limit int null, created_at, updated_at
ticket_priorities     id, name, color, level int, is_default bool, sort_order, created_at, updated_at
ticket_tags           id, name, color, sort_order, archived_at, created_at, updated_at
                      unique index on lower(name) where archived_at is null

tickets               id uuid pk
                      code int not null unique default nextval('ticket_code_seq')   -- prikaz „SPT-{code}"
                      title text not null
                      description text
                      column_id      → ticket_columns    (on delete restrict)
                      priority_id    → ticket_priorities (on delete set null)
                      position numeric not null          -- ručni redosled u koloni
                      due_date date
                      estimate_minutes int
                      blocked_by_ticket_id → tickets(id) (on delete set null)
                      order_id       → orders            (on delete set null)   -- opciona veza
                      variant_id     → product_variants  (on delete set null)   -- opciona veza
                      customer_id    → customers         (on delete set null)   -- opciona veza
                      created_by     → profiles          (on delete set null)
                      completed_at timestamptz           -- postavlja se ulaskom u is_done kolonu
                      source text not null default 'manual'
                             check (source in ('manual','auto_risky_customer'))
                      created_at, updated_at
                      unique index (order_id) where source = 'auto_risky_customer'  -- anti-duplikat
                      indeksi: (column_id, position), (due_date), (completed_at)

ticket_assignees      ticket_id, user_id → profiles, created_at   — pk (ticket_id, user_id)
ticket_tag_links      ticket_id, tag_id                            — pk (ticket_id, tag_id)
ticket_checklist_items id, ticket_id, label, done bool, sort_order, done_at, done_by
ticket_comments       id, ticket_id, author_id → profiles, body text, created_at, updated_at
ticket_events         id, ticket_id, actor_id, kind text, from_text, to_text, meta jsonb, created_at
                      -- audit: created | column | priority | assignee | due | tag | blocked | checklist | comment_deleted
```

### Odluke o modelu

- **`position` je `numeric`** (fractional indexing). Nov tiket → `max(position)+1000`.
  Pomeranje → sredina između suseda; ako razmak padne ispod `0.0001`, server prenumeriše kolonu
  (`1000, 2000, 3000…`) u jednoj transakciji. Bez float tipova (`double`) — pravilo iz `CLAUDE.md §5`.
- **`completed_at`** se postavlja/briše **isključivo** kad tiket uđe/izađe iz kolone sa `is_done = true`.
  Auto-sakrivanje = filter `completed_at > now() - interval '14 days'`, **bez crona i bez brisanja**.
- **Brisanje kolone** je zabranjeno ako ima tiketa (`on delete restrict` + srpska poruka) — obrazac
  iz statusa porudžbine. **Brisanje taga** ga samo skida sa tiketa (`cascade` na link tabeli);
  preporučeno arhiviranje. **Brisanje prioriteta** → `set null` (tiket ostaje bez prioriteta).
- **`is_done` i podrazumevani prioritet** se čitaju **po zastavici/imenu**, nikad po hardkodovanom UUID-u
  (pravilo iz `APP_STATUS`). Konstante imena idu u `lib/tickets.ts`.

### RLS (obrazac iz `postage_settlements`)

| Tabela | select | write |
|---|---|---|
| `tickets`, `ticket_assignees`, `ticket_tag_links`, `ticket_checklist_items`, `ticket_comments`, `ticket_events` | `admin`, `manager` | `admin`, `manager` |
| `ticket_columns`, `ticket_priorities`, `ticket_tags` | `admin`, `manager` | **`admin`** |

Logistika **nema nijednu politiku** → deny-by-default, ne vidi ništa (kao finansije).
`ticket_events` piše i server (service-role) kod automatike.

---

## 2. Faze i koraci

Redosled je namerno takav da posle **T2** već imaš upotrebljiv board, a svaka sledeća faza dodaje sloj
bez lomljenja prethodne. Svaki korak = svoj commit na grani **`korak-2-tiketi`**.

---

### T1 — Baza + Podešavanja (kolone, prioriteti, tagovi)

**Cilj:** šema, RLS, podrazumevani config, i ekran gde Admin pravi kolone/prioritete/tagove.

**Fajlovi**
- `supabase/migrations/20260825120000_tiketi.sql` (cela šema iz sekcije 1 + defaults)
- `lib/tickets.ts` — konstante (`TICKET_DEFAULTS`: imena start kolona/prioriteta/tagova), `formatTicketCode(code) → "SPT-42"`, `parseTicketParam(param)`
- `db/tickets-config.ts` — `getTicketColumns()`, `getTicketPriorities()`, `getTicketTags({ includeArchived })`
- `lib/validation/tickets.ts` — zod šeme za config CRUD
- `app/(app)/podesavanja/actions.ts` — dopuna: upsert/delete za kolone, prioritete, tagove (+ arhiviraj/vrati tag)
- `app/(app)/podesavanja/ticket-settings.tsx` — tri sekcije, obrazac iz `status-settings.tsx`
- `app/(app)/podesavanja/page.tsx` — dodati sekciju „Tiketi" (samo Admin)

**Podrazumevani sadržaj (u migraciji)**
- Kolone: `Za rad` (siva) · `U toku` (plava) · `Čeka` (amber) · `Završeno` (`is_done = true`, zelena `#1B7A45`), `wip_limit` NULL svuda.
- Prioriteti: `Nizak`(1) · `Srednji`(2, **default**) · `Visok`(3) · `Hitno`(4, crvena).
- Tagovi: `Poziv` · `XExpress` · `Reklamacija` · `Nabavka`.

**Rezultat (definicija gotovog)**
`supabase db push` prolazi; na `/podesavanja` Admin vidi tri nove sekcije i može da doda/izmeni/obriše
kolonu, prioritet i tag (+ arhivira tag); Menadžer i Logistika ne vide te sekcije; `npm run lint`,
`tsc` i `npm run build` zeleni.

> **PROMPT ZA SESIJU (T1)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (sekcije 0, 1 i korak T1).
> Uradi SAMO korak T1: migracija 20260825120000_tiketi.sql sa celom šemom tiketa iz sekcije 1
> (uključujući RLS po tabeli iz tabele u sekciji 1 i podrazumevane kolone/prioritete/tagove sa
> fiksnim UUID-jevima i `on conflict do nothing`), plus lib/tickets.ts, db/tickets-config.ts,
> lib/validation/tickets.ts i sekcija „Tiketi" na /podesavanja (Admin-only) po obrascu
> app/(app)/podesavanja/status-settings.tsx.
> Ne pravi još board, tikete ni rute /tiketi. Ne diraj postojeće migracije, RLS politike drugih
> tabela ni snapshot logiku. Na kraju pokreni lint + tsc + build i prijavi rezultat.
> ```

---

### T2 — Board + kartica + kreiranje/izmena tiketa

**Cilj:** upotrebljiv kanban (bez DnD) — vidiš, praviš i menjaš tikete, na desktopu i telefonu.

**Fajlovi**
- `db/tickets.ts` — `listTickets(filters)` (kolone + tiketi + izvršioci + tagovi + prioritet u malo upita; JS spajanje, bez N+1), `getTicketDetail(param)`, tipovi
- `lib/validation/tickets.ts` — dopuna: `ticketSchema`, `updateTicketSchema`, `moveTicketSchema`
- `app/(app)/tiketi/actions.ts` — `createTicket`, `updateTicket`, `deleteTicket`, `moveTicket` (kolona), `setAssignees`, `setTags`
- `app/(app)/tiketi/page.tsx` — server komponenta, čita filtere iz `searchParams`
- `app/(app)/tiketi/board.tsx` — desktop kanban (kolone + `wip_limit` badge, soft crveno)
- `app/(app)/tiketi/mobile-board.tsx` — tabovi po kolonama + lista kartica
- `app/(app)/tiketi/ticket-card.tsx` — šifra, naslov, tagovi, prioritet, izvršioci (inicijali), rok (bojen kad kasni), badge veze
- `app/(app)/tiketi/ticket-dialog.tsx` — kreiranje/izmena (naslov, opis, kolona, prioritet, izvršioci, tagovi, rok, procena, veze)
- `app/(app)/tiketi/filters.tsx` — pretraga, osoba, tag, prioritet, „Samo moji", traka „Probijeno / danas"
- `app/(app)/tiketi/[id]/page.tsx` — detalj (u T2 samo osnovna polja; sadržaj se puni u T4)
- `lib/nav.ts` — **`primary: boolean` → `primaryRoles: Role[]`** (koja rola vidi stavku u donjem bar-u):
  nova stavka Tiketi (`roles: STAFF`, `primaryRoles: STAFF`), a **Katalog silazi u „Više" za Admina i
  Menadžera** (`roles: ALL`, `primaryRoles: ["logistics"]`) — Logistici Katalog ostaje u bar-u jer im je
  jedini ekran. `navPrimaryForRole` / `navSecondaryForRole` filtriraju po tome; `components/layout/bottom-nav.tsx`
  i `sidebar.tsx` se ne menjaju u ponašanju (sidebar i dalje prikazuje sve stavke role)
- `db/profiles.ts` (novo) — lista Sportem korisnika za izbor izvršilaca (`admin`, `manager`)

**Odluke**
- Filteri u URL-u: `?kolona=&osoba=&tag=&prioritet=&q=&moji=1&rok=probijen|danas&arhiva=1`.
  Deljiv link = deljiv pogled.
- Veze (porudžbina/proizvod/kupac) se biraju **pretragom** u dijalogu; sve su opcione i nezavisne.
- Rok se boji: probijen = crveno, danas = amber, inače neutralno (`belgradeDate` iz `lib/date-belgrade.ts`).
- Sortiranje unutar kolone dok nema DnD: `position ASC` (nov tiket ide na dno).
- **Donji bar na telefonu (odluka korisnika):** Dashboard · Porudžbine · **Tiketi** · Finansije · „Više";
  **Katalog se seli u „Više"** (uz Troškove, Korisnike, Obaveštenja, Podešavanja). Broj slotova ostaje 5 —
  ništa se ne skraćuje. Logistika je izuzetak: njoj Katalog ostaje u bar-u (nema drugu primarnu stavku).

**Rezultat**
Na `/tiketi` vidiš 4 kolone sa karticama; možeš da napraviš tiket sa svim poljima, izmeniš ga, obrišeš,
prebaciš u drugu kolonu iz menija; filteri i pretraga rade i pamte se u URL-u; na telefonu su tabovi;
Logistika na `/tiketi` dobija redirect; završeni stariji od 14 dana su sakriveni dok ne klikneš „Prikaži arhivu".

> **PROMPT ZA SESIJU (T2)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (sekcije 0, 1 i korak T2). T1 je gotov.
> Uradi SAMO korak T2: db/tickets.ts, server akcije, /tiketi board (desktop kolone + mobilni tabovi),
> kartica, dijalog za kreiranje/izmenu, filteri u URL-u i nav stavka.
> Bez drag&drop-a (to je T3), bez komentara/checkliste/istorije (to je T4), bez obaveštenja (T5).
> Pristup: requireRole("admin","manager"). Prati postojeće obrasce: server akcije + zod + firstZodError,
> shadcn komponente iz components/ui, prazna stanja preko components/patterns/empty-state.tsx,
> mobilne kartice po obrascu iz app/(app)/troskovi/page.tsx.
> Na kraju lint + tsc + build.
> ```

---

### T3 — Drag & drop + ručni redosled

**Cilj:** kartica se prevlači između kolona i unutar kolone, redosled se pamti.

**Fajlovi**
- `package.json` — `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers` (**jedina nova zavisnost celog modula**)
- `app/(app)/tiketi/board.tsx` — `DndContext` + `SortableContext` po koloni, optimistički pomeraj (`useOptimistic`), rollback + toast na grešku
- `app/(app)/tiketi/actions.ts` — `moveTicket(ticketId, columnId, beforeId, afterId)` → računa `position` kao sredinu; prenumeracija kad razmak padne ispod praga
- `db/tickets.ts` — `repositionColumn(columnId)` helper

**Odluke**
- Server **ne veruje** klijentskoj poziciji: prima susede i sam računa broj (guard za istovremeni rad dvoje ljudi).
- DnD samo na `md+`; na telefonu ostaje meni (dodir + skrol se ne mešaju).
- Tastatura: `@dnd-kit` keyboard sensor uključen (pristupačnost, bez dodatnog koda).

**Rezultat**
Prevlačenje radi između i unutar kolona; posle `router.refresh()` redosled je isti; dva prozora ne mogu
da naprave dupli `position`; WIP limit i dalje samo upozorava.

> **PROMPT ZA SESIJU (T3)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (korak T3). T1 i T2 su gotovi.
> Uradi SAMO T3: instaliraj @dnd-kit (core, sortable, modifiers) i dodaj drag&drop na /tiketi board
> — pomeranje između kolona i ručni redosled unutar kolone kroz numeric `position` (fractional
> indexing, server računa poziciju iz suseda, prenumeracija kolone kad razmak padne ispod 0.0001).
> Optimistički UI uz rollback i toast na grešku. DnD samo na desktopu (md+).
> Ne diraj šemu (kolona position već postoji iz T1). Na kraju lint + tsc + build.
> ```

---

### T4 — Detalj tiketa: komentari, checklist, istorija, zavisnost, dupliranje

**Cilj:** sve što ubija komunikaciju van tiketa.

**Fajlovi**
- `db/tickets.ts` — `getTicketComments`, `getTicketChecklist`, `getTicketEvents`, `getBlockingTicket`, `getLinkedContext` (porudžbina/artikal/kupac u jednom pozivu)
- `app/(app)/tiketi/actions.ts` — `addComment`, `editComment`, `deleteComment`, `addChecklistItem`, `toggleChecklistItem`, `deleteChecklistItem`, `setBlockedBy`, `duplicateTicket`
- `lib/ticket-events.ts` — `logTicketEvent(...)`: jedinstven upis audit reda; poziva ga svaka mutirajuća akcija
- `app/(app)/tiketi/[id]/page.tsx` — pun detalj
- `app/(app)/tiketi/[id]/comments.tsx`, `checklist.tsx`, `activity.tsx`, `linked-panel.tsx`
- `components/patterns/linkify.tsx` — običan tekst → klikabilni URL-ovi, `SPT-12` i `#2419`

**Odluke**
- **Istorija se piše iz akcija, ne iz DB trigera** — isti obrazac kao `order_status_history` (znamo `actor`).
- Komentar sme da menja/briše **samo autor** (server proverava); brisanje upisuje audit red.
- `duplicateTicket` kopira: naslov + „ (kopija)", opis, prioritet, tagove, izvršioce, procenu, checklist
  (sve stavke neštiklirane). **Ne kopira**: komentare, istoriju, rok, veze, `completed_at`.
- Zavisnost: kartica i detalj pokazuju „čeka `SPT-12`" i sivi se; **ne blokira** nijednu akciju.
  Ciklus (A čeka B, B čeka A) server odbija sa srpskom porukom.
- `linked-panel` prikazuje kupca/porudžbinu/artikal sa linkom; **nikad ne prikazuje finansije** (Menadžer sme, ali panel ionako pokazuje samo naziv/broj/status).

**Rezultat**
Detalj tiketa ima nit komentara sa autorom i vremenom, checklist sa progresom `2/3`, hronologiju svih
promena („Marko je 25.08. prebacio u U toku"), panel vezanih zapisa sa linkovima, dugme „Dupliraj",
i izbor tiketa koji ga blokira.

> **PROMPT ZA SESIJU (T4)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (korak T4). T1–T3 su gotovi.
> Uradi SAMO T4: pun detalj tiketa — komentari (autor sme da menja/briše svoje), checklist sa
> progresom, istorija promena preko lib/ticket-events.ts (upis iz akcija, ne iz trigera; poziv dodati
> i u postojeće T2/T3 akcije), zavisnost „čeka drugi tiket" (upozorenje, ne blokira, odbij ciklus),
> panel vezanih zapisa (porudžbina/artikal/kupac) i dugme Dupliraj po pravilima iz plana.
> Bez obaveštenja (T5). Na kraju lint + tsc + build.
> ```

---

### T5 — Obaveštenja (push + email) i dnevni podsetnik za rok

**Cilj:** tiket sam javlja; ništa se ne pita van aplikacije.

**Fajlovi**
- `lib/push.ts` — **novi `notifyUsers(type, referenceId, userIds, payload)`** (postojeći `notifyRoles` ostaje; izdvojiti zajedničko jezgro: preference → kanal → push/email → dedup log)
- `lib/notifications.ts` — 5 novih tipova: `ticket_assigned`, `ticket_due`, `ticket_comment`, `ticket_done`, `ticket_unblocked` (role: `admin`, `manager`)
- `app/(app)/tiketi/actions.ts` — okidači, svi **best-effort** (nikad ne obaraju akciju; Sentry)
- `app/api/cron/notifikacije/route.ts` — dopuna: svaki dan „rok danas" i „probijen rok" ka **izvršiocima** tih tiketa
- `app/(app)/obavestenja/notification-preferences.tsx` — novi tipovi se pojavljuju sami (lista je iz `NOTIFICATION_TYPES`)

**Okidači i `reference_id` (dedup u `notification_log`)**

| Tip | Kad | Kome | `reference_id` |
|---|---|---|---|
| `ticket_assigned` | dodat kao izvršilac | tom korisniku | `ticket_event.id` |
| `ticket_comment` | nov komentar | izvršioci + autor tiketa, **bez onog ko je komentarisao** | `comment.id` |
| `ticket_done` | tiket ušao u `is_done` kolonu | autor tiketa (ako nije on pomerio) | `ticket_event.id` |
| `ticket_unblocked` | završen tiket koji je blokirao druge | izvršioci odblokiranih | `ticket_event.id` |
| `ticket_due` | dnevni cron | izvršioci tiketa sa rokom danas / probijenim | `ticket_due:{userId}:{YYYY-MM-DD}` |

**Odluke**
- `reference_id` uvek vezan za **događaj**, ne za tiket — inače bi ponovna dodela iste osobe zauvek bila „već poslato".
- Cron šalje **jedno sabrano obaveštenje po korisniku** („3 tiketa kasne, 1 ima rok danas"), ne po tiketu.
- Bez VAPID/Resend ključeva sve tiho ćuti (postojeće ponašanje).

**Rezultat**
Dodela, komentar, završetak i oslobođena blokada stižu kao push (i email ako je uključen); dnevni cron
šalje sažetak rokova; na `/obavestenja` se svaki novi tip može zasebno ugasiti ili prebaciti na email.

> **PROMPT ZA SESIJU (T5)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (korak T5). T1–T4 su gotovi.
> Uradi SAMO T5: dodaj notifyUsers u lib/push.ts (deljeno jezgro sa notifyRoles — preference, kanal,
> dedup log, cleanup mrtvih endpointa), 5 novih tipova u lib/notifications.ts, okidače u akcijama
> tiketa i dnevni podsetnik za rok u app/api/cron/notifikacije/route.ts (jedan sažetak po korisniku).
> reference_id po tabeli iz plana. Sve best-effort — nijedna greška obaveštenja ne sme da obori akciju.
> Bez migracije. Na kraju lint + tsc + build.
> ```

---

### T6 — Auto-tiket „rizičan kupac" + veze iz ostatka aplikacije

**Cilj:** sistem sam otvara jedini dogovoreni automatski tiket i povezuje tikete sa mestima gde radiš.

**Fajlovi**
- `lib/tickets-auto.ts` — `createRiskyCustomerTicket(orderId, wooOrderId, customerName)` (`server-only`, `createAdminClient`, best-effort, idempotentno preko unique indeksa `(order_id) where source='auto_risky_customer'`)
- `app/api/webhooks/woo/route.ts` — poziv odmah uz postojeći `notifyRoles("risky_customer", …)`
- `app/(app)/porudzbine/[id]/page.tsx` — sekcija „Tiketi" (vezani tiketi + dugme „Napravi tiket za ovu porudžbinu")
- `app/(app)/katalog/[id]/page.tsx` — isto za proizvod/varijantu
- `app/(app)/page.tsx` (Dashboard) — kartica **„Moji tiketi"**: koliko kasni, koliko ima rok danas, link na `/tiketi?moji=1`

**Odluke**
- Auto-tiket: naslov „Pozovi i potvrdi porudžbinu #{woo}", opis sa istorijom otkazivanja tog kupca,
  **nedodeljen**, prioritet **Visok** (po imenu, ne UUID), tag **Poziv**, prva kolona po `sort_order`,
  `order_id` i `customer_id` popunjeni, `source='auto_risky_customer'`.
- Ako tag/prioritet ne postoji (Admin ga obrisao) → tiket se svejedno pravi, bez tog polja.
- Webhook **nikad** ne pada zbog tiketa (isti obrazac kao `syncOrderStock` / `pushWooStatus`).

**Rezultat**
Nova porudžbina rizičnog kupca automatski otvori tiket (Woo retry ne pravi duplikat); na detalju
porudžbine i proizvoda vidiš vezane tikete i praviš nov u jednom kliku; Dashboard pokazuje tvoje rokove.

> **PROMPT ZA SESIJU (T6)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (korak T6). T1–T5 su gotovi.
> Uradi SAMO T6: lib/tickets-auto.ts (auto-tiket za rizičnog kupca, best-effort, idempotentno),
> poziv u app/api/webhooks/woo/route.ts uz postojeće risky_customer obaveštenje, sekcije „Tiketi"
> na detalju porudžbine i proizvoda (lista + dugme za nov tiket sa unapred popunjenom vezom), i
> kartica „Moji tiketi" na Dashboardu.
> Ne diraj snapshot, finansije ni tok statusa. Na kraju lint + tsc + build.
> ```

---

### T7 — QA, dozvole i dokumentacija

**Cilj:** dokazati da radi i da Logistika ne vidi ništa; zapisati odluke.

**Zadaci**
- `scripts/tickets-rls-test.mjs` (ili dopuna `scripts/rls-test.mjs`) — dokaz: Logistika dobija **0 redova**
  na svih 9 ticket tabela i redirect sa `/tiketi`; Menadžer piše tikete ali **ne** config; Admin sve.
- Ručni klik-test: kreiranje → DnD → komentar → checklist → završetak → auto-sakrivanje posle 14 dana
  (privremeno pomeriti `completed_at`), filteri, mobilni tabovi, push na telefonu (samo prod build).
- Prazna stanja i poruke na srpskom sa dijakriticima; provera na 360px širine.
- `CLAUDE.md` — nova sekcija „Tiketi (kanban)" sa zaključanim odlukama iz ove tabele.
- `docs/Sportem-Plan-Tiketi.md` — označiti korake kao urađene.

**Rezultat**
`npm run rls:test` zelen, klik-test prošao, `CLAUDE.md` dopunjen, sve spojeno u `main`.

> **PROMPT ZA SESIJU (T7)**
> ```
> Pročitaj CLAUDE.md i docs/Sportem-Plan-Tiketi.md (korak T7). T1–T6 su gotovi.
> Uradi SAMO T7: RLS test za ticket tabele (Logistika 0 redova, Menadžer bez config write-a),
> provera praznih stanja i mobilnog prikaza, pa dopuni CLAUDE.md sekcijom „Tiketi (kanban)" sa
> zaključanim odlukama iz plana i označi korake u planu kao urađene.
> ```

---

## 3. Pre produkcije (čeklista)

1. `supabase db push` — migracija `20260825120000_tiketi.sql` (bez toga svi `/tiketi` upiti vraćaju prazno).
2. `npm install` na Vercelu pokupi `@dnd-kit` sam (nema novih env promenljivih).
3. Push obaveštenja rade samo u prod build-u (SW je isključen u dev-u) — testirati na telefonu.
4. Bez novih Vercel env vrednosti i bez novog cron unosa — koristi se postojeći dnevni cron.

## 4. Namerno van opsega (v1)

Ponavljajući tiketi · prilozi/fajlovi · markdown opis · vreme (sat) u roku · auto-tiketi za `needs_vp`
i nisko stanje · tvrdi WIP limit · blokiranje napretka zavisnošću · pristup za Logistiku.
Svaka od ovih stvari se može dodati kasnije bez menjanja modela iz sekcije 1.
