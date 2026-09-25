"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { syncOffersNow } from "./actions";

/*
 * „Sinhronizuj sada" — ručno povlačenje događaja iz plugina. Cron je dnevni
 * (Hobby plan), pa je ovo način da se cifre osveže odmah.
 *
 * Obrazac iz settlement-dialog.tsx: `useTransition` + await akcije + toast.
 * Posle uspeha `router.refresh()` ponovo povuče server komponentu (stranica je
 * `force-dynamic`), pa se nove cifre i vreme sinhronizacije odmah vide.
 */
export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await syncOffersNow();
      if (result.error) {
        toast.error(result.error);
        router.refresh(); // greška se upisuje u last_error — prikaži je na stranici
        return;
      }
      toast.success(result.success ?? "Sinhronizovano.");
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" onClick={run} disabled={pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Sinhronizujem…" : "Sinhronizuj sada"}
    </Button>
  );
}
