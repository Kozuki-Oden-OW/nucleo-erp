// Servidor del puente, independiente de la librería de WhatsApp (se prueba con un doble).
// Solo responde a quien trae la llave; NÚCLEO es el único que la conoce. No guarda mensajes:
// cada consulta se lee de la sesión de WhatsApp en el momento.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const MAX_BODY = 25 * 1024 * 1024; // un PDF adjunto en base64
const LIMITE_MAX = 200;

/** Solo dígitos de un teléfono ("+56 9 8187 5679" → "56981875679"). */
export const digitos = (s) => String(s ?? "").replace(/\D/g, "");

function mismaLlave(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function entero(v, porDefecto, max = LIMITE_MAX) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : porDefecto;
}

class Rechazo extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

async function cuerpo(req) {
  let total = 0; const partes = [];
  for await (const p of req) {
    total += p.length;
    if (total > MAX_BODY) throw new Rechazo(413, "el archivo es demasiado grande (máximo 15 MB)");
    partes.push(p);
  }
  if (!partes.length) return {};
  try { return JSON.parse(Buffer.concat(partes).toString("utf8")); }
  catch { throw new Rechazo(400, "el cuerpo no es JSON válido"); }
}

/**
 * Crea el manejador HTTP.
 * `wsp` es el adaptador de WhatsApp: estado(), qr(), chats({limite, grupos}), mensajes(chat, limite),
 * enviar({chat, telefono, texto, archivo}).
 */
export function crearManejador({ wsp, llave, log = console }) {
  if (!llave || String(llave).length < 24) throw new Error("la llave del puente debe tener al menos 24 caracteres");
  return async function manejar(req, res) {
    const responder = (status, obj) => {
      const b = Buffer.from(JSON.stringify(obj));
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": b.length, "cache-control": "no-store" });
      res.end(b);
    };
    try {
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("Bearer ") || !mismaLlave(auth.slice(7), llave)) throw new Rechazo(401, "llave no válida");
      const url = new URL(req.url, "http://puente");
      const ruta = url.pathname.replace(/\/+$/, "") || "/";
      const q = url.searchParams;

      if (req.method === "GET" && ruta === "/estado") {
        const e = await wsp.estado();
        return responder(200, { puente: "nucleo-whatsapp", version: 1, ...e, qr: e.estado === "qr" ? await wsp.qr() : null });
      }
      // Todo lo demás necesita la sesión lista.
      const e = await wsp.estado();
      if (e.estado !== "listo") throw new Rechazo(409, e.estado === "qr" ? "falta vincular el número: escanea el código QR" : "WhatsApp aún se está conectando; intenta en un momento");

      if (req.method === "GET" && ruta === "/chats") {
        const lista = await wsp.chats({ limite: entero(q.get("limite"), 30), grupos: q.get("grupos") === "1" });
        return responder(200, { chats: q.get("no_leidos") === "1" ? lista.filter((c) => c.no_leidos > 0) : lista });
      }
      const m = /^\/chats\/([^/]+)\/mensajes$/.exec(ruta);
      if (req.method === "GET" && m) {
        return responder(200, await wsp.mensajes(decodeURIComponent(m[1]), entero(q.get("limite"), 30)));
      }
      if (req.method === "POST" && ruta === "/enviar") {
        const b = await cuerpo(req);
        const texto = typeof b.texto === "string" ? b.texto : "";
        const chat = typeof b.chat === "string" ? b.chat.trim() : "";
        const telefono = digitos(b.telefono);
        if (!chat && !telefono) throw new Rechazo(400, "indica el chat o el teléfono");
        if (telefono && (telefono.length < 8 || telefono.length > 15)) throw new Rechazo(400, "el teléfono debe ir con código de país, por ejemplo 56912345678");
        let archivo = null;
        if (b.archivo) {
          const nombre = String(b.archivo.nombre ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim();
          const datos = String(b.archivo.base64 ?? "");
          if (!nombre || !datos) throw new Rechazo(400, "el archivo necesita nombre y contenido");
          archivo = { nombre, base64: datos, tipo: String(b.archivo.tipo ?? "application/pdf") };
        }
        if (!texto.trim() && !archivo) throw new Rechazo(400, "falta el texto del mensaje");
        if (texto.length > 4000) throw new Rechazo(400, "el mensaje es demasiado largo (máximo 4.000 caracteres)");
        const r = await wsp.enviar({ chat, telefono, texto, archivo });
        log.info?.({ chat: r.chat }, "mensaje enviado");
        return responder(200, r);
      }
      throw new Rechazo(404, "ruta desconocida");
    } catch (e) {
      const status = e instanceof Rechazo ? e.status : 500;
      if (status === 500) log.error?.({ err: String(e?.stack ?? e) }, "error en el puente");
      responder(status, { error: e instanceof Rechazo ? e.message : `error del puente: ${String(e?.message ?? e)}` });
    }
  };
}

export function iniciarServidor({ wsp, llave, puerto = 47620, host = "0.0.0.0", log = console }) {
  const s = createServer(crearManejador({ wsp, llave, log }));
  return new Promise((ok, fail) => { s.once("error", fail); s.listen(puerto, host, () => ok(s)); });
}
