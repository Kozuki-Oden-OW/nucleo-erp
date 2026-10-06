# Roadmap — NÚCLEO ERP

Detalle completo en el Blueprint Maestro §17. Cada fase termina solo cuando cumple su criterio de salida.

| Fase | Nombre | Estado |
|---|---|---|
| 0 | Análisis — Blueprint Maestro | ✅ Aprobado (2026-10-05) |
| 1 | Arquitectura | ✅ Completo (2026-10-05): CI en Windows verde e instalador compilado |
| 2 | Modelo de datos | ✅ Completo (2026-10-05) — ver abajo |
| 3 | Diseño UX | 🟡 Sistema de diseño y prototipos listos; falta la prueba con 3-5 usuarios — ver abajo |
| 4 | Core (usuarios, roles, configuración, numeración, documentos, búsqueda) | ✅ Hito A cumplido (2026-10-06) — ver abajo |
| 5 | Ventas | ✅ Completo (2026-10-06) — ver abajo |
| 6 | Compras | ✅ Completo (2026-10-06) — ver abajo |
| 7 | Inventario (incluye stock real y futuro) | ✅ Hito B cumplido (2026-10-06) — ver abajo |
| 8 | Finanzas | 🟡 En curso |
| 9 | COMEX (requiere contador colaborador, D-07) | ⏳ |
| 10 | Contabilidad (motor de asientos) | ⏳ |
| 11 | Documentación externa e indicadores | ⏳ |
| 12 | Reportes y dashboard del dueño | ⏳ |
| 13 | Seguridad | ⏳ |
| 14 | Testing | ⏳ |
| 15 | Instalador → **MVP** | ⏳ |
| 16 | Inteligencia comercial (V1.1) | ⏳ |
| 17 | Fidelidad (V1.2) | ⏳ |

## Fase 1 — criterio de salida

> App instalable que crea una base cifrada, escribe, respalda y restaura.

| Entregable | Estado |
|---|---|
| Monorepo Cargo (5 crates + app) y app Tauri | ✅ |
| Archivos de control (11) y decisiones | ✅ |
| Spike SQLCipher + migraciones + FTS5 + API de backup | ✅ probado en Linux |
| Formato `.erpbackup` cifrado con verificación | ✅ |
| Flujo crear → escribir → respaldar → restaurar | ✅ prueba automática + prueba manual en la app |
| Auditoría encadenada con detección de manipulación | ✅ |
| Clave de recuperación | ✅ |
| CI en Windows + `NucleoERPSetup.exe` | ✅ CI verde en GitHub Actions (Linux y Windows) |
| Spike PDF (Typst vs. WebView2) | ⏳ movido a la Fase 5 (primer documento imprimible: cotización) |
| Instalador firmado | ⏳ requiere certificado de firma de código (costo anual) |

## Fase 2 — criterio de salida

> Migraciones probadas; base sembrada con 100k/100k/1M dentro de presupuestos de rendimiento.

| Entregable | Estado |
|---|---|
| Modelo completo del MVP: 91 tablas, 30 triggers, 62 índices, 10 migraciones | ✅ |
| Reglas en la base (inmutabilidad, stock como libro, asientos cuadrados, estados de venta) | ✅ 7 pruebas de esquema |
| `DATABASE.md` definitivo | ✅ |
| Firma Ed25519 de paquetes normativos + diff legible + herramienta `rules` | ✅ |
| Generador `seed` (100.000 clientes, 100.000 productos, 1.000.000 de movimientos) | ✅ 7,8 min, 436 MB |
| Mediciones `bench` contra las metas del MVP | ✅ 12/12 consultas dentro de meta (p95) |

## Fase 3 — criterio de salida

> Prueba de usabilidad con 3-5 usuarios no contadores (Blueprint §17).

| Entregable | Estado |
|---|---|
| Sistema de diseño: tokens claro/oscuro, densidad, componentes (`ui/`), accesibilidad | ✅ `docs/UX.md` |
| Layout: menú por perfil, barra superior, alertas, vista Simple/Contador, glosario dual | ✅ |
| Paleta de comandos Ctrl+K (registros + acciones) y atajos de teclado | ✅ |
| Prototipos navegables: dashboard, ciclo de venta completo, compra (OC → recepción), COMEX (escenarios) | ✅ demo en el navegador (backend de demostración) |
| Puerto `Backend` único: el prototipo se vuelve pantalla real al existir el comando Rust | ✅ `src/data/backend.ts` |
| Demo pública en `www.nucleoerp.cl/demo/` | ✅ automatizada en `web.yml` |
| Guion de prueba de usabilidad (8 tareas, métricas, criterio) | ✅ `docs/UX.md` §8 |
| **Prueba con 3-5 usuarios** | ⏳ la realiza el dueño del proyecto con el guion; resultados en `docs/usabilidad/` |

## Fase 4 — criterio de salida

> Hito A: "puedo crear mi empresa, usuarios y adjuntar documentos".

| Entregable | Estado |
|---|---|
| Migración 0011: 37 permisos, 8 roles, dueño inicial, monedas, adjuntos archivables | ✅ |
| Usuarios, contraseñas Argon2id, inicio de sesión con bloqueo, bloqueo por inactividad | ✅ |
| Roles y permisos editables; permisos verificados en Rust | ✅ |
| Configuración del negocio, numeración interna, monedas y tipos de cambio | ✅ |
| Documentos adjuntos cifrados, vinculados, exportables y archivables; incluidos en respaldos | ✅ |
| Búsqueda global filtrada por permisos; visor de auditoría | ✅ |
| Pruebas: `hito_a` (flujo completo + respaldo/restauración con adjuntos) | ✅ |

## Fase 7 — criterio de salida

> Hito B: "opero mi negocio: vendo, compro y controlo stock".

| Entregable | Estado |
|---|---|
| Multibodega, transferencias, ajustes y conteos con motivo | ✅ prueba `inventario.rs` e `ipc_tests.rs` |
| Kárdex por producto y bodega con costo promedio | ✅ |
| Stock real y futuro, velocidad (días con stock), cobertura, riesgo de quiebre, sin movimiento | ✅ |
| Sugerencia de compra explicada y parámetros de reposición | ✅ |
| Regla de stock negativo | ✅ |
| Recálculo retroactivo de costos y reservas | ⏳ postergado (D-F7-07) |

## Fase 6 — criterio de salida

> Ciclo de compra completo.

| Entregable | Estado |
|---|---|
| Proveedores (crear, editar, ficha con compras y deuda) | ✅ |
| Orden de compra → emitir → recibir (parcial/total) con stock y costo promedio | ✅ prueba `compras.rs` y `ipc_tests.rs` |
| Documento de compra (asociado a orden o directo con ingreso a bodega), cuenta por pagar, abonos y pago | ✅ |
| Anulación de órdenes y documentos con motivo | ✅ |
| Historial de precios por producto y proveedor | ✅ |
| Solicitudes de compra y comparador formal de cotizaciones de proveedores | ⏳ postergado (D-F6-01) |

## Fase 5 — criterio de salida

> Ciclo de venta completo sin re-digitar.

| Entregable | Estado |
|---|---|
| Productos base (crear con stock inicial, editar, unidades) y clientes (crear, editar, ficha) | ✅ |
| Cotización → "Convertir en venta" → efectuada → pagos → "Marcar como documentada" → cerrada | ✅ prueba `ventas.rs` y `ipc_tests.rs` |
| Factura interna (FV) y venta (VEN) con leyenda de documento interno; impresión | ✅ |
| Stock y costo al efectuar; cuenta por cobrar; contado y crédito; abonos | ✅ |
| Anulación con motivo (devuelve stock, anula cobros) | ✅ |
| Tasa de IVA informativa anotada por el usuario (sin valores normativos en el código) | ✅ |

## Sitio web

| Entregable | Estado |
|---|---|
| Sitio `www.nucleoerp.cl` (inicio, descarga, privacidad, 404), sin rastreadores | ✅ listo en `apps/web` |
| Descarga directa desde el dominio con SHA-256 publicado | ✅ automatizado (`release.yml` + `web.yml`) |
| Publicación | ✅ GitHub Pages con dominio www.nucleoerp.cl (HTTPS al emitirse el certificado) |

## Movido a fases posteriores (con motivo)

| Ítem | Nueva fase | Motivo |
|---|---|---|
| Hilo escritor + lectores | 12 (Reportes) | Las operaciones del Core miden < 50 ms con un `Mutex` por negocio (D-F4-11) |
| `tauri-specta` (tipos TS generados) | Al salir su versión estable | Sigue en *release candidate* (D-F4-11) |
| Clave de datos envuelta con la contraseña del administrador | 13 (Seguridad) | Se diseña junto con la clave de recuperación (D-F4-12) |
| Motor de PDF propio | Sin fecha | Se imprime con el diálogo del sistema (D-F5-07) |
| Clave oficial de firma de normativa | 11 | Se genera cuando exista el primer paquete con fuentes verificadas |
| Dashboard por bloques y "Atención" precalculada | 12 | Primera carga con caché fría ~1,3 s en el equipo de medición |
