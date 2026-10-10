# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar] — Fase 10, hito A: borrador del F29

### Agregado
- Impuestos (menú "Impuestos"): borrador del Formulario 29 del mes, código por código, con total a
  pagar, remanente, PPM y explicación de cada monto. NÚCLEO no declara: copias los códigos en sii.cl.
- Importación del Registro de Compras y Ventas descargado de sii.cl (CSV): reemplaza los datos de
  NÚCLEO del mes; las compras se clasifican (del giro, supermercado, activo fijo, uso común, sin
  derecho) y la clasificación se puede corregir. Documentos a mano (resumen de boletas, DIN).
- Sin registro importado, el borrador usa ventas documentadas, compras, gastos con IVA e IVA real de
  importaciones, y avisa lo que falta (ventas sin documentar, IVA de DIN estimado, gastos que podrían
  ser boletas).
- Datos del mes: remanente anterior reajustado con la UTM, impuesto único (48), retención de
  honorarios (151) y otras retenciones, pérdida que suspende el PPM y crédito del código 68.
- Configuración tributaria: régimen (Pro Pyme general, transparente o 14 A), tasa de PPM, día de
  vencimiento, decimales de UTM y proporción de IVA de uso común.
- "Ya lo declaré en sii.cl": guarda total, remanente y folio; bloquea el borrador (se puede reabrir con
  motivo) y propone ese remanente el mes siguiente.
- Cálculo en Rust (`nucleo-domain::f29`) con espejo en la interfaz y casos golden (`golden/f29.json`);
  migración `0018_impuestos_f29.sql`.
- Especificaciones para los próximos hitos: `docs/F29.md`, `docs/REMUNERACIONES.md`, `docs/F22.md` y los
  casos prácticos del SII en `golden/f22_casos_sii.json`.

### COMEX (respuestas del agente de aduana)
- Flete según el AWB o BL en la carpeta (facturas CPT/CFR): el valor aduanero usa ese flete y la
  diferencia pasa a la mercadería; el seguro teórico se calcula sobre esa mercadería. Con la DIN real
  la estimación queda a $2 del valor aduanero y a $1 del IVA. Migración `0019_comex_flete_documento.sql`.
- Avisos de despacho simplificado sin agente (carga general) y textos de exportación (DUS, factura de
  exportación exenta, recuperación del IVA exportador, reintegro).

### Corregido
- El escritorio mostraba COMEX como "próximamente" aunque el módulo estaba listo.

## [Sin publicar] — COMEX con un caso real y compras por courier o plataforma

### Agregado
- Seguro teórico: si no se contrató seguro, la carpeta y la calculadora aceptan el % que declara el
  agente; suma al valor aduanero (y por lo tanto al IVA y a los derechos) pero **no** al costo en
  bodega, porque no se paga. Migración `0017_comex_seguro_teorico.sql`.
- Calculadora de importación con tres modalidades: con agente de aduana (DIN), courier (trámite
  simplificado, cargo del courier) y plataforma (IVA cobrado al pagar sobre producto + envío, sin
  arancel, por defecto no recuperable con boleta). Avisa cuando la compra supera el límite de su
  modalidad (los límites vienen del paquete normativo; en la demostración, valores ilustrativos).
- Precios en USD o en pesos en la calculadora de importación; en modalidad plataforma se puede
  escribir el IVA que muestra el resumen de compra (cupones y descuentos de impuestos) y otros cargos
  (p. ej. garantía de envío).
- Calculadora de exportación: según el Incoterm de venta propone agregar flete, seguro, entrega y
  derechos en destino a los costos.
- Casos golden reales: la importación DIN 2850015246 (estimación con seguro teórico y montos reales
  de la DIN, del agente y de DHL) y una compra por Mercado Libre Internacional ($37.079, igual al
  checkout observado).

### Cambiado
- La vista de la carpeta muestra el seguro teórico en el valor aduanero y lo descuenta del costo.

### Corregido
- Pruebas que comparaban "hoy" en UTC con la fecha local de la aplicación fallaban entre las 21:00 y
  las 24:00 en Chile; ahora usan la misma fecha local.

## [Sin publicar] — Fase 9 (NÚCLEO COMEX) · en validación

### Agregado
- Carpetas de importación: proveedor, Incoterm, transporte, moneda y tipo de cambio, productos con
  precio en moneda extranjera, peso, arancel y partida; parten como cotización.
- 12 etapas (cotización → ordenada → … → recibida → cerrada) con historial, fechas automáticas y
  ETA con historial de cambios y motivo ("cambió 2 veces, +9 días").
- Costos estimados y reales (flete, seguro, derechos, IVA de importación, agente, puerto,
  almacenaje, transporte local, banco, otros), cada uno en su moneda y con su criterio de reparto;
  los reales pueden quedar por pagar o pagados en Dinero, y se anulan con motivo.
- Costo puesto en bodega por producto, calculado en Rust (`nucleo-domain::comex`) y con el mismo
  algoritmo en la interfaz; los montos reales de la declaración reemplazan al cálculo por tasa.
- Recepción parcial o total a la bodega principal al costo puesto en bodega (costo promedio y
  kárdex "Importación"); cierre con comparación "estimaste $X, costó $Y".
- Lo que viene en una importación cuenta como "por llegar" y su ETA como próxima llegada en el
  análisis de stock.
- Calculadora de importación con escenarios (misma fórmula) y botón "Crear importación"; calculadora
  de exportación (utilidad, margen y punto de equilibrio); guía de Incoterms® 2020 (resumen propio).
- Casos golden compartidos Rust/interfaz en `golden/comex.json`, pendientes de firma (D-07).

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
