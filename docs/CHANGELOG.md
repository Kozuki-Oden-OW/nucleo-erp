# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar] — Fase 8 (Finanzas) · Hito C

### Agregado
- Módulo Dinero con resumen: dinero disponible, lo que te deben y lo que debes (con atraso por tramos:
  al día, 1–30, 31–60, 61–90 y más de 90 días) y cuánto tendrías en 30 días.
- Proyección de caja a 13 semanas con lo que ya se sabe (cobros y pagos por vencer y recurrentes),
  gráfico con tabla equivalente y aviso de la primera semana en negativo.
- Cuentas de dinero (caja, banco, billetera): saldo inicial, saldo calculado, movimientos con enlace al
  documento, edición, archivo (solo con saldo cero) y traspasos entre cuentas. Solo se guarda una
  referencia corta de la cuenta, nunca el número completo.
- Gastos: registro rápido pagado o por pagar, IVA incluido separado de forma informativa, proveedor
  opcional, categorías propias, pagos parciales, anulación con motivo y documentos adjuntos.
- Ingresos y egresos recurrentes que alimentan el calendario y la proyección hasta que se registra el
  gasto del período.
- Calendario de cobros y pagos a 30, 60 y 90 días, con lo atrasado primero.
- Elección de la cuenta en cobros de ventas, pagos de compras y gastos (por defecto: efectivo → caja,
  otros medios → banco).
- Inicio con cifras reales de caja, deudas, gastos del mes, IVA estimado y próximos vencimientos.

## [Sin publicar] — Fase 7 (Inventario) · Hito B

### Agregado
- Existencias con análisis por producto: stock, por llegar, unidades vendidas por día (solo días con
  stock, últimos 90 días), días de cobertura, próxima llegada, estado (sin stock, riesgo de quiebre, bajo
  el mínimo, exceso, sin movimiento) y sugerencia de compra con su cálculo explicado.
- Kárdex por producto y bodega con saldo, costo y enlace al documento de origen.
- Ajustes y conteos de inventario con motivo obligatorio (AJU) y transferencias entre bodegas (TRA).
- Bodegas: crear, renombrar, elegir la principal y archivar (sin stock).
- Parámetros de reposición por producto: mínimo, plazo del proveedor, días de seguridad, cobertura
  objetivo y umbral de exceso.
- Regla "Permitir vender aunque no haya stock" (si se desactiva, la venta se rechaza con el detalle).

## [Sin publicar] — Fase 6 (Compras)

### Agregado
- Proveedores: ficha con RUT, contacto y plazo de pago habitual; compras, deuda y documentos adjuntos.
- Órdenes de compra: borrador, emisión, impresión ("ORDEN DE COMPRA") y anulación con motivo.
- Recepción de mercadería parcial o total: suma stock y recalcula el costo promedio ponderado.
- Documentos de compra del proveedor (factura, boleta…): asociados a una orden o directos con ingreso a
  bodega, vencimiento según el plazo del proveedor, "Ya lo pagué", abonos y pago final.
- "Dinero que debes" con vencimientos; anulación de documentos (devuelve el stock si ingresó directo).
- Historial de precios de compra por producto y proveedor; el editor sugiere el último precio pagado.
- Accesos en Ctrl+K: nueva orden de compra, registrar factura de proveedor, nuevo proveedor.

## [Sin publicar] — Fase 5 (Ventas)

### Agregado
- Ciclo de venta completo en el escritorio: cotización → "Convertir en venta" (sin volver a digitar) →
  efectuada → abonos y pagos → "Marcar como documentada", con cierre automático cuando está pagada y
  documentada.
- Factura interna (FV) y venta (VEN) con la leyenda "DOCUMENTO INTERNO — NO TRIBUTARIO".
- Al efectuar: descuenta stock al costo promedio, fija costo y margen de cada línea, crea la cuenta por
  cobrar y, si es al contado, registra el pago en la caja.
- Ventas a crédito con fecha de pago, abonos parciales, vistas "Por cobrar", "Pendientes de
  documentación", "Borradores" y "Anuladas".
- Anulación con motivo (también de ventas cerradas): devuelve el stock y anula los cobros; nada se borra.
- Productos y servicios: crear (con stock inicial), editar ficha y precio, unidades de medida.
- Clientes: editar datos y ficha con compras, deuda, última compra y frecuencia.
- Tasa de IVA anotada por el usuario (informativa) mientras no exista un paquete normativo firmado.
- Inicio del escritorio con accesos rápidos, dinero por cobrar y ventas pendientes de documentar.
- Pruebas del contrato IPC de punta a punta con el runtime simulado de Tauri.

### Corregido
- Al entrar a un campo de monto con valor, el texto queda seleccionado y lo digitado lo reemplaza.

## [Sin publicar] — Fase 4 (Core)

### Agregado
- Usuarios con contraseña (Argon2id), 8 roles predefinidos (Administrador, Dueño, Contador, Ventas,
  Bodega, Caja, Compras, Recursos humanos) y 37 permisos editables por rol. Cada acción se valida en
  Rust, no solo en la pantalla.
- Modo de un solo usuario: mientras nadie tenga contraseña, NÚCLEO abre directo con el dueño. Al
  asignar contraseñas aparece la pantalla de inicio de sesión, con bloqueo de 5 minutos tras 5 intentos
  fallidos y bloqueo automático por inactividad (configurable).
- Configuración del negocio (nombre, RUT, giro, dirección, recordatorio de documentación tributaria).
- Numeración interna editable por tipo de documento (prefijo, ancho y próximo número; nunca hacia atrás).
- Monedas (CLP, USD, EUR, CNY) y tipos de cambio anotados a mano, con historial por fecha.
- Documentos adjuntos cifrados por archivo (AES-256-GCM) dentro de la carpeta del negocio, con
  descripción, vínculo a cliente/proveedor/documento, vista previa de imágenes, exportación y archivado
  con motivo. Se incluyen en los respaldos.
- Búsqueda global (clientes, proveedores, productos, números de documento y adjuntos) filtrada por los
  permisos del usuario.
- Visor del registro de auditoría con filtro y verificación de la cadena.

### Seguridad
- Los adjuntos usan subclaves derivadas y nombres en disco con huella con clave (no revelan el contenido).
- No se puede dejar el negocio sin un dueño activo capaz de iniciar sesión.

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
