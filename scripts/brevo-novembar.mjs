// ============================================================================
// Sportem OS — Brevo: novembarska kampanja postojećim kupcima
//
// Ne šalje ništa kupcima. Koraci (rerun-safe, traži postojeće po imenu):
//   setup   atributi SEGMENT/PORUDZBINE/POSLEDNJA, folder i liste po segmentima,
//           uvoz segmenata iz CSV-a (samo dopuna atributa postojećih kontakata)
//   e1      nacrti kampanja E1 (4 segmenta) iz novembar/email/out, bez zakazivanja
//   test    probni mejl za jednu kampanju na zadatu adresu
//
//   node --env-file=.env.local scripts/brevo-novembar.mjs setup
//   node --env-file=.env.local scripts/brevo-novembar.mjs e1
//   node --env-file=.env.local scripts/brevo-novembar.mjs test <campaignId> <email>
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.BREVO_API_KEY;
if (!KEY) {
  console.error("Nedostaje BREVO_API_KEY u .env.local.");
  process.exit(2);
}
const EMAIL_DIR = "/Users/marko/Desktop/Marko/sportem-consulting/novembar/email";
const FOLDER = "Novembar 2026";
const SENDER = { name: "Sportem", email: "podrska@sportem.rs" };
const SEGMENTS = ["A", "B", "C", "D"];
const listName = (s) => `Kupci – segment ${s}`;
const ALL_LIST = "Kupci – svi (novembar)";

async function api(method, path, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers: { "api-key": KEY, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message ?? text}`);
  return json;
}

async function setup() {
  const { attributes } = await api("GET", "/contacts/attributes");
  const have = new Set(attributes.filter((a) => a.category === "normal").map((a) => a.name));
  for (const [name, type] of [["SEGMENT", "text"], ["PORUDZBINE", "float"], ["POSLEDNJA", "date"]]) {
    if (have.has(name)) console.log(`atribut ${name} postoji`);
    else {
      await api("POST", `/contacts/attributes/normal/${name}`, { type });
      console.log(`atribut ${name} napravljen`);
    }
  }

  const { folders = [] } = await api("GET", "/contacts/folders?limit=50");
  let folderId = folders.find((f) => f.name === FOLDER)?.id;
  if (!folderId) folderId = (await api("POST", "/contacts/folders", { name: FOLDER })).id;

  const { lists = [] } = await api("GET", "/contacts/lists?limit=50");
  const ids = {};
  for (const name of [...SEGMENTS.map(listName), ALL_LIST]) {
    ids[name] = lists.find((l) => l.name === name)?.id ?? (await api("POST", "/contacts/lists", { name, folderId })).id;
    console.log(`lista „${name}" id ${ids[name]}`);
  }

  for (const s of SEGMENTS) {
    const csv = readFileSync(join(EMAIL_DIR, "kontakti", `segment-${s}.csv`), "utf8").trim();
    const rows = csv.split("\n").length - 1;
    const r = await api("POST", "/contacts/import", {
      fileBody: csv,
      listIds: [ids[listName(s)], ids[ALL_LIST]],
      updateExistingContacts: true,
      emptyContactsAttributes: false,
    });
    console.log(`uvoz segment ${s}: ${rows} kontakata, proces ${r.processId}`);
  }
}

function subjects() {
  const out = {};
  const txt = readFileSync(join(EMAIL_DIR, "out", "NASLOVI.txt"), "utf8");
  for (const block of txt.trim().split("\n\n")) {
    const [file, s, ph] = block.split("\n");
    out[file.trim()] = { subject: s.replace(/^\s*Naslov: /, ""), preview: ph.replace(/^\s*Preheader: /, "") };
  }
  return out;
}

async function e1() {
  const { lists = [] } = await api("GET", "/contacts/lists?limit=50");
  const { campaigns = [] } = await api("GET", "/emailCampaigns?limit=100");
  const meta = subjects();
  for (const s of SEGMENTS) {
    const name = `NOV E1 Paketi – ${s}`;
    const file = `e1-paketi-segment-${s}`;
    const listId = lists.find((l) => l.name === listName(s))?.id;
    if (!listId) throw new Error(`Nema liste za segment ${s}. Prvo pokreni setup.`);
    const body = {
      name,
      sender: SENDER,
      replyTo: SENDER.email,
      subject: meta[file].subject,
      previewText: meta[file].preview,
      htmlContent: readFileSync(join(EMAIL_DIR, "out", `${file}.html`), "utf8"),
      recipients: { listIds: [listId] },
    };
    const existing = campaigns.find((c) => c.name === name);
    if (existing) {
      await api("PUT", `/emailCampaigns/${existing.id}`, body);
      console.log(`kampanja „${name}" ažurirana, id ${existing.id} (${existing.status})`);
    } else {
      const c = await api("POST", "/emailCampaigns", body);
      console.log(`kampanja „${name}" napravljena kao nacrt, id ${c.id}`);
    }
  }
}

// Lični E1: atributi iz kontakti/e1-personalizovano.json + jedna kampanja na listu svih kupaca.
const E1P_ATTRS = [
  "VOKATIV", "E1_NASLOV", "E1_PREHEADER", "HERO_TIP", "HERO_NAZIV", "HERO_URL", "HERO_SLIKA", "HERO_OPIS", "HERO_CENA", "HERO_POKLON",
  ...[1, 2, 3].flatMap((i) => [`R${i}_NAZIV`, `R${i}_URL`, `R${i}_SLIKA`, `R${i}_CENA`]),
];

async function e1p() {
  const { attributes } = await api("GET", "/contacts/attributes");
  const have = new Set(attributes.filter((a) => a.category === "normal").map((a) => a.name));
  for (const name of E1P_ATTRS) if (!have.has(name)) await api("POST", `/contacts/attributes/normal/${name}`, { type: "text" });

  const rows = JSON.parse(readFileSync(join(EMAIL_DIR, "kontakti", "e1-personalizovano.json"), "utf8"));
  for (let i = 0; i < rows.length; i += 100) {
    await api("POST", "/contacts/batch", {
      contacts: rows.slice(i, i + 100).map((r) => ({
        email: r.email,
        attributes: Object.fromEntries(E1P_ATTRS.map((a) => [a, r.attrs[a] ?? ""])),
      })),
    });
  }
  console.log(`atributi upisani za ${rows.length} kupaca`);

  const { lists = [] } = await api("GET", "/contacts/lists?limit=50");
  const listId = lists.find((l) => l.name === ALL_LIST)?.id;
  const { campaigns = [] } = await api("GET", "/emailCampaigns?limit=100");
  const name = "NOV E1 Lični";
  const body = {
    name,
    sender: SENDER,
    replyTo: SENDER.email,
    subject: "{{ contact.E1_NASLOV }}",
    previewText: "{{ contact.E1_PREHEADER }}",
    htmlContent: readFileSync(join(EMAIL_DIR, "out", "e1-licni.html"), "utf8"),
    recipients: { listIds: [listId] },
  };
  const existing = campaigns.find((c) => c.name === name);
  if (existing) {
    await api("PUT", `/emailCampaigns/${existing.id}`, body);
    console.log(`kampanja „${name}" ažurirana, id ${existing.id} (${existing.status})`);
  } else {
    const c = await api("POST", "/emailCampaigns", body);
    console.log(`kampanja „${name}" napravljena kao nacrt, id ${c.id}`);
  }
}

// Probna adresa dobija atribute jednog pravog kupca, da test izgleda kao pravi mejl.
async function testAs(id, email, sampleEmail) {
  const rows = JSON.parse(readFileSync(join(EMAIL_DIR, "kontakti", "e1-personalizovano.json"), "utf8"));
  const row = rows.find((r) => r.email === sampleEmail);
  if (!row) throw new Error(`Nema kupca ${sampleEmail} u preporukama.`);
  const attributes = { FIRSTNAME: "Marko", ...Object.fromEntries(E1P_ATTRS.map((a) => [a, row.attrs[a] ?? ""])) };
  await api("POST", "/contacts", { email, attributes, updateEnabled: true });
  await test(id, email);
  console.log(`  kao kupac: ${row.attrs.HERO_NAZIV} + ${[1, 2, 3].map((i) => row.attrs[`R${i}_NAZIV`]).join(", ")}`);
}

async function test(id, email) {
  if (!id || !email) throw new Error("Upotreba: test <campaignId> <email>");
  await api("POST", `/emailCampaigns/${id}/sendTest`, { emailTo: [email] });
  console.log(`probni mejl kampanje ${id} poslat na ${email}`);
}

const [cmd, ...args] = process.argv.slice(2);
const run = { setup, e1, e1p, test, testAs }[cmd];
if (!run) {
  console.error("Komanda: setup | e1 | e1p | test <campaignId> <email> | testAs <campaignId> <email> <kupac>");
  process.exit(2);
}
await run(...args);
