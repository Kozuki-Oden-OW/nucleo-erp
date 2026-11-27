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
   | Solo ver | `ver_pantalla`, `ir_a`, `desplazar` y las consultas (`resumen_negocio`, `buscar*`, `listar_*`, `datos_de_apoyo`, `listar_documentos_sii`, `consultar_estado_sii`, `consultar_libro_sii`, `pedidos_woocommerce`, `comparar_woocommerce`, `listar_accesos`, `cuentas_dinero`, `conciliacion_banco`) y el navegador en modo lectura (`web_abrir`, `web_leer`) |
   | Crear borradores | Lo anterior + `crear_cliente`, `crear_proveedor`, `crear_producto`, `crear_venta_borrador`, `registrar_gasto` (queda por pagar), `registrar_envio` |
   | Acceso completo | Lo anterior + `clic`, `escribir`, `elegir`, `tecla`, `confirmar_venta`, `registrar_cobro`, gastos pagados y la facturación SII (`cargar_folios_sii`, `emitir_documento_sii`, `enviar_documentos_sii`, `crear_libro_sii`, `enviar_libro_sii`, `responder_intercambio_sii`), `sincronizar_woocommerce`, `registrar_ventas_mercadolibre`, `registrar_movimientos_banco`, `conciliar_movimiento_banco` y el Navegador de NÚCLEO (`web_clic`, `web_escribir`, `web_guardar`, `web_ingresar`). Enviar stock o precios a la tienda WooCommerce no es una herramienta: lo confirma la persona en la pantalla. Enviar al SII es irreversible: Claude muestra el resumen y espera la confirmación de la persona en el chat |

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
| 1 | **Gestor de contraseñas de NÚCLEO** | Pide ingresos a sitios con usuarios de solo lectura, sin ver ni escribir la clave (funciones abajo) | Guardar accesos y `listar_accesos`: construido el 23-11-2026. Ingreso con el Navegador de NÚCLEO y permiso por el día (`web_ingresar`): construido el 26-11-2026 |
| 2 | **Aviso de autorización** | Cada ingreso pedido por el agente avisa al dueño con «Autorizo / No autorizo»: en el PC, por correo, por WhatsApp y en la app del celular | Por construir (PC primero, luego correo, luego WhatsApp) |
| 3 | **Extensión de Chrome para NÚCLEO** | Conecta Chrome con NÚCLEO para trabajar en sitios sin API con la sesión de la empresa | Por construir |
| 4 | **Revisar cartolas del banco** | Con el usuario de solo lectura (BCI primero): saldo, ingresos, egresos y glosa; propone qué venta quedó pagada. Nunca transferencias ni pagos | Construido el 24-11-2026 con la sesión que abre el dueño: `registrar_movimientos_banco`, `conciliacion_banco` y `conciliar_movimiento_banco` (receta `docs/recetas/cierre-diario.md`). El ingreso sin el dueño espera el usuario de lectura y la extensión; la API de notificaciones de BCI queda como vía futura |
| 5 | **Revisar Mercado Libre** | Con el colaborador de solo lectura: abre el **detalle de cada venta** (cliente, RUT, giro, factura subida, reclamos, cobro) y cuadra con NÚCLEO. Receta en `docs/recetas/mercadolibre-revision-ventas.md` | Colaborador creado; primera revisión a mano el 23-11-2026. Lo leído se registra con `registrar_ventas_mercadolibre` (descuenta stock de lo despachado desde el 23-11-2026; RC-5+ de Mercado Libre = P-00004 en NÚCLEO) |
| 6 | **Crear órdenes de transporte** | Desde un envío de NÚCLEO, crea la OT en el courier (Bluexpress primero: Punto Market Plaza Ñuñoa, talla S hasta 16 equipos y M desde 17, sin mercancías peligrosas); se detiene antes de pagar | Por construir (receta Bluexpress escrita) |
| 7 | **Ingreso automático del robot** | NÚCLEO entra solo con el usuario de lectura, descarga cartola y ventas y las deja importadas; el agente cuadra desde NÚCLEO sin entrar al banco | Por construir |
| 8 | **Folios y consultas en sii.cl** | Ayuda a descargar folios (CAF) y a consultar la empresa con la sesión que inició la persona | Por construir (con la extensión de Chrome) |
| 9 | **Asistente NÚCLEO (plan Premium)** | El mismo conjunto de herramientas, dentro de NÚCLEO, con la API de Anthropic | Idea |
| 10 | **Tienda WooCommerce** | Sincroniza los pedidos pagados (cliente, venta que descuenta stock y envío por despachar), lista los pedidos y compara stock y precios con la tienda. Enviar cambios a la tienda lo confirma la persona | Construido el 23-11-2026 (falta probar en la tienda real) |
| 11 | **Cotizar y enviar por correo** | Crea la cotización con precios de lista, emite el PDF y lo envía desde la casilla de la empresa, sin salir de NÚCLEO | Construido el 25-11-2026: `listar_cotizaciones`, `crear_cotizacion`, `emitir_cotizacion`, `enviar_correo`, `correos_enviados` (D-AGENT-07; receta `docs/recetas/cotizaciones.md`). Falta que el dueño conecte la casilla y marque el permiso |
| 12 | **WhatsApp desde NÚCLEO** | Lee los chats de la empresa y envía la respuesta aprobada (con la cotización en PDF) por el puente local, sin Chrome | Construido el 25-11-2026: puente `integraciones/whatsapp` y herramientas `whatsapp_chats`, `whatsapp_leer`, `whatsapp_enviar` (D-WSP-01). Falta arrancar el puente en el PC del dueño, vincular el número y probar con chats reales |
| 12b | **Chrome conectado a NÚCLEO** | Extensión de Chrome propia de NÚCLEO (API de extensiones: pestañas, lectura y acciones en la página) unida al programa por un canal local con llave. Claude se conecta a esa sesión de Chrome **a través de NÚCLEO** con herramientas `web_*`, para Bluexpress, BCI (solo lectura), Mercado Libre y SII con la sesión que abrió el dueño | Por construir; pedido del dueño el 25-11-2026 como paso siguiente a WhatsApp. Reemplaza el uso de la extensión de Claude en Chrome para esos sitios |
| 13 | **Leer el correo en NÚCLEO** | Bandeja de entrada por IMAP: pedidos de cotización y avisos de transferencia del banco, que pasan solos a la conciliación | Por construir |
| 14 | **Cobranza** | Muestra la ronda (lo más vencido primero) y, si el dueño lo pide, envía los recordatorios con los datos de pago | Construido el 26-11-2026: `ronda_cobranza`, `enviar_cobranza` (D-AUTO-02). Programar la ronda y excluir clientes es de la persona |
| 15 | **Informe y meta** | Dice cómo va el negocio y cuánto falta para la meta del mes, con el mismo texto que le llega al dueño por correo | Construido el 26-11-2026: `informe_negocio` (D-AUTO-03) |
| 16 | **Cobros recurrentes** | Consulta qué se cobra cada mes, a quién, cuándo toca y cuál fue la última venta generada | Construido el 26-11-2026: `cobros_recurrentes` (D-AUTO-04). Crearlos y cambiarlos es de la persona |
| 17 | **Reglas del banco** | Anota lo que el dueño le explica de un movimiento que se repite; NÚCLEO además aprende de cada conciliación | Construido el 26-11-2026: `reglas_banco`, `guardar_regla_banco`; `registrar_movimientos_banco` con RUT, nombre y comentario (D-BANK-RULES) |
| 18 | **Series y certificados** | Registra series con su certificado de calibración, las une a la venta y responde a quién se le vendió cada equipo y qué calibraciones vencen | Construido el 26-11-2026: `buscar_series`, `registrar_series` (D-SERIE-01) |
| 19 | **Conector propio del banco** | Servicio local que entra al portal con el usuario de consulta (solo lectura) y deja los movimientos, con quién transfirió, en la conciliación | Por construir: requiere estudiar el portal de BCI con una sesión abierta por el dueño. Mientras tanto Claude los lee en esa sesión y los carga con `registrar_movimientos_banco` |

### Ventas con los datos del SII

Decisiones: D-VEN-SII-01…03. «Nueva venta» parte por el documento y guarda lo mismo que pide el
facturador del SII, para que emitir sea copiar.

| Herramienta | Nivel | Qué hace |
|---|---|---|
| `crear_venta_borrador {documento, cliente, lineas[detalle], referencias, forma_pago…}` | borradores | Venta con documento (boleta, factura, guia), receptor desde la ficha, descripción extendida por línea, referencias (orden de compra, HES, guía) y forma de pago. Avisa qué le falta al receptor y si el cliente trabaja con orden de compra y no se anotó |
| `ver_venta {venta}` | ver | La venta en el orden del formulario del SII: receptor, transporte, detalle con «Descrip.», referencias, forma de pago, totales y lo que falta para emitir |
| `actualizar_cliente {cliente, …}` | completo | Completa o corrige la ficha (razón social, giro, dirección, comuna, ciudad, contacto, correos, teléfono, orden de compra) y responde con lo que había antes |
| `crear_cliente {…, ciudad, trabaja_con_oc}` | borradores | Si no se indica la ciudad, la propone desde la comuna |

Reglas: una factura o guía necesita cliente; la ciudad es obligatoria en el SII; un cliente marcado
«trabaja con orden de compra» no se factura sin anotarla en referencias (se le pide a la persona). La
consulta pública de situación tributaria (`https://www2.sii.cl/stc/noauthz`) entrega razón social,
inicio de actividades y giro; la dirección y la comuna las da el formulario de factura al escribir el
RUT. Pasos: `docs/recetas/navegador-sii-y-banco.md` §0.0 a §0.3.

### Gestor de contraseñas y Navegador de NÚCLEO

Decisiones: `docs/DECISIONS.md`, D-NAV-01…06. Del SII solo se guarda el acceso a e-Boleta (RUT y
Clave Tributaria), que NÚCLEO usa únicamente en `eboleta.sii.cl`: `docs/recetas/boleta-electronica-sii.md`.
Pedidos de la tienda WordPress: `docs/recetas/woocommerce-pedidos-navegador.md`. Receta de uso: `docs/recetas/navegador-sii-y-banco.md`.

**Regla estricta (dueño, 27-11-2026): solo el Navegador de NÚCLEO.** Todo lo que el agente hace en
un sitio web para el negocio (SII, banco, Bluexpress, la tienda, Mercado Libre) lo hace en el
Navegador de NÚCLEO. No se usa Chrome ni otro navegador, tampoco «solo para terminar un paso». Si
algo no se puede hacer ahí (el sitio no está permitido, un control no aparece, hace falta un pago),
se le dice a la persona qué falta y se corrige en NÚCLEO.

Lo que hace la persona (en Configuración → Integraciones):

- **Accesos**: guarda un acceso por sitio (nombre, dirección de ingreso, usuario, clave y tipo: solo
  lectura u operador sin facultad de pago). La clave se escribe en NÚCLEO, queda en la base cifrada y
  nunca se muestra de vuelta.
- **Navegador → «Autorizar por hoy»**: por cada acceso, permite que NÚCLEO inicie sesión con él hasta
  que cambie el día. Lo puede quitar cuando quiera.
- **Navegador → sitios permitidos y carpeta de descargas**.
- En la ventana del navegador: elige su certificado digital para el SII y resuelve códigos, captchas o
  segundas claves.

Lo que puede hacer el agente:

| Herramienta | Nivel | Qué hace |
|---|---|---|
| `listar_accesos` | ver | Sitios con acceso guardado, usuario y tipo. Nunca la clave |
| `web_abrir {direccion \| acceso}` | ver | Abre una página de un sitio permitido y la lee |
| `web_leer {buscar, desde}` | ver | Texto de la página y de todos sus marcos, controles numerados (`w12`, el número se conserva mientras la página sea la misma) y los avisos (`alert`) que mostró la página |
| `web_clic {elemento \| volver}` | completo | Clic en un control o volver atrás; devuelve solo lo que cambió (la página completa si es otra) |
| `web_escribir {elemento, texto, enter}` | completo | Escribe en un campo o elige en una lista; devuelve solo lo que cambió. Nunca en un campo de clave |
| `web_guardar {nombre, elemento, direccion}` | completo | Guarda en la carpeta de descargas el documento incrustado, un enlace o una dirección |
| `web_ingresar {acceso}` | completo | Pide a NÚCLEO que rellene el ingreso con un acceso autorizado hoy |

Lo que hace NÚCLEO solo:

- Rellena usuario y clave **solo si la página es del mismo sitio que la dirección guardada** (protege
  de páginas falsas) y solo con el permiso de hoy. La clave no vuelve en ninguna respuesta.
- Registra en la auditoría cada permiso dado o quitado y cada lectura de la clave.
- Bloquea la navegación a sitios que no están en la lista y lo informa.
- Cierra el navegador al salir de la sesión o al cerrar NÚCLEO.

Límites que no cambian:

- No hay herramienta que entregue una clave al agente ni que le permita escribirla. El permiso del día
  lo da siempre la persona: el agente no puede autorizarse, ni cambiar los sitios ni la carpeta.
- Solo accesos de solo lectura u operador sin pago. No se guardan claves de apoderado del banco, de
  Google, de la Clave Tributaria ni datos de tarjetas.
- Segundo factor, captchas, códigos de verificación, certificados y pagos los hace la persona.
- En los sitios, el agente navega y consulta. No pulsa controles que paguen, transfieran, envíen,
  emitan, anulen o acepten condiciones sin que la persona lo haya pedido para ese caso; en el banco,
  solo lectura.
