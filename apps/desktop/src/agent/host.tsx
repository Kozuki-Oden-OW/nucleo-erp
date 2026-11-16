// Atiende en la ventana las llamadas que Claude hace a NÚCLEO (ver agent.rs): las ejecuta con la misma
// interfaz y el mismo Backend que usa la persona, muestra el cursor de Claude y responde.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBackend, type Backend } from "../data";
import { activity } from "./cursor";
import { runTool, TOOL_DEFS, type AgentLevel, type ToolResult } from "./tools";

export interface AgentView {
  enabled: boolean;
  level: AgentLevel;
  running: boolean;
  calls: number;
  last_call: string | null;
  exe_path: string;
  claude_config_path: string | null;
  claude_configured: boolean;
}

/** En la demostración no hay servidor local: el estado vive en memoria y sirve para probar las herramientas. */
let demoView: AgentView = {
  enabled: true, level: "completo", running: false, calls: 0, last_call: null, exe_path: "", claude_config_path: null, claude_configured: false,
};

export async function agentSettings(backend: Backend): Promise<AgentView> {
  return backend.kind === "tauri" ? invoke<AgentView>("agent_settings") : { ...demoView };
}

export async function updateAgent(backend: Backend, enabled: boolean, level: AgentLevel): Promise<AgentView> {
  if (backend.kind === "tauri") return invoke<AgentView>("agent_update", { enabled, level });
  demoView = { ...demoView, enabled, level };
  return { ...demoView };
}

export async function connectClaude(backend: Backend): Promise<AgentView> {
  if (backend.kind !== "tauri") throw new Error("La conexión con la app de Claude está en la versión instalada de NÚCLEO.");
  return invoke<AgentView>("agent_connect_claude");
}

const LABEL: Record<string, string> = {
  ver_pantalla: "mirando la pantalla", ir_a: "abriendo una sección", desplazar: "desplazando", clic: "haciendo clic", escribir: "escribiendo",
  elegir: "eligiendo una opción", tecla: "usando el teclado", resumen_negocio: "revisando el resumen", buscar: "buscando",
  buscar_clientes: "buscando clientes", buscar_productos: "buscando productos", buscar_proveedores: "buscando proveedores",
  listar_ventas: "revisando ventas", listar_gastos: "revisando gastos", datos_de_apoyo: "revisando categorías y cuentas",
  crear_cliente: "creando un cliente", crear_proveedor: "creando un proveedor", crear_producto: "creando un producto",
  crear_venta_borrador: "preparando una venta", registrar_gasto: "registrando un gasto", confirmar_venta: "confirmando una venta",
  registrar_cobro: "registrando un cobro",
};

declare global {
  interface Window {
    /** Acceso de prueba a las herramientas (demostración y pruebas automáticas). */
    __nucleoAgent?: { tools: typeof TOOL_DEFS; call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult> };
  }
}

export function AgentHost() {
  const backend = useBackend();
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const run = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const view = await agentSettings(backend).catch(() => null);
      if (!view?.enabled) return { content: [{ type: "text", text: "El acceso de Claude a NÚCLEO está desactivado." }], isError: true };
      activity(`Claude está usando NÚCLEO · ${LABEL[name] ?? name}`, () => { void updateAgent(backend, false, view.level); });
      return runTool(backend, view.level, name, args);
    };
    // Una llamada a la vez, en orden.
    const serial = (name: string, args: Record<string, unknown>) => {
      const p = queue.current.then(() => run(name, args));
      queue.current = p.catch(() => {});
      return p;
    };

    if (backend.kind !== "tauri") {
      window.__nucleoAgent = { tools: TOOL_DEFS, call: (name, args = {}) => serial(name, args) };
      return () => { delete window.__nucleoAgent; };
    }
    let off: (() => void) | undefined;
    let alive = true;
    void listen<{ id: number; name: string; arguments: Record<string, unknown> }>("agent://call", async (e) => {
      const { id, name, arguments: args } = e.payload;
      let result: ToolResult;
      try { result = await serial(name, args ?? {}); } catch (err) { result = { content: [{ type: "text", text: String(err) }], isError: true }; }
      await invoke("agent_reply", { id, result: JSON.stringify(result) }).catch(() => {});
    }).then((u) => { if (alive) off = u; else u(); });
    return () => { alive = false; off?.(); };
  }, [backend]);

  return null;
}
