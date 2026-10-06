# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar] — Fase 3 (Diseño UX)

### Agregado
- Sistema de diseño: tokens claro/oscuro con colores de marca, densidad cómoda/compacta, componentes
  accesibles (botones, campos, montos, tablas con teclado y virtualización, paneles laterales, diálogos,
  avisos, gráfico de ventas con vista de tabla). Documentado en `docs/UX.md`.
- Nueva estructura de pantalla: menú lateral según el perfil (Emprendedor, Negocio, Empresa) con
  "Más módulos", barra superior con búsqueda, "Nueva venta", vista Simple/Contador, tema y alertas.
- Paleta de comandos `Ctrl+K` que busca clientes, productos, ventas, cotizaciones y órdenes de compra y
  ejecuta acciones. Atajos `Alt+N`, `Ctrl+Enter`, `Ctrl+B`.
- Prototipos navegables: dashboard del dueño, cotización → venta → efectuada → pagos → documentada,
  factura interna, impresión con leyenda "DOCUMENTO INTERNO — NO TRIBUTARIO", clientes con ficha,
  productos con margen, órdenes de compra con recepción y calculadora de importación con escenarios.
- Demostración en el navegador con una ferretería ficticia (`www.nucleoerp.cl/demo/`) y botón
  "Explorar con datos de ejemplo" en el escritorio.
- Guion de prueba de usabilidad para 3-5 personas (`docs/UX.md` §8).

## [Sin publicar] — Fase 2 (Modelo de datos) y sitio web

### Agregado
- Modelo de datos completo del MVP en 10 migraciones: 91 tablas, 30 triggers, 62 índices, vista
  `v_stock_position` y búsqueda FTS5 de clientes, proveedores y productos.
- La base hace cumplir reglas críticas: stock como libro de solo inserción, ventas efectuadas
  inmutables, flujo de estados, pagos que actualizan saldos, asientos que deben cuadrar, períodos
  cerrados, historial de etapas y ETA de importaciones.
- 23 tipos de documento NÚCLEO con prefijos (COT, VEN, FV, PRO…), título impreso y leyenda
  "DOCUMENTO INTERNO — NO TRIBUTARIO".
- Paquetes normativos firmados con Ed25519, verificación, diff legible y herramienta `rules`.
- Herramientas `seed` (100k clientes, 100k productos, 1M movimientos) y `bench` (metas del MVP).
- Tabla `fact_sales_day` e índice cubriente: el dashboard bajó de ~14,6 s a ~0,3 s con 1M de movimientos.
- Sitio web `www.nucleoerp.cl` (`apps/web`) sin rastreadores, con descarga directa y SHA-256, y
  publicación automática (`web.yml`, `release.yml`).
- Identidad de marca: logo a color en los íconos de la app y del instalador, en la pantalla de inicio,
  en la barra lateral y en el sitio (encabezado, portada, favicon e imagen para redes sociales).
- `release.yml` se puede ejecutar a mano desde GitHub Actions indicando la versión.

### Corregido
- CI: el frontend se compila antes de `cargo`, porque Tauri necesita `dist/` para compilar.

### Cambiado
- La tabla mínima de clientes de la Fase 1 se reemplazó por el modelo completo (permitido antes de la
  primera beta). Bases creadas con la versión 0.1.0 deben recrearse.

## [0.1.0] — 2026-10-05 · Fase 1 (Arquitectura)

### Agregado
- Monorepo con Cargo workspace: `nucleo-domain`, `nucleo-rules`, `nucleo-db`, `nucleo-io`, `nucleo-app`
  y la app de escritorio `apps/desktop` (Tauri 2 + React 19 + TypeScript + Tailwind 4).
- Dominio: dinero exacto (`Money`), RUT con módulo 11, numeración NÚCLEO (`COT-000001`), totales de
  documento con tasa y redondeo parametrizados, costo promedio ponderado, stock real y futuro,
  velocidad, cobertura, riesgo de quiebre, punto de reorden, riesgo de pérdida de clientes y estados
  de venta en tres ejes. Casos golden de `02_INTELIGENCIA_COMERCIAL.md`.
- Normativa versionada: vigencias, fuente obligatoria, rechazo de superposiciones, error explícito
  si falta un valor.
- Base cifrada con SQLCipher, migraciones transaccionales, auditoría encadenada con triggers de solo
  inserción, búsqueda FTS5 sin tildes, paginación por cursor, copia en caliente.
- Respaldo `.erpbackup` v1: AES-256-GCM + Argon2id, manifiesto con SHA-256, verificación inmediata,
  restauración como negocio nuevo con validación de integridad y conteos.
- Claves por negocio en el Windows Credential Manager y clave de recuperación imprimible.
- Pantallas: crear negocio (perfiles Emprendedor/Negocio/Empresa), clave de recuperación, inicio,
  clientes, respaldos, seguridad y auditoría.
- CI en GitHub Actions para Windows y Linux, verificación de valores normativos en el código.
- Licencia AGPL-3.0-or-later.
