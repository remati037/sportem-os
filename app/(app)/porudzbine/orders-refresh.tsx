"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/*
 * Osvežavanje liste porudžbina bez restarta app-a. Nove porudžbine stižu kroz
 * WooCommerce webhook, ali stranica je server komponenta (`force-dynamic`) i
 * renderuje se jednom — pa `router.refresh()` ponovo povuče iz baze, čuvajući
 * trenutne filtere/paginaciju (searchParams). Uz ručno dugme, tiho auto-osvežava
 * svakih ~60s dok je tab vidljiv (u pozadini se preskače — štedi upite).
 */
export function OrdersRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        startTransition(() => router.refresh());
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      Osveži
    </Button>
  );
}
