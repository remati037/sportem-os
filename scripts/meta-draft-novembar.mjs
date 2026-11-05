// ============================================================================
// Sportem OS — draft kampanje „NOV | Novembar | Sales" (sve PAUSED)
//
// Pravi kampanju (ABO), dva ad seta i oglase iz postojećih postova.
// Oglasi sa novim slikama se dodaju posebno, kad slike budu u folderu.
//
//   node --env-file=.env.local scripts/meta-draft-novembar.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-draft-novembar.mjs --live   → kreira
// ============================================================================

import { writeFileSync } from "node:fs";

const GRAPH = "v25.0";
const ACC = "act_1916780612251411";
const PIXEL = "1809630962935446";
const PAGE = "934741139725593";
const RSD_PER_USD = 104.5;
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");
const OUT = process.argv[process.argv.indexOf("--out") + 1];

const UTM = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const usdCents = (rsd) => Math.round((rsd / RSD_PER_USD) * 100);

const ADSETS = [
  { key: "A", name: "NOV | A · Kućna teretana", rsd: 5000 },
  { key: "B", name: "NOV | B · Fitnes i oblikovanje", rsd: 2000 },
];
// Postojeći postovi (zadržavaju lajkove i komentare). REZ = rezerva, ne uključivati 1.11.
const POST_ADS = [
  { set: "A", name: "NOV | Podesiva bučica 2,5-24 | promena težine | video | v1", story: "122144922813219611" },
  { set: "A", name: "REZ | Prsluk | 10 i 20 kg cene | stari post | v1", story: "122139783591219611" },
  { set: "A", name: "REZ | Gumirani tegovi | od 490 | stari post | v1", story: "122132302701219611" },
  { set: "B", name: "NOV | Platnene trake | Nova Kreativa | stari post | v1", story: "122115716943219611" },
  { set: "B", name: "NOV | Platnene trake | ne klize | stari post | v1", story: "122109993261219611" },
  { set: "B", name: "REZ | Štitnik za dlanove | žuljevi | video | v1", story: "122144922687219611" },
];

async function post(path, body) {
  if (!live) { console.log(`DRY POST ${path}`, JSON.stringify(body)); return { id: `dry_${path.split("/").pop()}_${Math.random().toString(36).slice(2, 6)}` }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: TOKEN }),
  });
  const j = await res.json();
  if (j.error) { console.error(`GREŠKA ${path}:`, j.error.message, j.error.error_user_msg ?? ""); process.exit(1); }
  return j;
}

const result = { campaign: null, adsets: {}, ads: [] };
const camp = await post(`${ACC}/campaigns`, {
  name: "NOV | Novembar | Sales",
  objective: "OUTCOME_SALES",
  buying_type: "AUCTION",
  special_ad_categories: [],
  is_adset_budget_sharing_enabled: false,
  status: "PAUSED",
});
result.campaign = camp.id;
console.log("kampanja", camp.id);

for (const s of ADSETS) {
  const a = await post(`${ACC}/adsets`, {
    name: s.name,
    campaign_id: camp.id,
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
  result.adsets[s.key] = a.id;
  console.log(`ad set ${s.key}`, a.id, `$${usdCents(s.rsd) / 100}/dan`);
}

for (const ad of POST_ADS) {
  const cr = await post(`${ACC}/adcreatives`, {
    name: ad.name,
    object_story_id: `${PAGE}_${ad.story}`,
    url_tags: UTM,
  });
  const a = await post(`${ACC}/ads`, {
    name: ad.name,
    adset_id: result.adsets[ad.set],
    creative: { creative_id: cr.id },
    status: "PAUSED",
  });
  result.ads.push({ ...ad, creative: cr.id, ad: a.id });
  console.log(`oglas ${ad.set}`, a.id, ad.name);
}

if (live && OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(live ? "Gotovo, sve PAUSED." : "Dry-run. Za kreiranje dodaj --live.");
