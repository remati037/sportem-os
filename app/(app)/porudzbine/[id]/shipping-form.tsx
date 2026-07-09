"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updateShipping, type OrderActionState } from "../actions";

const initial: OrderActionState = { error: null };

type ShippingValues = {
  shipping_charged: number | null;
  shipping_actual: number | null;
  weight_grams: number | null;
  package_count: number | null;
};

/*
 * Paket i poštarina (Korak 1.5) — popunjava se na koraku „Poslato". Prolazne
 * stavke (ne diraju snapshot cene ni status). Admin + Menadžer; stvarna
 * poštarina može i naknadno po XExpress specifikaciji.
 */
export function ShippingForm({ orderId, values }: { orderId: string; values: ShippingValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toStr = (n: number | null) => (n != null ? String(n) : "");
  const [charged, setCharged] = useState(toStr(values.shipping_charged));
  const [actual, setActual] = useState(toStr(values.shipping_actual));
  const [weight, setWeight] = useState(toStr(values.weight_grams));
  const [packages, setPackages] = useState(toStr(values.package_count));

  function save() {
    const fd = new FormData();
    fd.set("order_id", orderId);
    fd.set("shipping_charged", charged.trim());
    fd.set("shipping_actual", actual.trim());
    fd.set("weight_grams", weight.trim());
    fd.set("package_count", packages.trim());
    startTransition(async () => {
      const result = await updateShipping(initial, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Sačuvano.");
      router.refresh();
    });
  }

  return (
    <section className="border-border bg-surface shadow-soft rounded-lg border p-4">
      <h2 className="eyebrow mb-3">Paket i poštarina</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Naplaćena poštarina (RSD)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={charged}
            onChange={(e) => setCharged(e.target.value)}
            placeholder="—"
          />
        </Field>
        <Field label="Stvarna poštarina (RSD)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="—"
          />
        </Field>
        <Field label="Težina (g)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="—"
          />
        </Field>
        <Field label="Broj paketa">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={packages}
            onChange={(e) => setPackages(e.target.value)}
            placeholder="—"
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={pending} onClick={save}>
          Sačuvaj
        </Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-ink-faint text-xs">{label}</Label>
      {children}
    </div>
  );
}
