// Árbol de navegación (Blueprint §4.2) y visibilidad por perfil (§1.3).
import {
  Banknote, BarChart3, Boxes, Building2, FileText, Home, Landmark, Package, Settings, Ship, ShoppingBag, ShoppingCart, Users,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "../data/backend";
import type { BusinessProfile } from "../data/types";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Perfiles que lo muestran por defecto. */
  profiles: BusinessProfile[];
  /** Funcionalidad del backend que lo habilita; sin ella aparece "próximamente". */
  feature?: Feature;
  /** Fase del roadmap en que llega al escritorio. */
  phase: number;
  children?: { label: string; href: string }[];
}

const ALL: BusinessProfile[] = ["emprendedor", "negocio", "empresa"];

export const NAV: NavItem[] = [
  { id: "inicio", label: "Inicio", icon: Home, href: "/inicio", profiles: ALL, feature: "dashboard", phase: 12 },
  {
    id: "vender", label: "Vender", icon: ShoppingBag, href: "/ventas", profiles: ALL, feature: "ventas", phase: 5,
    children: [
      { label: "Ventas", href: "/ventas" },
      { label: "Cotizaciones", href: "/ventas?tab=cotizaciones" },
      { label: "Pendientes de documentación", href: "/ventas?tab=pendientes_doc" },
    ],
  },
  { id: "clientes", label: "Clientes", icon: Users, href: "/clientes", profiles: ALL, feature: "clientes", phase: 1 },
  { id: "productos", label: "Productos y servicios", icon: Package, href: "/productos", profiles: ALL, feature: "productos", phase: 5 },
  { id: "comprar", label: "Comprar", icon: ShoppingCart, href: "/compras", profiles: ["negocio", "empresa"], feature: "compras", phase: 6 },
  { id: "inventario", label: "Inventario", icon: Boxes, href: "/inventario", profiles: ALL, phase: 7 },
  { id: "dinero", label: "Dinero", icon: Banknote, href: "/dinero", profiles: ALL, phase: 8 },
  { id: "comex", label: "COMEX", icon: Ship, href: "/comex", profiles: ["empresa"], feature: "comex", phase: 9 },
  { id: "contabilidad", label: "Contabilidad", icon: Landmark, href: "/contabilidad", profiles: ["empresa"], phase: 10 },
  { id: "analisis", label: "Análisis y reportes", icon: BarChart3, href: "/analisis", profiles: ["negocio", "empresa"], phase: 12 },
  { id: "documentos", label: "Documentos", icon: FileText, href: "/documentos", profiles: ["negocio", "empresa"], phase: 4 },
];

export const NAV_FOOTER: NavItem[] = [
  { id: "negocio", label: "Mi negocio", icon: Building2, href: "/config/negocio", profiles: ALL, feature: "negocio", phase: 4 },
  { id: "config", label: "Configuración", icon: Settings, href: "/config/respaldos", profiles: ALL, phase: 1 },
];

/** Módulos visibles para el perfil, más los que la persona decidió mostrar. */
export function visibleNav(profile: BusinessProfile, extra: string[]): NavItem[] {
  return NAV.filter((n) => n.profiles.includes(profile) || extra.includes(n.id));
}

export function hiddenNav(profile: BusinessProfile, extra: string[]): NavItem[] {
  return NAV.filter((n) => !n.profiles.includes(profile) && !extra.includes(n.id));
}
