// Levanta el servidor del puente con un WhatsApp de mentira, para probar NÚCLEO contra el puente
// real por HTTP sin vincular un teléfono:  NUCLEO_WSP_KEY=… node test/puente-simulado.mjs [puerto]
import { iniciarServidor, digitos } from "../servidor.mjs";

const enviados = [];
const wsp = {
  estado: async () => ({ estado: "listo", numero: "56981875679", nombre: "Data Logger (simulado)" }),
  qr: async () => null,
  chats: async ({ limite }) => [
    { id: "56911111111@c.us", nombre: "Laboratorio Alfa", telefono: "56911111111", no_leidos: 2, grupo: false, ultimo: { texto: "¿Tienen stock del RC-5+?", de_mi: false, fecha: new Date().toISOString() } },
    { id: "56922222222@c.us", nombre: "Clínica Sur", telefono: "56922222222", no_leidos: 0, grupo: false, ultimo: { texto: "Gracias", de_mi: false, fecha: new Date().toISOString() } },
  ].slice(0, limite),
  mensajes: async (chat) => ({ chat: { id: chat, nombre: "Laboratorio Alfa", telefono: digitos(chat), no_leidos: 2, grupo: false }, mensajes: [{ id: "m1", de_mi: false, texto: "¿Tienen stock del RC-5+?", tipo: "chat", fecha: new Date().toISOString(), adjunto: false }, ...enviados.map((e, i) => ({ id: `e${i}`, de_mi: true, texto: e.texto || `[archivo] ${e.archivo?.nombre}`, tipo: e.archivo ? "document" : "chat", fecha: new Date().toISOString(), adjunto: !!e.archivo }))] }),
  enviar: async (m) => { enviados.push(m); return { id: `env-${enviados.length}`, chat: m.chat || `${m.telefono}@c.us` }; },
};
const puerto = Number(process.argv[2] ?? 47622);
await iniciarServidor({ wsp, llave: process.env.NUCLEO_WSP_KEY, puerto, host: "127.0.0.1", log: { info() {}, error: console.error } });
console.log(`puente simulado en http://127.0.0.1:${puerto}`);
