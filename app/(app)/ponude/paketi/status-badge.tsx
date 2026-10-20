import { Badge } from "@/components/ui/badge";

/* Status paketa sa sajta → badge. Stoji van „use client" modula jer ga koriste
   i server strana (detalj) i klijentska tabela — server komponenta ne sme da
   POZOVE funkciju iz klijentskog modula (obara render). */
export function statusBadge(status: string | null) {
  if (status === null) return <Badge variant="danger">Nema ga na sajtu</Badge>;
  if (status === "publish") return <Badge variant="success">Objavljen</Badge>;
  if (status === "draft") return <Badge variant="warning">Nacrt</Badge>;
  return <Badge variant="info">{status}</Badge>;
}
