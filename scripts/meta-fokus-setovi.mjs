// ============================================================================
// Sportem OS — fokus setovi u kampanji „NOV | Novembar | Sales" (sve PAUSED)
//
// Tri nova ad seta (C, D, E), svaki sa jednim proizvodom i svojim budžetom, da
// Meta mora da troši na njih. Oglasi koriste iste kreative kao originali u A i B
// (isti post → lajkovi i komentari ostaju). Podešavanja kao set A.
// Rerun-safe: preskače ad setove i oglase koji već postoje po imenu.
//
//   node --env-file=.env.local scripts/meta-fokus-setovi.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-fokus-setovi.mjs --live   → kreira
// ============================================================================

const GRAPH = "v25.0";
const ACC = "act_1916780612251411";
const CAMPAIGN = "120252907253300136";
const PIXEL = "1809630962935446";
const RSD_PER_USD = 104.5;
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");

const usdCents = (rsd) => Math.round((rsd / RSD_PER_USD) * 100);

// creative = postojeći creative_id originalnog oglasa u A/B
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const ADSETS_ALL = [
  { key: "C", name: "NOV | C · Podesiva 24 kg", rsd: 1500, ads: [
    { name: "NOV | Podesiva bučica 2,5-24 | promena težine | video | v1", creative: "983185290892920" },
  ] },
  { key: "D", name: "NOV | D · Podesive 5 kg", rsd: 1500, ads: [
    { name: "NOV | Podesive bučice 5kg | vaš dom | slika | v1", creative: "2233004190957516" },
    { name: "NOV | Podesive bučice 5kg | četiri težine | slika | v1", creative: "3061956370813359" },
  ] },
  { key: "E", name: "NOV | E · BOSU", rsd: 1500, ads: [
    { name: "NOV | BOSU lopta | balans | slika | v1", creative: "1387853140086854" },
    { name: "NOV | BOSU lopta | 4 vežbe | slika | v1", creative: "1614821239810143" },
  ] },
  { key: "H", name: "NOV | H · Set 3u1", rsd: 1000, ads: [
    { name: "NOV | Set bučica i zvona 3u1 | tvoj dom | slika | v1", creative: "1391850597351270" },
  ] },
  // 4.11: trake u B nisu dobijale prikaze (BOSU uzima budžet) → poseban set.
  { key: "J", name: "NOV | J · Platnene trake", rsd: 1500, ads: [
    { name: "NOV | Platnene trake | gluteusi tri trake | slika | v2", creative: "4076319996011259" },
    { name: "NOV | Platnene trake | ne klize | video | v1", creative: "4289678857830148" },
    { name: "NOV | Platnene trake | Nova Kreativa | slika | v1", creative: "1378972427400805" },
  ] },
];

async function get(path, params) {
  const u = new URL(`https://graph.facebook.com/${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  const j = await (await fetch(u)).json();
  if (j.error) { console.error(`GREŠKA ${path}:`, j.error.message); process.exit(1); }
  return j.data;
}

async function post(path, body) {
  if (!live) { console.log(`DRY POST ${path}`, JSON.stringify(body)); return { id: `dry_${Math.random().toString(36).slice(2, 6)}` }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: TOKEN }),
  });
  const j = await res.json();
  if (j.error) { console.error(`GREŠKA ${path}:`, j.error.message, j.error.error_user_msg ?? ""); process.exit(1); }
  return j;
}

const existingSets = await get(`${CAMPAIGN}/adsets`, { fields: "name", limit: "100" });

const ADSETS = ONLY ? ADSETS_ALL.filter((s) => ONLY.split(",").includes(s.key)) : ADSETS_ALL;
for (const s of ADSETS) {
  let setId = existingSets.find((x) => x.name === s.name)?.id;
  if (setId) {
    console.log(`ad set ${s.key} postoji`, setId);
  } else {
    const a = await post(`${ACC}/adsets`, {
      name: s.name,
      campaign_id: CAMPAIGN,
      daily_budget: usdCents(s.rsd),
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
      attribution_spec: [
        { event_type: "CLICK_THROUGH", window_days: 7 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ],
      targeting: { geo_locations: { countries: ["RS"] }, age_min: 18, targeting_automation: { advantage_audience: 1 } },
      status: "PAUSED",
    });
    setId = a.id;
    console.log(`ad set ${s.key}`, setId, `$${usdCents(s.rsd) / 100}/dan`);
  }

  const existingAds = setId.startsWith("dry_") ? [] : await get(`${setId}/ads`, { fields: "name", limit: "100" });
  for (const ad of s.ads) {
    if (existingAds.some((x) => x.name === ad.name)) { console.log(`  oglas postoji: ${ad.name}`); continue; }
    const a = await post(`${ACC}/ads`, {
      name: ad.name,
      adset_id: setId,
      creative: { creative_id: ad.creative },
      status: "PAUSED",
    });
    console.log(`  oglas ${s.key}`, a.id, ad.name);
  }
}

console.log(live ? "Gotovo, sve PAUSED." : "Dry-run. Za kreiranje dodaj --live.");
