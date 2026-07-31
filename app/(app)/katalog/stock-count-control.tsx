"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { datum } from "@/lib/format";
import { Input } from "@/components/ui/input";

import { setStockCount } from "./actions";

/*
 * Popis zaliha po varijanti — unos količine + čekboks „Popisano".
 *
 * Unos cifre automatski markira popis (potvrdio si stanje time što si ga uneo);
 * čekboks postoji da bi se moglo označiti i stanje 0 („prebrojao sam, nema
 * ništa") bez menjanja cifre. Skidanje čekboksa ne dira količinu.
 *
 * Dostupno Adminu i Logistici; upis ide kroz `setStockCount` (service role uz
 * requireRole guard) jer Logistika nema write RLS na `product_variants`.
 */
export function StockCountControl({
  variantId,
  productId,
  stockQuantity,
  countedAt,
  showLabel = false,
}: {
  variantId: string;
  productId?: string;
  stockQuantity: number;
  countedAt: string | null;
  /** Mobilne kartice nemaju zaglavlje kolone → tekst uz čekboks. */
  showLabel?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState(String(stockQuantity));
  const [counted, setCounted] = useState(countedAt != null);

  function save(nextCounted: boolean, nextQty?: number) {
    const prevCounted = counted;
    const prevQty = qty;
    setCounted(nextCounted);
    if (nextQty != null) setQty(String(nextQty));

    startTransition(async () => {
      const result = await setStockCount({
        variant_id: variantId,
        product_id: productId,
        counted: nextCounted,
        stock_quantity: nextQty,
      });
      if (result.error) {
        setCounted(prevCounted);
        setQty(prevQty);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function commitQty() {
    const parsed = Number(qty);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setQty(String(stockQuantity));
      toast.error("Stanje mora biti ceo broj ≥ 0.");
      return;
    }
    // Cifra nije dirana → ništa se ne snima (prolazak kroz polje ne markira
    // popis; za potvrdu nepromenjenog stanja, npr. nule, služi čekboks).
    if (parsed === stockQuantity) return;
    save(true, parsed);
  }

  const title = counted
    ? countedAt
      ? `Popisano ${datum(countedAt)}`
      : "Popisano"
    : "Nije popisano — količina nikad nije uneta";

  // Root je <span> — kontrola ume da stoji i unutar MobileCardField (koji je span).
  return (
    <span className="flex items-center justify-end gap-2">
      <Input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={qty}
        disabled={pending}
        aria-label="Stanje"
        onChange={(e) => setQty(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="num h-8 w-20 text-right"
      />
      <label
        title={title}
        className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap"
      >
        <input
          type="checkbox"
          checked={counted}
          disabled={pending}
          aria-label="Popisano"
          onChange={(e) => {
            // Čekiranje ujedno snima i cifru iz polja (ako je ispravna).
            const n = Number(qty);
            const valid = Number.isInteger(n) && n >= 0;
            save(e.target.checked, e.target.checked && valid ? n : undefined);
          }}
          className="accent-green size-4"
        />
        {showLabel ? "Popisano" : null}
      </label>
    </span>
  );
}
