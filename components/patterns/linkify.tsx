import Link from "next/link";

/*
 * Običan tekst → klikabilni linkovi (Korak T4). Opis tiketa i komentari su
 * OBIČAN TEKST (markdown je namerno van opsega v1), pa se prepoznaju samo tri
 * stvari koje tim stvarno kuca:
 *
 *   • URL (`https://…`, `www…`) → novi tab
 *   • šifra tiketa `SPT-42`      → `/tiketi/SPT-42`
 *   • broj porudžbine `#2419`    → `/porudzbine/2419` (Woo broj, kao svuda)
 *
 * Sve ostalo ostaje tekst — ništa se ne renderuje kao HTML (nema `dangerouslySetInnerHTML`),
 * pa unos korisnika ne može da ubaci markup.
 */

/** Jedan prolaz: URL | „SPT-42" | „#2419". */
const PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|\bSPT-\d+\b|#\d{2,})/gi;

/** Interpunkcija zalepljena na kraj URL-a ne pripada linku („…rs).", „…rs,"). */
const TRAILING = /[.,;:!?)\]}»"']+$/;

export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(PATTERN);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (!part) return null;
        const key = `${index}-${part}`;

        if (/^(https?:\/\/|www\.)/i.test(part)) {
          const trail = part.match(TRAILING)?.[0] ?? "";
          const url = trail ? part.slice(0, -trail.length) : part;
          const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
          return (
            <span key={key}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-deep font-medium underline"
              >
                {url}
              </a>
              {trail}
            </span>
          );
        }

        if (/^SPT-\d+$/i.test(part)) {
          const code = part.toUpperCase();
          return (
            <Link
              key={key}
              href={`/tiketi/${code}`}
              className="text-green-deep num font-medium underline"
            >
              {code}
            </Link>
          );
        }

        if (/^#\d{2,}$/.test(part)) {
          return (
            <Link
              key={key}
              href={`/porudzbine/${part.slice(1)}`}
              className="text-green-deep num font-medium underline"
            >
              {part}
            </Link>
          );
        }

        return <span key={key}>{part}</span>;
      })}
    </span>
  );
}
