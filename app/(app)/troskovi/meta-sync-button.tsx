"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { syncMetaNow } from "./actions";

/*
 * „Sinhronizuj Meta" — ručno povlačenje potrošnje sa Meta Ads naloga (cron je
 * dnevni). Obrazac `ponude/sync-button.tsx`: posle akcije `router.refresh()`
 * prikaže novi automatski red i stanje sinhronizacije.
 */
export function MetaSyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await syncMetaNow();
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Sinhronizovano.");
      router.refresh();
    });
  }

  return (
    <Button variant="subtle" onClick={run} disabled={pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Sinhronizujem…" : "Sinhronizuj Meta"}
    </Button>
  );
}
