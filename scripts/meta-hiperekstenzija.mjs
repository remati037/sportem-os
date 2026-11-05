// ============================================================================
// Sportem OS — L · Hiperekstenzija (poseban set u „NOV | Novembar | Sales"), sve PAUSED.
// Zarada po komadu 2.490 RSD. Rerun-safe (preskače postojeća imena).
//   node --env-file=.env.local scripts/meta-hiperekstenzija.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-hiperekstenzija.mjs --live   → kreira
// ============================================================================
import { readFileSync } from "node:fs";
const GRAPH = "v25.0", ACC = "act_1916780612251411", CAMPAIGN = "120252907253300136";
const PAGE = "934741139725593", IG = "17841478455773533", PIXEL = "1809630962935446";
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");
const UTM = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const LINK = "https://sportem.rs/product/hexit-hiperekstenzija/";
const DIR = "/Users/marko/Desktop/Marko/sportem-consulting/kreative/hiperekstenzija";
const SET = { name: "NOV | L · Hiperekstenzija", cents: 1435 }; // 1.500 RSD
const IMAGE_ADS = [
  { file: "02-ledja-gluteus.jpg", name: "NOV | Hiperekstenzija | leđa i gluteus | slika | v1",
    title: "HEXIT hiperekstenzija · 10.990 din", desc: "Leđa i gluteus kod kuće",
    text: `Jača leđa i čvršći gluteus, bez odlaska u teretanu. 🍑\n\nHiperekstenzija je jedna od najboljih vežbi za donji deo leđa, gluteus i zadnju ložu. Visina se podešava u 7 pozicija, a nagib u 3 ugla, pa odgovara i nižima i višima.\n\n✅ 10.990 din\n✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana` },
  { file: "03-treniraj-ledja.jpg", name: "NOV | Hiperekstenzija | treniraj leđa | slika | v1",
    title: "Treniraj leđa kod kuće · 10.990 din", desc: "Sklopiva, nosivost 180 kg",
    text: `Sediš ceo dan? Leđa traže posao. 💪\n\nNekoliko serija hiperekstenzije nedeljno jača donji deo leđa, gluteus i zadnju ložu. HEXIT klupa nosi do 180 kg, a kad ne treniraš, sklopiš je i skloniš.\n\n✅ 10.990 din\n✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana` },
  { file: "01-studio.jpg", name: "NOV | Hiperekstenzija | proizvod | slika | v1",
    title: "Klupa za hiperekstenziju · 10.990 din", desc: "HEXIT, podesiva visina",
    text: `Klupa za hiperekstenziju za kućni trening. 🏋️\n\nZa donji deo leđa, gluteus i zadnju ložu. 7 pozicija visine, 3 ugla nagiba, nosivost 180 kg. Ručke služe i za propadanja, a sprava se sklapa.\n\n✅ 10.990 din\n✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana` },
];
const STORY_ADS = [];
async function api(method, path, body) {
  if (method === "POST" && !live) { console.log("DRY POST", path, JSON.stringify(body).slice(0, 300)); return { id: `dry_${Math.random().toString(36).slice(2, 6)}`, images: { x: { hash: "dry" } } }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${TOKEN}` : ""}`,
    method === "GET" ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: TOKEN }) });
  const j = await res.json();
  if (j.error) throw new Error(`${path}: ${j.error.message} ${j.error.error_user_msg ?? ""}`);
  return j;
}
const sets = (await api("GET", `${CAMPAIGN}/adsets?fields=name&limit=100`)).data;
let setId = sets.find((s) => s.name === SET.name)?.id;
if (!setId) {
  setId = (await api("POST", `${ACC}/adsets`, {
    name: SET.name, campaign_id: CAMPAIGN, daily_budget: SET.cents, billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }],
    targeting: { geo_locations: { countries: ["RS"] }, age_min: 18, targeting_automation: { advantage_audience: 1 } },
    status: "PAUSED",
  })).id;
  console.log("ad set L", setId);
} else console.log("ad set L postoji", setId);
const existing = setId.startsWith("dry_") ? [] : (await api("GET", `${setId}/ads?fields=name&limit=100`)).data.map((a) => a.name);
const makeAd = (name, creative_id) => api("POST", `${ACC}/ads`, { name, adset_id: setId, creative: { creative_id }, status: "PAUSED" });
for (const ad of IMAGE_ADS) {
  if (existing.includes(ad.name)) { console.log("postoji:", ad.name); continue; }
  const img = await api("POST", `${ACC}/adimages`, { bytes: readFileSync(`${DIR}/${ad.file}`).toString("base64") });
  const hash = Object.values(img.images)[0].hash;
  const cr = await api("POST", `${ACC}/adcreatives`, { name: ad.name, url_tags: UTM,
    object_story_spec: { page_id: PAGE, instagram_user_id: IG, link_data: { image_hash: hash, link: LINK, message: ad.text, name: ad.title, description: ad.desc, call_to_action: { type: "SHOP_NOW", value: { link: LINK } } } } });
  console.log("oglas", (await makeAd(ad.name, cr.id)).id, ad.name);
}
for (const ad of STORY_ADS) {
  if (existing.includes(ad.name)) { console.log("postoji:", ad.name); continue; }
  const cr = await api("POST", `${ACC}/adcreatives`, { name: ad.name, object_story_id: `${PAGE}_${ad.story}`, url_tags: UTM });
  console.log("oglas", (await makeAd(ad.name, cr.id)).id, ad.name);
}
console.log(live ? "Gotovo, sve PAUSED." : "Dry-run. Za kreiranje dodaj --live.");
