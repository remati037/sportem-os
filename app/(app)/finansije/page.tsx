import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";

/*
 * Finansije — landing. Pun overview (drug mi duguje, saldo poštarine, neto
 * profit) stiže u Koraku 1.6c; do tada vodi na Uplate.
 */
export default async function FinansijePage() {
  await requireRole("admin", "manager");
  redirect("/finansije/uplate");
}
