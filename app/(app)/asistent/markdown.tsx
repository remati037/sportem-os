"use client";

import { useRef } from "react";
import { Copy, Download } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { toast } from "sonner";
import remarkGfm from "remark-gfm";

/*
 * Markdown prikaz odgovora asistenta (tabele, liste, bold, kod). Sirov HTML
 * je ISKLJUČEN (react-markdown ga podrazumevano ne renderuje — bez
 * `rehype-raw`), pa odgovor ne može da ubaci markup. Linkovi idu u nov tab.
 */
const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="text-ink mt-4 mb-2 text-base font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="text-ink mt-4 mb-2 text-base font-bold">{children}</h3>,
  h3: ({ children }) => <h4 className="text-ink mt-3 mb-1.5 font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-green-deep underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={`${className} font-mono text-[0.8125rem]`}>{children}</code>
    ) : (
      <code className="bg-surface-2 rounded px-1 py-0.5 font-mono text-[0.8125rem]">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="bg-surface-2 my-2 overflow-x-auto rounded-md p-3 text-[0.8125rem]">
      {children}
    </pre>
  ),
  table: ({ children }) => <ExportableTable>{children}</ExportableTable>,
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  th: ({ children }) => (
    <th className="border-border text-ink border-b px-3 py-2 text-left font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-border border-b px-3 py-1.5">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="border-border text-ink-soft my-2 border-l-2 pl-3">{children}</blockquote>
  ),
  hr: () => <hr className="border-border my-4" />,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-ink text-[0.9375rem] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/*
 * Tabela iz odgovora + izvoz (Korak A4). CSV je u formatu koji Excel na
 * srpskom podešavanju otvara bez čarobnjaka: separator `;`, UTF-8 sa BOM-om.
 * Ćelije se čitaju iz prikazane tabele (tekst bez markdown-a).
 */
function tableToCsv(table: HTMLTableElement): string {
  const escape = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [...table.rows]
    .map((row) => [...row.cells].map((c) => escape((c.textContent ?? "").trim())).join(";"))
    .join("\r\n");
}

function ExportableTable({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);

  async function copy() {
    if (!ref.current) return;
    try {
      await navigator.clipboard.writeText(tableToCsv(ref.current));
      toast.success("Tabela je kopirana (CSV).");
    } catch {
      toast.error("Kopiranje nije uspelo.");
    }
  }

  function download() {
    if (!ref.current) return;
    const blob = new Blob(["\uFEFF" + tableToCsv(ref.current)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sportem-asistent-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="my-3">
      <div className="border-border overflow-x-auto rounded-md border">
        <table ref={ref} className="num w-full border-collapse text-sm">
          {children}
        </table>
      </div>
      <div className="text-ink-faint mt-1 flex justify-end gap-3 text-xs">
        <button
          type="button"
          onClick={copy}
          className="hover:text-ink inline-flex items-center gap-1"
        >
          <Copy className="size-3.5" /> Kopiraj CSV
        </button>
        <button
          type="button"
          onClick={download}
          className="hover:text-ink inline-flex items-center gap-1"
        >
          <Download className="size-3.5" /> Preuzmi CSV
        </button>
      </div>
    </div>
  );
}
