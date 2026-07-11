"use client";

import { useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { usePush } from "@/components/push/use-push";
import { Button } from "@/components/ui/button";

/*
 * Push podešavanja (Korak 1.9) — uključi/isključi obaveštenja na OVOM uređaju.
 * Pretplata je vezana za uređaj (svaki browser/telefon zasebno), pa je ekran
 * dostupan svim rolama. Šta ko dobija filtrira se na serveru (Logistika = samo
 * low stock). Radi samo u produkcionom build-u (SW isključen u dev-u).
 */
export function PushSettings() {
  const { status, busy, subscribe, unsubscribe } = usePush();
  const [pending, startTransition] = useTransition();
  const working = busy || pending;

  const handleSubscribe = () => {
    startTransition(async () => {
      const res = await subscribe();
      if (res.ok) toast.success("Obaveštenja uključena na ovom uređaju.");
      else toast.error(res.error ?? "Nije uspelo.");
    });
  };

  const handleUnsubscribe = () => {
    startTransition(async () => {
      const res = await unsubscribe();
      if (res.ok) toast.success("Obaveštenja isključena na ovom uređaju.");
      else toast.error(res.error ?? "Nije uspelo.");
    });
  };

  return (
    <div className="border-border bg-card shadow-soft rounded-lg border p-6">
      {status === "loading" ? (
        <p className="text-ink-soft text-sm">Provera podrške…</p>
      ) : status === "unsupported" ? (
        <div className="space-y-1">
          <p className="text-ink text-sm font-medium">Uređaj ne podržava obaveštenja</p>
          <p className="text-ink-soft text-sm">
            Na iPhone-u prvo dodaj aplikaciju na početni ekran (Deli → „Dodaj na početni ekran“), pa
            otvori odatle.
          </p>
        </div>
      ) : status === "denied" ? (
        <div className="space-y-1">
          <p className="text-ink text-sm font-medium">Obaveštenja su blokirana</p>
          <p className="text-ink-soft text-sm">
            Dozvoli obaveštenja za ovu stranicu u podešavanjima browsera, pa osveži.
          </p>
        </div>
      ) : status === "subscribed" ? (
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-ink flex items-center gap-2 text-sm font-medium">
              <Bell className="text-green size-4" aria-hidden />
              Obaveštenja su uključena
            </p>
            <p className="text-ink-soft text-sm">Ovaj uređaj prima push obaveštenja.</p>
          </div>
          <Button variant="ghost" onClick={handleUnsubscribe} disabled={working}>
            <BellOff aria-hidden />
            Isključi
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-ink text-sm font-medium">Obaveštenja su isključena</p>
            <p className="text-ink-soft text-sm">Uključi da bi ovaj uređaj primao obaveštenja.</p>
          </div>
          <Button onClick={handleSubscribe} disabled={working}>
            <Bell aria-hidden />
            Uključi
          </Button>
        </div>
      )}
    </div>
  );
}
