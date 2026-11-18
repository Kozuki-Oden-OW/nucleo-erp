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
   | Solo ver | `ver_pantalla`, `ir_a`, `desplazar` y las consultas (`resumen_negocio`, `buscar*`, `listar_*`, `datos_de_apoyo`) |
   | Crear borradores | Lo anterior + `crear_cliente`, `crear_proveedor`, `crear_producto`, `crear_venta_borrador`, `registrar_gasto` (queda por pagar) |
   | Acceso completo | Lo anterior + `clic`, `escribir`, `elegir`, `tecla`, `confirmar_venta`, `registrar_cobro` y gastos pagados |

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
