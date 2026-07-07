# Sportem App — Dizajn sistem i tokeni

**Tema:** Light · clean · premium · **Brend:** Sportem (premium fitnes oprema)
**Verzija:** 1.0 · **Format:** za kopiranje i A4 štampu
**Veza:** dizajn temelj za Korak 0.2 i 0.3 iz „Sportem App — Plan implementacije"

---

## 0. Smer dizajna (pre tokena)

Sportem app nije marketinški sajt — to je **interni operativni alat** za porudžbine, inventar i novac. Zato dizajn nije „atraktivan", nego **precizan i poverljiv**: svetla, mirna podloga; sadržaj (brojevi, tabele, statusi) je glavni junak; brend zelena se troši štedljivo, samo na akcijama i ključnim akcentima.

Tri principa:

1. **Svetlo i tiho.** Skoro-bela podloga, bele kartice, suptilni borderi i mek slojevite senke. Nikad teške senke ni jaka pozadina.
2. **Zelena = akcija.** Sportem zelena znači „uradi nešto" (primarno dugme, aktivni status, selektovan red). Ne boji se njom dekoracija.
3. **Brojevi su precizni.** Sve cifre (MP, VP, profit, količine, SKU) koriste **tabularne brojeve** (`tnum`) i poravnate su desno u tabelama. Ovo je potpis sistema — odgovara biznisu „precizne težine i pouzdani materijali".

> **Pre implementacije:** otvori `sportem.rs`, iz logoa/CSS-a potvrdi **tačan hex zelene** i **ime fonta**. Vrednosti ispod su pažljivo izabrani default-i koji rade odmah; ako se prava zelena/font razlikuju, zameni samo te tokene — ostatak sistema ostaje isti.

---

## 1. Boje (light tema)

### Neutralni (osnova)
Topli-hladni sivo-zeleni neutrali (blagi zeleni undertone) da se sve veže za brend, bez „bolničkog" čisto-sivog.

| Token | Hex | Upotreba |
|---|---|---|
| `paper` | `#F5F7F5` | pozadina cele aplikacije |
| `surface` | `#FFFFFF` | kartice, paneli, modali |
| `surface-2` | `#FAFBFA` | header tabele, alt redovi, uvučeni paneli |
| `ink` | `#15211B` | primarni tekst (skoro-crna, zeleni undertone) |
| `ink-soft` | `#5A6B62` | sekundarni tekst, opisi |
| `ink-faint` | `#8A988F` | placeholder, caption, disabled tekst |
| `border` | `#E4E9E5` | hairline borderi (kartice, redovi) |
| `border-strong` | `#D2DAD4` | inputi, izraženiji razdvajači |

### Brend zelena
| Token | Hex | Upotreba |
|---|---|---|
| `green` | `#1B7A45` | primarno dugme, glavni akcenat (potvrdi sa logoa) |
| `green-deep` | `#145C34` | hover/active na zelenom, naglašeni naslovi |
| `green-bright` | `#2E9E5B` | mali highlight, sparkline, ikonice na svetlom |
| `green-soft` | `#E7F2EB` | tint pozadina, selektovan red, suptilni bedž |
| `green-ring` | `rgba(27,122,69,0.20)` | focus prsten |

### Statusne boje (mekane, premium — ne „bombona")
Svaka ima jaku (tekst/ikona) i soft (pozadina bedža) varijantu.

| Namena | Jaka | Soft |
|---|---|---|
| `info` — Kreirano / neutralno | `#3D6B8C` | `#E9EFF4` |
| `sent` — Poslato | `#0E7C86` | `#E1F1F2` |
| `success` — Isporučeno / Uplaćeno / Keš | `#1B7A45` | `#E7F2EB` |
| `warning` — Treba VP / Neuplaćeno / Low stock | `#A86A12` | `#FBF1DD` |
| `danger` — Otkazano / Vraćeno / minus | `#B23B30` | `#FBEAE8` |

**Finansijske cifre:** profit/plus → `success`; gubitak/minus saldo → `danger`; neutralan iznos → `ink`.

---

## 2. Tipografija

- **UI font (default):** **Geist** — čist, tehnički, premium; savršeno leže uz Next.js/Vercel. Težine 400/500/600/700.
  *Alternativa ako želiš topliji ton:* Hanken Grotesk ili Manrope. *Ako želiš 1:1 sa sajtom:* zameni font onim sa `sportem.rs`.
- **Brojevi / SKU / ID (mono):** **Geist Mono** — za SKU, broj porudžbine, fakture; daje „precizni" osećaj.
- **Tabularni brojevi:** na svim numeričkim ćelijama uključi `font-feature-settings: "tnum" 1;` (cifre se poravnaju u kolonama).

### Skala (rem, 16px baza)
| Rola | Veličina | Težina | Napomena |
|---|---|---|---|
| `display` (veliki dashboard broj) | 2.25rem / 36px | 700 | tnum, line-height 1.1 |
| `h1` | 1.75rem / 28px | 700 | |
| `h2` | 1.375rem / 22px | 600 | |
| `h3` | 1.125rem / 18px | 600 | |
| `body` | 0.9375rem / 15px | 400 | osnovni tekst/tabele |
| `label` | 0.8125rem / 13px | 500 | labele formi |
| `caption` | 0.75rem / 12px | 500 | pomoćni tekst |
| `eyebrow` | 0.6875rem / 11px | 600 | UPPERCASE, letter-spacing 0.08em, `ink-faint` |

---

## 3. Razmaci, radijusi, senke, borderi

**Spacing skala (4px baza):** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

**Radijusi:**
| Token | Vrednost | Upotreba |
|---|---|---|
| `radius-sm` | 8px | bedževi, mali tagovi |
| `radius-md` | 12px | dugmad, inputi |
| `radius-lg` | 16px | kartice |
| `radius-xl` | 20px | modali, veliki paneli |
| `radius-pill` | 999px | pill dugmad, status pilule |

**Senke (mek, slojevit, zeleno-crni ton — ne sivi):**
| Token | Vrednost |
|---|---|
| `shadow-soft` | `0 1px 2px rgba(21,33,27,.04), 0 2px 8px rgba(21,33,27,.05)` |
| `shadow-card` | `0 1px 3px rgba(21,33,27,.05), 0 6px 18px rgba(21,33,27,.06)` |
| `shadow-lift` | `0 6px 16px rgba(21,33,27,.08), 0 16px 36px rgba(21,33,27,.10)` |
| `shadow-focus` | `0 0 0 3px rgba(27,122,69,.20)` |

**Borderi:** podrazumevano `1px solid border`; inputi `1px solid border-strong`; na fokusu border → `green` + `shadow-focus`.

---

## 4. Komponente (specifikacija)

### Dugmad
Visine: `sm 32px`, `md 40px` (default), `lg 48px`. Radijus `radius-md` (ili `radius-pill` za primarne CTA). Tranzicija 150ms.

| Varijanta | Pozadina | Tekst | Border | Hover |
|---|---|---|---|---|
| `btn-primary` | `green` | `#fff` | — | `green-deep` + `shadow-lift` |
| `btn-dark` | `ink` | `paper` | — | osvetli ink ~8% |
| `btn-ghost` | `surface` | `ink` | `1px border` | `surface-2` + `border-strong` |
| `btn-subtle` | `green-soft` | `green-deep` | — | tamniji tint |
| `btn-danger` | `surface` | `danger` jaka | `1px danger` | `danger` soft pozadina |

Disabled: `ink-faint` tekst, `surface-2` pozadina, bez senke, `cursor: not-allowed`.

### Kartica
`surface` pozadina, `1px border`, `radius-lg`, `shadow-soft`, padding 20–24px. Hover (ako je klikabilna) → `shadow-card`.

### Stat kartica (dashboard)
Eyebrow labela (npr. „NETO PROFIT") + veliki `display` broj (tnum) + delta ispod (`success`/`danger` sa strelicom). Tanak zeleni akcenat levo opcioni.

### Input / Select
Visina 40px, `surface`, `1px border-strong`, `radius-md`, padding 0 12px. Fokus → border `green` + `shadow-focus`. Greška → border `danger` + caption `danger`. Labela `label` iznad, pomoćni tekst `caption ink-faint`.

### Tabela (porudžbine / katalog / finansije)
- Header red: `surface-2`, tekst `eyebrow`, sticky na skrolu.
- Redovi: `1px border` razdvajač, hover → `green-soft`.
- **Numeričke kolone (MP, VP, profit, količina, iznos):** desno poravnate, mono/tnum.
- Selektovan red (npr. označen za slanje): leva zelena traka 3px + `green-soft` pozadina.
- Prazno stanje: kratka poruka + primarna akcija (npr. „Nema porudžbina za ovaj period. Dodaj ručnu prodaju.").

### Status pilula / bedž
`radius-pill`, soft pozadina + jaka boja teksta, `caption` veličina, 2–10px padding. Mapiranje boja po statusu iz tabele u sekciji 1.

### Navigacija
Sidebar (desktop) / bottom nav (mobilni), `surface`, `1px border` razdvajač. Aktivna stavka: `green-soft` pozadina + `green-deep` tekst + leva zelena traka. **Stavke se filtriraju po roli** (Logistika vidi samo Katalog/Stanje).

---

## 5. Tokeni kao kod

### 5.1 CSS varijable — `globals.css`
```css
:root {
  /* neutralni */
  --paper: #F5F7F5;
  --surface: #FFFFFF;
  --surface-2: #FAFBFA;
  --ink: #15211B;
  --ink-soft: #5A6B62;
  --ink-faint: #8A988F;
  --border: #E4E9E5;
  --border-strong: #D2DAD4;

  /* brend zelena */
  --green: #1B7A45;
  --green-deep: #145C34;
  --green-bright: #2E9E5B;
  --green-soft: #E7F2EB;
  --green-ring: rgba(27,122,69,.20);

  /* statusi (jaka / soft) */
  --info: #3D6B8C;        --info-soft: #E9EFF4;
  --sent: #0E7C86;        --sent-soft: #E1F1F2;
  --success: #1B7A45;     --success-soft: #E7F2EB;
  --warning: #A86A12;     --warning-soft: #FBF1DD;
  --danger: #B23B30;      --danger-soft: #FBEAE8;

  /* radijusi */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  /* senke */
  --shadow-soft: 0 1px 2px rgba(21,33,27,.04), 0 2px 8px rgba(21,33,27,.05);
  --shadow-card: 0 1px 3px rgba(21,33,27,.05), 0 6px 18px rgba(21,33,27,.06);
  --shadow-lift: 0 6px 16px rgba(21,33,27,.08), 0 16px 36px rgba(21,33,27,.10);
  --shadow-focus: 0 0 0 3px var(--green-ring);
}
```

### 5.2 Tailwind config — `tailwind.config.ts`
```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        ink: { DEFAULT: "var(--ink)", soft: "var(--ink-soft)", faint: "var(--ink-faint)" },
        border: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        green: {
          DEFAULT: "var(--green)", deep: "var(--green-deep)",
          bright: "var(--green-bright)", soft: "var(--green-soft)",
        },
        info:    { DEFAULT: "var(--info)",    soft: "var(--info-soft)" },
        sent:    { DEFAULT: "var(--sent)",    soft: "var(--sent-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger:  { DEFAULT: "var(--danger)",  soft: "var(--danger-soft)" },
      },
      borderRadius: {
        sm: "var(--radius-sm)", md: "var(--radius-md)",
        lg: "var(--radius-lg)", xl: "var(--radius-xl)", pill: "var(--radius-pill)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)", card: "var(--shadow-card)",
        lift: "var(--shadow-lift)", focus: "var(--shadow-focus)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 5.3 Font (Next.js) — `app/layout.tsx`
```ts
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

// na <html>: className={`${GeistSans.variable} ${GeistMono.variable}`}
// body: font-sans, bg-paper, text-ink
```

### 5.4 Bazne klase — `globals.css` (`@layer components`)
```css
@layer base {
  body { background: var(--paper); color: var(--ink); }
  /* tabularni brojevi za sve cifre u tabelama i statima */
  .num, td.num, .stat-value { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
}

@layer components {
  .eyebrow { font-size: .6875rem; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--ink-faint); }

  .card { background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); box-shadow: var(--shadow-soft); padding: 1.25rem; }

  /* dugmad */
  .btn { display: inline-flex; align-items: center; justify-content: center;
    height: 40px; padding: 0 16px; border-radius: var(--radius-md);
    font-weight: 600; font-size: .9375rem; transition: all .15s ease; }
  .btn-primary { background: var(--green); color: #fff; box-shadow: var(--shadow-soft); }
  .btn-primary:hover { background: var(--green-deep); box-shadow: var(--shadow-lift); }
  .btn-dark { background: var(--ink); color: var(--paper); }
  .btn-ghost { background: var(--surface); color: var(--ink); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--surface-2); border-color: var(--border-strong); }
  .btn-subtle { background: var(--green-soft); color: var(--green-deep); }
  .btn:disabled { background: var(--surface-2); color: var(--ink-faint);
    box-shadow: none; cursor: not-allowed; }

  /* input */
  .input { height: 40px; width: 100%; padding: 0 12px; background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: var(--radius-md);
    color: var(--ink); }
  .input:focus { outline: none; border-color: var(--green); box-shadow: var(--shadow-focus); }
  .input::placeholder { color: var(--ink-faint); }

  /* status pilula — boju setuje modifikator (.is-success itd.) */
  .pill { display: inline-flex; align-items: center; gap: 6px; height: 24px;
    padding: 0 10px; border-radius: var(--radius-pill); font-size: .75rem; font-weight: 600; }
  .pill.is-info    { background: var(--info-soft);    color: var(--info); }
  .pill.is-sent    { background: var(--sent-soft);    color: var(--sent); }
  .pill.is-success { background: var(--success-soft); color: var(--success); }
  .pill.is-warning { background: var(--warning-soft); color: var(--warning); }
  .pill.is-danger  { background: var(--danger-soft);  color: var(--danger); }
}
```

### 5.5 shadcn/ui mapiranje (HSL tema)
shadcn koristi semantičke varijable; mapiraj ih na Sportem tokene (HSL ekvivalenti istih hex vrednosti):
```css
:root {
  --background: 130 14% 96%;     /* paper */
  --foreground: 150 22% 11%;     /* ink */
  --card: 0 0% 100%;             /* surface */
  --card-foreground: 150 22% 11%;
  --primary: 146 64% 29%;        /* green */
  --primary-foreground: 0 0% 100%;
  --secondary: 140 25% 93%;      /* green-soft */
  --secondary-foreground: 147 62% 22%;  /* green-deep */
  --muted: 140 14% 98%;          /* surface-2 */
  --muted-foreground: 153 9% 38%; /* ink-soft */
  --border: 140 12% 90%;         /* border */
  --input: 140 12% 84%;          /* border-strong */
  --ring: 146 64% 29%;           /* green */
  --destructive: 5 57% 44%;      /* danger */
  --radius: 0.75rem;             /* 12px baza */
}
```

---

## 6. Mapiranje statusa na pilule

| Status porudžbine | Klasa | | Stanje plaćanja | Klasa |
|---|---|---|---|---|
| Kreirano | `is-info` | | Uplaćeno | `is-success` |
| Poslato | `is-sent` | | Neuplaćeno | `is-warning` |
| Isporučeno | `is-success` | | Keš / Isplaćeno | `is-success` |
| Otkazano / Vraćeno | `is-danger` | | Treba VP | `is-warning` |

**Stanje zaliha:** Na stanju → `is-success`; Pri kraju (≤ prag) → `is-warning`; Nema → `is-danger`.

---

## 7. Format brojeva i valute

Sve cifre kroz jedan helper, srpski locale, RSD:
```ts
export const rsd = (n: number) =>
  new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD",
    maximumFractionDigits: 0 }).format(n); // → "12.500 RSD"

export const num = (n: number) =>
  new Intl.NumberFormat("sr-RS").format(n);
```
Iznosi i količine uvek `.num` klasa (tnum) + desno poravnati u tabelama.

---

## 8. Pristupačnost i ponašanje (quality floor)

- **Kontrast:** `ink` na `paper`/`surface` i bela na `green` zadovoljavaju WCAG AA. Ne koristiti `ink-faint` za važan tekst.
- **Fokus:** uvek vidljiv `shadow-focus` prsten (tastatura).
- **Reduced motion:** `@media (prefers-reduced-motion)` gasi tranzicije/animacije.
- **Touch mete:** min 40px visina za dugmad/redove na mobilnom (brat radi sa telefona).
- **Stanja:** svaka lista ima loading skeleton, prazno stanje sa akcijom, i jasnu grešku (šta se desilo + kako dalje), u glasu interfejsa.

---

## 9. Rola → vidljivost (dizajn strana)

Finansije su tehnički skrivene RLS-om (Korak 0.5), ali i UI to poštuje:

- **Admin / Menadžer:** vide sve — MP, VP, profit, finansijske kartice, fakture.
- **Logistika (drug):** vidi **samo** katalog i stanje. Sve finansijske cifre (MP/VP/profit/iznosi) se **ne renderuju** (ne „blur", nego ih nema), kolone se izostave. Vidi: naziv, SKU, slika, stanje, low stock bedž.

---

*Kraj dokumenta — Sportem Dizajn sistem v1.0*