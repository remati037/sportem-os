// Ime za pozdrav u mejlu: vrati kvačice, prebaci ćirilicu u latinicu, izbaci
// prezimena i nazive firmi, pa napravi vokativ („Milica" → „Milice", „Nenad" → „Nenade").
// Vraća "" kad ime nije pouzdano, pa šablon piše samo „Zdravo,".

const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj",
  м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č",
  џ: "dž", ш: "š",
};

// Česta imena upisana bez kvačica.
const DIACRITICS = {
  Dusan: "Dušan", Milos: "Miloš", Uros: "Uroš", Natasa: "Nataša", Snezana: "Snežana", Nebojsa: "Nebojša",
  Sasa: "Saša", Slavisa: "Slaviša", Sinisa: "Siniša", Srdjan: "Srđan", Djordje: "Đorđe", Sladjana: "Slađana",
  Sladjan: "Slađan", Andjela: "Anđela", Andjelija: "Anđelija", Pedja: "Peđa", Ruzica: "Ružica", Zeljka: "Željka",
  Zeljana: "Željana", Zeljko: "Željko", Zaklina: "Žaklina", Zarko: "Žarko", Dusko: "Duško", Dusica: "Dušica",
  Drazen: "Dražen", Vukasin: "Vukašin", Snjezana: "Snježana", Dragisa: "Dragiša", Dusanka: "Dušanka",
  Bosko: "Boško", Djurdjina: "Đurđina", Nadja: "Nađa", Masa: "Maša", Saska: "Saška", Dzevad: "Dževad",
  Djurdja: "Đurđa", Djuro: "Đuro", Ivanka: "Ivanka",
};

// Nije ime osobe.
const NOT_A_NAME = new Set(["Restoran", "Simpson", "Nektar", "Mil", "Firma", "Doo", "Sr", "Szr", "Test"]);

// Ženska imena na suglasnik: ostaju kao u nominativu.
const FEMALE_CONSONANT = new Set(["Ines", "Karmen", "Ruth", "Miriam", "Nives", "Ingrid", "Zsanett", "Dolores", "Ivon"]);

// Muška imena sa nepostojanim a: Petar → Petre.
const FLEETING_A = { Petar: "Petre", Aleksandar: "Aleksandre", Dimitar: "Dimitre" };

// Strana imena na suglasnik kod kojih ne menjamo završetak.
const FOREIGN_KEEP = new Set(["Erik", "Mihal", "Istvan", "Akoš", "Antal", "Gadif"]);

function clean(raw) {
  let s = String(raw ?? "").trim().split(/\s+/)[0] ?? "";
  s = [...s.toLowerCase()].map((ch) => CYR[ch] ?? ch).join("");
  if (!/^[\p{L}-]{2,}$/u.test(s)) return "";
  s = s[0].toUpperCase() + s.slice(1);
  s = DIACRITICS[s] ?? s;
  if (NOT_A_NAME.has(s)) return "";
  if (/(ić|ic|vić|vic)$/i.test(s) && s.length >= 4) return ""; // prezime
  return s;
}

export function vokativ(raw) {
  const s = clean(raw);
  if (!s) return "";
  if (FLEETING_A[s]) return FLEETING_A[s];
  if (/ica$/.test(s)) return s.slice(0, -1) + "e"; // Milica → Milice, Perica → Perice
  if (/[aeiouóáé]$/i.test(s)) return s; // Jelena, Nikola, Marko, Đorđe
  if (FEMALE_CONSONANT.has(s) || FOREIGN_KEEP.has(s)) return s;
  if (/(j|ć|đ)$/.test(s)) return s; // Matej, Andrej: bez nastavka
  if (/k$/.test(s)) return s.slice(0, -1) + "če"; // Vuk → Vuče
  if (/g$/.test(s)) return s.slice(0, -1) + "že"; // Predrag → Predraže
  if (/h$/.test(s)) return s.slice(0, -1) + "še";
  return s + "e"; // Nenad → Nenade, Vladimir → Vladimire
}

export { clean as cistoIme };
