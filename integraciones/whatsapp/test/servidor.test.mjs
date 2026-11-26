// El puente con un WhatsApp de mentira: llave, estados, lectura y envío.
import test from "node:test";
import assert from "node:assert/strict";
import { iniciarServidor, digitos } from "../servidor.mjs";

const LLAVE = "llave-de-prueba-0123456789abcdef";

function doble() {
  const w = {
    situacion: "listo", enviados: [],
    estado: async () => ({ estado: w.situacion, numero: w.situacion === "listo" ? "56981875679" : null, nombre: "Data Logger" }),
    qr: async () => "data:image/png;base64,AAAA",
    chats: async ({ limite, grupos }) => [
      { id: "56911111111@c.us", nombre: "Laboratorio Alfa", telefono: "56911111111", no_leidos: 2, grupo: false, ultimo: { texto: "¿Tienen stock del RC-5+?", de_mi: false, fecha: "2026-11-25T14:00:00.000Z" } },
      { id: "56922222222@c.us", nombre: "Clínica Sur", telefono: "56922222222", no_leidos: 0, grupo: false, ultimo: { texto: "Gracias", de_mi: false, fecha: "2026-11-25T13:00:00.000Z" } },
      ...(grupos ? [{ id: "1203@g.us", nombre: "Familia", telefono: null, no_leidos: 9, grupo: true, ultimo: null }] : []),
    ].slice(0, limite),
    mensajes: async (chat, limite) => ({ chat: { id: chat, nombre: "Laboratorio Alfa", telefono: digitos(chat) }, mensajes: [{ id: "m1", de_mi: false, texto: "Hola", tipo: "chat", fecha: "2026-11-25T13:59:00.000Z", adjunto: false }].slice(0, limite) }),
    enviar: async (m) => { w.enviados.push(m); return { id: "env-1", chat: m.chat || `${m.telefono}@c.us` }; },
  };
  return w;
}

async function con(fn) {
  const wsp = doble();
  const s = await iniciarServidor({ wsp, llave: LLAVE, puerto: 0, host: "127.0.0.1", log: { info() {}, error() {} } });
  const base = `http://127.0.0.1:${s.address().port}`;
  const pedir = async (ruta, { metodo = "GET", cuerpo, llave = LLAVE } = {}) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { ...(llave ? { authorization: `Bearer ${llave}` } : {}), "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: await r.json() };
  };
  try { await fn({ wsp, pedir }); } finally { await new Promise((ok) => s.close(ok)); }
}

test("sin la llave no entrega nada", async () => {
  await con(async ({ pedir }) => {
    assert.equal((await pedir("/estado", { llave: "" })).status, 401);
    assert.equal((await pedir("/chats", { llave: "otra-llave-de-la-misma-largura-x" })).status, 401);
  });
  assert.throws(() => iniciarServidor({ wsp: doble(), llave: "corta" }));
});

test("estado: muestra el QR mientras no esté vinculado y no deja leer", async () => {
  await con(async ({ wsp, pedir }) => {
    wsp.situacion = "qr";
    const e = await pedir("/estado");
    assert.equal(e.json.estado, "qr");
    assert.match(e.json.qr, /^data:image\/png/);
    const c = await pedir("/chats");
    assert.equal(c.status, 409);
    assert.match(c.json.error, /QR/);
    wsp.situacion = "listo";
    const ok = await pedir("/estado");
    assert.deepEqual([ok.json.estado, ok.json.qr, ok.json.numero], ["listo", null, "56981875679"]);
  });
});

test("lee chats y mensajes; los grupos solo si se piden", async () => {
  await con(async ({ pedir }) => {
    const todos = await pedir("/chats?limite=10");
    assert.equal(todos.json.chats.length, 2);
    assert.equal((await pedir("/chats?no_leidos=1")).json.chats.length, 1);
    assert.equal((await pedir("/chats?grupos=1")).json.chats.length, 3);
    const m = await pedir(`/chats/${encodeURIComponent("56911111111@c.us")}/mensajes?limite=5`);
    assert.equal(m.json.chat.telefono, "56911111111");
    assert.equal(m.json.mensajes[0].texto, "Hola");
    assert.equal((await pedir("/otra")).status, 404);
  });
});

test("envía texto o un PDF, y rechaza lo incompleto", async () => {
  await con(async ({ wsp, pedir }) => {
    assert.equal((await pedir("/enviar", { metodo: "POST", cuerpo: { texto: "hola" } })).status, 400);
    assert.equal((await pedir("/enviar", { metodo: "POST", cuerpo: { telefono: "123", texto: "hola" } })).status, 400);
    assert.equal((await pedir("/enviar", { metodo: "POST", cuerpo: { chat: "56911111111@c.us", texto: "  " } })).status, 400);
    assert.equal((await pedir("/enviar", { metodo: "POST", cuerpo: { chat: "x@c.us", texto: "a".repeat(4001) } })).status, 400);
    const t = await pedir("/enviar", { metodo: "POST", cuerpo: { telefono: "+56 9 1111 1111", texto: "Sí, tenemos stock." } });
    assert.equal(t.status, 200);
    assert.equal(wsp.enviados[0].telefono, "56911111111");
    const a = await pedir("/enviar", { metodo: "POST", cuerpo: { chat: "56911111111@c.us", texto: "Adjunto la cotización.", archivo: { nombre: "COT-1529 Alfa.pdf", base64: "JVBERi0=" } } });
    assert.equal(a.status, 200);
    assert.deepEqual([wsp.enviados[1].archivo.nombre, wsp.enviados[1].archivo.tipo], ["COT-1529 Alfa.pdf", "application/pdf"]);
    assert.equal(wsp.enviados.length, 2);
  });
});
