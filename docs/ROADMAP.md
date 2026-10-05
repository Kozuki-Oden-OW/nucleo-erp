# Roadmap — NÚCLEO ERP

Detalle completo en el Blueprint Maestro §17. Cada fase termina solo cuando cumple su criterio de salida.

| Fase | Nombre | Estado |
|---|---|---|
| 0 | Análisis — Blueprint Maestro | ✅ Aprobado (2026-10-05) |
| 1 | Arquitectura | 🟡 Código y pruebas listos; falta validar la compilación e instalador en Windows (CI) |
| 2 | Modelo de datos | ✅ Completo (2026-10-05) — ver abajo |
| 3 | Diseño UX | ⏳ |
| 4 | Core (usuarios, roles, configuración, numeración, documentos, búsqueda) | ⏳ |
| 5 | Ventas | ⏳ |
| 6 | Compras | ⏳ |
| 7 | Inventario (incluye stock real y futuro) | ⏳ |
| 8 | Finanzas | ⏳ |
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
| CI en Windows + `NucleoERPSetup.exe` | ⏳ requiere publicar el repositorio en GitHub |
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

## Sitio web

| Entregable | Estado |
|---|---|
| Sitio `www.nucleoerp.cl` (inicio, descarga, privacidad, 404), sin rastreadores | ✅ listo en `apps/web` |
| Descarga directa desde el dominio con SHA-256 publicado | ✅ automatizado (`release.yml` + `web.yml`) |
| Publicación | ⏳ requiere repositorio en GitHub y DNS (ver `docs/WEB.md`) |

## Movido a fases posteriores (con motivo)

| Ítem | Nueva fase | Motivo |
|---|---|---|
| Hilo escritor + lectores | 4 (Core) | Hace falta recién con varias pantallas trabajando en paralelo |
| `tauri-specta` (tipos TS generados) | 4 (Core) | Sigue en *release candidate*; el contrato IPC crece en la Fase 4 |
| Spike de PDF | 5 (Ventas) | El primer documento imprimible es la cotización |
| Clave oficial de firma de normativa | 11 | Se genera cuando exista el primer paquete con fuentes verificadas |
| Dashboard por bloques y "Atención" precalculada | 12 | Primera carga con caché fría ~1,3 s en el equipo de medición |
