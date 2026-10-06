// Sesión del negocio abierto: quién opera y qué puede hacer. La interfaz solo oculta lo que la
// persona no puede usar; el backend vuelve a verificar cada permiso.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SessionInfo } from "../data/types";

interface Ctx {
  session: SessionInfo;
  setSession: (s: SessionInfo) => void;
  can: (perm: string) => boolean;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ session, setSession, children }: { session: SessionInfo; setSession: (s: SessionInfo) => void; children: ReactNode }) {
  // Valor estable mientras no cambie la sesión: los efectos que dependen de `can` no se repiten.
  const value = useMemo<Ctx>(() => {
    const perms = new Set(session.user?.permissions ?? []);
    return { session, setSession, can: (p) => perms.has(p) };
  }, [session, setSession]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider ausente");
  return c;
}
