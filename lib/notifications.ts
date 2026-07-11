import type { Role } from "@/lib/auth";

/*
 * Tipovi obaveštenja (Korak 1.9) + rezolucija kanala po korisničkoj preferenci.
 * Deljeno klijent/server (bez server-only importa). Redosled = redosled u UI-ju.
 *
 * `roles` = kome tip uopšte može stići (uz to notifyRoles bira ciljne role po
 * događaju). Logistika u praksi dobija samo `low_stock`.
 */
export const NOTIFICATION_TYPES = [
  { key: "new_order", label: "Nova porudžbina", roles: ["admin", "manager"] as Role[] },
  { key: "prep_reminder", label: "Podsetnik za slanje", roles: ["admin", "manager"] as Role[] },
  {
    key: "low_stock",
    label: "Nisko stanje",
    roles: ["admin", "manager", "logistics"] as Role[],
  },
  {
    key: "delivered_unpaid",
    label: "Isporučeno a neuplaćeno",
    roles: ["admin", "manager"] as Role[],
  },
  {
    key: "invoice_reminder",
    label: "Podsetnik za fakturu",
    roles: ["admin", "manager"] as Role[],
  },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["key"];

/** Izbor kanala za jedan tip. */
export type ChannelPref = { push: boolean; email: boolean };

/** Podrazumevano (dok korisnik ne izmeni): push uključen, email isključen. */
export const DEFAULT_CHANNEL: ChannelPref = { push: true, email: false };

/** Cela preferenca korisnika (kako se čuva/čita). */
export type NotificationPrefs = {
  enabled: boolean; // master prekidač
  prefs: Partial<Record<string, ChannelPref>>; // po tipu; nedostaje → DEFAULT_CHANNEL
};

/** Kanal za dati tip iz preferenci (nedostaje red/tip → default). */
export function resolveChannel(
  prefs: Partial<Record<string, ChannelPref>> | null | undefined,
  type: string,
): ChannelPref {
  const p = prefs?.[type];
  if (!p) return DEFAULT_CHANNEL;
  return { push: p.push !== false, email: p.email === true };
}

/** Tipovi vidljivi datoj roli (za UI). */
export function notificationTypesForRole(role: Role) {
  return NOTIFICATION_TYPES.filter((t) => t.roles.includes(role));
}
