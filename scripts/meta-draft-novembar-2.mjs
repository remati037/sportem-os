// ============================================================================
// Sportem OS — drugi deo drafta „NOV | Novembar | Sales" (sve PAUSED)
//
// Kampanja i ad setovi su već napravljeni (meta-draft-novembar.mjs).
// Ovde: oglasi sa slikama iz sportem-consulting/kreative/, stari postovi
// koji ne mogu preko object_story_id (dinamički format) i Štitnik video.
//
//   node --env-file=.env.local scripts/meta-draft-novembar-2.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-draft-novembar-2.mjs --live   → kreira
// ============================================================================

import { readFileSync } from "node:fs";

const GRAPH = "v25.0";
const ACC = "act_1916780612251411";
const PAGE = "934741139725593";
const IG = "17841478455773533";
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");
const DIR = "/Users/marko/Desktop/Marko/sportem-consulting/kreative";
const ADSET = { A: "120252907253460136", B: "120252907253970136" };
const UTM = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const DOSTAVA = "✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana";

const IMAGE_ADS = [
  { set: "A", file: "08-samostojece-vratilo.jpg", name: "NOV | Samostojeće vratilo | bez bušenja | slika | v1",
    link: "https://sportem.rs/product/samostojece-vratilo-za-zgibove-i-propadanja/",
    title: "Samostojeće vratilo · 15.999 din", desc: "Bez montaže na zid",
    text: `Zgibovi, propadanja, trbušnjaci i sklekovi na jednoj spravi. Bez bušenja zida i plafona. 💪\n\nVratilo stoji na sopstvenoj bazi, visina se podešava od 150 do 225 cm, a zauzima manje mesta od kreveta za jednu osobu. Dobro rešenje i za podstanare.\n\n✅ 15.999 din\n${DOSTAVA}` },
  { set: "A", file: "01-podesive-5kg-par-u-sobi.jpg", name: "NOV | Podesive bučice 5kg | vaš dom | slika | v1",
    link: "https://sportem.rs/product/podesive-bucice-5kg/",
    title: "Podesive bučice 2–5 kg · 9.900 din par", desc: "Siva ili roze",
    text: `Jedan par bučica umesto četiri. 🏠\n\nSvaka bučica se podešava na 2, 3, 4 ili 5 kg za par sekundi, bez šrafova i stezaljki. Lakše za ruke i ramena, teže za leđa, grudi i noge, sve sa istim parom.\n\n✅ 9.900 din za par\n✅ Siva ili roze\n${DOSTAVA}` },
  { set: "A", file: "10-podesive-5kg-cetiri-tezine.jpg", name: "NOV | Podesive bučice 5kg | četiri težine | slika | v1",
    link: "https://sportem.rs/product/podesive-bucice-5kg/",
    title: "Jedan par. Četiri težine.", desc: "9.900 din za par",
    text: `Četiri para bučica zauzimaju pola sobe. Ovaj par zauzima mesto jednog. 🏋️\n\nDodaš ili skineš segment i bučica je 2, 3, 4 ili 5 kg. Kad vežba postane laka, pojačaš težinu i nastavljaš da napreduješ bez nove kupovine. Četvrtasti krajevi se ne kotrljaju po podu.\n\n✅ 9.900 din za par, do 10 kg ukupno\n${DOSTAVA}` },
  { set: "A", file: "03-set-3u1-muskarac.jpg", name: "NOV | Set bučica i zvona 3u1 | tvoj dom | slika | v1",
    link: "https://sportem.rs/product/set-podesivih-bucica-i-zvona/",
    title: "Bučice, šipka i zvono · od 5.990 din", desc: "Set 3u1, 20 ili 30 kg",
    text: `Bučice, šipka i zvono u jednom setu. 🔥\n\nIsti tegovi se slažu na kratke ručke, dugu šipku ili ručku za zvono, pa jednim setom radiš ruke, grudi, leđa i noge. Protivklizne ručke, a set staje u ćošak stana.\n\n✅ 20 kg: 5.990 din\n✅ 30 kg: 6.990 din\n${DOSTAVA}` },
  { set: "A", file: "09-podesive-bucice-2.jpg", name: "NOV | Podesive bučice 2 | 20 kg | slika | v1",
    link: "https://sportem.rs/product/podesive-bucice-2/",
    title: "Set 2 × 10 kg · 3.999 din", desc: "Bučice ili dvoručni teg",
    text: `20 kg tegova za kućni trening. 💪\n\nDve bučice do 10 kg svaka, ili jedan dvoručni teg do 20 kg uz spojni nastavak, za čučanj, mrtvo dizanje i potiske. Osmougaoni tegovi se ne kotrljaju po podu.\n\n✅ 3.999 din za ceo set\n${DOSTAVA}` },
  { set: "A", file: "04-set-3u1-teretana-1x1.jpg", name: "REZ | Set bučica i zvona 3u1 | ceo trening | slika | v1",
    link: "https://sportem.rs/product/set-podesivih-bucica-i-zvona/",
    title: "Ceo trening. Jedan set.", desc: "20 kg 5.990 · 30 kg 6.990 din",
    text: `Jedan set umesto tri sprave. 🏋️\n\nPodesive bučice, šipka i rusko zvono od istih tegova. Menjaš konfiguraciju za minut i radiš celo telo kod kuće.\n\n✅ 20 kg: 5.990 din\n✅ 30 kg: 6.990 din\n${DOSTAVA}` },
  { set: "B", file: "05-bosu-muskarac.jpg", name: "NOV | BOSU lopta | balans | slika | v1",
    link: "https://sportem.rs/product/bosu-lopta-46cm/",
    title: "BOSU lopta sa trakama · 4.999 din", desc: "Trake i pumpa u kompletu",
    text: `Čučanj na BOSU lopti nije isti čučanj. ⚖️\n\nNestabilna površina tera trbušnjake, leđa i stabilizatore da rade u svakoj vežbi. U kompletu dobijaš elastične trake sa ručkama i pumpu, pa na istoj lopti radiš i ruke i ramena.\n\n✅ 4.999 din, prečnik 46 cm\n✅ Plava, siva ili žuta\n${DOSTAVA}` },
  { set: "B", file: "06-bosu-mreza.jpg", name: "NOV | BOSU lopta | 4 vežbe | slika | v1",
    link: "https://sportem.rs/product/bosu-lopta-46cm/",
    title: "Jedna lopta, trening za celo telo", desc: "4.999 din, trake uključene",
    text: `Čučnjevi, plank, iskoraci i vežbe sa gumama, na jednoj lopti. 🔵\n\nBOSU lopta od 46 cm koristi se sa obe strane, a elastične trake se kače za bazu. Obične vežbe postaju zahtevnije, bez ijednog dodatnog kilograma.\n\n✅ 4.999 din, trake i pumpa uključene\n${DOSTAVA}` },
  { set: "B", file: "07-tegovi-za-noge.jpg", name: "NOV | Tegovi za noge 2 | gluteus | slika | v1",
    link: "https://sportem.rs/product/tegovi-za-noge-2/",
    title: "Tegovi za noge · od 890 din par", desc: "0,3 · 0,5 · 1 · 2 kg",
    text: `Pola kilograma na nozi i obična vežba za gluteus postaje pravi trening. 🍑\n\nHEXIT tegovi se čičak trakom kače oko zgloba, ne klize i ne žuljaju. Svaka težina ima svoju boju, pa odmah znaš koji par uzimaš.\n\n✅ 0,3 kg 890 · 0,5 kg 1.100 · 1 kg 1.390 · 2 kg 1.890 din\n✅ Par od 2 komada\n${DOSTAVA}` },
];
// Stari oglasi u dinamičkom formatu: ponovo sa istim asset_feed_spec + naš UTM.
const FEED_ADS = [
  { set: "B", from: "120241941907290136", name: "NOV | Platnene trake | Nova Kreativa | slika | v1" },
  { set: "B", from: "120240792964680136", name: "NOV | Platnene trake | ne klize | video | v1" },
];
const STORY_ADS = [
  { set: "B", name: "REZ | Štitnik za dlanove | žuljevi | video | v1", story: "122144922687219611", from: "120252753928670136" },
];

async function api(method, path, body) {
  if (method === "POST" && !live) { console.log(`DRY POST ${path}`, JSON.stringify(body).slice(0, 300)); return { id: `dry_${Math.random().toString(36).slice(2, 7)}`, images: { x: { hash: "dryhash" } } }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${TOKEN}` : ""}`, method === "GET" ? {} : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: TOKEN }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${path}: ${j.error.message} ${j.error.error_user_msg ?? ""}`);
  return j;
}
// Ponovno pokretanje preskače oglase koji već postoje u ad setu (isto ime).
const existing = new Set();
for (const id of Object.values(ADSET)) for (const a of (await api("GET", `${id}/ads?fields=name&limit=100`)).data) existing.add(a.name);
const done = (name) => { if (existing.has(name)) { console.log("već postoji:", name); return true; } return false; };
const makeAd = (set, name, creative_id) => api("POST", `${ACC}/ads`, { name, adset_id: ADSET[set], creative: { creative_id }, status: "PAUSED" });

for (const ad of IMAGE_ADS) {
  if (done(ad.name)) continue;
  const bytes = readFileSync(`${DIR}/${ad.file}`).toString("base64");
  const img = await api("POST", `${ACC}/adimages`, { bytes });
  const hash = Object.values(img.images)[0].hash;
  const cr = await api("POST", `${ACC}/adcreatives`, {
    name: ad.name,
    object_story_spec: {
      page_id: PAGE, instagram_user_id: IG,
      link_data: { image_hash: hash, link: ad.link, message: ad.text, name: ad.title, description: ad.desc,
        call_to_action: { type: "SHOP_NOW", value: { link: ad.link } } },
    },
    url_tags: UTM,
  });
  const a = await makeAd(ad.set, ad.name, cr.id);
  console.log(`oglas ${ad.set}`, a.id, ad.name);
}

const STRIP = new Set(["adlabels"]);
const clean = (v) => Array.isArray(v) ? v.map(clean) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !STRIP.has(k) && k !== "thumbnail_url").map(([k, x]) => [k, clean(x)])) : v;

for (const ad of FEED_ADS) {
  if (done(ad.name)) continue;
  const src = await api("GET", `${ad.from}?fields=creative{object_story_spec,asset_feed_spec}`);
  const feed = src.creative.asset_feed_spec;
  // Pravila po plasmanu upućuju na adlabels; bez njih Meta sama bira sliku/video po plasmanu.
  const spec = clean({ ...feed, asset_customization_rules: undefined });
  delete spec.asset_customization_rules;
  spec.link_urls = spec.link_urls?.map((l) => ({ website_url: l.website_url }));
  let cr;
  try {
    cr = await api("POST", `${ACC}/adcreatives`, {
      name: ad.name,
      object_story_spec: { page_id: PAGE, instagram_user_id: IG },
      asset_feed_spec: spec,
      url_tags: UTM,
    });
  } catch (e) {
    // Više slika/videa bez pravila po plasmanu Meta tretira kao dinamičku kreativu: uzima se prvi asset.
    console.log("asset_feed odbijen, jedan asset:", e.message.slice(0, 120));
    const link = spec.link_urls[0].website_url, cta = { type: "SHOP_NOW", value: { link } };
    const story = spec.videos?.length
      ? { video_data: { video_id: spec.videos[0].video_id, image_url: feed.videos[0].thumbnail_url, message: spec.bodies[0].text, title: spec.titles?.[0]?.text, call_to_action: cta } }
      : { link_data: { image_hash: spec.images[0].hash, link, message: spec.bodies[0].text, name: spec.titles?.[0]?.text, call_to_action: cta } };
    cr = await api("POST", `${ACC}/adcreatives`, {
      name: ad.name, object_story_spec: { page_id: PAGE, instagram_user_id: IG, ...story }, url_tags: UTM,
    });
  }
  const a = await makeAd(ad.set, ad.name, cr.id);
  console.log(`oglas ${ad.set}`, a.id, ad.name);
}

for (const ad of STORY_ADS) {
  if (done(ad.name)) continue;
  try {
    const cr = await api("POST", `${ACC}/adcreatives`, { name: ad.name, object_story_id: `${PAGE}_${ad.story}`, url_tags: UTM });
    const a = await makeAd(ad.set, ad.name, cr.id);
    console.log(`oglas ${ad.set}`, a.id, ad.name);
  } catch (e) {
    // Dinamički post: kopija postojećeg oglasa (UTM već postoji na kreativi).
    const c = await api("POST", `${ad.from}/copies`, { adset_id: ADSET[ad.set], status_option: "PAUSED", rename_options: { rename_strategy: "NO_RENAME" } });
    const id = c.copied_ad_id ?? c.ad_object_ids?.[0]?.copied_id;
    if (live) await api("POST", id, { name: ad.name });
    console.log(`oglas ${ad.set} (kopija)`, id, ad.name);
  }
}
console.log(live ? "Gotovo, sve PAUSED." : "Dry-run. Za kreiranje dodaj --live.");
