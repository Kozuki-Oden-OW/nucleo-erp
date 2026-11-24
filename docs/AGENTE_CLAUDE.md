# NÚCLEO ERP — Acceso para Claude (agentes)

> Estado: **implementado** (2026-11-16, sin publicar). Decisiones D-AGENT-01 a D-AGENT-05 en `DECISIONS.md`.

Permite que Claude, el asistente de Anthropic, use NÚCLEO por la persona: ve la pantalla como texto, la
recorre con su propio cursor (dentro de la ventana, sin tocar el mouse del computador) y registra datos
con las mismas reglas, permisos y auditoría del programa.

## 1. Cómo se activa

1. Configuración → **Claude** → «Permitir que Claude use NÚCLEO» (viene apagado).
2. Elegir qué puede hacer:

   | Nivel | Puede |
   |---|---|
   | Solo ver | `ver_pantalla`, `ir_a`, `desplazar` y las consultas (`resumen_negocio`, `buscar*`, `listar_*`, `datos_de_apoyo`, `listar_documentos_sii`, `consultar_estado_sii`, `consultar_libro_sii`, `pedidos_woocommerce`, `comparar_woocommerce`, `listar_accesos`, `cuentas_dinero`, `conciliacion_banco`) |
   | Crear borradores | Lo anterior + `crear_cliente`, `crear_proveedor`, `crear_producto`, `crear_venta_borrador`, `registrar_gasto` (queda por pagar), `registrar_envio` |
   | Acceso completo | Lo anterior + `clic`, `escribir`, `elegir`, `tecla`, `confirmar_venta`, `registrar_cobro`, gastos pagados y la facturación SII (`cargar_folios_sii`, `emitir_documento_sii`, `enviar_documentos_sii`, `crear_libro_sii`, `enviar_libro_sii`, `responder_intercambio_sii`), `sincronizar_woocommerce`, `registrar_ventas_mercadolibre`, `registrar_movimientos_banco` y `conciliar_movimiento_banco`. Enviar stock o precios a la tienda WooCommerce no es una herramienta: lo confirma la persona en la pantalla. Enviar al SII es irreversible: Claude muestra el resumen y espera la confirmación de la persona en el chat |

   Siempre valen además los permisos del usuario con que está abierta la sesión.
3. «Instalar en Claude» abre en la app de Claude la extensión **NucleoERP.mcpb** (formato MCPB) y la
   persona presiona Instalar. Si no se abre, se arrastra el archivo a Claude → Configuración →
   Extensiones.

   Se usa una extensión y no el archivo `claude_desktop_config.json` porque en Windows la app de Claude
   se instala como paquete MSIX (Microsoft Store, WinGet y también `claude-setup.exe`): lee su
   configuración desde `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`, su
   botón «Editar configuración» abre otro archivo y, según la versión, ignora los servidores de ese
   archivo. Las extensiones se instalan desde la propia app y funcionan siempre.

## 2. Arquitectura

```
App de Claude ──stdio (MCP)──▶ extensión NucleoERP.mcpb ──HTTP 127.0.0.1 + llave──▶ ventana de NÚCLEO
                               (Node.js integrado de Claude)                       (servidor en Rust → evento
                                                                                    a la interfaz → herramienta)
```

- **Extensión** (`tools/claude-extension/`, armada con `tools/build_claude_extension.py` y guardada en
  `apps/desktop/src-tauri/resources/`): `server/index.js` sin dependencias, con la misma lista de
  herramientas (`tools.json`, el CI verifica que esté al día). Busca el archivo de conexión en las
  carpetas posibles y, si uno quedó de una sesión anterior, prueba el siguiente.

- **Puente alternativo** (`agent.rs::bridge`): el mismo ejecutable con `--mcp`, para otros clientes MCP. Habla MCP (JSON-RPC, un mensaje por
  línea), responde `initialize` y `tools/list` por sí mismo —Claude conoce las herramientas aunque
  NÚCLEO esté cerrado— y reenvía `tools/call`. Si NÚCLEO está cerrado o el acceso apagado, devuelve un
  error que explica qué hacer.
- **Servidor local** (`agent.rs`): solo existe con el acceso activado. Escucha en `127.0.0.1` en un
  puerto al azar, exige una llave de 192 bits nueva en cada arranque y la deja, con el puerto, en
  `%LOCALAPPDATA%\NucleoERP\agent-endpoint.json` (carpeta del usuario), que se borra al desactivar
  el acceso y al cerrar NÚCLEO. Atiende una llamada a la vez.
- **Interfaz** (`src/agent/`): `tools.json` (lista compartida con Rust), `tools.ts` (ejecución, niveles),
  `dom.ts` (lectura de la pantalla y acciones), `cursor.ts` (cursor y aviso), `host.tsx` (recibe el
  evento `agent://call` y responde con `agent_reply`).

## 3. Lo que Claude ve

`ver_pantalla` devuelve la sección, el diálogo abierto (si lo hay, solo se puede usar lo de adentro),
los avisos, el contenido —las tablas como filas «celda | celda»— y cada control con un identificador
`[eN]`, su tipo, su valor y su estado. Cada acción devuelve la pantalla nueva.

## 4. Resguardos

- Apagado por defecto; se apaga desde Configuración o con «Detener» en el aviso «Claude está usando
  NÚCLEO» que aparece durante la actividad.
- La auditoría registra al usuario con la marca «(Claude)» mientras se atiende una llamada.
- Claude no escribe contraseñas (los campos de contraseña se rechazan) ni ve la clave de recuperación
  (`data-agent-secret`). Las confirmaciones marcadas `data-agent-human` las hace solo la persona.
- Mover dinero (confirmar ventas, cobros, gastos pagados) exige «Acceso completo».
- Lo que Claude lee para hacer su trabajo se envía a Claude (Anthropic); los datos siguen guardados solo
  en el computador. La pantalla de configuración lo dice.

## 5. Pruebas

- Rust: `agent::tests` (lista de herramientas, respuestas del puente, fusión de la configuración de
  Claude, llave del servidor).
- Interfaz: `src/agent/tools.test.ts` (niveles, duplicados por RUT, venta → confirmación → cobro).
- De punta a punta (manual): la app real bajo Xvfb, conversando por el puente `--mcp` como lo haría
  Claude (crear negocio por pantalla, crear cliente, producto, venta y cobro; auditoría con «(Claude)»).

## 6. Pendientes

- Probado en Windows con la extensión (2026-11-18): resumen y lectura de pantalla desde Claude.
- Captura de imagen de la ventana como herramienta opcional (hoy la pantalla se entrega como texto).
- Herramientas para compras, inventario e importaciones.

## 7. Tareas nuevas del agente (pedidas por el dueño el 22 y 23-11-2026)

Lista de trabajo para el agente (Claude por la extensión hoy; el Asistente NÚCLEO después). El diseño de
cada una está en `docs/INTEGRACIONES.md` (I4, I7) y `docs/ROADMAP.md` («Ideas para más adelante»). Se
construyen después de la certificación del SII.

| # | Tarea | Qué hace el agente | Estado |
|---|---|---|---|
| 1 | **Gestor de contraseñas de NÚCLEO** | Pide ingresos a sitios con usuarios de solo lectura, sin ver ni escribir la clave (funciones abajo) | Guardar accesos y `listar_accesos`: construido el 23-11-2026. Pedir y autorizar el ingreso: por construir (con la extensión) |
| 2 | **Aviso de autorización** | Cada ingreso pedido por el agente avisa al dueño con «Autorizo / No autorizo»: en el PC, por correo, por WhatsApp y en la app del celular | Por construir (PC primero, luego correo, luego WhatsApp) |
| 3 | **Extensión de Chrome para NÚCLEO** | Conecta Chrome con NÚCLEO para trabajar en sitios sin API con la sesión de la empresa | Por construir |
| 4 | **Revisar cartolas del banco** | Con el usuario de solo lectura (BCI primero): saldo, ingresos, egresos y glosa; propone qué venta quedó pagada. Nunca transferencias ni pagos | Construido el 24-11-2026 con la sesión que abre el dueño: `registrar_movimientos_banco`, `conciliacion_banco` y `conciliar_movimiento_banco` (receta `docs/recetas/cierre-diario.md`). El ingreso sin el dueño espera el usuario de lectura y la extensión; la API de notificaciones de BCI queda como vía futura |
| 5 | **Revisar Mercado Libre** | Con el colaborador de solo lectura: abre el **detalle de cada venta** (cliente, RUT, giro, factura subida, reclamos, cobro) y cuadra con NÚCLEO. Receta en `docs/recetas/mercadolibre-revision-ventas.md` | Colaborador creado; primera revisión a mano el 23-11-2026. Lo leído se registra con `registrar_ventas_mercadolibre` (descuenta stock de lo despachado desde el 23-11-2026; RC-5+ de Mercado Libre = P-00004 en NÚCLEO) |
| 6 | **Crear órdenes de transporte** | Desde un envío de NÚCLEO, crea la OT en el courier (Bluexpress primero: Punto Market Plaza Ñuñoa, talla S hasta 16 equipos y M desde 17, sin mercancías peligrosas); se detiene antes de pagar | Por construir (receta Bluexpress escrita) |
| 7 | **Ingreso automático del robot** | NÚCLEO entra solo con el usuario de lectura, descarga cartola y ventas y las deja importadas; el agente cuadra desde NÚCLEO sin entrar al banco | Por construir |
| 8 | **Folios y consultas en sii.cl** | Ayuda a descargar folios (CAF) y a consultar la empresa con la sesión que inició la persona | Por construir (con la extensión de Chrome) |
| 9 | **Asistente NÚCLEO (plan Premium)** | El mismo conjunto de herramientas, dentro de NÚCLEO, con la API de Anthropic | Idea |
| 10 | **Tienda WooCommerce** | Sincroniza los pedidos pagados (cliente, venta que descuenta stock y envío por despachar), lista los pedidos y compara stock y precios con la tienda. Enviar cambios a la tienda lo confirma la persona | Construido el 23-11-2026 (falta probar en la tienda real) |

### Funciones del gestor de contraseñas

Lo que hace la persona (en Configuración → Integraciones → Accesos):

- Guarda un acceso por sitio: nombre, dirección de ingreso, usuario, clave y tipo (**solo lectura** u
  operador sin facultad de pago). La clave se escribe en NÚCLEO, se guarda en la base cifrada y nunca
  se muestra de vuelta (solo «guardada»).
- Elige por acceso quién puede pedirlo (el robot programado, el agente, ambos) y por dónde llega el
  aviso (PC, correo, WhatsApp, app).
- Cambia la clave, desactiva o borra el acceso, y ve el historial de ingresos.

Lo que puede hacer el agente (herramientas nuevas):

| Herramienta | Qué hace |
|---|---|
| `listar_accesos` | Sitios con acceso guardado, usuario y tipo. Nunca la clave |
| `pedir_ingreso {acceso, motivo}` | Crea una solicitud de un solo uso que vence en minutos y dispara el aviso al dueño |
| `estado_ingreso {solicitud}` | Pendiente, autorizada (sesión abierta), rechazada o vencida |
| `cerrar_sesion {acceso}` | Cierra la sesión del sitio al terminar la tarea |

Lo que hace NÚCLEO solo:

- Con la autorización, completa usuario y clave en el navegador del robot o de la extensión, **solo si
  la dirección de la página es la guardada en el acceso** (protege de páginas falsas).
- Registra en la auditoría cada solicitud: quién la pidió, para qué, quién autorizó o rechazó y desde
  qué canal.
- Avisa cuando una clave dejó de funcionar o el sitio pide cambiarla.

Límites que no cambian:

- No hay herramienta que entregue una clave al agente, ni un botón que el agente pueda pulsar para
  completarla: la autorización es siempre de la persona.
- Solo accesos de solo lectura u operador sin pago. No se guardan claves de apoderado del banco, de
  Google, de la Clave Tributaria ni datos de tarjetas.
- Segundo factor, captchas, códigos de verificación y pagos los hace la persona.
