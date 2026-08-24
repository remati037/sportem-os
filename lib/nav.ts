import {
  Bell,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  SquareKanban,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Role kojima je stavka vidljiva. Filtriranje je higijena; zaštita je RLS + requireRole. */
  roles: Role[];
  /**
   * Role kojima je stavka PRIMARNA (donji bar na telefonu). Ostale je vide u
   * meniju „Više". Po roli, jer se Katalog razlikuje: Adminu i Menadžeru je
   * sekundaran (bar drži Tiketi), a Logistici je jedini ekran — ostaje u baru.
   */
  primaryRoles: Role[];
};

const ALL: Role[] = ["admin", "manager", "logistics"];
const STAFF: Role[] = ["admin", "manager"];

/** Navigacione stavke po dizajn dokumentu (sekcija 4) i matrici rola (Korak 0.8). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: STAFF, primaryRoles: STAFF },
  {
    href: "/porudzbine",
    label: "Porudžbine",
    icon: ShoppingCart,
    roles: STAFF,
    primaryRoles: STAFF,
  },
  { href: "/tiketi", label: "Tiketi", icon: SquareKanban, roles: STAFF, primaryRoles: STAFF },
  { href: "/katalog", label: "Katalog", icon: Package, roles: ALL, primaryRoles: ["logistics"] },
  { href: "/finansije", label: "Finansije", icon: Wallet, roles: STAFF, primaryRoles: STAFF },
  { href: "/troskovi", label: "Troškovi", icon: Receipt, roles: STAFF, primaryRoles: [] },
  { href: "/korisnici", label: "Korisnici", icon: Users, roles: ["admin"], primaryRoles: [] },
  { href: "/obavestenja", label: "Obaveštenja", icon: Bell, roles: ALL, primaryRoles: [] },
  { href: "/podesavanja", label: "Podešavanja", icon: Settings, roles: ALL, primaryRoles: [] },
];

/** Stavke vidljive datoj roli. */
export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Primarne stavke (bottom bar na mobilnom) vidljive datoj roli. */
export function navPrimaryForRole(role: Role): NavItem[] {
  return navForRole(role).filter((item) => item.primaryRoles.includes(role));
}

/** Sekundarne stavke (mobilni „Više" meni) vidljive datoj roli. */
export function navSecondaryForRole(role: Role): NavItem[] {
  return navForRole(role).filter((item) => !item.primaryRoles.includes(role));
}

/** Da li je stavka aktivna za dati pathname (`/` egzaktno, ostale po prefiksu). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
