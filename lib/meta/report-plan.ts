/*
 * Plan i pravila za dnevni Telegram izveštaj o reklamama.
 *
 * Ovo je JEDINO mesto odakle AI deo izveštaja zna „kakav je plan". Kad se plan
 * promeni (novi ad set, nova pravila, datumi), menja se ovaj tekst i deploy-uje.
 * Cifre u izveštaju NE dolaze odavde — samo iz Meta API-ja i Supabase-a.
 */

export const REPORT_PLAN = `
Ekonomija (Supabase, avg–okt 2026):
- Break-even CPA ~1.200 RSD po realizovanoj porudžbini sa oglasa (zarada MP−VP posle ~14% otkaza/povrata i poštarine povrata).
- Ciljni CPA ≤ 900 RSD. CPA = potrošnja / realizovane porudžbine sa sajta pripisane oglasu (UTM), ne Meta „kupovine".

Kampanja „NOV | Novembar | Sales" (ABO, optimizacija na Purchase, 7d klik / 1d pregled):
- A · Kućna teretana 5.000 RSD/dan — nose je Podesive bučice 2 i Samostojeće vratilo. HEXIT podesiva klupa ×2 dodata 3.11.
- B · Fitnes i oblikovanje 1.000 RSD/dan — BOSU balans + Platnene trake „gluteusi tri trake" v2 (od 3.11).
- C · Podesiva 24 kg 1.500 RSD/dan — test; pauza ako bez porudžbine posle ~3.000 RSD (zarada po komadu ~3.100).
- F · Paketi kućni 3.500 RSD/dan i G · Paketi teretana 1.500 RSD/dan — uključeni 3.11, prva 72h bez izmena (do 6.11 uveče).
- D (Podesive 5 kg) i E (BOSU) pauzirani 3.11 — potrošili limit bez porudžbine.

Zarada po paketu (MP−VP, bez poklona): Kućni starter ~1.770, HEX starter ~1.740, Booty ~3.270, Kardio ~1.410, Joga ~2.200,
Kućna teretana ~5.590, Street workout ~6.400, CrossFit ~3.800, Hyrox ~22.900; olimpijski/powerlifting/benč — VP nepouzdan.
Pokloni uz pakete važe 1–30.11.

Pravila odlučivanja:
- Prvih 72h posle uključivanja oglasa/ad seta — bez izmena.
- Oglas bez ijedne porudžbine posle potrošnje ≥ 2× očekivane zarade po porudžbini → predložiti pauzu.
- Ad set sa CPA < 900 tri+ dana → predložiti budžet +20% (najviše jednom u 2–3 dana).
- CPA 900–1.200 → držati, dodati nove kreative. CPA > 1.200 → smanjiti/pauzirati, ali prvo proveriti tracking (Meta kupovine vs porudžbine sa sajta).
- Oglas kog Meta ne prikazuje (0 impresija 2+ dana) → zameniti kreativom.
- 2–3 nove kreative nedeljno. Crni petak 27.11 — kreative spremne do 20.11, fokus na paketima.
- Ništa se u Meta nalogu ne menja bez potvrde vlasnika; izveštaj samo predlaže.
`.trim();
