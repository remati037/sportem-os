"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { CUSTOMER_FLAGS, type CustomerFlag } from "@/lib/customers";
import { cn } from "@/lib/utils";

import { setCustomerFlags } from "../actions";

/*
 * Oznake kupca (Korak C3) — fiksna lista, klik pali/gasi. Čuva se odmah cela
 * lista (`setCustomerFlags`); pri grešci se vraća prethodno stanje.
 */

const ACTIVE: Record<(typeof CUSTOMER_FLAGS)[number]["variant"], string> = {
  success: "border-success/30 bg-success-soft text-success",
  info: "border-info/30 bg-info-soft text-info",
  warning: "border-warning/30 bg-warning-soft text-warning",
};

export function CustomerFlags({
  customerId,
  initial,
}: {
  customerId: string;
  initial: CustomerFlag[];
}) {
  const router = useRouter();
  const [flags, setFlags] = useState<CustomerFlag[]>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(flag: CustomerFlag) {
    const prev = flags;
    const next = prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag];
    setFlags(next);
    startTransition(async () => {
      const result = await setCustomerFlags(customerId, next);
      if (result.error) {
        setFlags(prev);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Oznake kupca">
      {CUSTOMER_FLAGS.map((f) => {
        const on = flags.includes(f.value);
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={on}
            disabled={pending}
            onClick={() => toggle(f.value)}
            className={cn(
              "rounded-pill inline-flex h-7 items-center gap-1 border px-2.5 text-xs font-semibold transition-colors disabled:opacity-60",
              on
                ? ACTIVE[f.variant]
                : "border-border text-ink-faint hover:text-ink-soft hover:border-border-strong border-dashed",
            )}
          >
            {on ? <Check className="size-3" /> : null}
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
