# Puente de WhatsApp para NÚCLEO ERP

Conecta el WhatsApp de la empresa con NÚCLEO para que la persona (y Claude, por la extensión de
NÚCLEO) pueda **leer los chats y enviar mensajes desde NÚCLEO**, sin abrir WhatsApp Web en un
navegador.

## Cómo está hecho

- Se vincula al número como **dispositivo vinculado**, igual que WhatsApp Web: se escanea un código
  QR una sola vez y la sesión queda guardada en la carpeta `sesion/`. Usa la librería
  `whatsapp-web.js` (un Chromium sin ventana). **No es la API oficial de Meta**: no tiene costo por
  mensaje ni exige verificar la empresa, pero tampoco tiene su garantía; es para atención normal, no
  para envíos masivos.
- Corre en Docker, en el mismo computador que NÚCLEO. El puerto (47620) se publica solo en
  `127.0.0.1` y cada consulta lleva una llave que solo conoce NÚCLEO.
- **No guarda mensajes y no responde por su cuenta.** Lee lo que NÚCLEO pide en el momento y envía
  lo que NÚCLEO manda. Leer no marca los chats como leídos.
- WhatsApp permite hasta cuatro dispositivos vinculados por número: este puente ocupa uno.

## Activarlo

1. Tener Docker Desktop abierto.
2. En PowerShell, en esta carpeta: `powershell -ExecutionPolicy Bypass -File .\Iniciar-WhatsApp.ps1`
   (la primera vez construye la imagen y crea la llave).
3. En NÚCLEO → Configuración → Integraciones → WhatsApp: escribir la dirección y la llave que
   muestra el paso anterior, y guardar.
4. NÚCLEO muestra el código QR: en el teléfono, WhatsApp → Dispositivos vinculados → Vincular un
   dispositivo.

Para detenerlo: `docker compose -f compose.yml down`. Para desvincular el número: quitar el
dispositivo en el teléfono y borrar la carpeta `sesion/`.

## Qué ofrece a NÚCLEO

| Ruta | Para qué |
|---|---|
| `GET /estado` | `iniciando`, `qr` (con la imagen del código), `listo` (con el número) o `desconectado` |
| `GET /chats?limite=30&no_leidos=1` | Chats recientes: nombre, teléfono, no leídos y último mensaje |
| `GET /chats/{id}/mensajes?limite=30` | Mensajes de un chat (texto, quién, fecha) |
| `POST /enviar` | Envía un texto, con un PDF adjunto si se indica, a un chat o a un teléfono |

Pruebas del servidor con un WhatsApp simulado: `npm test`.
