// Preferencias de la persona que usa este computador: tema, densidad, vista y menú.
// Se guardan localmente (no son datos del negocio) y nunca salen del equipo.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ViewMode } from "../data/types";

export type Theme = "sistema" | "claro" | "oscuro";
export type Density = "comoda" | "compacta";

export interface Prefs {
  theme: Theme;
  density: Density;
  view: ViewMode;
  sidebarCollapsed: boolean;
  /** Módulos ocultos por el perfil que la persona decidió mostrar igual (Blueprint §3.2). */
  extraModules: string[];
}

const DEFAULTS: Prefs = { theme: "sistema", density: "comoda", view: "simple", sidebarCollapsed: false, extraModules: [] };
const KEY = "nucleo.prefs.v1";

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const Ctx = createContext<{ prefs: Prefs; set: (patch: Partial<Prefs>) => void }>({ prefs: DEFAULTS, set: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento: se usan los valores por defecto */ }
    const root = document.documentElement;
    if (prefs.theme === "sistema") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme === "oscuro" ? "dark" : "light");
    root.setAttribute("data-density", prefs.density);
  }, [prefs]);
  return <Ctx.Provider value={{ prefs, set: (patch) => setPrefs((p) => ({ ...p, ...patch })) }}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  return useContext(Ctx);
}
