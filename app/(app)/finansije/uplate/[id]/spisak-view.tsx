"use client";

import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";

import type { PayoutSpisak } from "@/db/finance";
import { num, rsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/*
 * Spisak za druga (Korak 1.6a): zbirno po artiklu (za kucanje u kasi) + razrada
 * po porudžbini. Kopiraj (plain-text u clipboard) i Štampaj (čist prozor, bez PDF).
 */
export function SpisakView({
  spisak,
  payoutDate,
}: {
  spisak: PayoutSpisak;
  payoutDate: string;
}) {
  const { byOrder, byArticle, totals } = spisak;

  function buildText(): string {
    const lines: string[] = [`Uplata ${payoutDate}`, ""];
    for (const a of byArticle) lines.push(`${a.product_name} x${a.quantity}`);
    lines.push(
      "",
      `MP ukupno: ${rsd(totals.mp)}`,
      `VP ukupno: ${rsd(totals.vp)}`,
      `Dostava: ${rsd(totals.shipping)}`,
      `Zarada: ${rsd(totals.profit)}`,
    );
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildText());
      toast.success("Spisak kopiran.");
    } catch {
      toast.error("Kopiranje nije uspelo.");
    }
  }

  function print() {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      toast.error("Štampa nije uspela (blokiran pop-up).");
      return;
    }
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const articleRows = byArticle
      .map((a) => `<tr><td>${esc(a.product_name)}</td><td class="q">${a.quantity}</td></tr>`)
      .join("");
    const totalsRows = [
      ["MP ukupno", rsd(totals.mp)],
      ["VP ukupno", rsd(totals.vp)],
      ["Dostava", rsd(totals.shipping)],
      ["Zarada", rsd(totals.profit)],
    ]
      .map(([label, value]) => `<tr><td>${esc(label)}</td><td class="v">${esc(value)}</td></tr>`)
      .join("");
    win.document.write(
      `<!doctype html><html lang="sr"><head><meta charset="utf-8"><title>Uplata ${esc(payoutDate)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px}h2{font-size:14px;margin-top:20px}table{border-collapse:collapse;width:100%;margin-bottom:8px}td{padding:2px 6px;border-bottom:1px solid #ddd;font-size:12px}td.q{width:40px;text-align:right;font-weight:600}table.totals{max-width:260px}table.totals td.v{text-align:right;font-weight:600}</style></head><body>` +
        `<h1>Uplata ${esc(payoutDate)}</h1>` +
        `<table>${articleRows}</table>` +
        `<h2>Zbir</h2><table class="totals">${totalsRows}</table>` +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink text-sm font-semibold">Spisak za druga</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="subtle" onClick={copy}>
            <Copy /> Kopiraj
          </Button>
          <Button size="sm" variant="subtle" onClick={print}>
            <Printer /> Štampaj
          </Button>
        </div>
      </div>

      {byArticle.length === 0 ? (
        <p className="text-ink-soft border-border bg-surface rounded-lg border px-4 py-6 text-sm">
          Nema artikala (uplata bez vezanih porudžbina).
        </p>
      ) : (
        <>
          {/* Zbirovi za celu uplatu — MP/VP/Dostava/Zarada (zamrznute cene). */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <TotalCard label="MP ukupno" value={rsd(totals.mp)} />
            <TotalCard label="VP ukupno" value={rsd(totals.vp)} />
            <TotalCard label="Dostava" value={rsd(totals.shipping)} />
            <TotalCard label="Zarada" value={rsd(totals.profit)} tone="success" />
          </div>

          <p className="text-ink-faint mb-1 text-xs">Zbirno po artiklu (za kasu):</p>
          <div className="border-border bg-surface shadow-soft mb-6 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="eyebrow bg-surface-2 h-9 px-4">Artikal</TableHead>
                  <TableHead className="eyebrow bg-surface-2 h-9 w-16 px-4 text-right">Kol.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byArticle.map((a) => (
                  <TableRow key={a.sku} className="border-border">
                    <TableCell className="text-ink px-4 py-2">{a.product_name}</TableCell>
                    <TableCell className="num px-4 py-2 text-right font-semibold">
                      {num(a.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-ink-faint mb-1 text-xs">Razrada po porudžbini:</p>
          <div className="space-y-3">
            {byOrder.map((o, idx) => (
              <div
                key={o.woo_order_id ?? `ord-${idx}`}
                className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3"
              >
                <div className="text-ink mb-1.5 text-sm font-medium">
                  <span className="num">#{o.woo_order_id ?? "—"}</span> — {o.ship_name ?? "—"}
                </div>
                <ul className="text-ink-soft space-y-0.5 text-sm">
                  {o.items.map((it) => (
                    <li key={it.sku}>
                      {it.product_name} <span className="num font-semibold">x{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TotalCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-lg border px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={"num mt-1 text-lg font-bold " + (tone === "success" ? "text-success" : "text-ink")}>
        {value}
      </div>
    </div>
  );
}
