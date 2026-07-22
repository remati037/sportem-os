import { redirect } from "next/navigation";

/*
 * Finansije nemaju zaseban pregled — ulazak u sekciju vodi direktno na Uplate.
 * (Ranije je ovde bio overview sa 3 kartice; uklonjen na zahtev korisnika.)
 * Redirect stranica čuva stare linkove i `revalidatePath("/finansije")`.
 */
export default function FinansijePage() {
  redirect("/finansije/uplate");
}
