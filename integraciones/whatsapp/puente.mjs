// Puente de WhatsApp para NÚCLEO ERP.
//
// Se vincula al número de la empresa como «dispositivo vinculado» (igual que WhatsApp Web): se
// escanea un código QR una sola vez y la sesión queda guardada en WSP_SESSION_DIR. No usa la API de
// Meta. NÚCLEO le habla por HTTP en este mismo computador, con una llave; el puente no guarda
// mensajes ni responde por su cuenta: solo lee lo que NÚCLEO pide y envía lo que NÚCLEO manda.
//
// Variables: NUCLEO_WSP_KEY (obligatoria, ≥ 24 caracteres), NUCLEO_WSP_PORT (47620),
// WSP_SESSION_DIR (/session), WSP_WEB_VERSION (versión fijada de WhatsApp Web; vacío = la última),
// PUPPETEER_EXECUTABLE_PATH (Chromium del sistema).
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import pkg from "whatsapp-web.js";
import { digitos, iniciarServidor } from "./servidor.mjs";

const { Client, LocalAuth, MessageMedia } = pkg;
const log = {
  info: (o, m) => console.log(JSON.stringify({ nivel: "info", t: new Date().toISOString(), msg: m ?? "", ...(typeof o === "object" ? o : { detalle: o }) })),
  error: (o, m) => console.error(JSON.stringify({ nivel: "error", t: new Date().toISOString(), msg: m ?? "", ...(typeof o === "object" ? o : { detalle: o }) })),
};

const llave = (process.env.NUCLEO_WSP_KEY ?? "").trim();
if (llave.length < 24) { log.error({}, "falta NUCLEO_WSP_KEY (la crea Iniciar-WhatsApp.ps1)"); process.exit(1); }
const puerto = Number(process.env.NUCLEO_WSP_PORT ?? 47620);
const sessionDir = process.env.WSP_SESSION_DIR ?? "/session";
mkdirSync(sessionDir, { recursive: true });

/** Chromium deja archivos Singleton* en el perfil; si el proceso anterior no cerró limpio, el nuevo
 * no puede abrirlo. Aquí corre un solo navegador, así que se limpian al iniciar. */
function soltarPerfil(dir, nivel = 0) {
  if (nivel > 4) return;
  let entradas = []; try { entradas = readdirSync(dir); } catch { return; }
  for (const e of entradas) {
    const p = path.join(dir, e);
    if (/^Singleton(Lock|Socket|Cookie)$/.test(e)) { try { rmSync(p, { force: true }); } catch {} continue; }
    try { if (statSync(p).isDirectory()) soltarPerfil(p, nivel + 1); } catch {}
  }
}
soltarPerfil(sessionDir);

// WhatsApp publica versiones de su web varias veces al día y la librería tarda en adaptarse: se fija
// una versión conocida (repositorio público wppconnect-team/wa-version). Vacío = la última.
const webVersion = (process.env.WSP_WEB_VERSION ?? "2.3000.1055167106-alpha").trim();
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionDir, clientId: "nucleo" }),
  ...(webVersion ? { webVersion, webVersionCache: { type: "remote", remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${webVersion}.html` } } : {}),
  puppeteer: { headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
});

let situacion = "iniciando"; // iniciando | qr | listo | desconectado
let qrActual = null;
let reinicios = 0, vigia = null;
const ESPERA_LISTO = Number(process.env.WSP_READY_TIMEOUT_MS ?? 120_000);
/** Si tras iniciar no llega «listo» a tiempo, se reinicia el cliente; al tercer intento el proceso
 * sale para que Docker lo levante limpio (WhatsApp Web a veces se queda cargando). */
function vigilar(motivo) {
  if (vigia) clearTimeout(vigia);
  vigia = setTimeout(async () => {
    if (situacion === "listo" || situacion === "qr") return;
    reinicios++;
    log.error({ motivo, reinicios }, "WhatsApp no quedó listo a tiempo; reiniciando");
    if (reinicios >= 3) process.exit(2);
    try { await client.destroy(); } catch {}
    soltarPerfil(sessionDir);
    client.initialize().then(() => vigilar("reinicio")).catch(() => process.exit(2));
  }, ESPERA_LISTO);
}
client.on("qr", async (qr) => { situacion = "qr"; qrActual = await QRCode.toDataURL(qr, { width: 360, margin: 2 }); log.info({}, "esperando que se escanee el código QR"); });
client.on("authenticated", () => { situacion = "iniciando"; qrActual = null; log.info({}, "sesión autenticada"); vigilar("autenticado"); });
client.on("auth_failure", (m) => log.error({ m }, "fallo de autenticación: borra la carpeta de sesión y vuelve a vincular"));
client.on("ready", () => { situacion = "listo"; qrActual = null; reinicios = 0; if (vigia) clearTimeout(vigia); log.info({}, "WhatsApp listo"); });
client.on("disconnected", (r) => {
  situacion = "desconectado"; log.error({ r }, "desconectado; se reintenta");
  setTimeout(() => { soltarPerfil(sessionDir); client.initialize().then(() => vigilar("reconexión")).catch((e) => log.error({ err: String(e) }, "no se pudo reconectar")); }, 10_000);
});

const fecha = (t) => (t ? new Date(t * 1000).toISOString() : null);
const recorte = (s, n) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n)}…` : t; };
const textoDe = (m) => (m.body && String(m.body).trim()) || (m.hasMedia || m.type !== "chat" ? `[${m.type === "document" ? "archivo" : m.type === "ptt" || m.type === "audio" ? "audio" : m.type === "image" ? "imagen" : m.type}]` : "");

/** Teléfono real de un chat. WhatsApp puede entregar el chat como «…@lid» (identidad vinculada), que
 * no es el número: se resuelve con getContactLidAndPhone; si no se puede, queda sin teléfono. */
async function telefonoDe(id) {
  if (id.endsWith("@c.us")) return digitos(id.replace(/@.*$/, ""));
  if (!id.endsWith("@lid")) return null;
  try {
    const [r] = await client.getContactLidAndPhone([id]);
    const pn = r?.pn;
    if (pn && /@c\.us$/.test(pn)) return digitos(pn.replace(/@.*$/, ""));
  } catch {}
  return null;
}

const wsp = {
  async estado() {
    const yo = situacion === "listo" ? client.info : null;
    return { estado: situacion, numero: yo?.wid?.user ?? null, nombre: yo?.pushname ?? null };
  },
  async qr() { return qrActual; },
  async chats({ limite, grupos }) {
    const todos = (await client.getChats()).filter((c) => (grupos || !c.isGroup) && c.id?._serialized !== "status@broadcast");
    todos.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    const salida = [];
    for (const c of todos.slice(0, limite)) {
      const id = c.id._serialized;
      const u = c.lastMessage;
      salida.push({
        id, nombre: c.name || null, telefono: c.isGroup ? null : await telefonoDe(id), no_leidos: c.unreadCount ?? 0, grupo: !!c.isGroup, archivado: !!c.archived,
        ultimo: u ? { texto: recorte(textoDe(u), 300), de_mi: !!u.fromMe, fecha: fecha(u.timestamp) } : null,
      });
    }
    return salida;
  },
  async mensajes(chatId, limite) {
    const chat = await client.getChatById(chatId);
    // fetchMessages no marca el chat como leído: la persona sigue viendo sus pendientes en el teléfono.
    const lista = await chat.fetchMessages({ limit: limite });
    return {
      chat: { id: chat.id._serialized, nombre: chat.name || null, telefono: chat.isGroup ? null : await telefonoDe(chat.id._serialized), no_leidos: chat.unreadCount ?? 0, grupo: !!chat.isGroup },
      mensajes: lista.filter((m) => m.type !== "e2e_notification" && m.type !== "notification_template")
        .map((m) => ({ id: m.id?._serialized ?? "", de_mi: !!m.fromMe, texto: recorte(textoDe(m), 4000), tipo: m.type, fecha: fecha(m.timestamp), adjunto: !!m.hasMedia })),
    };
  },
  async enviar({ chat, telefono, texto, archivo }) {
    let destino = chat;
    if (!destino) {
      // Por teléfono: se comprueba que el número tenga WhatsApp antes de escribirle.
      const id = await client.getNumberId(telefono);
      if (!id) throw new Error(`el número +${telefono} no tiene WhatsApp`);
      destino = id._serialized;
    }
    const m = archivo
      ? await client.sendMessage(destino, new MessageMedia(archivo.tipo, archivo.base64, archivo.nombre), { caption: texto || undefined })
      : await client.sendMessage(destino, texto);
    return { id: m.id?._serialized ?? "", chat: destino };
  },
};

const servidor = await iniciarServidor({ wsp, llave, puerto, log });
log.info({ puerto, webVersion: webVersion || "(última)" }, "puente de WhatsApp para NÚCLEO escuchando");
client.initialize().then(() => vigilar("inicio")).catch((e) => { log.error({ err: String(e) }, "no se pudo iniciar WhatsApp"); process.exit(1); });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { try { await client.destroy(); } catch {} servidor.close(); process.exit(0); });
