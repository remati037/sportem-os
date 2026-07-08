// Korak 0.7 — generator PWA ikonica (dev-only, ne izvršava se u buildu).
//
// Privremeni „S" monogram: beli „S" na brend-zelenoj (#1B7A45) pločici.
// Izvor istine za ikonice je ovaj fajl. Kad stigne pravi logo:
//   - zameni `renderSvg()` (ili ubaci logo SVG/PNG) i pokreni `npm run icons`,
//   - imena/dimenzije izlaznih fajlova ostaju ista → nigde drugde nema izmena.
//
// Pokretanje: `npm run icons`
//
// Izlaz:
//   public/icons/icon-192.png       (purpose: any)
//   public/icons/icon-512.png       (purpose: any)
//   public/icons/maskable-512.png   (purpose: maskable, ~20% safe-zone)
//   app/icon.png                    (favicon/tab — Next auto-link)
//   app/apple-icon.png              (180×180 apple-touch — Next auto-link)

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "#1B7A45"; // brend zelena (theme_color)
const WHITE = "#FFFFFF";

/**
 * SVG „S" monogram.
 * @param {number} size  strana u px
 * @param {object} opts
 * @param {number} opts.radius     radijus zaobljenja pločice (0 = pun kvadrat)
 * @param {number} opts.fontRatio  visina slova kao udeo strane (safe-zone kontrola)
 */
function renderSvg(size, { radius, fontRatio }) {
  const fontSize = Math.round(size * fontRatio);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${GREEN}"/>
  <text x="50%" y="50%" dy="0.02em" text-anchor="middle" dominant-baseline="central"
        font-family="Geist, 'Helvetica Neue', Arial, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="${WHITE}">S</text>
</svg>`;
}

async function emit(relPath, size, opts) {
  const out = join(ROOT, relPath);
  await mkdir(dirname(out), { recursive: true });
  const svg = Buffer.from(renderSvg(size, opts));
  // Renderuj na visokom DPI radi oštrine, pa svedi na tačnu ciljanu dimenziju.
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("✓", relPath);
}

async function main() {
  // Zaobljena pločica (purpose: any) — prikazuje se kakva jeste.
  await emit("public/icons/icon-192.png", 192, { radius: 40, fontRatio: 0.62 });
  await emit("public/icons/icon-512.png", 512, { radius: 108, fontRatio: 0.62 });
  await emit("app/icon.png", 512, { radius: 108, fontRatio: 0.62 });

  // Maskable — pun kvadrat, manji „S" (OS maska seče ivice, ~20% safe-zone).
  await emit("public/icons/maskable-512.png", 512, { radius: 0, fontRatio: 0.46 });

  // Apple touch — pun kvadrat (iOS sam maskira), 180×180.
  await emit("app/apple-icon.png", 180, { radius: 0, fontRatio: 0.6 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
