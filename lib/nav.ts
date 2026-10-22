import {
  Bell,
  Calculator,
  Contact,
  FileChartColumn,
  LayoutDashboard,
  Megaphone,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  SquareKanban,
  Target,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/auth";

/** Sekcije navigacije, redom kako se prikazuju (sidebar i meni „Više"). */
export type NavSectionId = "pocetak" | "prodaja" | "operativa" | "novac" | "sistem";

export const NAV_SECTIONS: { id: NavSectionId; title: string | null }[] = [
  { id: "pocetak", title: null },
  { id: "prodaja", title: "Prodaja" },
  { id: "operativa", title: "Operativa" },
  { id: "novac", title: "Novac" },
  { id: "sistem", title: "Sistem" },
];

export type NavItem = {
  /** Za „uskoro" stavke ruta još ne postoji — služi samo kao ključ, nikad kao link. */
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSectionId;
  /** Role kojima je stavka vidljiva. Filtriranje je higijena; zaštita je RLS + requireRole. */
  roles: Role[];
  /**
   * Role kojima je stavka PRIMARNA (donji bar na telefonu). Ostale je vide u
   * meniju „Više". Po roli, jer se Katalog razlikuje: Adminu i Menadžeru je
   * sekundaran (bar drži Tiketi), a Logistici je jedini ekran — ostaje u baru.
   */
  primaryRoles: Role[];
  /** Budući modul: prikazuje se onemogućen sa oznakom „Uskoro", bez navigacije. */
  soon?: boolean;
};

const ALL: Role[] = ["admin", "manager", "logistics"];
const STAFF: Role[] = ["admin", "manager"];

/** Navigacione stavke po dizajn dokumentu (sekcija 4) i matrici rola (Korak 0.8). */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    section: "pocetak",
    roles: STAFF,
    primaryRoles: STAFF,
  },
  {
    href: "/asistent",
    label: "Asistent",
    icon: Sparkles,
    section: "pocetak",
    roles: STAFF,
    primaryRoles: [],
  },

  {
    href: "/porudzbine",
    label: "Porudžbine",
    icon: ShoppingCart,
    section: "prodaja",
    roles: STAFF,
    primaryRoles: STAFF,
  },
  {
    href: "/ponude",
    label: "Ponude",
    icon: Megaphone,
    section: "prodaja",
    roles: STAFF,
    primaryRoles: [],
  },
  {
    href: "/kupci",
    label: "Kupci",
    icon: Contact,
    section: "prodaja",
    roles: STAFF,
    primaryRoles: [],
  },

  {
    href: "/tiketi",
    label: "Tiketi",
    icon: SquareKanban,
    section: "operativa",
    roles: STAFF,
    primaryRoles: STAFF,
  },
  {
    href: "/katalog",
    label: "Katalog",
    icon: Package,
    section: "operativa",
    roles: ALL,
    primaryRoles: ["logistics"],
  },
  {
    href: "/nabavka",
    label: "Nabavka",
    icon: Truck,
    section: "operativa",
    roles: STAFF,
    primaryRoles: [],
    soon: true,
  },

  {
    href: "/finansije",
    label: "Finansije",
    icon: Wallet,
    section: "novac",
    roles: STAFF,
    primaryRoles: STAFF,
  },
  {
    href: "/troskovi",
    label: "Troškovi",
    icon: Receipt,
    section: "novac",
    roles: STAFF,
    primaryRoles: [],
  },
  {
    href: "/racunica",
    label: "Računica",
    icon: Calculator,
    section: "novac",
    roles: STAFF,
    primaryRoles: [],
  },
  {
    href: "/izvestaji",
    label: "Izveštaji",
    icon: FileChartColumn,
    section: "novac",
    roles: STAFF,
    primaryRoles: [],
    soon: true,
  },
  {
    href: "/reklame",
    label: "Reklame",
    icon: Target,
    section: "novac",
    roles: STAFF,
    primaryRoles: [],
    soon: true,
  },

  {
    href: "/korisnici",
    label: "Korisnici",
    icon: Users,
    section: "sistem",
    roles: ["admin"],
    primaryRoles: [],
  },
  {
    href: "/obavestenja",
    label: "Obaveštenja",
    icon: Bell,
    section: "sistem",
    roles: ALL,
    primaryRoles: [],
  },
  {
    href: "/podesavanja",
    label: "Podešavanja",
    icon: Settings,
    section: "sistem",
    roles: ALL,
    primaryRoles: [],
  },
];

export type NavSection = { id: NavSectionId; title: string | null; items: NavItem[] };

/** Stavke vidljive datoj roli. */
export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Primarne stavke (bottom bar na mobilnom) vidljive datoj roli. „Uskoro" nikad nije primarna. */
export function navPrimaryForRole(role: Role): NavItem[] {
  return navForRole(role).filter((item) => !item.soon && item.primaryRoles.includes(role));
}

/** Sekundarne stavke (mobilni „Više" meni) vidljive datoj roli. */
export function navSecondaryForRole(role: Role): NavItem[] {
  return navForRole(role).filter((item) => !item.primaryRoles.includes(role));
}

/** Grupiše stavke po sekcijama (redosled iz NAV_SECTIONS); prazne sekcije se izostavljaju. */
export function groupNavItems(items: NavItem[]): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.id) })).filter(
    (s) => s.items.length > 0,
  );
}

/** Da li je stavka aktivna za dati pathname (`/` egzaktno, ostale po prefiksu). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
