"use client";

import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";

import type { InvoiceDetailOrder } from "@/db/finance";
import { rsd, datum } from "@/lib/format";
import { Button } from "@/components/ui/button";

/*
 * Kopiraj/Štampaj za fakturu (Korak 1.6b, bez PDF-a — zaključana odluka).
 * Kopira plain-text u clipboard; štampa čist prozor (window.print()).
 */
export function InvoicePrint({
  invoiceNumber,
  date,
  total,
  orders,
}: {
  invoiceNumber: string;
  date: string;
  total: number;
  orders: InvoiceDetailOrder[];
}) {
  function buildText(): string {
    const lines: string[] = [
      `Faktura ${invoiceNumber}`,
      `Datum: ${date}`,
      "",
      "PORUDŽBINE (zarada):",
    ];
    for (const o of orders) {
      lines.push(`#${o.woo_order_id ?? "—"} — ${o.ship_name ?? "—"}: ${rsd(o.profit)}`);
    }
    lines.push("", `UKUPNO: ${rsd(total)}`);
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildText());
      toast.success("Faktura kopirana.");
    } catch {
      toast.error("Kopiranje nije uspelo.");
    }
  }

  function print() {
    const win = window.open("", "_blank", "noopener,width=800,height=900");
    if (!win) {
      toast.error("Štampa nije uspela (blokiran pop-up).");
      return;
    }
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const rows = orders
      .map(
        (o) =>
          `<tr><td class="n">#${o.woo_order_id ?? "—"}</td><td>${esc(o.ship_name ?? "—")}</td>` +
          `<td class="d">${o.delivered_at ? esc(datum(o.delivered_at)) : "—"}</td>` +
          `<td class="a">${esc(rsd(o.profit))}</td></tr>`,
      )
      .join("");
    win.document.write(
      `<!doctype html><html lang="sr"><head><meta charset="utf-8"><title>Faktura ${esc(invoiceNumber)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px}` +
        `p{font-size:12px;color:#555}table{border-collapse:collapse;width:100%;margin-top:12px}` +
        `td,th{padding:4px 6px;border-bottom:1px solid #ddd;font-size:12px;text-align:left}` +
        `td.a,th.a{text-align:right;font-weight:600}td.n{font-weight:600}td.d{color:#555}` +
        `tfoot td{border-top:2px solid #111;font-weight:700;font-size:13px}</style></head><body>` +
        `<h1>Faktura ${esc(invoiceNumber)}</h1><p>Datum: ${esc(date)}</p>` +
        `<table><thead><tr><th>Br.</th><th>Kupac</th><th>Isporučeno</th><th class="a">Zarada</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `<tfoot><tr><td colspan="3">UKUPNO</td><td class="a">${esc(rsd(total))}</td></tr></tfoot></table>` +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="subtle" onClick={copy}>
        <Copy /> Kopiraj
      </Button>
      <Button size="sm" variant="subtle" onClick={print}>
        <Printer /> Štampaj
      </Button>
    </div>
  );
}
