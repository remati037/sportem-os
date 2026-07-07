# Sportem app

Interni operativni sistem (PWA) za ecommerce sportske opreme (`sportem.rs`, WooCommerce). Jedno mesto za porudžbine, katalog/inventar, finansije (zarada, profit, marža, fakture, isplate, poštarina, keš), troškove, dashboard, low stock i push notifikacije. Zamenjuje dosadašnji Google Sheets + Make tok.

> **Kontekst i pravila projekta su u [`CLAUDE.md`](./CLAUDE.md).** Izvori istine su u [`docs/`](./docs): biznis kontekst, plan implementacije po fazama i dizajn sistem. Pročitati pre bilo kakvog rada na šemi baze ili finansijskoj logici.

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

Za lokalni razvoj baze (kasnije, Korak 0.4):

```bash
supabase start        # lokalna Postgres instanca
supabase db push      # primeni migracije iz supabase/migrations
```

## Skripte

| Komanda                | Opis                                  |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Dev server (Next.js)                  |
| `npm run build`        | Produkcioni build (type-check + lint) |
| `npm run start`        | Pokreni produkcioni build             |
| `npm run lint`         | ESLint                                |
| `npm run format`       | Prettier — formatiraj sve             |
| `npm run format:check` | Prettier — samo provera (bez izmena)  |

## Struktura foldera

```
app/                 # Next.js App Router (rute, layout, server akcije)
components/           # UI komponente (shadcn/ui + brend obrasci)
lib/                 # helperi (rsd(), num(), getUser(), requireRole(), supabase klijenti)
db/                  # tipovi/upiti vezani za bazu
supabase/migrations/ # SVE izmene šeme idu ovde (nikad kroz dashboard)
docs/                # kontekst, plan, dizajn sistem (izvori istine)
```
