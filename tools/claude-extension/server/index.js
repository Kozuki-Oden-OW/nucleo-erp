#!/usr/bin/env node
// Extensión de NÚCLEO ERP para la app de Claude (MCPB).
// Habla MCP por la entrada y salida estándar (JSON-RPC, un mensaje por línea), entrega la lista de
// herramientas y reenvía cada llamada al servidor local que abre NÚCLEO cuando la persona activa
// Configuración → Claude. No guarda datos ni se conecta a Internet: solo a 127.0.0.1.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const readline = require("node:readline");

const TOOLS = require("./tools.json");
const VERSION = require("../manifest.json").version;

const INSTRUCTIONS =
  "NÚCLEO ERP es el sistema de gestión del negocio (ventas, clientes, productos, inventario, gastos, dinero e impuestos). " +
  "Para trabajar en la pantalla: usa ver_pantalla, luego clic, escribir o elegir con los identificadores [eN] que entrega; cada acción devuelve la pantalla nueva. " +
  "Para datos usa las herramientas directas (buscar_*, crear_*, registrar_gasto, crear_venta_borrador). Los montos están en pesos chilenos; los precios de productos son netos (sin IVA). " +
  "No inventes RUT ni datos de clientes: si falta algo, pregúntalo. Nunca escribas contraseñas.";

const CLOSED =
  "NÚCLEO no está abierto o el acceso para Claude está desactivado. Abre NÚCLEO ERP y activa Configuración → Claude → «Permitir que Claude use NÚCLEO».";

/** Carpetas donde puede estar la carpeta de datos de NÚCLEO (la misma que usa la ventana). */
function dataDirs() {
  const dirs = [];
  if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "NucleoERP"));
    if (process.env.USERPROFILE) dirs.push(path.join(process.env.USERPROFILE, "AppData", "Local", "NucleoERP"));
    dirs.push(path.join(os.homedir(), "AppData", "Local", "NucleoERP"));
  } else if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Application Support", "NucleoERP"));
  } else {
    dirs.push(path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "NucleoERP"));
  }
  return [...new Set(dirs)];
}

/** Datos de conexión que deja NÚCLEO al activar el acceso (todos los que haya), y lo que se revisó. */
function endpoints() {
  const found = [];
  const tried = [];
  for (const dir of dataDirs()) {
    const file = path.join(dir, "agent-endpoint.json");
    try {
      const ep = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!found.some((x) => x.port === ep.port && x.token === ep.token)) found.push(ep);
    } catch (e) {
      tried.push(`${file}: ${e.code || e.message}`);
    }
  }
  return { found, tried };
}

const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

function toolsList() {
  return {
    tools: TOOLS.map((t) => {
      const need = t.nivel === "completo" ? " Requiere «Acceso completo»." : t.nivel === "borradores" ? " Requiere «Crear borradores» o «Acceso completo»." : "";
      return { name: t.name, description: t.description + need, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.nivel === "ver" } };
    }),
  };
}

function post(ep, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host: "127.0.0.1", port: ep.port, path: "/call", method: "POST", timeout: 150_000,
        headers: { Authorization: `Bearer ${ep.token}`, "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("tiempo agotado")));
    req.on("error", reject);
    req.end(data);
  });
}

async function callTool(name, args) {
  const { found, tried } = endpoints();
  if (!found.length) return toolError(`${CLOSED}\n\nDetalle técnico: no se encontró el archivo de conexión (${tried.join(" · ")}).`);
  const failures = [];
  // Si quedó un archivo de una sesión anterior, se prueba el siguiente.
  for (const ep of found) {
    try {
      const r = await post(ep, { name, arguments: args || {} });
      if (r.status === 200) {
        try { return JSON.parse(r.body); } catch { return toolError("Respuesta inválida de NÚCLEO."); }
      }
      if (r.status === 401) { failures.push(`${ep.port}: llave antigua`); continue; }
      return toolError(`NÚCLEO respondió ${r.status}: ${r.body}`);
    } catch (e) {
      failures.push(`${ep.port}: ${e.code || e.message}`);
    }
  }
  return toolError(`${CLOSED} Si NÚCLEO está abierto, ciérralo y vuelve a abrirlo.\n\nDetalle técnico: ${failures.join(" · ")}.`);
}

async function answer(msg) {
  if (msg === null || typeof msg !== "object" || !("id" in msg)) return null; // notificación
  const { id, method, params = {} } = msg;
  let result;
  switch (method) {
    case "initialize":
      result = {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nucleo-erp", title: "NÚCLEO ERP", version: VERSION },
        instructions: INSTRUCTIONS,
      };
      break;
    case "ping": result = {}; break;
    case "tools/list": result = toolsList(); break;
    case "tools/call": result = await callTool(params.name, params.arguments); break;
    case "resources/list": result = { resources: [] }; break;
    case "prompts/list": result = { prompts: [] }; break;
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método no disponible: ${method}` } };
  }
  return { jsonrpc: "2.0", id, result };
}

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

// Las llamadas se atienden en orden: Claude trabaja paso a paso sobre la misma pantalla.
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }); return; }
  queue = queue.then(() => answer(msg)).then((r) => { if (r) send(r); }).catch((e) => {
    if (msg && "id" in msg) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e) } });
  });
});
