// ============================================================================
// Sportem OS — paketi i HEXIT podesiva klupa u kampanji „NOV | Novembar | Sales" (sve PAUSED)
//
// F · Paketi kućni (3.500 RSD/dan): opšta kreativa → /paketi/ + 7 paketa za kućni trening.
// G · Paketi teretana (1.500 RSD/dan): 5 skupih setova (olimpijski, powerlifting, benč, CrossFit, Hyrox).
// HEXIT podesiva klupa: 2 oglasa u postojećem setu A.
// Slike: sportem-consulting/kreative/paketi/1..15.jpg. Podešavanja ad setova kao C/D/E.
// Rerun-safe: preskače ad setove i oglase koji već postoje po imenu.
//
//   node --env-file=.env.local scripts/meta-paketi.mjs          → dry-run
//   node --env-file=.env.local scripts/meta-paketi.mjs --live   → kreira
// ============================================================================

import { readFileSync } from "node:fs";

const GRAPH = "v25.0";
const ACC = "act_1916780612251411";
const CAMPAIGN = "120252907253300136";
const PIXEL = "1809630962935446";
const PAGE = "934741139725593";
const IG = "17841478455773533";
const SET_A = "120252907253460136";
const RSD_PER_USD = 104.5;
const TOKEN = process.env.META_ADS_MANAGE_TOKEN;
if (!TOKEN) { console.error("Nedostaje META_ADS_MANAGE_TOKEN."); process.exit(2); }
const live = process.argv.includes("--live");
const DIR = "/Users/marko/Desktop/Marko/sportem-consulting/kreative/paketi";
const UTM = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const DOSTAVA = "✅ Plaćanje pouzećem\n✅ Dostava za 2 do 3 radna dana";
const P = "https://sportem.rs/paketi/";
const usdCents = (rsd) => Math.round((rsd / RSD_PER_USD) * 100);

const ADSETS = [
  { key: "F", name: "NOV | F · Paketi kućni", rsd: 3500, ads: [
    { file: "1.jpg", name: "NOV | Paketi | novembarska akcija | slika | v1", link: P,
      title: "Fitnes paketi · poklon uz svaki", desc: "12 paketa, akcija traje do 30.11.",
      text: `Novembarska akcija: fitnes paketi sa poklonom uz svaki paket. 🎁\n\nOd kućnog startera i Booty paketa do kompletne kućne teretane i olimpijskog seta. Izabereš paket, složiš ga po svojoj meri i poklon stiže uz porudžbinu.\n\n✅ 12 paketa, od 4.380 din\n✅ Pokloni važe do 30.11.\n${DOSTAVA}` },
    { file: "2.jpg", name: "NOV | Kućni starter paket | prvi treninzi | slika | v1", link: `${P}kucni-starter-paket/`,
      title: "Kućni starter paket · 4.380 din", desc: "Gratis e-book sa vežbama",
      text: `Sve za prve treninge kod kuće u jednom paketu. 🏠\n\nNBR prostirka, platnene trake u tri jačine i vinil bučice. Uz paket dobijaš e-book „Trening kod kuće uz trake i bučice" sa gotovim programom.\n\n✅ 4.380 din za ceo paket\n${DOSTAVA}` },
    { file: "3.jpg", name: "NOV | HEX starter paket | jednostavno | slika | v1", link: `${P}hex-starter-paket/`,
      title: "HEX starter paket · od 4.580 din", desc: "Gratis e-book sa vežbama",
      text: `Prostirka, HEX bučice i trake: kućni trening bez komplikacija. 💪\n\nGumirane HEX bučice se ne kotrljaju po podu, platnene trake ne klize, a prostirka štiti i pod i kolena. Uz paket stiže e-book sa programom vežbi.\n\n✅ Od 4.580 din\n${DOSTAVA}` },
    { file: "4.jpg", name: "NOV | Booty paket | gluteus i noge | slika | v1", link: `${P}booty-paket/`,
      title: "Booty paket · od 7.760 din", desc: "Gratis plan treninga za gluteus",
      text: `Sve za čvrst gluteus i snažne noge, na jednom mestu. 🍑\n\nPlatnene trake u tri jačine, tegovi za noge, steper i NBR prostirka. Uz paket dobijaš e-book „Plan treninga za gluteus i noge" sa gotovim programom za 4 nedelje.\n\n✅ Od 7.760 din\n${DOSTAVA}` },
    { file: "5.jpg", name: "NOV | Kućni kardio paket | kondicija | slika | v1", link: `${P}kucni-kardio-paket/`,
      title: "Kućni kardio paket · od 4.550 din", desc: "Gratis e-book sa vežbama",
      text: `Kondicija i kardio kod kuće, bez trake za trčanje. 🔥\n\nRusko zvono i HEXIT steper pokrivaju i snagu i sagorevanje. Uz paket stiže e-book „Trening sa zvonom i steperom" sa programom za 4 nedelje.\n\n✅ Od 4.550 din\n${DOSTAVA}` },
    { file: "6.jpg", name: "NOV | Joga i pilates paket | osnovne vežbe | slika | v1", link: `${P}joga-pilates-paket/`,
      title: "Joga i pilates paket · od 7.180 din", desc: "Gratis e-book sa vežbama",
      text: `Kompletna oprema za jogu i pilates kod kuće. 🧘\n\nPU prostirka, joga blok, pilates prsten i pilates trake. Uz paket dobijaš e-book „Osnovne vežbe za jogu i pilates", pa znaš odakle da kreneš.\n\n✅ Od 7.180 din\n${DOSTAVA}` },
    { file: "7.jpg", name: "NOV | Kućna teretana paket | klupa i bučice | slika | v1", link: `${P}kucna-teretana-paket/`,
      title: "Kućna teretana · od 10.690 din", desc: "Klupa + bučice po izboru",
      text: `HEXIT podesiva klupa i bučice: kompletna kućna teretana. 🏋️\n\nUz klupu biraš podesive bučice 2,5–24 kg ili HEX bučice željene kilaže. Uz paket stiže plan treninga za celo telo.\n\n✅ Od 10.690 din\n${DOSTAVA}` },
    { file: "13.jpg", name: "NOV | Street workout paket | vratilo | slika | v1", link: `${P}street-workout-paket/`,
      title: "Street workout paket · od 18.739 din", desc: "Gratis magnezijum kreda",
      text: `Zgibovi i propadanja kod kuće, bez bušenja zida. 💪\n\nSamostojeće vratilo, power band gume i opterećenje po izboru: prsluk ili pojas sa tegovima. Gratis magnezijum kreda uz paket.\n\n✅ Od 18.739 din\n${DOSTAVA}` },
  ] },
  { key: "G", name: "NOV | G · Paketi teretana", rsd: 1500, ads: [
    { file: "8.jpg", name: "NOV | HEXIT olimpijski set | 105 kg | slika | v1", link: `${P}hexit-olimpijski-set/`,
      title: "Olimpijski set 105 kg · 50.460 din", desc: "Gratis flip lock osigurači",
      text: `Olimpijska šipka od 180 cm i 105 kg gumiranih tegova. 🏋️\n\nSet za ozbiljan trening kod kuće ili u garaži. Gratis uz paket: flip lock osigurači i magnezijum kreda.\n\n✅ 50.460 din\n${DOSTAVA}` },
    { file: "9.jpg", name: "NOV | HEXIT powerlifting set | half rack | slika | v1", link: `${P}hexit-powerlifting-set/`,
      title: "Powerlifting set · 126.420 din", desc: "Half rack, šipka i 100 kg bampera",
      text: `Half rack, olimpijska šipka od 220 cm i 100 kg bamper tegova. 🔩\n\nSve za čučanj, benč i mrtvo dizanje kod kuće. Gratis flip lock osigurači i magnezijum kreda, a set možeš da dopuniš kombinovanom benč klupom.\n\n✅ 126.420 din\n${DOSTAVA}` },
    { file: "10.jpg", name: "NOV | Prenosivi benč set | benč | slika | v1", link: `${P}prenosivi-benc-set/`,
      title: "Prenosivi benč set · 69.850 din", desc: "Gratis flip lock osigurači",
      text: `Kompletan set za benč kod kuće. 🏋️\n\nRavna klupa, prenosivi stalak, olimpijska šipka od 180 cm i 105 kg gumiranih tegova. Gratis flip lock osigurači.\n\n✅ 69.850 din\n${DOSTAVA}` },
    { file: "11.jpg", name: "NOV | CrossFit paket | funkcionalni | slika | v1", link: `${P}crossfit-paket/`,
      title: "CrossFit paket · 20.740 din", desc: "Gratis vijača i magnezijum kreda",
      text: `Kompletna oprema za funkcionalni trening. ⚡\n\nAntislip pliometrijska kutija, battle rope, čelična ruska zvona i wall ball ili slam ball po izboru. Gratis aluminijumska vijača i magnezijum kreda.\n\n✅ 20.740 din\n${DOSTAVA}` },
    { file: "12.jpg", name: "NOV | Hyrox paket | ski erg i rower | slika | v1", link: `${P}hybrid-trening-paket/`,
      title: "Hyrox paket · 130.750 din", desc: "Besplatna dostava + kreda",
      text: `Kompletna oprema za Hyrox trening. 🏁\n\nSki erg, air rower, battle rope, wall ball, fitnes vreće i čelična zvona. Besplatna dostava i gratis magnezijum kreda.\n\n✅ 130.750 din\n✅ Plaćanje pouzećem` },
  ] },
  { key: "A", existing: SET_A, ads: [
    { file: "14.jpg", name: "NOV | HEXIT podesiva klupa | naslon | slika | v1", link: "https://sportem.rs/product/hexit-podesiva-klupa/",
      title: "HEXIT podesiva klupa", desc: "Podesiv naslon i sedište",
      text: `Jedna klupa za ravan i kosi benč. 🏋️\n\nNaslon se podešava prema vežbi, a valjci drže noge kod trbušnjaka. Uz bučice dobijaš kompletan trening gornjeg dela tela kod kuće.\n\n${DOSTAVA}` },
    { file: "15.jpg", name: "NOV | HEXIT podesiva klupa | nagib | slika | v1", link: "https://sportem.rs/product/hexit-podesiva-klupa/",
      title: "HEXIT podesiva klupa", desc: "Za trening kod kuće",
      text: `Jedna klupa, više vežbi. 💪\n\nMenjaš nagib naslona za par sekundi i radiš grudi, ramena, ruke i trbušnjake na istoj klupi.\n\n${DOSTAVA}` },
  ] },
];

async function api(method, path, body) {
  if (method === "POST" && !live) { console.log(`DRY POST ${path}`, JSON.stringify(body).slice(0, 200)); return { id: `dry_${Math.random().toString(36).slice(2, 7)}`, images: { x: { hash: "dryhash" } } }; }
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${TOKEN}` : ""}`, method === "GET" ? {} : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: TOKEN }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${path}: ${j.error.message} ${j.error.error_user_msg ?? ""}`);
  return j;
}

const existingSets = (await api("GET", `${CAMPAIGN}/adsets?fields=name&limit=100`)).data;

for (const s of ADSETS) {
  let setId = s.existing ?? existingSets.find((x) => x.name === s.name)?.id;
  if (setId) {
    console.log(`ad set ${s.key} postoji`, setId);
  } else {
    const a = await api("POST", `${ACC}/adsets`, {
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

  const existingAds = setId.startsWith("dry_") ? [] : (await api("GET", `${setId}/ads?fields=name&limit=100`)).data;
  for (const ad of s.ads) {
    if (existingAds.some((x) => x.name === ad.name)) { console.log(`  oglas postoji: ${ad.name}`); continue; }
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
    const a = await api("POST", `${ACC}/ads`, { name: ad.name, adset_id: setId, creative: { creative_id: cr.id }, status: "PAUSED" });
    console.log(`  oglas ${s.key}`, a.id, ad.name);
  }
}

console.log(live ? "Gotovo, sve PAUSED." : "Dry-run. Za kreiranje dodaj --live.");
