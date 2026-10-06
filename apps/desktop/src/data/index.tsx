import { createContext, useContext, type ReactNode } from "react";
import type { Backend } from "./backend";
import { DemoBackend } from "./demo/store";
import { TauriBackend } from "./tauri";

export * from "./backend";
export * from "./types";

/** En el escritorio (Tauri) usa los datos reales; en un navegador, la demostración. */
export function defaultBackend(): Backend {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  return inTauri ? new TauriBackend() : new DemoBackend();
}

export function createDemoBackend(): Backend {
  return new DemoBackend();
}

const Ctx = createContext<Backend | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  return <Ctx.Provider value={backend}>{children}</Ctx.Provider>;
}

export function useBackend(): Backend {
  const b = useContext(Ctx);
  if (!b) throw new Error("BackendProvider ausente");
  return b;
}
