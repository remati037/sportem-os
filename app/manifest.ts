import type { MetadataRoute } from "next";

// Korak 0.7 — Web app manifest (služi se na /manifest.webmanifest).
// Boje iz dizajn sistema: theme = brend zelena #1B7A45, background = paper #F5F7F5.
// Light-only tema, srpski jezik. UTF-8 → dijakritici bezbedni.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sportem",
    short_name: "Sportem",
    description: "Interni operativni sistem za Sportem",
    lang: "sr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F7F5",
    theme_color: "#1B7A45",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
