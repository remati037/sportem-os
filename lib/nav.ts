import {
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingCart,
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
  /** Prikazati u mobilnom bottom nav-u (primarne sekcije). */
  primary: boolean;
};

const ALL: Role[] = ["admin", "manager", "logistics"];
const STAFF: Role[] = ["admin", "manager"];

/** Navigacione stavke po dizajn dokumentu (sekcija 4) i matrici rola (Korak 0.8). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: STAFF, primary: true },
  { href: "/porudzbine", label: "Porudžbine", icon: ShoppingCart, roles: STAFF, primary: true },
  { href: "/katalog", label: "Katalog", icon: Package, roles: ALL, primary: true },
  { href: "/finansije", label: "Finansije", icon: Wallet, roles: STAFF, primary: true },
  { href: "/troskovi", label: "Troškovi", icon: Receipt, roles: STAFF, primary: true },
  { href: "/korisnici", label: "Korisnici", icon: Users, roles: ["admin"], primary: false },
];

/** Stavke vidljive datoj roli. */
export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Da li je stavka aktivna za dati pathname (`/` egzaktno, ostale po prefiksu). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
