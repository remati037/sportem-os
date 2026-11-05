// ============================================================================
// Sportem OS — nova varijanta oglasa „Podesive bučice 2" u setu A (PAUSED).
// Kreativa: sportem-consulting/kreative/11-podesive-bucice-2-dvorucni.jpg
//   node --env-file=.env.local scripts/meta-podesive2-v2.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-podesive2-v2.mjs --live   → kreira (PAUSED)
// ============================================================================
import { readFileSync } from "node:fs";
const GRAPH = "v25.0", ACC = "act_1916780612251411", PAGE = "934741139725593", IG = "17841478455773533";
const ADSET_A = "120252907253460136";
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");
const UTM = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const LINK = "https://sportem.rs/product/podesive-bucice-2/";
const AD = {
  file: "/Users/marko/Desktop/Marko/sportem-consulting/kreative/11-podesive-bucice-2-dvorucni.jpg",
  name: "NOV | Podesive bučice 2 | bučice ili dvoručni teg | slika | v2",
  title: "Bučice ili dvoručni teg · 3.999 din",
  desc: "Set 2 × 10 kg",
  text: `Jedan set, dve sprave. 🏋️\n\nDve bučice do 10 kg za ruke i ramena. Spojiš ih nastavkom i dobijaš dvoručni teg do 20 kg za čučanj, mrtvo dizanje i veslanje. Tegove skidaš i dodaješ za par sekundi, pa težinu pojačavaš kako napreduješ.\n\n✅ 3.999 din za ceo set\n✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana`,
};
async function api(method, path, body) {
  if (method === "POST" && !live) { console.log("DRY POST", path, JSON.stringify(body).slice(0, 400)); return { id: "dry", images: { x: { hash: "dry" } } }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${TOKEN}` : ""}`,
    method === "GET" ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: TOKEN }) });
  const j = await res.json();
  if (j.error) throw new Error(`${path}: ${j.error.message} ${j.error.error_user_msg ?? ""}`);
  return j;
}
const existing = (await api("GET", `${ADSET_A}/ads?fields=name&limit=200`)).data.map((a) => a.name);
if (existing.includes(AD.name)) { console.log("već postoji:", AD.name); process.exit(0); }
const img = await api("POST", `${ACC}/adimages`, { bytes: readFileSync(AD.file).toString("base64") });
const hash = Object.values(img.images)[0].hash;
const cr = await api("POST", `${ACC}/adcreatives`, {
  name: AD.name,
  object_story_spec: { page_id: PAGE, instagram_user_id: IG,
    link_data: { image_hash: hash, link: LINK, message: AD.text, name: AD.title, description: AD.desc,
      call_to_action: { type: "SHOP_NOW", value: { link: LINK } } } },
  url_tags: UTM,
});
const ad = await api("POST", `${ACC}/ads`, { name: AD.name, adset_id: ADSET_A, creative: { creative_id: cr.id }, status: "PAUSED" });
console.log(live ? `Kreirano PAUSED: ad ${ad.id}, creative ${cr.id}` : "Dry-run. Za kreiranje dodaj --live.");
