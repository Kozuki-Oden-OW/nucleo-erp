// Sesión del negocio abierto: quién opera y qué puede hacer. La interfaz solo oculta lo que la
// persona no puede usar; el backend vuelve a verificar cada permiso.
import { createContext, useContext, type ReactNode } from "react";
import type { SessionInfo } from "../data/types";

interface Ctx {
  session: SessionInfo;
  setSession: (s: SessionInfo) => void;
  can: (perm: string) => boolean;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ session, setSession, children }: { session: SessionInfo; setSession: (s: SessionInfo) => void; children: ReactNode }) {
  const perms = new Set(session.user?.permissions ?? []);
  return <SessionCtx.Provider value={{ session, setSession, can: (p) => perms.has(p) }}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider ausente");
  return c;
}
