"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Jedinstven toast obrazac za server akcije (Korak 0.8).
 * Prikaže error toast kad se `state.error` promeni; opciono success toast.
 * Koristi se uz `useActionState`.
 */
export function useActionToast(state: { error?: string | null; success?: string | null }) {
  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);
}
