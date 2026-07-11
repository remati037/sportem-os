"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAppUpdate } from "./use-app-update";

/*
 * Obaveštenje o novoj verziji aplikacije. Kad SW detektuje novi build, prikaže
 * perzistentni toast sa dugmetom „Osveži" — klik prebaci app na najnoviju
 * verziju (bez ručnog gašenja/otvaranja). Montira se u root layout-u uz Toaster.
 * Radi samo u produkcionom build-u (SW isključen u dev-u).
 */
export function UpdateToast() {
  const { updateReady, applyUpdate } = useAppUpdate();
  const shown = useRef(false);

  useEffect(() => {
    if (!updateReady || shown.current) return;
    shown.current = true;
    toast.info("Dostupna je nova verzija aplikacije.", {
      id: "app-update",
      duration: Infinity,
      description: "Osveži da bi preuzeo najnoviju verziju.",
      action: {
        label: "Osveži",
        onClick: () => void applyUpdate(),
      },
    });
  }, [updateReady, applyUpdate]);

  return null;
}
