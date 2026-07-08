import type { Role } from "@/lib/auth";

/** Srpski nazivi rola za UI (DB/kod koristi engleske ključeve). */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Menadžer",
  logistics: "Logistika",
};
