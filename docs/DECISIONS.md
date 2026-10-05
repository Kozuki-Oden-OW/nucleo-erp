# Registro de decisiones — NÚCLEO ERP

Las decisiones registradas aquí están **cerradas**: no se vuelven a discutir salvo que aparezca un hecho
nuevo, que se documenta como una nueva decisión que reemplaza a la anterior.

## ADR — decisiones de arquitectura (aprobadas el 2026-10-05 con el Blueprint v1.0)

| ADR | Decisión | Motivo principal | Consecuencias |
|---|---|---|---|
| 001 | SQLite como base local, una por negocio | Sin servidor, un archivo, transaccional | Respaldo simple; uso multi-PC requiere Modo Servidor Local (V3) |
| 002 | Tauri 2 + React/TypeScript | Liviano, seguro, multiplataforma futura | Depende de WebView2 en Windows |
| 003 | **NÚCLEO no es un sistema tributario** | Simplicidad, privacidad, sin certificación | Sin conexión fiscal, credenciales, folios ni emisión; numeración propia + referencia externa manual |
| 004 | `rusqlite` + SQLCipher (no SQLx) | SQLCipher nativo, API síncrona, backup en caliente | Sin verificación de SQL en compilación; se compensa con pruebas |
| 005 | Un archivo de base por negocio + `app.db` | Aislamiento total, respaldo por negocio | Reportes entre negocios requieren abrir varias bases |
| 006 | Dinero en enteros de unidad mínima + `rust_decimal` | Exactitud | Prohibido `f64` para montos |
| 007 | Libro de movimientos de stock + costo promedio ponderado | Trazabilidad | Recalculo retroactivo necesario (riesgo T-05) |
| 008 | Documentos inmutables tras confirmar | Auditoría | Correcciones con documentos de ajuste |
| 009 | Normativa como datos versionados con fuente | No inventar normativa; actualizable | Cálculo falla si falta un parámetro |
| 010 | Monolito modular hexagonal en 5 crates | Testeable y preparado para modo servidor | Reglas de dependencia estrictas |
| 011 | Cero telemetría; conexiones salientes opt-in | Privacidad como arquitectura | Sin métricas de uso automáticas |
| 012 | Auditoría con hash encadenado | Detectar manipulación | Tabla de solo inserción |
| 013 | PK entera + `uid` UUIDv7 | Rendimiento + referencias estables | Dos identificadores por entidad principal |
| 014 | Asistente detrás de una interfaz de proveedor; IA externa solo con consentimiento | Privacidad | Primera versión sin IA |
| 015 | Estados de venta en tres ejes (comercial, pago, documentación) | Los estados se combinan en la realidad | Etiqueta única derivada para la UI |
| 016 | Gratuito, sin sistema de licencias; donaciones fuera del programa | Decisión del dueño del producto | Sostenibilidad es un riesgo (T-18) |
| 017 | Inteligencia determinista y explicable | Toda recomendación muestra su cálculo | Sin modelos opacos |
| 018 | Capa analítica con tablas resumen transaccionales + foto diaria de stock | Rendimiento con 1M movimientos | Más escrituras por venta |
| 019 | Promociones como descuentos con origen por línea | No tocar precios de lista; analítica posible | Motor de precios en Rust |

## Decisiones del Blueprint (D-01 a D-14, aprobadas)

D-01 motor de asientos en el MVP · D-02 cifrado por defecto + clave de recuperación · D-03 un computador
en el MVP · D-04 gratis con donaciones · D-05 tablas separadas por etapa + `document_links` · D-06 tres
perfiles en el MVP · D-07 contador colaborador antes de la Fase 9 · D-08 `NucleoERPSetup.exe` y
`.erpbackup` · D-09 "FACTURA INTERNA" + leyenda "DOCUMENTO INTERNO — NO TRIBUTARIO" · D-10 IVA estimado
informativo, sin renta guiada · D-11 promociones no acumulables por defecto · D-12 reparto MVP/V1.1/V1.2
· D-13 código abierto **AGPL-3.0-or-later** · D-14 recordatorio de donación discreto (sin ventanas al abrir).

## Decisiones de la Fase 1

| ID | Decisión | Motivo |
|---|---|---|
| D-F1-01 | Migraciones con un ejecutor propio de ~40 líneas sobre `user_version` (no `rusqlite_migration`) | Evita acoplar versiones de `rusqlite`; transacción por migración; control total |
| D-F1-02 | Contenedor del respaldo = **tar** cifrado con AES-256-GCM, clave Argon2id | Formato estándar e inspeccionable al descifrar; crate `tar` estable (el crate `zip` estaba en pre-release) |
| D-F1-03 | `tauri-specta` **postergado** a la Fase 2; tipos TS espejados a mano en `src/lib/api.ts` | `tauri-specta` sigue en *release candidate*; el contrato actual es pequeño |
| D-F1-04 | ADR consolidados en este archivo (no un archivo por ADR) | Menos dispersión; mismo contenido |
| D-F1-05 | Frontend como proyecto pnpm independiente en `apps/desktop` (sin workspace pnpm en la raíz) | Hay un solo paquete JS; se agrega workspace si aparece otro |
| D-F1-06 | La clave de datos se guarda en Windows Credential Manager vía `keyring`; clave de recuperación = clave en base32 agrupada | Simple y robusto; envoltura con contraseña en Fase 13 |
| D-F1-07 | El respaldo incluye la clave de datos **dentro** del contenedor cifrado | Restaurar en otro PC solo con la contraseña del respaldo |
| D-F1-08 | La restauración crea **siempre** un negocio nuevo | Nunca sobrescribir datos vigentes |
| D-F1-09 | `NUCLEO_EPHEMERAL_KEYS=1` solo en compilaciones debug | Pruebas automáticas sin almacén de claves; inexistente en versiones publicadas |
| D-F1-10 | Spike de PDF movido al inicio de la Fase 2 | No bloquea el criterio de salida de la Fase 1 |
| D-F1-11 | `rust-toolchain.toml` fija Rust 1.97.0; `rust-version` mínimo 1.90 (requisito de Tauri 2.12) | Builds reproducibles |

## Decisiones de la Fase 2

| ID | Decisión | Motivo |
|---|---|---|
| D-F2-01 | Todo valor numérico como entero (`*_minor`, `*_e4`, `qty_milli`, `*_ppm`, `rate_e6`) | Exactitud y agregaciones en SQL sin `REAL` |
| D-F2-02 | Reglas críticas también en la base (triggers y `CHECK`), no solo en la app | Defensa en profundidad: un error de la app no corrompe la contabilidad ni el stock |
| D-F2-03 | Costo promedio por producto (global), no por bodega | Más simple y habitual en pymes |
| D-F2-04 | `stock_balances` mantenido por trigger desde `stock_movements` | Saldo siempre consistente con el libro |
| D-F2-05 | Recepción pendiente actualiza `received_milli`; el movimiento se crea al confirmar | Evita contar dos veces "en compra" y "en recepción" |
| D-F2-06 | Cajas, bancos y billeteras en una sola tabla `money_accounts` | Mismo comportamiento; menos tablas |
| D-F2-07 | Plan de cuentas con `simple_name` (lenguaje de negocio) | Vista Simple y vista Contador sobre los mismos datos |
| D-F2-08 | `fact_sales_day` (totales por día) además de `fact_sales_daily` | Medición: la serie de 12 meses tardaba ~14 s |
| D-F2-09 | Paquetes normativos firmados con Ed25519 sobre la serialización canónica | El formato del archivo no invalida la firma; cualquier cambio de valor sí |
| D-F2-10 | Claves públicas de confianza embebidas en la app; la privada nunca en el repositorio | Seguridad de la cadena de normativa |
| D-F2-11 | Sitio web estático en GitHub Pages; instalador publicado en `/descargas/` del propio dominio | Gratis, HTTPS, descarga directa desde www.nucleoerp.cl |
| D-F2-12 | Sitio sin cookies, analítica ni recursos de terceros | Coherente con la promesa de privacidad |
| D-F2-13 | Marca: logo a color del usuario (`docs/marca/`); colores azul marino `#001a3c`, turquesa `#0090aa`, verde `#6f9f00` | Identidad única en app, íconos, instalador y sitio |
| D-F2-14 | Código en GitHub `Kozuki-Oden-OW/nucleo-erp`; el dueño hace el push; las versiones se publican con `release.yml` (etiqueta o "Run workflow") | Claude no maneja credenciales; publicación reproducible desde CI |

## Dependencias y su justificación

| Dependencia | Dónde | Por qué |
|---|---|---|
| `rusqlite` (bundled-sqlcipher-vendored-openssl, backup) | db | Base cifrada sin instalar nada en el PC del usuario |
| `rust_decimal` | domain, rules | Decimales exactos |
| `serde`, `serde_json` | todos | Serialización (IPC, manifiestos, paquetes normativos) |
| `thiserror` | todos | Errores tipados con mensajes |
| `time` | rules, db, app | Fechas y vigencias |
| `uuid` (v7) | db, app | Identificadores ordenables |
| `sha2`, `hex` | db, io | Hash de auditoría y checksums |
| `aes-gcm`, `argon2`, `getrandom` | io, app | Cifrado autenticado de respaldos, derivación de clave, aleatoriedad del SO |
| `tar` | io | Contenedor del respaldo |
| `tempfile` | io, app | Carpetas temporales y escritura atómica |
| `data-encoding` | app | Clave de recuperación en base32 |
| `keyring` | app (feature `os-keyring`) | Windows Credential Manager |
| `ed25519-dalek` | rules, tools | Firma y verificación de paquetes normativos |
| `tauri`, `tauri-plugin-dialog` | desktop | Aplicación de escritorio y selector de archivos |
| React, `@tauri-apps/api`, `@tauri-apps/plugin-dialog` | frontend | Interfaz e IPC |
| Vite, TypeScript, Tailwind CSS, Vitest | frontend (desarrollo) | Compilación, tipos, estilos, pruebas |
