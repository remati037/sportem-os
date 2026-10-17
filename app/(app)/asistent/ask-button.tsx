import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/*
 * „Pitaj asistenta" (Korak A4) — otvara nov razgovor sa pred-popunjenim
 * pitanjem (`/asistent?pitanje=…`). Ništa se ne šalje dok korisnik ne pritisne
 * Enter, pa pitanje može da dopuni. Renderuje se SAMO Adminu i Menadžeru
 * (pozivalac proverava rolu; ruta /asistent ionako ima svoju kapiju).
 */
export function AskAssistantButton({ question }: { question: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/asistent?pitanje=${encodeURIComponent(question)}`}>
        <Sparkles /> Pitaj asistenta
      </Link>
    </Button>
  );
}
