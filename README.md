# Sportem app

Interni operativni sistem (PWA) za ecommerce sportske opreme (`sportem.rs`, WooCommerce). Jedno mesto za porudžbine, katalog/inventar, finansije (zarada, profit, marža, fakture, isplate, poštarina, keš), troškove, dashboard, low stock i push notifikacije. Zamenjuje dosadašnji Google Sheets + Make tok.

> **Kontekst i pravila projekta su u [`CLAUDE.md`](./CLAUDE.md)** — to je jedini izvor važećih odluka.
> Uz njega: [`docs/sportem-kontekst.md`](./docs/sportem-kontekst.md) (biznis), [`docs/Sportem-Dizajn-Sistem.md`](./docs/Sportem-Dizajn-Sistem.md) (UI),
> [`docs/sportem-brief.md`](./docs/sportem-brief.md) (sve na jednom mestu), [`docs/backlog.md`](./docs/backlog.md) (šta je otvoreno)
> i [`docs/Sportem-Plan-Izvestaji.md`](./docs/Sportem-Plan-Izvestaji.md) (živi plan: modul Izveštaji / Izvoz).
> Odrađeni planovi i stari auditi su u [`docs/arhiva/`](./docs/arhiva) — istorija, ne izvor istine.
> Pročitati pre bilo kakvog rada na šemi baze ili finansijskoj logici.

## Tehnološki stack

- **Framework:** Next.js (App Router) + TypeScript
- **Stilizacija:** Tailwind CSS v4 + shadcn/ui (brend po `docs/Sportem-Dizajn-Sistem.md`)
- **Baza + Auth + Storage:** Supabase (Postgres, Auth, Storage, RLS) — migracije preko Supabase CLI
- **Hosting + cron:** Vercel (auto-deploy sa `main`)
- **PWA:** Serwist · **PDF:** `@react-pdf/renderer` · **Monitoring:** Sentry

## Pokretanje lokalno

```bash
# 1) Instaliraj zavisnosti
npm install

# 2) Podesi okruženje — kopiraj primer i popuni vrednosti
cp .env.example .env.local

# 3) Pokreni dev server
npm run dev            # http://localhost:3000
```

### Baza (Supabase)

Radi se **na cloud instanci, bez Docker-a** — `supabase start` se ne koristi (zaključana odluka, `CLAUDE.md` §10).
Šema se menja **isključivo** kroz migracioni fajl u `supabase/migrations`, pa:

```bash
supabase db push      # primeni migracije iz supabase/migrations na cloud
```

> Nikad ručna izmena šeme kroz Supabase dashboard — lokalno i produkcija moraju ostati u sync-u.

## Skripte

| Komanda                | Opis                                  |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Dev server (Next.js)                  |
| `npm run build`        | Produkcioni build (type-check + lint) |
| `npm run start`        | Pokreni produkcioni build             |
| `npm run lint`         | ESLint                                |
| `npm run format`       | Prettier — formatiraj sve             |
| `npm run format:check` | Prettier — samo provera (bez izmena)  |
| `npm run icons`        | Regeneriši PWA ikonice (`sharp`)      |
| `npm run rls:test`     | Dokaz da RLS drži po rolama           |
| `npm run woo:test`     | Test WooCommerce webhook rute         |
| `npm run backfill`     | Backfill istorije — dry-run (odrađen) |

## Struktura foldera

```
app/                 # Next.js App Router (rute, layout, server akcije)
components/           # UI komponente (shadcn/ui + brend obrasci)
lib/                 # helperi (rsd(), num(), getUser(), requireRole(), supabase klijenti)
db/                  # tipovi/upiti vezani za bazu
scripts/             # jednokratne i pomoćne skripte (backfill, RLS test, ikonice)
supabase/migrations/ # SVE izmene šeme idu ovde (nikad kroz dashboard)
docs/                # kontekst i dizajn sistem (izvori istine)
docs/arhiva/         # odrađeni planovi i stari auditi — istorija, NE izvor istine
```
