# NÚCLEO ERP — Blueprint Maestro (Fase 0)

> **Todo tu negocio. Un solo núcleo.**
> **Privado. Local. Simple.** — Desde tu primera venta hasta tu empresa.
> **Tu negocio. Tus datos. Tu computador.**

| Campo | Valor |
|---|---|
| Documento | Blueprint Maestro — Fase 0 |
| Versión | **1.0 — APROBADO** |
| Fecha | 2026-10-05 (v0.1: 2026-10-04) |
| Documentos rectores | `01_VISION_PRODUCTO.md` (visión) y `02_INTELIGENCIA_COMERCIAL.md` (inteligencia comercial). Ante cualquier diferencia, prevalecen ellos |
| Estado | **Aprobado por el dueño del producto el 2026-10-05.** Fase 0 cerrada; Fase 1 en curso |
| Alcance | Visión, arquitectura, módulos, datos, seguridad, riesgos, MVP y roadmap |

**Cómo leer este documento.** Las secciones 1 a 18 responden exactamente a los 18 entregables pedidos. La sección 19 diseña la inteligencia comercial, la sección 20 propone los ADR (decisiones de arquitectura) y la sección 21 lista las **decisiones que necesito que apruebes** antes de pasar a la Fase 1. Ningún valor tributario, previsional o aduanero aparece en este documento como dato definitivo: todos se tratan como **parámetros versionados con fuente obligatoria** (regla 50).

> **Historial de cambios**
> - **v1.0 (2026-10-05):** aprobado en su totalidad ("apruebo todo"). Las decisiones D-01 a D-14 quedan resueltas según la recomendación de cada una; D-13: código abierto con licencia AGPL-3.0-or-later.
> - **v0.5 (2026-10-05):** NÚCLEO ERP será **gratuito, completo y sin activación**, financiado con **donaciones voluntarias**. Se elimina el sistema de licencias.
> - **v0.4 (2026-10-05):** incorpora `02_INTELIGENCIA_COMERCIAL.md`: promociones, fidelidad, inteligencia de clientes y productos, inventario real y proyectado, etapas y ETA de importaciones, planificación de compras, análisis de proveedores, dashboard del dueño y centro de oportunidades. Nueva §19 con fórmulas; MVP captura todos los datos necesarios desde el día 1.
> - **v0.3 (2026-10-05):** incorpora la Introducción oficial (`01_VISION_PRODUCTO.md`). NÚCLEO **no es un sistema tributario**. Documentos internos con prefijos (COT, VEN, PRO, FV…) y leyenda **DOCUMENTO INTERNO — NO TRIBUTARIO**. Estados de venta completos y **Marcar como documentada** con referencia externa opcional. Perfiles **Emprendedor / Negocio / Empresa**. Modelo comercial sin mensualidad obligatoria.
> - **v0.2 (2026-10-05):** cero integración con sistemas tributarios (sin conexión, credenciales, archivos ni emisión).
> - **v0.1 (2026-10-04):** primera versión.

---

## 1. Visión final del producto

La visión completa está en `01_VISION_PRODUCTO.md`. Esta sección la traduce en decisiones de producto.

### 1.1 Qué es

NÚCLEO ERP es un **software de gestión empresarial privado, local y simple**, una aplicación de escritorio para Windows que administra un negocio completo desde un computador: ventas, compras, clientes, proveedores, inventario, cotizaciones, caja, finanzas, costos, rentabilidad, remuneraciones, proyectos, importaciones, exportaciones, documentos y reportes. Sirve por igual a un emprendimiento informal, a una persona con inicio de actividades y a una empresa constituida. No se limita a registrar: busca ser el **sistema operativo del negocio**, que explica qué ocurrió, qué está ocurriendo y qué conviene revisar después (§19). Su diferenciador técnico adicional es **NÚCLEO COMEX**, el cálculo real de importaciones y exportaciones.

### 1.2 NÚCLEO ERP no es un sistema tributario

**NÚCLEO administra el negocio. El sistema tributario externo administra la documentación tributaria oficial.** NÚCLEO no es intermediario entre ambos.

Por diseño, NÚCLEO no emite documentos tributarios electrónicos, no solicita credenciales tributarias, no guarda contraseñas tributarias, no se conecta con plataformas fiscales, no envía ventas, no informa clientes, no transmite inventario ni proveedores, no declara impuestos, no obtiene ni firma folios tributarios y no requiere certificación como software de facturación. Esto es una **restricción de arquitectura** (ADR-003), verificada por pruebas, no solo una política.

Lo que sí hace es separar la **operación comercial** de la **documentación tributaria externa**: cada venta tiene un estado de documentación y, cuando el negocio lo tiene activado, NÚCLEO recuerda las ventas *pendientes de documentación* y permite registrar a mano la referencia externa (por ejemplo, "Factura Nº 563") que el usuario decida guardar.

### 1.3 Perfiles de operación

| Perfil | Para quién | Qué administra |
|---|---|---|
| **Emprendedor** | Persona que está comenzando; sin datos tributarios obligatorios | Productos, servicios, costos, precios, clientes, proveedores, inventario, cotizaciones, ventas internas, gastos, caja, utilidades, presupuestos, proyectos |
| **Negocio** | Persona que vende regularmente y necesita más control | Lo anterior + compras, stock, cuentas por cobrar y por pagar, bancos, empleados, reportes, rentabilidad |
| **Empresa** | Empresa constituida con administración más completa | Lo anterior + múltiples usuarios, sucursales, bodegas, centros de costo, permisos, contabilidad interna, remuneraciones, activos, comercio exterior, reportes avanzados |

**Todos usan el mismo núcleo.** El perfil solo decide qué módulos se muestran por defecto; no cambia la base de datos ni limita los datos. Se puede subir (o bajar) de perfil en cualquier momento sin migrar nada.

La **situación tributaria** (sin inicio de actividades / con inicio de actividades / empresa constituida) es un dato **separado y opcional** del negocio. Solo se usa para proponer si las ventas nacen "pendientes de documentación" o "no aplica". Un contador o asesor no es un perfil de negocio: es un **usuario** con rol Contador y vista profesional (§3.2).

### 1.4 Recorrido sin barreras

```
IDEA → EMPRENDIMIENTO → PRIMEROS CLIENTES → PRIMERAS VENTAS → ORGANIZACIÓN → FORMALIZACIÓN → EMPRESA → CRECIMIENTO
└──── Perfil Emprendedor ────┘└──────── Perfil Negocio ────────┘└──────── Perfil Empresa ────────┘
                       (misma base de datos, sin migrar, sin re-digitar, sin cambiar de software)
```

Formalizarse es **"Actualizar el perfil de mi negocio"**: agregar RUT, razón social, giro y fecha de inicio de actividades. Todo lo registrado antes (clientes, productos, cotizaciones, ventas, gastos) sigue ahí. Las ventas anteriores a la fecha de inicio quedan con documentación "no aplica".

### 1.5 Principios no negociables

1. **Local-first real.** Funciona sin Internet, sin cuenta online y aunque el proveedor desaparezca. Cero telemetría.
2. **No es un sistema tributario.** Cero integración con plataformas fiscales (§1.2).
3. **Privacidad como arquitectura.** El proveedor no puede saber cuánto vende, gana o quiénes son los clientes del negocio, porque técnicamente esos datos nunca salen del computador.
4. **Gratis, completo y sin activación.** Sin mensualidades, sin licencias y sin funciones bloqueadas. Quien quiera puede apoyar con una donación voluntaria (§1.7).
5. **Lenguaje de negocio primero.** "Dinero que te deben" en vista simple; "Deudores por venta" en vista Contador.
6. **Normativa como datos, no como código.** Toda tasa o tabla que use un cálculo vive versionada con vigencia y fuente.
7. **Trazabilidad total.** Lo efectuado no se borra: se anula o se corrige con documentos de ajuste, con auditoría encadenada.
8. **Tus datos son portables.** Exportación abierta (CSV, Excel, JSON, PDF) de todo, sin formatos cerrados.
9. **Qué pasa → por qué → qué revisar.** Ninguna recomendación sin los datos y el cálculo que la justifican.

### 1.6 Las preguntas que NÚCLEO debe responder

Un ERP para trabajar, no para declarar. Cada pregunta tiene una respuesta directa en el dashboard o en un reporte:

| Pregunta del empresario | Dónde se responde |
|---|---|
| ¿Cuánto vendí hoy? ¿Cuánto gané? | Dashboard: ventas del día/mes, utilidad estimada |
| ¿Qué clientes me deben? ¿Qué tengo que pagar? | Dinero → Por cobrar / Por pagar |
| ¿Cuánto stock tengo? | Inventario → Stock por bodega; alertas de stock crítico |
| ¿Qué producto me deja más dinero? | Reportes → Rentabilidad por producto |
| ¿Cuál proveedor es más conveniente? | Compras → Comparador de proveedores |
| ¿Cuánto efectivo tengo? | Dashboard: dinero disponible (caja y bancos) |
| ¿Cuánto cuesta realmente importar este producto? | COMEX → Landed cost / Simulador |
| ¿Cuánto necesito vender para cubrir mis gastos? | Reportes → Punto de equilibrio |
| ¿Qué ventas todavía tengo pendientes de documentar? | Dashboard y Ventas → Pendientes de documentación |
| ¿Qué debo volver a comprar? | Comprar → ¿Qué debo comprar? |
| ¿Qué viene en camino y cuándo llega? | Inventario → Stock real y proyectado · COMEX → Timeline |
| ¿Cuánto stock tendré en 30, 60 o 90 días? | Inventario → Stock futuro |
| ¿Qué clientes están dejando de comprar? | Clientes → En riesgo de pérdida |
| ¿Qué promoción funcionó mejor? | Análisis → Promociones |

### 1.7 Modelo comercial compatible con la arquitectura

**Decisión del dueño del producto (2026-10-05): NÚCLEO ERP es gratuito.** Quien lo encuentre útil puede hacer una **donación voluntaria**, al estilo de los programas clásicos de escritorio como WinRAR. Requisitos técnicos y de producto:

- **Sin sistema de licencias.** No hay activación, registro, cuenta, clave de producto ni período de prueba. Todos los módulos y perfiles (Emprendedor, Negocio, Empresa) son gratuitos.
- **Actualizaciones gratuitas**, descargables a mano o con el actualizador opcional.
- **Donar es un acto separado del programa.** El botón "Apoyar NÚCLEO" (en *Acerca de* y en un lugar discreto del menú) solo abre el navegador en la página de donaciones. NÚCLEO no procesa pagos, no guarda datos de quien dona y no cambia su comportamiento según si el usuario donó o no.
- **Sin ventanas insistentes.** A diferencia del aviso que muestra WinRAR al abrir, propongo como máximo un recordatorio amable y fácil de cerrar, por ejemplo una vez al año o al cumplir hitos ("Llevas 1.000 ventas registradas con NÚCLEO"). Nunca bloquea ni retrasa el trabajo. Ver D-14.
- Como no hay licencias, desaparece por completo el riesgo de que una licencia bloquee los datos.

### 1.8 Lo que NO es

No es un sistema tributario ni un emisor de documentos tributarios (decisión cerrada), no es un SaaS, no reemplaza al contador, no presenta declaraciones, y no integra ni copia productos existentes del mercado.

---

## 2. Arquitectura recomendada

### 2.1 Evaluación de la arquitectura sugerida (Tauri 2 + React + Rust + SQLite)

Analicé la propuesta antes de aceptarla, como pediste. **Conclusión: se mantiene**, con un ajuste importante en la capa de acceso a datos.

| Criterio | Tauri 2 + Rust + SQLite | Alternativa evaluada | Veredicto |
|---|---|---|---|
| Peso del instalador y RAM | Ejecutable pequeño, usa WebView2 del sistema | Electron (incluye Chromium completo, mucho más pesado) | Tauri gana |
| Seguridad | Modelo de *capabilities* por ventana, sin Node en el frontend | Electron requiere endurecimiento manual | Tauri gana |
| Cálculo exacto y rendimiento | Rust: tipos fuertes, decimales exactos, sin GC | .NET/WPF o WinUI: buenos en Windows, malos para macOS/Linux futuros | Tauri + Rust gana por portabilidad futura |
| Ecosistema UI moderno (Linear/Stripe-like) | React + TypeScript, ecosistema enorme | Flutter desktop, Qt | React gana por velocidad de desarrollo y talento disponible |
| Base local sin servidor | SQLite: un archivo, transaccional, probado a escala | PostgreSQL embebido | SQLite gana: cero instalación, respaldo = un archivo |
| Curva de aprendizaje | Rust es exigente | Node/Electron más fácil | Riesgo aceptado (ver §13) |

**Ajuste: `rusqlite` en lugar de SQLx.** SQLx es excelente, pero (a) su soporte de SQLCipher no es nativo y exige forzar la compilación de `libsqlite3-sys` con cifrado; (b) su API es asíncrona, lo que no aporta nada con SQLite, que tiene un único escritor; (c) la verificación de queries en compilación requiere una base de desarrollo, lo que complica CI. `rusqlite` soporta SQLCipher directamente (`bundled-sqlcipher`), es síncrono, maduro y expone la API de backup en caliente de SQLite. Ver ADR-004.

### 2.2 Estilo arquitectónico: monolito modular hexagonal

Un solo proceso, sin microservicios, pero con fronteras internas estrictas para que cada módulo sea testeable sin la UI y para que en el futuro el mismo núcleo pueda servir a varios PCs en red local sin reescribirse.

```
┌──────────────────────────────────────────────────────────────────┐
│  UI  (React + TypeScript, dentro de WebView2)                     │
│  Páginas · componentes · estado de vista · formularios            │
└───────────────▲──────────────────────────────────────────────────┘
                │ IPC tipado (comandos Tauri; tipos TS generados desde Rust)
┌───────────────┴──────────────────────────────────────────────────┐
│  CAPA TAURI (src-tauri) — delgada                                 │
│  Comandos · sesión · permisos de ventana · diálogos de archivo    │
└───────────────▲──────────────────────────────────────────────────┘
                │ llamadas Rust
┌───────────────┴──────────────────────────────────────────────────┐
│  nucleo-app  — CASOS DE USO                                       │
│  Transacciones · control de roles (RBAC) · auditoría · eventos    │
│  Motor de contabilización · motor de alertas · numeración         │
└──────▲───────────────────▲───────────────────▲───────────────────┘
       │                   │                   │
┌──────┴──────┐   ┌────────┴────────┐   ┌──────┴───────────────────┐
│nucleo-domain│   │  nucleo-rules   │   │ nucleo-io                │
│ Entidades y │   │ Normativa       │   │ Import/export CSV, Excel,│
│ cálculos    │   │ versionada y    │   │ JSON, PDF,               │
│ PUROS (sin  │   │ firmada         │   │ respaldos .erpbackup     │
│ IO): IVA,   │   │                 │   │                          │
│ costos,COMEX│   │                 │   │                          │
└─────────────┘   └────────▲────────┘   └──────────▲───────────────┘
                           │                       │
                  ┌────────┴───────────────────────┴──────┐
                  │ nucleo-db — SQLite + SQLCipher         │
                  │ Migraciones · repositorios · FTS5      │
                  └───────────────────────────────────────┘
```

**Reglas de dependencia:** `domain` no depende de nada (ni de la base ni de Tauri). `app` orquesta. `db` e `io` son adaptadores. La UI **nunca** decide permisos ni calcula impuestos: todo cálculo con efecto contable o tributario ocurre en Rust y se testea ahí. La UI puede mostrar cálculos previos en vivo (por ejemplo, totales mientras se escribe), pero el valor que se guarda siempre lo recalcula el backend.

### 2.3 Concurrencia y transacciones

SQLite en modo **WAL**, con **un hilo escritor** dedicado (cola de comandos) y un **pool de lectores**. Cada caso de uso que modifica datos corre en **una sola transacción** que incluye: el cambio, los movimientos derivados (stock, CxC, asiento), el registro de auditoría y el evento para alertas. O se guarda todo o no se guarda nada.

### 2.4 Representación numérica (crítico para un ERP)

- **Montos:** enteros (`INTEGER`) en la unidad mínima de cada moneda. CLP sin decimales; USD/EUR en centavos. La precisión por moneda es un parámetro de la tabla de monedas.
- **Cálculo intermedio:** `rust_decimal` (decimal exacto, nunca `f64`).
- **Cantidades y tasas de cambio:** decimal exacto almacenado como texto canónico o entero escalado (decisión cerrada en Fase 2).
- **Redondeo:** la regla de redondeo (por línea vs. por total, modo de redondeo) es un **parámetro normativo**, no una constante del código.
- **Fechas:** fechas contables como `DATE` local de Chile; marcas de tiempo en UTC con conversión explícita a `America/Santiago` (que tiene cambio de horario).

### 2.5 Identificadores

Clave primaria `INTEGER` (rápida en SQLite) en todas las tablas, más una columna `uid` UUIDv7 única en las entidades principales, para referencias externas, importaciones, respaldos y una eventual sincronización futura.

---

## 3. Módulos

### 3.1 Mapa de módulos

| # | Módulo | Propósito | Contenido principal | Etapa |
|---|---|---|---|---|
| M00 | **Núcleo (Core)** | Base de todo | Negocios (multiempresa), perfil de operación, sucursales, usuarios, roles, configuración, numeración con prefijos, monedas y tasas, auditoría, normativa | MVP (sucursales: V1.1) |
| M01 | **Maestros comerciales** | Fichas | Clientes, proveedores, contactos, condiciones comerciales, etiquetas, historial cronológico | MVP |
| M02 | **Productos e inventario** | Qué vendo y dónde está | Productos/servicios, SKU, código de barras, categorías, marcas, variantes, bodegas, movimientos, ajustes, transferencias, lotes, series, vencimientos, costo promedio, **stock real** (disponible, reservado, en compra, en importación, en tránsito, en recepción) y **stock futuro** | MVP (lotes/series/variantes: V1.1) |
| M03 | **Ventas** | Del interés al cobro | Cotizaciones y presupuestos (COT), proformas (PRO), notas de venta y órdenes de pedido, ventas (VEN), facturas internas (FV), registros de servicios, despachos, devoluciones, listas de precios, descuentos, vendedores | MVP (comisiones: V1.1) |
| M04 | **Compras** | Del requerimiento al pago | Solicitudes, cotizaciones de proveedor, comparador, órdenes de compra, recepciones, documentos de compra digitados | MVP |
| M05 | **Dinero (Finanzas)** | Cobrar, pagar, proyectar | CxC con antigüedad, CxP con prioridad, comprobantes de pago y registros de abonos, aplicación de pagos, bancos y cajas, gastos (recurrentes/únicos), calendario financiero, flujo de caja proyectado | MVP (conciliación bancaria: V1.1) |
| M06 | **Documentación externa** | Separar operación de documentación tributaria | Ventas **pendientes de documentación**, **Marcar como documentada** con referencia externa opcional (tipo, número, fecha, observación), IVA estimado informativo (ver D-10) | MVP |
| M07 | **NÚCLEO COMEX** | Diferenciador | Carpetas de importación con **12 etapas, ETA y timeline**, calculadora de importación, landed cost, simulador de escenarios, exportaciones, Incoterms, conversor de monedas | MVP |
| M08 | **Contabilidad interna** | Perfil Empresa + vista Contador | Plan de cuentas, motor de asientos automáticos, libro diario, mayor, balance de comprobación, estado de resultados, balance, centros de costo, períodos y cierres | Motor: MVP · UI completa: V2 |
| M09 | **Remuneraciones** | Personas | Fichas, contratos, liquidaciones preliminares, libro interno, costo empresa, provisiones, vacaciones | V2 |
| M10 | **Activos fijos** | Bienes de la empresa | Registro, vida útil, depreciación parametrizada, ubicación, responsable | V2 |
| M11 | **Punto de venta (POS)** | Venta de mesón | Búsqueda rápida, lector de código, carrito, medios de pago, apertura/cierre/arqueo de caja | V2 |
| M12 | **Reportes e indicadores** | Entender el negocio | Reportes estándar exportables, rentabilidad por dimensión, dashboard | MVP (set base) |
| M13 | **Documentos** | Repositorio local | Adjuntos cifrados vinculados a cualquier registro | MVP |
| M14 | **Búsqueda global** | "Buscar cualquier cosa" | Índice de texto completo (FTS5) sobre todas las entidades | MVP |
| M15 | **Alertas** | Avisar a tiempo | Motor de reglas configurable: vencimientos, stock, márgenes, IVA, flujo negativo, alzas de precio | MVP (set base) |
| M16 | **Datos: importar/exportar** | Portabilidad | Asistente de migración (CSV/Excel/TXT) con mapeo y duplicados; exportación total | MVP |
| M17 | **Respaldos** | Continuidad | Respaldo manual y automático, restauración validada | MVP |
| M18 | **Asistente inteligente** | Preguntar en lenguaje natural | Fase 1: consultas predefinidas sin IA; Fase 2: modelos locales (Ollama/LM Studio); externos solo con consentimiento | V2 / V3 |
| M19 | **Herramientas del emprendedor** | Antes y durante el crecimiento | Costeo, precio sugerido por margen, punto de equilibrio, proyección de ventas, actualizar perfil del negocio | MVP (base) |
| M20 | **Proyectos y presupuestos** | Agrupar trabajo por proyecto | Proyectos con sus cotizaciones, ventas, compras, gastos y rentabilidad; presupuestos | V1.1 |
| M21 | **Dashboard del dueño** | Entender el negocio en 30 segundos | Hoy · Este mes · Atención (§19.14) | MVP |
| M22 | **Inteligencia de productos** | Qué vender, qué impulsar, qué liquidar | Análisis por producto, velocidad, cobertura, riesgo de quiebre, sin movimiento, capital inmovilizado (MVP); matriz, estrellas, crecimiento, evolución 12 meses (V1.1) | MVP / V1.1 |
| M23 | **Inteligencia de clientes** | Conocer y retener clientes | Ficha inteligente (MVP); riesgo de pérdida, clasificación automática, segmentos, rentabilidad por cliente (V1.1) | MVP / V1.1 |
| M24 | **Planificación de compras** | "¿Qué debo comprar?" | Punto de reorden, cantidad sugerida con cálculo visible, exceso de inventario | V1.1 |
| M25 | **Análisis de proveedores** | Elegir mejor a quién comprar | Plazo real, cumplimiento, calidad, variación de precio, precio histórico, comparador con capital inmovilizado | V1.1 |
| M26 | **Promociones** | Vender más sin perder margen | Motor de promociones, cupones, guardia de margen, analítica "¿aumentó mis ganancias?" | V1.1 |
| M27 | **NÚCLEO Fidelidad** | Premiar a los clientes | Puntos, niveles, beneficios por nivel (opcional, todo local) | V1.2 |
| M28 | **Centro de oportunidades** | Descubrir qué hacer | Hallazgos explicados y ordenados por impacto (§19.1) | V1.1 |

### 3.2 Perfil del negocio y vista del usuario

Dos ejes independientes:

| Eje | Opciones | Qué decide | Dónde se configura |
|---|---|---|---|
| **Perfil de operación** (del negocio) | Emprendedor · Negocio · Empresa | Qué módulos aparecen en el menú por defecto (§1.3) | Configuración → Negocio |
| **Vista** (de cada usuario) | Simple (por defecto) · Contador | Vocabulario y nivel de detalle: tarjetas y lenguaje de negocio, o asientos, libros y términos contables | Menú de usuario |

Ninguno de los dos es un permiso: los permisos los dan los roles (§10.4). Un usuario de rol Ventas no ve asientos aunque active la vista Contador. Cualquier módulo oculto por el perfil se puede mostrar individualmente.

Ejemplos del glosario dual (vive en un archivo de traducción, editable):

| Vista Simple | Vista Contador |
|---|---|
| Dinero que te deben | Deudores por venta / Cuentas por cobrar |
| Dinero que debes | Proveedores / Cuentas por pagar |
| Deudas de corto plazo | Pasivo corriente |
| Utilidad estimada del mes | Resultado del ejercicio (preliminar) |
| IVA estimado (informativo) | Débito fiscal − crédito fiscal (± ajustes) |
| Dinero disponible | Disponible (caja y bancos) |

---

## 4. Mapa de navegación

### 4.1 Estructura de pantalla

```
┌────────────┬─────────────────────────────────────────────────────────────┐
│ [Empresa ▾]│  🔍 Buscar cualquier cosa (Ctrl+K)     🔔 Alertas  Modo ▾  👤 │
│            ├─────────────────────────────────────────────────────────────┤
│ SIDEBAR    │                                                             │
│ (colapsable│              ÁREA DE TRABAJO                                │
│  y con     │   Listas virtualizadas · fichas · formularios · paneles     │
│  atajos)   │   laterales de detalle (sin abrir ventanas nuevas)          │
│            │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

### 4.2 Árbol de navegación

```
Inicio — Dashboard del dueño · Centro de oportunidades (V1.1)
│
├─ Vender
│   ├─ Cotizaciones y presupuestos (COT) · Proformas (PRO)
│   ├─ Notas de venta · Órdenes de pedido
│   ├─ Ventas (VEN) · Facturas internas (FV) · Registros de servicios
│   ├─ Pendientes de documentación ← (según configuración del negocio)
│   ├─ Despachos · Devoluciones
│   ├─ Clientes (ficha inteligente · segmentos · en riesgo de pérdida)
│   ├─ Promociones y cupones ......................................... (V1.1)
│   ├─ Fidelidad (puntos y niveles) .................................. (V1.2)
│   ├─ Listas de precios
│   └─ Punto de venta ............................................ (V2)
│
├─ Comprar
│   ├─ Solicitudes de compra
│   ├─ ¿Qué debo comprar? ............................................. (V1.1)
│   ├─ Cotizaciones de proveedores · Comparador
│   ├─ Órdenes de compra
│   ├─ Recepciones
│   ├─ Documentos de compra
│   └─ Proveedores (análisis y precio histórico: V1.1)
│
├─ Inventario
│   ├─ Productos y servicios
│   ├─ Stock real y proyectado (disponible · reservado · en compra · en importación · stock futuro)
│   ├─ Sin movimiento · Capital inmovilizado
│   ├─ Stock por bodega
│   ├─ Movimientos (kárdex)
│   ├─ Ajustes · Transferencias · Toma de inventario
│   └─ Bodegas
│
├─ Dinero
│   ├─ Por cobrar (antigüedad: al día / 1-30 / 31-60 / 61-90 / +90)
│   ├─ Por pagar (prioridad y vencimientos)
│   ├─ Cobros y pagos (comprobantes de pago, abonos)
│   ├─ IVA estimado (informativo, por período) ...................... (D-10)
│   ├─ Bancos y cajas
│   ├─ Gastos (únicos y recurrentes)
│   ├─ Flujo de caja (7 d · 30 d · 60 d · 90 d · 6 m · 12 m)
│   └─ Calendario financiero
│
├─ Proyectos ........................................................ (V1.1)
│
├─ COMEX
│   ├─ Importaciones (carpetas por operación, etapas, ETA y timeline)
│   ├─ Calculadora de importación · Landed cost
│   ├─ Simulador de escenarios (marítimo / aéreo / courier…)
│   ├─ Exportaciones
│   ├─ Guía de Incoterms
│   └─ Monedas y tasas de cambio
│
├─ Contabilidad .......................... (perfil Empresa + vista Contador + rol)
│   ├─ Plan de cuentas
│   ├─ Asientos
│   ├─ Libro diario · Libro mayor · Balance de comprobación
│   ├─ Estado de resultados · Balance general
│   └─ Períodos y cierres
│
├─ Personas ........................................................ (V2)
├─ Activos fijos ................................................... (V2)
├─ Análisis (productos · clientes · promociones · proveedores · rentabilidad)
├─ Reportes
├─ Documentos (repositorio)
│
└─ Configuración
    ├─ Negocio (datos; perfil: Emprendedor / Negocio / Empresa; situación tributaria opcional; sucursales)
    ├─ Usuarios y roles
    ├─ Normativa (paquetes vigentes, historial, parámetros)
    ├─ Numeración de documentos (prefijos y correlativos: COT, VEN, PRO, FV…)
    ├─ Respaldos (manual, automático, restaurar)
    ├─ Seguridad (cifrado, bloqueo, clave de recuperación)
    ├─ Importar datos · Exportar datos
    ├─ Alertas (umbrales)
    └─ Auditoría
```

### 4.3 Principios de navegación

- **Máximo dos clics** a cualquier operación frecuente desde el Inicio; acciones rápidas en el dashboard ("Nueva venta", "Registrar pago", "Nueva cotización").
- **Paleta de comandos (Ctrl+K)**: buscar registros *y* ejecutar acciones ("nueva cotización para Juan Pérez").
- **Convertir, no re-digitar**: cada documento muestra su cadena ("COT-000147 → VEN-000089 → PAG-000340 → Documentada: Factura Nº 563") con enlaces navegables.
- **Paneles laterales** para ver detalle sin perder la lista.
- **Teclado primero** en todas las pantallas de digitación (Tab, Enter, atajos), porque un ERP se usa ocho horas al día.
- **Primer uso:** `Instalar → Crear negocio (nombre y perfil; datos tributarios opcionales: RUT, razón social, giro, dirección) → Dashboard`. Nada de servidores ni terminal.

---

## 5. Modelo conceptual de datos

### 5.1 Principios del modelo

1. **Una base de datos por empresa** (archivo SQLite cifrado propio) + una base pequeña de aplicación (`app.db`) que solo lista empresas, rutas y preferencias globales. Aislamiento físico total entre empresas (ADR-005).
2. **Libro mayor de stock como fuente de verdad**: el stock no se "edita"; se deriva de `stock_movements`. Una tabla `stock_balances` mantiene el saldo por producto/bodega dentro de la misma transacción, para lecturas rápidas.
3. **Documentos inmutables tras confirmar**: estado `borrador → confirmado → (anulado)`. Las correcciones se hacen con NC/ND, reversas o ajustes, nunca editando lo confirmado.
4. **Trazabilidad documental genérica**: `document_links (origen, destino, tipo de relación)` registra cada conversión (cotización→nota de venta→despacho→factura→pago).
5. **Normativa referenciada**: todo cálculo tributario guarda `rule_set_id` (versión normativa usada).
6. **Integridad en la base, no solo en el código**: `FOREIGN KEY`, `CHECK`, `UNIQUE`, `NOT NULL` y `PRAGMA foreign_keys=ON` siempre.
7. **Borrado lógico para maestros** (`archived_at`); **nunca borrado físico** de transacciones confirmadas.

### 5.2 Entidades por dominio

Incluye todas las tablas que pediste como mínimo (en **negrita**) y las adicionales que el diseño necesita (en cursiva, con su justificación).

**Núcleo y seguridad**
- **companies** — RUT, razón social, giro(s), dirección, comuna, perfil de operación (emprendedor / negocio / empresa), situación tributaria opcional, documentación por defecto de las ventas (pendiente / no aplica), moneda base, año inicial. RUT y datos tributarios opcionales.
- *branches* — sucursales (V1.1), cada una con sus bodegas y cajas.
- **users** — usuario local, hash Argon2id, estado, último acceso.
- *roles, permissions, role_permissions, user_roles* — roles configurables (§10.4).
- **settings** — clave/valor tipado por empresa.
- **audit_log** — usuario, acción, fecha-hora, entidad, id, valor anterior, valor nuevo, hash encadenado.
- *numbering_sequences* — **numeración NÚCLEO** por tipo de documento: prefijo + correlativo de 6 dígitos (`COT-000001`, `VEN-000001`, `PRO-000001`, `FV-000001`…), editable por el usuario (prefijo, número inicial, por sucursal). Numeración administrativa interna, sin relación con folios tributarios.
- *currencies* — código ISO, decimales, símbolo.
- **exchange_rates** — moneda, fecha, valor en CLP, origen (manual / paquete importado), usuario.

**Normativa** (detalle en §5.4)
- *rule_sets* — versión de paquete normativo (año, vigencia, firma, fuente).
- **tax_rules** → generalizado como *rule_values* — `code, value, valid_from, valid_until, source, notes, rule_set_id`.
- *document_types* — catálogo de documentos NÚCLEO (cotización, presupuesto, proforma, nota de venta, orden de pedido, venta, factura interna, registro de servicio, comprobante de pago, abono, orden de compra…) con su prefijo, efecto en stock y CxC/CxP, si **lleva la leyenda "DOCUMENTO INTERNO — NO TRIBUTARIO"** y si nace pendiente de documentación. El usuario puede crear tipos propios.
- *tax_codes* — impuestos aplicables por línea (IVA y otros impuestos que correspondan, parametrizados).

**Maestros comerciales**
- **customers**, **suppliers** — ficha completa; RUT validado (módulo 11), condiciones, crédito autorizado.
- *contacts, addresses, tags, entity_tags* — compartidos por clientes y proveedores.
- *party_notes* — notas e historial manual.

**Productos e inventario**
- **products** — tipo (bien / servicio / kit), SKU, código de barras, unidad, afecto/exento, costo promedio, último costo, precio base, stock mín./máx.
- **categories**, *brands*, *units*, *product_variants* (V1.1), *product_suppliers* (código y precio histórico por proveedor).
- **warehouses**.
- **stock_movements** — producto, bodega, fecha, tipo (entrada, salida, ajuste, transferencia), cantidad, costo unitario, costo promedio resultante, documento origen, lote/serie.
- *stock_balances* — saldo materializado por producto/bodega.
- *lots, serials* (V1.1) — vencimientos y trazabilidad unitaria.
- *price_lists, price_list_items*.

**Ventas**
- **quotes**, **quote_items**.
- *sales_orders, sales_order_items* — nota de venta / pedido.
- *deliveries, delivery_items* — despachos (generan la salida de stock).
- **sales**, **sale_items** — ventas (VEN) y facturas internas (FV) con numeración NÚCLEO. Tres estados independientes (§7.2): **comercial**, **pago** y **documentación**. Guardan en cada línea el costo, precio y margen al momento de efectuarse, más vendedor y medio de pago.
- *external_doc_refs* — referencia externa registrada a mano por el usuario al **marcar como documentada**: tipo de documento, número o folio externo, fecha de emisión, observación (todos opcionales).
- *salespeople* (comisiones en V1.1).

**Compras**
- *purchase_requests, purchase_request_items*.
- *supplier_quotes, supplier_quote_items* — alimentan el comparador.
- **purchase_orders** (+ *purchase_order_items*).
- *receipts, receipt_items* — recepciones (generan la entrada de stock).
- **purchases**, **purchase_items** — documentos de compra digitados por el usuario (con el número del documento del proveedor como referencia).

**Dinero**
- **payments** — cobros y pagos; medio de pago; cuenta de banco o caja.
- *payment_allocations* — aplica un pago a uno o varios documentos (pagos parciales y anticipos).
- **accounts_receivable**, **accounts_payable** — vencimientos (cuotas) derivados de documentos; saldo calculado desde aplicaciones.
- *bank_accounts, cash_registers*.
- **expenses** — gasto único o recurrente, categoría, fijo/variable.
- *recurring_schedules* — gastos e ingresos recurrentes (alimentan el flujo de caja).
- *cash_flow_scenarios* (V1.1).

**Impuestos**
- **tax_periods** — período mensual, estado (abierto / revisado / cerrado), resumen IVA calculado, `rule_set_id`.

**Contabilidad**
- **accounting_accounts** — plan de cuentas jerárquico (plantilla base editable).
- **journal_entries**, **journal_entry_lines** — asientos con origen (automático / manual), documento fuente, estado (propuesto / contabilizado / reversado).
- *posting_rules* — reglas configurables "tipo de documento → cuentas" del motor de contabilización.
- *cost_centers*, *fiscal_periods* (bloqueo por cierre).

**COMEX**
- **imports** — carpeta de importación: proveedor, Incoterm, moneda, tasa usada, medio de transporte, estado, `rule_set_id`.
- **import_costs** — cada costo (flete, seguro, derechos, agente, puerto, almacenaje, transporte interno, banco, otros) con moneda, base de prorrateo y si es recuperable como crédito fiscal.
- *import_items* — productos, cantidades y costo final unitario prorrateado (vínculo a inventario).
- *import_scenarios* — escenarios guardados y comparables (A marítimo, B aéreo, C courier…).
- **exports**, **export_costs**, *export_items*.
- *incoterm_definitions* — contenido versionado (quién paga, riesgo, punto de transferencia), editable/actualizable.

**Personas y activos** (V2)
- **employees**, *contracts*, **payroll**, *payroll_lines*, *payroll_parameters* (vía normativa).
- **assets**, *asset_depreciation*.

**Inteligencia comercial** (detalle en §19)
- *stock_reservations* — reservas por nota de venta / pedido.
- *import_stage_history*, *eta_changes* — etapas y cambios de ETA con motivo.
- *stock_daily_snapshot*, *fact_sales_daily*, *fact_customer_monthly* — capa analítica (§19.3).
- *insights* — hallazgos del motor (qué pasa, por qué, qué revisar, cálculo, estado).
- *sale_item_adjustments* — descuentos de cada línea desglosados por origen (promoción, cupón, nivel, manual).
- *promotions, promotion_conditions, promotion_benefits, coupons, promotion_usages* (V1.1).
- *customer_segments, segment_rules, segment_members* (V1.1).
- *loyalty_programs, points_ledger, customer_levels, level_benefits, customer_level_history* (V1.2).
- *reorder_settings* — días de seguridad, cobertura objetivo, mínimo y múltiplo de compra por producto/proveedor (V1.1).

**Transversales**
- **documents** — archivo adjunto (hash SHA-256, nombre, tipo, tamaño, ruta cifrada), *document_attachments* (vínculo a cualquier entidad).
- **alerts** — alertas generadas; *alert_rules* — umbrales configurables.
- *document_links* — trazabilidad entre documentos.
- *search_index* — tabla virtual FTS5.

### 5.3 Relaciones clave (resumen)

```
companies ─┬─< customers ──< sales ──< sale_items >── products
           ├─< suppliers ──< purchases ──< purchase_items >── products
           ├─< warehouses ──< stock_movements >── products
           │
quotes ─→ sales_orders ─→ deliveries ─→ sales ─→ accounts_receivable ←─ payment_allocations ←─ payments
supplier_quotes ─→ purchase_orders ─→ receipts ─→ purchases ─→ accounts_payable ←─ payment_allocations
                       (todas las flechas registradas en document_links)

sales / purchases / payments / expenses / imports ──(motor de contabilización)──→ journal_entries ──< journal_entry_lines >── accounting_accounts
sales / purchases ──(período)──→ tax_periods ──→ rule_sets
imports ──< import_costs ;  imports ──< import_items ──→ receipts ──→ stock_movements (costo prorrateado)
cualquier entidad ──< document_attachments >── documents
cualquier mutación ──→ audit_log
```

### 5.4 Normativa versionada (regla 50 y 51)

```
rule_sets
  id · code (ej. "CL-2026.1") · tax_year · valid_from · valid_until
  publisher · signature · imported_at · imported_by · notes

rule_values
  id · rule_set_id · code (ej. "IVA_TASA_GENERAL", "UTM", "TOPE_IMPONIBLE_AFP_UF")
  value · value_type (decimal | integer | table | json)
  valid_from · valid_until · source (norma, URL, circular) · notes
```

- El código **nunca** contiene una tasa. Pide `rules.get("IVA_TASA_GENERAL", fecha)` y recibe valor + versión, o un error explícito "parámetro no configurado para esta fecha".
- Valores mensuales (UTM, UF si se usa) se ingresan manualmente o desde un paquete; el sistema advierte si falta el del mes.
- Cada cálculo persistido guarda `rule_set_id` y, cuando aplica, una copia de los valores usados (para reproducir el cálculo años después aunque el paquete cambie).
- **Paquetes normativos** (`.nucleo-rules`): archivo firmado digitalmente (Ed25519) que el proveedor publica; el usuario lo importa a mano (offline) o, si lo autoriza explícitamente, lo descarga. Antes de activarlo, la app muestra un **diff legible** ("IVA: sin cambios · UTM octubre: nuevo valor · Tabla impuesto único: actualizada") y pide confirmación.
- Ningún valor semilla entra al repositorio sin **fuente oficial verificada** documentada en `TAX_RULES.md` / `COMEX_RULES.md`.

---

## 6. Dependencias entre módulos

### 6.1 Grafo de dependencias

```
                         ┌──────────────────────────┐
                         │ M00 NÚCLEO               │
                         │ empresas·usuarios·roles· │
                         │ normativa·monedas·audit· │
                         │ numeración·settings      │
                         └────────────┬─────────────┘
                 ┌────────────────────┼─────────────────────┐
                 ▼                    ▼                     ▼
        ┌────────────────┐   ┌────────────────┐    ┌────────────────┐
        │ M01 Maestros   │   │ M02 Productos  │    │ M13 Documentos │
        │ clientes/prov. │   │ e inventario   │    │ M14 Búsqueda   │
        └───────┬────────┘   └───────┬────────┘    └────────────────┘
                └─────────┬──────────┘
            ┌─────────────┼──────────────┐
            ▼             ▼              ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │ M03 Ventas │ │ M04 Compras│◄┤ M07 COMEX  │ (importaciones alimentan costo de compras/stock)
     └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
           └──────┬───────┘              │
                  ▼                      │
           ┌─────────────┐               │
           │ M05 Dinero  │◄──────────────┘ (costos de importación generan CxP)
           │ CxC·CxP·caja│
           └──────┬──────┘
         ┌────────┼─────────────┐
         ▼        ▼             ▼
  ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │M06 Impto.│ │M08 Contab│ │M15 Alertas   │
  │ IVA      │ │ (motor)  │ │M12 Reportes  │
  └──────────┘ └──────────┘ │   Dashboard  │
                            └──────────────┘
  V2: M09 Remuneraciones → M05, M08, M06 · M10 Activos → M08 · M11 POS → M02, M03, M05 · M18 Asistente → lectura de todo
```

### 6.2 Reglas de acoplamiento

- Un módulo **solo llama casos de uso públicos** de otro (nunca escribe sus tablas directamente). Ejemplo: Ventas no inserta en `stock_movements`; invoca `inventario::registrar_salida(...)`.
- Los módulos "de lectura" (Reportes, Dashboard, Alertas, Búsqueda, Asistente) usan **vistas/consultas de solo lectura** y nunca escriben datos de negocio.
- Las reacciones transversales (actualizar índice de búsqueda, evaluar alertas) se disparan con **eventos de dominio** dentro de la transacción (patrón *outbox* local) para no acoplar módulos entre sí.
- **Orden de construcción** derivado del grafo: Núcleo → Maestros/Productos → Inventario → Ventas/Compras → Dinero → Impuestos/Contabilidad → COMEX → Reportes/Alertas.

---

## 7. Flujo de información

### 7.1 Ciclo de venta

```
COT-000147 ──"Convertir en venta"──► VEN-000089 ──"Venta efectuada"──► PAGO / ABONOS ──► (documentación externa) ──► CERRADA
(cotizada → aceptada)                (borrador)    (stock, caja, CxC,    (PAG-…, saldo     "Marcar como documentada"
                                                    costo, margen,        de CxC)           + referencia externa opcional
                                                    utilidad)
```

Convertir copia cliente, productos, cantidades, precios y descuentos sin re-digitar, y deja el vínculo COT → VEN en `document_links`.

Lo que ocurre al **marcar VENTA EFECTUADA** (una sola transacción):

1. Fija **fecha, cliente, productos, cantidades, precio, costo (costo promedio vigente), margen y utilidad** por línea, más **vendedor** y **medio de pago**. Estos valores quedan congelados aunque después cambien costos o precios.
2. **Inventario:** genera la salida de stock (si no hubo despacho previo).
3. **Caja / cuenta por cobrar:** si fue al contado, registra el ingreso a la caja o banco; si fue a crédito, crea los vencimientos en `accounts_receivable`.
4. Genera el asiento propuesto (solo visible en vista Contador) y suma la venta al IVA estimado informativo, si el negocio lo tiene activado (D-10).
5. Si el negocio tiene activada la documentación, la venta queda **PENDIENTE DE DOCUMENTACIÓN** y aparece la alerta.
6. Registra auditoría, actualiza la búsqueda y evalúa alertas (ej. "margen negativo").

### 7.2 Estados de una venta

Los nueve estados de la visión se modelan como **tres ejes independientes**, porque en la realidad se combinan: una venta puede estar *pagada* y a la vez *pendiente de documentación*, o *documentada* y todavía *con saldo por cobrar*.

| Eje | Estados | Cómo cambia |
|---|---|---|
| **Comercial** | BORRADOR → COTIZADA → ACEPTADA → EFECTUADA → CERRADA · ANULADA | COTIZADA y ACEPTADA corresponden a la etapa de cotización (COT) y se muestran en la línea de tiempo de la venta. EFECTUADA lo marca el usuario. ANULADA revierte stock y cuentas con trazabilidad. |
| **Pago** | SIN PAGO · ABONADA · PAGADA | Automático, según los pagos y abonos aplicados. |
| **Documentación** | NO APLICA · PENDIENTE DE DOCUMENTACIÓN · DOCUMENTADA | Nace PENDIENTE o NO APLICA según la configuración del negocio (y puede cambiarse por venta). DOCUMENTADA solo la marca el usuario. |

**CERRADA** es automática cuando la venta está EFECTUADA + PAGADA + (DOCUMENTADA o NO APLICA); también puede cerrarse a mano. En pantalla, el usuario ve una sola etiqueta con el estado más relevante (por ejemplo "Pagada · Pendiente de documentación") y puede filtrar por cualquiera de los tres ejes.

### 7.3 Documentación externa

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ Esta venta está pendiente de documentación tributaria.         │
│ VEN-000089 · Juan Pérez · $ 119.000 · efectuada el 05-10-2026    │
├──────────────────────────────────────────────────────────────────┤
│ [Marcar como documentada]   [Recordármelo después]   [No aplica] │
└──────────────────────────────────────────────────────────────────┘

MARCAR COMO DOCUMENTADA  (todos los campos son opcionales)
  Tipo de documento ....... [ Factura            ▾ ]
  Número o folio externo .. [ 563                  ]
  Fecha de emisión ........ [ 05-10-2026           ]
  Observación ............. [                      ]
                                      [ Guardar ]
```

- NÚCLEO **no intenta emitir**, no abre sesiones, no usa contraseñas, no envía información y no consulta sistemas externos. Solo recuerda y guarda lo que el usuario decide escribir.
- La lista **"Pendientes de documentación"** está en Ventas, en el dashboard ("3 ventas pendientes de documentar") y en las alertas.
- La venta documentada muestra su referencia: *VEN-000089 · DOCUMENTADA · Referencia externa: Factura Nº 563*.
- Todo documento que pueda confundirse con uno tributario (venta, factura interna, proforma, comprobante) se imprime y exporta con la leyenda fija **DOCUMENTO INTERNO — NO TRIBUTARIO**, que el usuario no puede quitar. La factura interna lleva el título **FACTURA INTERNA** (D-09).

### 7.4 Ciclo de compra

```
SOLICITUD ──► COTIZACIONES DE PROVEEDOR ──► COMPARADOR ──► ORDEN DE COMPRA ──► RECEPCIÓN ──► DOCUMENTO DE COMPRA ──► PAGO
                                           (mejor precio,                     (entrada de     (CxP + IVA crédito +
                                            mejor plazo,                       stock, recalcula asiento propuesto)
                                            mejor histórico)                   costo promedio)
```

**Entrada de compras:** el usuario digita el documento de su proveedor (o carga varios desde una planilla propia con el asistente de importación de datos). NÚCLEO no lee archivos ni registros de sistemas tributarios.

### 7.5 Ciclo de importación (COMEX → inventario → finanzas)

```
SIMULACIÓN / ESCENARIOS ──► CARPETA DE IMPORTACIÓN ──► COSTOS REALES (facturas de proveedor, flete, agente, aduana…)
                                                        │
                                ┌───────────────────────┼─────────────────────────┐
                                ▼                       ▼                         ▼
                      PRORRATEO A PRODUCTOS      CxP por cada proveedor     IVA de importación como
                      (por valor, peso, volumen  de servicio               crédito (si corresponde, según
                       o unidades — elegible)                                normativa parametrizada)
                                ▼
                      RECEPCIÓN EN BODEGA a costo landed → costo promedio actualizado → margen real de venta
```

La simulación y la operación real usan **la misma calculadora**; al cerrar la carpeta, NÚCLEO compara lo simulado vs. lo real ("estimaste $X por unidad; costó $Y").

### 7.6 Cierre mensual (guiado)

`Revisar ventas → revisar compras → ventas pendientes de documentación → IVA estimado (si está activo) → revisar alertas → (contador) revisar asientos → cerrar período → respaldo de cierre automático`.

---

## 8. Estrategia local-first

### 8.1 Qué significa en la práctica

| Garantía | Cómo se cumple |
|---|---|
| Funciona sin Internet | Ninguna función del MVP requiere red. Pruebas automáticas corren con red deshabilitada. |
| Sin cuenta online | Usuarios locales con contraseña; sin licencias, activación ni registro. |
| Sobrevive al proveedor | Formato de datos documentado (SQLite + JSON), exportación total abierta, la app es gratuita y no depende de ninguna activación, así que sigue funcionando indefinidamente. |
| Cero fuga de datos | Sin telemetría, sin analítica, sin reportes de error automáticos. Cualquier conexión saliente futura (actualizaciones, paquete normativo, IA externa) es **opt-in explícito** y se describe antes de ocurrir. |
| Verificable | Política técnica: la configuración de seguridad de Tauri no permite peticiones HTTP salvo las autorizadas; en pruebas se monitorea que el proceso no abra conexiones. |

### 8.2 Ubicación de datos en disco

```
%LOCALAPPDATA%\NucleoERP\            (ubicación cambiable al instalar, ej. D:\NucleoERP)
├─ app.db                        lista de empresas, preferencias globales (sin datos de negocio)
├─ companies\
│   └─ <uid-empresa>\
│       ├─ company.db            base cifrada de la empresa (SQLCipher)
│       ├─ documents\ab\cd\<sha256>.enc   adjuntos cifrados, deduplicados por contenido
│       ├─ exports\              exportaciones generadas
│       └─ logs\                 registro técnico local (sin datos de negocio)
└─ rules\                        paquetes normativos importados
```

### 8.3 Actualizaciones

- **De la aplicación:** instalador nuevo descargado manualmente, o actualizador integrado de Tauri con firma, **desactivado por defecto** y activable por el usuario.
- **De la base de datos:** migraciones automáticas al abrir la empresa, **siempre precedidas por un respaldo automático** y ejecutadas en transacción; si fallan, se revierte y se informa.
- **De la normativa:** paquetes firmados (§5.4), con diff y confirmación.

### 8.4 Uso en varios computadores (decisión consciente)

El MVP es **un computador, varios usuarios**. Abrir un archivo SQLite desde una carpeta compartida de red **no es seguro** (riesgo de corrupción) y la app lo detectará y lo impedirá. La arquitectura hexagonal deja preparado un **"Modo Servidor Local" (V3)**: un PC de la oficina ejecuta el mismo núcleo como servidor en la red local y los demás se conectan, sin nube. Ver riesgo T-03.

---

## 9. Estrategia de respaldos

### 9.1 Formato `.erpbackup`

Nombre: `empresa_YYYY-MM-DD.erpbackup` (si ya existe ese día: `empresa_YYYY-MM-DD_HHMM.erpbackup`), donde *empresa* es el nombre corto de la empresa normalizado.

```
empresa_2026-10-04.erpbackup   (contenedor cifrado con contraseña de respaldo o clave de la empresa)
└─ (descifrado)
   ├─ manifest.json      formato, versión de app, versión de esquema, uid y RUT de empresa,
   │                     fecha, usuario, lista de archivos con SHA-256, cantidad de registros por tabla
   ├─ company.db         copia consistente obtenida con la API de backup en caliente de SQLite
   ├─ documents/…        adjuntos
   ├─ settings.json      configuración de la empresa
   └─ rules/…            paquetes normativos usados (para reproducir cálculos)
```

### 9.2 Crear respaldo (botón "CREAR RESPALDO")

1. Snapshot consistente de la base **sin cerrar la app** (backup API / `VACUUM INTO`).
2. Empaquetado + checksums SHA-256 + cifrado autenticado.
3. **Verificación inmediata**: se reabre el respaldo en una carpeta temporal, se validan checksums e `integrity_check`. Si falla, el respaldo se marca inválido y se avisa.
4. Registro en auditoría y en el historial de respaldos.

### 9.3 Restaurar ("RESTAURAR RESPALDO")

1. Usuario elige el archivo → se valida: firma/magia del formato, descifrado, **versión** (no se restaura un respaldo de una versión de app más nueva), **checksums**, **estructura** (`integrity_check`, `foreign_key_check`, tablas esperadas).
2. Muestra resumen antes de confirmar: empresa, fecha, cantidad de clientes, ventas, documentos.
3. Restaura **en una carpeta nueva**; si el esquema es antiguo, aplica migraciones.
4. Solo entonces reemplaza la empresa activa, conservando la anterior como `pre-restore` hasta que el usuario confirme.
5. Opción alternativa: restaurar como **empresa nueva** (para revisar un respaldo antiguo sin tocar la actual).

### 9.4 Respaldo automático

| Opción | Disparador |
|---|---|
| Cada día | Al abrir la app si el último tiene más de 24 h, y al cerrar la app |
| Cada semana | Igual, umbral 7 días |
| Cada cierre | Al cerrar un período mensual |
| Siempre | Antes de cualquier migración o restauración |

- Destino elegido por el usuario: carpeta local, USB o disco externo (si el destino no está conectado, avisa y reintenta, sin bloquear el trabajo). **Nunca obligatoriamente la nube**; si el usuario elige una carpeta sincronizada por su cuenta, es su decisión y el archivo va cifrado.
- **Retención configurable** (ej. 7 diarios, 4 semanales, 12 mensuales) para no llenar el disco.
- **Advertencia** si el destino está en el mismo disco que los datos (no protege ante falla del disco).
- Indicador permanente en el dashboard: "Último respaldo verificado: hace 2 días ✓".

---

## 10. Seguridad

### 10.1 Cifrado en reposo

- **Base de datos:** SQLCipher (AES-256) vía `rusqlite` (ADR-004).
- **Adjuntos y respaldos:** cifrado autenticado por archivo con la clave de la empresa.
- **Gestión de claves:**
  - Cada empresa tiene una **clave de datos aleatoria**.
  - Esa clave se protege con el **almacén seguro de Windows** (Credential Manager / DPAPI vía crate `keyring`) para que el uso diario no exija contraseña adicional; **y además** se envuelve con una clave derivada de la contraseña del administrador (Argon2id).
  - Al crear la empresa se genera una **clave de recuperación** imprimible ("guárdala como guardarías las llaves de la oficina"). Sin ella, una contraseña olvidada + un Windows reinstalado = datos irrecuperables. La app lo explica con claridad.
  - Nunca hay claves en texto plano, ni en archivos de configuración, ni en logs.

### 10.2 Seguridad de la aplicación

- Tauri con **capabilities mínimas**: sin plugin de shell, acceso a archivos solo vía diálogos y rutas permitidas, sin contenido remoto, **CSP estricta**.
- **Validación en Rust** de todo lo que llega por IPC (tipos, rangos, longitudes); la UI no es una frontera de confianza.
- **Permisos (RBAC) verificados en el backend** en cada caso de uso, con pruebas automáticas.
- SQL siempre parametrizado; sin SQL dinámico desde la UI.
- Bloqueo por inactividad configurable y cambio rápido de usuario.
- Instalador y ejecutables **firmados** con certificado de firma de código.
- Cadena de suministro: `cargo audit`, `cargo deny`, `npm audit`, dependencias fijadas y revisadas (regla 55: cada dependencia nueva se justifica en `DECISIONS.md`).

### 10.3 Auditoría

`audit_log`: usuario, acción, fecha-hora (UTC + local), entidad, id del registro, valor anterior y nuevo (JSON), módulo, equipo. Cada fila guarda el **hash de la fila anterior** (cadena tipo libro inmutable): si alguien edita la base por fuera, la verificación de integridad lo detecta. Las operaciones contables críticas (confirmar, anular, reversar, cerrar período, reabrir período) exigen motivo escrito.

### 10.4 Roles base (permisos configurables)

| Permiso \ Rol | Admin | Dueño | Contador | Ventas | Bodega | Caja | Compras | RR.HH. |
|---|---|---|---|---|---|---|---|---|
| Configuración y usuarios | ✔ | ✔ | — | — | — | — | — | — |
| Ventas y clientes | ✔ | ✔ | ver | ✔ | ver | parcial | — | — |
| Compras y proveedores | ✔ | ✔ | ver | — | ver | — | ✔ | — |
| Inventario | ✔ | ✔ | ver | ver | ✔ | ver | ver | — |
| Dinero (CxC, CxP, bancos) | ✔ | ✔ | ✔ | ver propio | — | caja | ver | — |
| Impuestos y contabilidad | ✔ | ✔ | ✔ | — | — | — | — | — |
| Remuneraciones (V2) | ✔ | ✔ | ✔ | — | — | — | — | ✔ |
| Costos y márgenes | ✔ | ✔ | ✔ | config. | — | — | config. | — |
| Respaldos / restaurar | ✔ | ✔ | crear | — | — | — | — | — |
| Auditoría | ✔ | ✔ | ✔ | — | — | — | — | — |

Los permisos son granulares (ver/crear/editar/confirmar/anular/exportar por recurso); la tabla es solo la plantilla inicial.

### 10.5 Datos personales

Clientes, contactos y empleados son datos personales. Aunque los datos no salgan del computador, la pyme es responsable de su tratamiento. NÚCLEO incluirá exportación de los datos de una persona, anonimización de clientes inactivos y registro de acceso a datos sensibles (remuneraciones). La normativa chilena de protección de datos personales aplicable y sus fechas de vigencia **se verificarán en Fase 13** con fuente oficial antes de definir requisitos.

---

## 11. Estructura propuesta del repositorio

Monorepo con **Cargo workspace** (Rust) + **pnpm workspace** (frontend). Cinco crates, no más, para evitar sobre-ingeniería.

```
nucleo-erp/
├─ apps/
│  └─ desktop/
│     ├─ src/                         Frontend React + TypeScript
│     │  ├─ app/                      router, providers, layout, sidebar, Ctrl+K
│     │  ├─ modules/                  un directorio por módulo
│     │  │  ├─ dashboard/
│     │  │  ├─ customers/  suppliers/  products/  inventory/
│     │  │  ├─ sales/  purchases/  finance/  taxes/  comex/
│     │  │  ├─ accounting/  reports/  documents/  settings/
│     │  │  └─ <módulo>/ { pages/, components/, hooks/, api.ts, schemas.ts }
│     │  ├─ shared/                   ui/ (sistema de diseño), lib/, format/ (CLP, RUT, fechas), i18n/ (glosario Simple/Contador)
│     │  └─ bindings/                 tipos TS GENERADOS desde Rust (no se editan a mano)
│     └─ src-tauri/
│        ├─ src/ { main.rs, commands/<módulo>.rs, session.rs }
│        ├─ capabilities/             permisos Tauri mínimos
│        └─ tauri.conf.json
├─ crates/
│  ├─ nucleo-domain/                  entidades, validaciones (RUT), cálculos puros: IVA, descuentos,
│  │                                  costo promedio, landed cost, exportación, flujo de caja, monedas
│  ├─ nucleo-rules/                   motor normativo: carga, vigencias, firma de paquetes, consultas por fecha
│  ├─ nucleo-db/                      conexión SQLCipher, migraciones/ (SQL numerado), repositorios, FTS5
│  ├─ nucleo-app/                     casos de uso, transacciones, RBAC, auditoría, eventos, motor de asientos,
│  │                                  alertas, respaldos
│  └─ nucleo-io/                      CSV, Excel, JSON, PDF, formato .erpbackup
├─ rules/                             fuentes de paquetes normativos (YAML/JSON) + referencia a su fuente oficial
├─ tests/
│  ├─ golden/                         casos de cálculo validados (IVA, COMEX, costos) en tablas legibles
│  ├─ fixtures/                       bases de versiones anteriores para pruebas de migración
│  └─ e2e/                            flujos críticos de UI
├─ tools/
│  ├─ seed/                           generador de datos masivos (100k clientes, 100k productos, 1M movimientos)
│  └─ bench/                          mediciones de rendimiento
├─ docs/
│  ├─ 00_BLUEPRINT_MAESTRO.md
│  ├─ README.md  ARCHITECTURE.md  DATABASE.md  ROADMAP.md  CHANGELOG.md
│  ├─ SECURITY.md  TAX_RULES.md  COMEX_RULES.md  DECISIONS.md  TESTING.md
│  └─ adr/ ADR-001-sqlite.md …
├─ .github/workflows/                 CI en Windows: lint, tests, build, auditoría de dependencias
├─ Cargo.toml  package.json  pnpm-workspace.yaml  rust-toolchain.toml
└─ LICENSE (según D-13: código abierto o cerrado)
```

**Reglas de tamaño:** archivos de más de ~400 líneas o componentes de más de ~250 líneas se dividen. Cada módulo frontend expone solo lo necesario.

---

## 12. Stack definitivo

| Capa | Elección | Por qué | Alternativa descartada |
|---|---|---|---|
| Shell de escritorio | **Tauri 2.x** | Liviano, seguro, instalador Windows, multiplataforma futura | Electron (pesado) |
| Runtime web | **WebView2** (Windows) | Incluido en Windows 11; en Windows 10 el instalador lo incluye/instala | — |
| Backend | **Rust estable** | Exactitud, rendimiento, seguridad de memoria | Node (cálculos con flotantes, menor robustez) |
| Base de datos | **SQLite** en modo WAL + **SQLCipher** | Un archivo, sin servidor, transaccional, cifrado | PostgreSQL embebido |
| Acceso a datos | **rusqlite** + migraciones SQL versionadas embebidas | SQLCipher nativo, síncrono, API de backup | SQLx (ver §2.1) |
| Decimales | **rust_decimal** | Aritmética exacta | `f64` (prohibido para dinero) |
| Fechas | **time** o **chrono** + zona `America/Santiago` | Manejo de horario de verano | — |
| Contraseñas / claves | **argon2** · **keyring** (Credential Manager/DPAPI) | Estándar actual; almacén seguro del SO | Texto plano (prohibido) |
| Búsqueda | **SQLite FTS5** | Integrado, rápido, sin dependencias | Motor externo |
| Excel / CSV | **rust_xlsxwriter**, **calamine**, **csv** | Escribir y leer Excel sin Office | — |
| PDF | **Typst embebido** *(a validar en spike)*; respaldo: impresión a PDF de WebView2 | Plantillas de calidad, reproducibles | Generación manual de PDF de bajo nivel |
| Tipos Rust → TS | **tauri-specta** | Un solo contrato, cero desalineación | Tipos duplicados a mano |
| Frontend | **React + TypeScript** (estricto) + **Vite** | Ecosistema, productividad | — |
| Datos en UI | **TanStack Query** (caché sobre IPC), **TanStack Table** + **TanStack Virtual** | Listas de cientos de miles de filas fluidas | — |
| Formularios | **react-hook-form** + **zod** | Validación declarativa (espejo de la validación Rust) | — |
| Estilos / componentes | **Tailwind CSS** + primitivas **Radix** (componentes propios, estilo shadcn) | Accesibles, modo claro/oscuro, estética moderna | Librerías de UI pesadas |
| Gráficos | **ECharts** o **Recharts** *(decidir en Fase 3)* | Dashboards claros | — |
| Estado global | **Zustand** (mínimo) | Solo estado de UI; el estado de negocio vive en la base | Redux |
| Pruebas | `cargo test`, **proptest**, **Vitest** + Testing Library, **Playwright** / WebDriver de Tauri para E2E | Ver criterios del §18 | — |
| Instalador | **NSIS** de Tauri → `NucleoERPSetup.exe` (x64), firmado | Instalación por usuario sin permisos de administrador | — |
| Asistente (V2) | Interfaz `AssistantProvider` → Ollama / LM Studio (API local) / externo opt-in | Desacoplado | Dependencia cloud obligatoria |

Las versiones exactas se fijan en `Cargo.lock` / `pnpm-lock.yaml` al iniciar la Fase 1 y se registran en `DECISIONS.md`.

---

## 13. Riesgos técnicos

| ID | Riesgo | Impacto | Prob. | Mitigación |
|---|---|---|---|---|
| T-01 | **Pérdida de la clave de cifrado** (contraseña olvidada + Windows reinstalado) | Crítico: datos irrecuperables | Media | Clave de recuperación imprimible obligatoria al crear empresa; respaldos con contraseña propia; recordatorios |
| T-02 | Corrupción de base por corte de luz o cierre forzado | Alto | Baja | WAL, transacciones, `synchronous` adecuado, verificación de integridad al abrir, respaldos verificados |
| T-03 | **Pymes con 2+ computadores** (caja + oficina) que esperan compartir datos | Alto (comercial) | Alta | Bloquear apertura desde red compartida; comunicarlo; Modo Servidor Local en V3 (arquitectura ya preparada) |
| T-04 | Compilación de SQLCipher en Windows (backend criptográfico) | Medio | Media | Spike en Fase 1 con build reproducible en CI antes de cualquier otro código |
| T-05 | Recalcular costo promedio con documentos de fecha retroactiva | Alto (márgenes erróneos) | Alta | Recalculo del kárdex desde la fecha afectada en segundo plano; bloquear fechas en períodos cerrados; pruebas de propiedad |
| T-06 | Redondeos CLP (por línea vs. total) generan diferencias de $1 con el sistema oficial | Medio | Alta | Regla de redondeo parametrizada; conciliación tolerante y explicada; casos golden |
| T-07 | Rendimiento de IPC con listas enormes | Medio | Media | Paginación por cursor (keyset), virtualización, nunca enviar tablas completas a la UI |
| T-08 | WebView2 ausente o desactualizado en Windows 10 | Medio | Baja | Instalador con bootstrapper de WebView2 (o versión offline) |
| T-09 | Antivirus y SmartScreen bloquean el instalador | Alto (adopción) | Media | Firma de código desde la primera beta pública; el certificado tiene un costo anual que debe cubrirse aunque el programa sea gratuito |
| T-18 | **Sostenibilidad**: las donaciones suelen cubrir una fracción pequeña de los costos (certificado de firma, sitio web, tiempo de desarrollo y soporte) | Alto | Alta | Costos fijos mínimos (sin servidores: el modelo local-first casi no tiene costos de operación); servicios opcionales fuera del programa (capacitación, migración de datos, soporte personalizado) si se decide; comunidad si el código es abierto (D-13) |
| T-10 | Generación de PDF de calidad | Medio | Media | Spike Typst vs. impresión WebView2 en Fase 1 |
| T-11 | **Alcance del MVP demasiado grande** (20 módulos) | Alto | Alta | Hitos internos con entregables usables (§17); criterios de "terminado" por módulo; no avanzar con módulos a medias |
| T-12 | Curva de aprendizaje de Rust / dependencia de una sola persona | Medio | Media | Código del dominio simple y documentado; ADR; pruebas como documentación |
| T-13 | Migraciones de esquema que rompen bases de clientes | Crítico | Media | Respaldo previo automático, migración transaccional, pruebas desde cada versión publicada (fixtures) |
| T-14 | Horario de verano Chile y fechas límite | Bajo | Media | Fechas contables sin hora; zona horaria explícita en pruebas |
| T-15 | Recomendaciones erróneas por datos incompletos (stock mal contado, ventas sin costo, ETA desactualizadas) | Alto | Alta | "Datos insuficientes" en vez de recomendar; cálculo siempre visible; indicadores de calidad de datos (productos sin costo, ETA vencidas, inventario sin tomar hace más de N días) |
| T-16 | Lentitud de la analítica con mucho historial | Medio | Media | Tablas resumen transaccionales (§19.3), recalculo en segundo plano, presupuestos de rendimiento en CI |
| T-17 | Promociones combinadas que regalan margen sin que el usuario lo note | Alto | Media | No acumulables por defecto (D-11), guardia de margen, vista previa del efecto antes de activar |

---

## 14. Riesgos tributarios

| ID | Riesgo | Mitigación |
|---|---|---|
| R-01 | Que un documento interno entregado a un cliente se confunda con un documento tributario (problema para el usuario y para el producto) | Leyenda fija **DOCUMENTO INTERNO — NO TRIBUTARIO** en todo impreso y PDF de ese tipo, no editable; título **FACTURA INTERNA** (D-09); numeración con prefijo NÚCLEO (FV-000001), distinta de un folio tributario |
| R-02 | **POS sin boleta legal**: vender en mesón exige documento tributario electrónico; una "boleta interna" no lo reemplaza | El POS (V2) usa el mismo flujo: venta efectuada → pendiente de documentación → el usuario documenta fuera de NÚCLEO. NÚCLEO no emitirá documentos tributarios (decisión cerrada) |
| R-03 | Ventas efectuadas que el usuario olvida documentar | Lista "Pendientes de documentación", dashboard, alertas y resumen de fin de mes; la documentación tributaria sigue siendo responsabilidad del usuario |
| R-04 | Cambios normativos (tasas, tablas, reformas, topes) | Normativa versionada con vigencia y fuente; paquetes firmados; cada cálculo guarda su versión |
| R-05 | **Diferencias por régimen tributario** (regímenes Pro Pyme y régimen general tienen obligaciones contables distintas) | Régimen como dato de la empresa; reglas condicionadas por régimen en el paquete normativo; "no lo sé aún" permitido con advertencia |
| R-06 | IVA con operaciones mixtas (afectas y exentas), notas de crédito de períodos anteriores, IVA de importación, retenciones o impuestos adicionales | Modelo de impuestos por línea (`tax_codes`); asistente IVA que marca casos complejos como "requiere revisión de tu contador" en lugar de resolverlos en silencio |
| R-07 | Que cifras informativas (IVA estimado, utilidad) se usen como si fueran una declaración | Rotuladas siempre como "estimado / informativo"; NÚCLEO no prepara declaraciones (ver D-10) |
| R-08 | Responsabilidad por cálculos erróneos | Términos de uso claros; avisos "estimado/preliminar"; casos golden revisados por un contador antes del lanzamiento; trazabilidad del cálculo |
| R-09 | Remuneraciones: errores en cotizaciones o impuesto único con consecuencias laborales | Módulo en V2; liquidación "preliminar"; todos los parámetros (topes, tasas por AFP, seguros, tablas) versionados; casos de prueba con liquidaciones reales verificadas |
| R-10 | Conservación de documentos y libros por los plazos legales | Política de no-borrado; respaldos; plazos a parametrizar tras verificar fuente oficial |
| R-11 | Documentos en moneda extranjera (exportaciones) y tipo de cambio aplicable | Tipo de cambio registrado por documento con su origen; regla de qué tasa usar como parámetro normativo verificado |
| R-12 | COMEX: valor aduanero, aranceles preferenciales por tratados, seguro/flete presunto, franquicias, pequeñas importaciones | La calculadora **no trae aranceles inventados**: el usuario ingresa la tasa o selecciona un parámetro con fuente; reglas especiales en `COMEX_RULES.md` con fuente oficial; resultados rotulados como simulación |

**Regla transversal:** ante ambigüedad normativa, NÚCLEO **no decide por el usuario**: explica, muestra alternativas y recomienda consultar a su contador.

---

## 15. Módulos MVP — "ERP CORE V1"

Tus 20 puntos, con el alcance concreto que propongo para cada uno.

| # | Módulo MVP | Alcance V1 (dentro) | Fuera de V1 |
|---|---|---|---|
| 1 | Empresas | Crear negocio con perfil (Emprendedor / Negocio / Empresa), multiempresa, selector, datos tributarios opcionales, actualizar perfil sin perder datos | Sucursales (V1.1) |
| 2 | Usuarios | Usuarios locales, roles base, permisos granulares, bloqueo por inactividad | SSO |
| 3 | Clientes | Ficha completa, validación RUT, historial cronológico, deuda, crédito, etiquetas | Portal de clientes |
| 4 | Proveedores | Ficha, contactos, precios históricos, condiciones, deuda | — |
| 5 | Productos | Bienes y servicios, SKU, código de barras, categorías, marcas, precios, listas de precios | Variantes (V1.1) |
| 6 | Inventario | Multibodega, movimientos, ajustes, transferencias, costo promedio ponderado, último costo, stock mín./máx., kárdex | Lotes, series, vencimientos (V1.1) |
| 7 | Ventas | Ventas (VEN), facturas internas (FV), proformas (PRO), registros de servicios, tres ejes de estado, despachos, devoluciones, pendientes de documentación y "Marcar como documentada" | Comisiones (V1.1), POS (V2) |
| 8 | Compras | Documentos de compra digitados, recepción, carga desde planilla propia | — |
| 9 | Cotizaciones | Cotizaciones y presupuestos (COT) con PDF y "Convertir en venta"; cotizaciones de proveedor y comparador | — |
| 10 | Órdenes | Órdenes de compra y notas de venta con conversión y estados | Aprobaciones multinivel |
| 11 | Cuentas por cobrar | Vencimientos, comprobantes de pago y registros de abonos, antigüedad, total por cobrar | Cobranza automatizada por correo |
| 12 | Cuentas por pagar | Vencimientos, prioridad, calendario financiero | Pagos bancarios automáticos |
| 13 | Gastos | Categorías, recurrentes, fijos/variables, adjunto del comprobante | — |
| 14 | Dashboard | **Dashboard del dueño** (Hoy · Este mes · Atención) + ingresos vs. gastos + flujo de caja 7/30/60/90 días | Centro de oportunidades (V1.1), dashboards personalizables |
| 15 | Calculadora / IVA estimado | Cifra **informativa**: IVA de ventas − IVA de compras ± ajustes, comparación con meses anteriores; desactivable (D-10) | Cualquier declaración, formulario, archivo o conexión tributaria |
| 16 | Importaciones | Calculadora, landed cost, escenarios, carpeta real con 12 etapas, ETA con historial, timeline, prorrateo a inventario, precio sugerido por margen | Integración con agentes |
| 17 | Exportaciones | Calculadora: costo, ingreso, margen, utilidad, punto de equilibrio; Incoterms; monedas | Documentos de exportación oficiales |
| 18 | Backup | Manual, automático, verificación, restauración validada | — |
| 19 | Reportes | Ventas (período/cliente/producto/vendedor), margen, compras, gastos, inventario, rotación, CxC, CxP, flujo, IVA, importaciones, exportaciones → PDF/Excel/CSV | Diseñador de reportes |
| 20 | Auditoría | Registro encadenado, visor con filtros, verificación de integridad | — |

**Inteligencia comercial en el MVP** (porque usa datos que el MVP ya tiene): captura completa de datos (§19.2), stock real y stock futuro, velocidad de venta, cobertura y riesgo de quiebre, productos sin movimiento y capital inmovilizado, análisis básico por producto y ficha inteligente del cliente. El resto llega en V1.1 y V1.2 (ver D-12).

**Incluido además en el MVP por ser fundacional** (bajo costo si se hace desde el inicio, alto costo si se agrega después): motor de normativa versionada, búsqueda global, alertas base, repositorio de documentos, importación/exportación de datos, herramientas del emprendedor (costeo, precio, punto de equilibrio), y el **motor de asientos automáticos** (genera asientos propuestos; la UI contable completa llega en V2) — ver decisión D-01.

---

## 16. Módulos posteriores

| Versión | Módulos |
|---|---|
| **V1.1 — Inteligencia comercial** | Promociones, cupones y su analítica; matriz de productos, estrellas, crecimiento y evolución; "¿Qué debo comprar?"; análisis y comparador de proveedores; clientes en riesgo, segmentos y rentabilidad por cliente; Centro de oportunidades; Sucursales; Proyectos y presupuestos; Variantes, lotes, series y vencimientos; comisiones de vendedores; conciliación bancaria (importando cartolas CSV/Excel); escenarios de flujo de caja; centros de costo en UI |
| **V1.2** | NÚCLEO Fidelidad (puntos, niveles, beneficios por nivel) |
| **V2** | Contabilidad interna completa en vista Contador (libros, balances, cierre anual); Remuneraciones; Activos fijos y depreciación; POS offline con caja; Asistente inteligente fase 1 (consultas predefinidas sin IA) |
| **V3** | Asistente con modelos locales (Ollama / LM Studio) y externos opt-in; Modo Servidor Local (varios PCs en red local); macOS y Linux; exportaciones de archivos previsionales |
| **Futuro evaluable** | Fuentes externas de tipo de cambio (opt-in), app móvil de consulta en red local, presupuestos y planificación financiera avanzada |

---

## 17. Roadmap de construcción

Cada fase termina con un entregable verificable. No se pasa a la siguiente sin cumplir su criterio de salida.

| Fase | Nombre | Entregables | Criterio de salida |
|---|---|---|---|
| **0** | Análisis | Este Blueprint | Aprobado por ti, con decisiones D-01…D-14 resueltas |
| **1** | Arquitectura | Monorepo, CI Windows, los 11 archivos de control, ADR-001…, **spikes**: SQLCipher + backup API en Windows, IPC tipado, PDF, FTS5, instalador firmado de prueba | App "hola mundo" instalable que crea una base cifrada, escribe, respalda y restaura |
| **2** | Modelo de datos | `DATABASE.md`, migraciones iniciales, motor de normativa, generador de datos masivos | Migraciones probadas; base sembrada con 100k/100k/1M dentro de presupuestos de rendimiento |
| **3** | Diseño UX | Sistema de diseño (tokens, componentes, claro/oscuro), layout, Ctrl+K, prototipos navegables de dashboard, venta, compra, COMEX | Prueba de usabilidad con 3-5 usuarios no contadores |
| **4** | Core | Empresas, usuarios, roles, auditoría, configuración, monedas, numeración, documentos, búsqueda | Hito A: "puedo crear mi empresa, usuarios y adjuntar documentos" |
| **5** | Ventas | Clientes, productos (base), COT → "Convertir en venta" → VEN → efectuada → pago → "Marcar como documentada" | Ciclo de venta completo sin re-digitar |
| **6** | Compras | Proveedores, solicitudes, comparador, OC, recepción, documentos de compra | Ciclo de compra completo |
| **7** | Inventario | Multibodega, kárdex, costo promedio, ajustes, transferencias, recálculo retroactivo, reservas, stock real y futuro, velocidad, cobertura, riesgo de quiebre, sin movimiento | Hito B: "opero mi negocio: vendo, compro y controlo stock" |
| **8** | Finanzas | CxC, CxP, cobros/pagos, bancos/cajas, gastos, calendario, flujo de caja, dashboard | Hito C: "sé cuánto me deben, cuánto debo y cuánto tendré" |
| **9** | COMEX | Calculadoras, escenarios, carpeta de importación con etapas, ETA, timeline y prorrateo a stock, exportaciones, Incoterms | Casos golden de importación/exportación aprobados |
| **10** | Contabilidad | Plan de cuentas base, motor de asientos automáticos, visor de asientos | Todo documento confirmado produce asiento cuadrado |
| **11** | Documentación externa e indicadores | Pendientes de documentación, referencias externas, IVA estimado informativo, paquete normativo inicial con fuentes verificadas | Hito D: cierre mensual guiado completo |
| **12** | Reportes | Reportes MVP + exportación PDF/Excel/CSV, alertas, Dashboard del dueño, análisis básico de productos y clientes | Todos los reportes del §15 #19 disponibles |
| **13** | Seguridad | Revisión de cifrado, claves, RBAC, auditoría encadenada, datos personales, endurecimiento Tauri | Checklist de `SECURITY.md` completo |
| **14** | Testing | Suite completa, pruebas de rendimiento, de migración, E2E, prueba de "cero red" | Criterios del §18 cumplidos |
| **15** | Instalador | `NucleoERPSetup.exe` firmado, actualizador opt-in, manual de inicio | **MVP terminado** → beta con pymes reales |
| **16** | Inteligencia comercial (V1.1) | Promociones, planificación de compras, proveedores, segmentos, matriz, Centro de oportunidades | Casos golden de §19 aprobados; cada hallazgo muestra su cálculo |
| **17** | Fidelidad (V1.2) | Puntos, niveles, beneficios | Libro de puntos cuadra con ventas y anulaciones |

**Nota de método.** Las fases 4 a 12 se construyen como *rebanadas verticales* (de la base a la pantalla, con pruebas) y no como capas horizontales. Testing y seguridad no esperan a las fases 13-14: cada módulo nace con sus pruebas y sus permisos; esas fases son de **auditoría final**.

---

## 18. Criterios objetivos de MVP terminado

El MVP se considera terminado **solo si se cumplen todos**:

**Funcionales**
1. Los 20 módulos del §15 cumplen su alcance "V1 (dentro)", cada uno con validaciones, mensajes de error en lenguaje claro, auditoría y permisos.
2. Un usuario sin conocimientos contables completa, sin ayuda, en una prueba observada: crear empresa → cargar 10 productos → vender a crédito → cobrar → comprar → ver IVA estimado y flujo de caja. Meta: ≥ 4 de 5 participantes.
3. Ciclos completos sin re-digitar: cotización→pago y solicitud→pago, con cadena documental visible.
4. Todo documento confirmado genera asiento cuadrado (debe = haber) verificado por prueba automática sobre la base sembrada.
5. Importación de datos: migración de 10.000 clientes y 10.000 productos desde Excel con detección de duplicados.

**Calidad de cálculo**
6. 100 % de casos golden aprobados en IVA, descuentos, márgenes, costo promedio ponderado (incluye retroactivos), importaciones, exportaciones, monedas y flujo de caja; los casos golden tributarios y COMEX **revisados y firmados por un contador**.
7. Cobertura de pruebas ≥ 90 % en `nucleo-domain` y `nucleo-rules`; ≥ 75 % en `nucleo-app`.
8. Ningún valor normativo en el código fuente (verificación automática en CI); todo cálculo tributario persistido referencia su `rule_set_id`.

**Rendimiento** (equipo de referencia: Windows 10 x64, CPU de gama media de 4 núcleos, 8 GB RAM, SSD)
9. Con 100.000 clientes, 100.000 productos y 1.000.000 de movimientos: inicio en frío ≤ 3 s; búsqueda global ≤ 300 ms (p95); apertura de cualquier lista ≤ 500 ms; desplazamiento de listas sin saltos perceptibles; dashboard ≤ 1 s.
10. Consumo de RAM en uso normal ≤ 400 MB.
10b. Dashboard del dueño ≤ 1 s y análisis de un producto ≤ 500 ms con el volumen de referencia.
10c. Los ejemplos numéricos de `02_INTELIGENCIA_COMERCIAL.md` (stock futuro 120 y 518, disponible real 18, cobertura 30 días, riesgo de quiebre 25 días, cliente en riesgo 72 vs. 25 días) son casos golden automatizados y pasan.

**Local-first, privacidad y seguridad**
11. Todas las funciones del MVP operan con la red deshabilitada; monitoreo durante la suite E2E registra **cero conexiones salientes**.
12. NÚCLEO no es un sistema tributario: ninguna conexión con plataformas fiscales, credencial tributaria, emisión, firma, folio tributario ni intercambio de archivos tributarios (revisión de código + prueba).
12b. Todo documento de tipo venta, factura interna, proforma o comprobante impreso/PDF muestra "DOCUMENTO INTERNO — NO TRIBUTARIO" (prueba automática sobre cada plantilla).
12c. La aplicación funciona completa sin registro, activación ni licencia; el botón de donación solo abre el navegador y no envía ningún dato.
13. Base, adjuntos y respaldos cifrados; ninguna clave en texto plano (inspección de disco, registro de Windows y logs).
14. Permisos verificados en backend: pruebas automáticas que intentan cada operación con cada rol.
15. Verificación de la cadena de auditoría detecta una modificación manual de la base.

**Continuidad**
16. Respaldo → restauración en otro PC limpio reproduce la empresa idéntica (conteos y checksums).
17. Prueba de corte: matar el proceso 100 veces durante escrituras → 0 bases corruptas.
18. Migración desde cada versión beta publicada (fixtures) sin pérdida de datos.

**Entrega**
19. `NucleoERPSetup.exe` firmado instala en Windows 10 y 11 x64 limpios sin permisos de administrador, sin terminal y sin instalar nada adicional manualmente.
20. Archivos de control (`README` … `TESTING`) al día y `CHANGELOG` con la versión 1.0.0.

---

## 19. Inteligencia comercial — diseño técnico

Especificación funcional: `02_INTELIGENCIA_COMERCIAL.md` (37 puntos). Esta sección define **cómo** se calcula cada cosa, qué datos exige y en qué versión entra.

### 19.1 Principio rector: qué pasa → por qué → qué revisar

Toda la inteligencia de NÚCLEO es **determinista y explicable**: fórmulas simples, parámetros visibles y configurables, sin "cajas negras". Un único **motor de hallazgos** (*insights*) genera las alertas, la sección "Atención" del dashboard del dueño y el Centro de oportunidades. Cada hallazgo guarda:

| Campo | Ejemplo |
|---|---|
| Qué pasa | "Cafetera X podría quedarse sin stock" |
| Por qué | Disponible real 18 u · velocidad 1,0 u/día · próximo arribo en 43 días |
| Qué revisar | Enlace a "¿Qué debo comprar?" y a la importación IMP-000012 |
| Cálculo | Fórmula con los números reales y los parámetros usados |
| Período y datos | Ventana de 60 días, 41 ventas consideradas |
| Estado | Nuevo · visto · descartado (con "no volver a mostrar por 30 días") |

**Regla:** si no hay datos suficientes (por ejemplo, un producto con 2 ventas), NÚCLEO dice "datos insuficientes" en vez de inventar una recomendación.

### 19.2 Datos que se capturan desde el MVP (aunque la pantalla llegue después)

La analítica no se puede reconstruir si el dato no se guardó en el momento. Por eso el MVP registra desde el primer día:

- **Por línea de venta:** precio de lista, precio final, **descuentos desglosados por origen** (promoción, cupón, nivel de cliente, manual), costo unitario al momento, margen, cliente (o "cliente ocasional"), vendedor, sucursal y **fecha con hora** (necesaria para promociones por horario).
- **Por línea de compra o importación:** fecha de orden, fechas estimadas, fecha real de recepción, cantidad pedida vs. recibida vs. rechazada (para medir plazo, cumplimiento y calidad del proveedor).
- **Foto diaria de stock** por producto y bodega (`stock_daily_snapshot`), para saber cuántos días hubo stock y graficar su evolución.
- **Historial de cambios de ETA** de cada importación, con motivo.

### 19.3 Capa analítica y rendimiento

Los cálculos no recorren el millón de movimientos cada vez. NÚCLEO mantiene **tablas resumen** que se actualizan en la misma transacción de cada venta o compra:

- `fact_sales_daily` — producto × día × sucursal: unidades, ingresos, descuentos, costo, utilidad, número de ventas.
- `fact_customer_monthly` — cliente × mes: compras, monto, margen, puntos.
- `stock_daily_snapshot` — stock por producto/bodega/día.
- `insights` — hallazgos vigentes.

Se pueden reconstruir desde cero con "Recalcular indicadores" (por ejemplo, después de importar datos históricos). Meta: Dashboard del dueño ≤ 1 s y cualquier análisis de producto ≤ 500 ms con el volumen de referencia.

### 19.4 Inventario real: definiciones y fórmulas

Cada unidad está en **un solo** estado a la vez (sin dobles conteos):

| Estado | Definición en NÚCLEO |
|---|---|
| **Disponible** (físico) | Suma de movimientos confirmados en bodega |
| **Reservado** | Unidades de notas de venta / pedidos aceptados aún no despachados |
| **Disponible real** | Disponible − Reservado |
| **En compra** | Cantidad pendiente de órdenes de compra nacionales abiertas |
| **En importación** | Cantidad pendiente de importaciones en etapas ORDENADA a TRANSPORTE LOCAL |
| **En tránsito** | Subconjunto de "en importación" (etapas EMBARCADA y EN TRÁNSITO) o compra nacional marcada como "despachada por el proveedor" |
| **En recepción** | Recibido físicamente, pendiente de confirmar ingreso (no se puede vender) |

**Stock futuro a la fecha H** = Disponible real + En recepción + Σ compras e importaciones con ETA ≤ H − ventas proyectadas hasta H.

Se muestran dos versiones: **con** ventas proyectadas (realista) y **sin** ellas (lo que llega). Verificación con los ejemplos de la especificación (que serán casos de prueba):

- Producto A: 20 disponible + 100 en compra → **stock futuro 120** ✓
- Cafetera X: 23 disponible − 5 reservado = **18 disponible real**; + 500 en importación → **stock futuro 518** ✓

**Valorizado:** cada estado × costo promedio (importaciones: costo landed estimado). **Capital inmovilizado** = valor del stock disponible, separado en *activo*, *lento* y *sin movimiento* según los días sin venta (umbrales configurables, por defecto ≤ 30 / 31–90 / > 90 días).

### 19.5 Velocidad de venta, cobertura y riesgo de quiebre

- **Velocidad diaria** = unidades vendidas en la ventana ÷ **días con stock** en la ventana (ventana configurable: 30, 60 o 90 días). Se excluyen los días sin stock para no subestimar la demanda. Se muestra también por semana y por mes.
- **Cobertura (días)** = Disponible real ÷ velocidad diaria. Ejemplo: 150 u ÷ 5 u/día = **30 días** ✓.
- **Fecha estimada de quiebre** = hoy + cobertura.
- **Próximo arribo** = ETA más cercana entre compras e importaciones abiertas del producto.
- **Riesgo de quiebre** = Próximo arribo − Cobertura, si es positivo. Ejemplo: 43 − 18 = **25 días**. En pantalla: *"⚠ RIESGO DE QUIEBRE DE STOCK: 25 días sin stock (se agota en ~18 días; la próxima importación llega en ~43)"*. El texto "días sin stock" evita que se lea como "quedan 25 días".

### 19.6 Punto de reorden y "¿Qué debo comprar?"

| Concepto | Fórmula (parámetros configurables por producto o proveedor) |
|---|---|
| Plazo de reposición (L) | Plazo real promedio del proveedor (orden → recepción) o el declarado si no hay historial; en importaciones, suma de etapas estimadas |
| Stock de seguridad (SS) | Velocidad diaria × días de seguridad |
| Punto de reorden (ROP) | Velocidad diaria × L + SS |
| Posición de inventario | Disponible real + En recepción + En compra + En importación |
| **Comprar** si | Posición ≤ ROP |
| Cantidad sugerida | Velocidad × (L + días de cobertura objetivo) + SS − Posición, redondeada al mínimo o múltiplo de compra del proveedor |
| **Exceso de inventario** si | Cobertura > umbral (por defecto 180 días) |

Resultado por producto: **Comprar N**, **No comprar**, **Exceso de inventario** o **Datos insuficientes**, siempre con el desarrollo numérico visible ("¿Cómo se calculó?") y un botón para crear la orden de compra con esa cantidad editable.

### 19.7 Productos: matriz, estrellas, crecimiento y detenidos

- **Matriz** (por período elegido): eje X = utilidad $ (o ventas, a elección), eje Y = margen %. Cortes = **mediana** del catálogo con ventas en el período (o valores fijos configurables). Clases: **Estrella** (alto/alto), **Volumen** (alta venta, bajo margen), **Joya** (baja venta, alto margen), **Problema** (bajo/bajo). Productos con menos de N días de vida se marcan "nuevo" y no se clasifican.
- **Puntaje estrella** = promedio ponderado de los percentiles de ventas, utilidad, margen, frecuencia (número de ventas), rotación y estabilidad (variación mensual baja). Pesos visibles y editables. Los primeros N reciben ⭐.
- **Crecimiento / caída**: período actual vs. período anterior de igual duración y vs. el mismo período del año anterior (si hay historia).
- **Sin movimiento**: tramos 30 / 60 / 90 / 180 / 365 días desde la última venta, con **valor detenido** = stock × costo promedio. Acciones sugeridas por regla (ej. Joya detenida → promoción o combo; Problema detenido → liquidación y reducir compras), siempre como sugerencias para revisar.
- **Rentabilidad por producto**: los rankings por defecto ordenan por **utilidad $**, no por ventas, para destacar casos como "B gana más que A aunque venda menos".
- **Evolución de 12 meses**: ventas, unidades, precio promedio, costo promedio, margen y stock (desde la foto diaria), con comparación de períodos.

### 19.8 Clientes: ficha inteligente, riesgo de pérdida y segmentos

- **Ficha**: total comprado, número de compras, última compra, compra promedio, productos y categorías favoritas, margen generado, puntos, nivel, deuda y frecuencia.
- **Frecuencia** = promedio de días entre compras (se exige un mínimo de 3 compras).
- **Riesgo de pérdida**: días desde la última compra > factor × intervalo habitual (factor configurable, por defecto 2). Ejemplo: 72 días > 2 × 25 → **CLIENTE EN RIESGO DE PÉRDIDA** ("lleva 2,9 veces su intervalo habitual sin comprar").
- **Clasificación automática** por recencia, frecuencia y monto: mejores, frecuentes, alto valor, nuevos (primera compra reciente), inactivos (más de N días sin comprar). Rentabilidad por cliente: ventas, descuentos, costos, utilidad y margen.
- **Segmentos**: *dinámicos* (una regla guardada que se recalcula, por ejemplo "compras > $1.000.000 y margen < 15 %") o *manuales* (lista fija). Se usan en promociones, descuentos, campañas y análisis.
- Las ventas a "cliente ocasional" cuentan para productos, pero no para la analítica de clientes.

### 19.9 Motor de promociones

Una promoción = **condiciones** + **beneficio** + **reglas de uso**:

- **Condiciones**: productos, categorías o combos; cliente, segmento o nivel; rango de fechas; días de la semana; horario; cupón; cantidad mínima.
- **Beneficios**: porcentaje, precio fijo, N×M (2x1, 3x2), precio por tramos de cantidad, producto regalo, precio de combo.
- **Reglas de uso**: prioridad, acumulable o no, tope de usos total y por cliente, vigencia del cupón.

Funcionamiento:

- Se evalúa en Rust al calcular la venta, de forma determinista. **El precio de lista nunca se modifica**: la promoción se guarda como un descuento con origen en cada línea ("2x1 Verano: −$12.990").
- El producto regalo entra como línea a precio $0 **con su costo real**, para que el margen y el stock sean correctos.
- **Guardia de margen**: aviso (o bloqueo, configurable) cuando una promoción deja una línea con margen negativo.
- Combinación de promociones: ver D-11.

### 19.10 Analítica de promociones: ¿realmente aumentó mis ganancias?

- Métricas: ventas generadas, unidades, ingresos, descuento entregado, utilidad, margen, clientes nuevos y recurrentes.
- **Comparación contra un período base**: los mismos productos durante un período de igual duración inmediatamente anterior (o el mismo período del año anterior, si existe). Se calcula la diferencia de unidades, ingresos y **utilidad**.
- Veredicto en lenguaje simple con números: *"La promoción 2x1 aumentó las ventas un 32 %, pero la utilidad bajó $120.000 frente al período normal."*
- Aviso honesto: la comparación muestra lo que cambió, no prueba la causa (puede haber estacionalidad).

### 19.11 NÚCLEO Fidelidad

- **Libro de puntos inmutable** (`points_ledger`): ganar, canjear, vencer, ajustar y revertir (cuando se anula una venta). El saldo es la suma de movimientos.
- Reglas configurables: monto por punto, valor del punto, productos excluidos, multiplicadores por promoción y vencimiento (los puntos más antiguos vencen primero).
- **Canje** como descuento en la venta, con su valor registrado (afecta el margen de forma transparente).
- **Niveles** (Bronce, Plata, Oro, VIP o los que el negocio defina) según compras acumuladas en una ventana móvil (por defecto 12 meses) o históricas; recálculo diario e historial de cambios de nivel.
- **Beneficios por nivel** = promociones con la condición "nivel" (reutiliza el motor de 19.9).
- Cumpleaños: dato opcional del cliente, solo si lo entrega.
- En vista Contador, los puntos vigentes valorizados se pueden ver como obligación informativa.

### 19.12 Proveedores

| Indicador | Cálculo |
|---|---|
| Tiempo de entrega real | Recepción − fecha de orden (promedio y variación) |
| Cumplimiento | % de órdenes recibidas a tiempo y completas |
| Calidad | % de unidades rechazadas o devueltas (registradas en la recepción) |
| Frecuencia | Compras por período |
| Variación de precio | Cambio % del costo unitario en 3, 6 y 12 meses ("aumentó 18 % en 6 meses") |

**Comparador**: para cada opción (proveedor nacional o importación con costo landed estimado) muestra costo unitario, plazo, cantidad necesaria para cubrir el plazo, **capital inmovilizado** (unidades × costo) y **riesgo de quiebre** (si el plazo supera la cobertura actual).

### 19.13 Importaciones: etapas, ETA y timeline

| Etapa | Estado de stock |
|---|---|
| COTIZACIÓN | No cuenta |
| ORDENADA · PAGADA · PRODUCCIÓN · LISTA PARA DESPACHO | En importación |
| EMBARCADA · EN TRÁNSITO | En importación → **en tránsito** |
| ARRIBADA · EN PROCESO DE INTERNACIÓN · TRANSPORTE LOCAL | En importación (en destino) |
| RECIBIDA | En recepción → disponible al confirmar |
| CERRADA | Costos finales; recálculo del costo landed y del costo promedio |

- Fechas: compra, producción estimada, embarque, ETA, llegada real y recepción; todas editables, con **historial de cambios de ETA** ("la ETA cambió 3 veces: +12 días").
- **Timeline visual**: COMPRA → PRODUCCIÓN → EMBARQUE → TRÁNSITO → ARRIBO → RECEPCIÓN → INVENTARIO, con la etapa actual y los días estimados restantes.

### 19.14 Dashboard del dueño y Centro de oportunidades

- **Dashboard del dueño** (pantalla de Inicio por defecto): bloques **HOY** (ventas $, utilidad estimada, caja, número de ventas, número de clientes), **ESTE MES** (ventas, compras, gastos, utilidad, margen) y **ATENCIÓN** (clientes que deben, productos por agotarse, importaciones en tránsito, alzas de precio de proveedores, productos detenidos). Cada cifra abre su detalle.
- **Centro de oportunidades**: los hallazgos del motor (19.1) ordenados por impacto estimado en $. Tipos iniciales: producto creciendo, producto de alto margen, riesgo de quiebre, producto detenido, cliente en riesgo, proveedor que bajó o subió precio, importación por llegar, resultado de una promoción.

### 19.15 Ventas proyectadas

Versión inicial: velocidad diaria × días del horizonte. Con al menos 12 meses de historia se podrá ajustar por estacionalidad (V2). Siempre rotuladas como **estimación**.

---

## 20. ADR propuestos (registro inicial de decisiones)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-001 | SQLite como base local (una por empresa) | **Aprobado** (2026-10-05) |
| ADR-002 | Tauri 2 + React/TypeScript como aplicación de escritorio | **Aprobado** (2026-10-05) |
| ADR-003 | NÚCLEO no es un sistema tributario: sin conexión con plataformas fiscales, credenciales, archivos, folios ni emisión. Numeración NÚCLEO propia + estado de documentación + referencia externa manual | **Aprobado** (2026-10-05) |
| ADR-015 | Estados de venta en tres ejes independientes (comercial, pago, documentación) | **Aprobado** (2026-10-05) |
| ADR-016 | Software gratuito sin sistema de licencias; donaciones voluntarias fuera del programa | **Aprobado** (2026-10-05) |
| ADR-017 | Inteligencia determinista y explicable: un motor de hallazgos con fórmulas visibles, sin modelos opacos | **Aprobado** (2026-10-05) |
| ADR-018 | Capa analítica con tablas resumen actualizadas en la misma transacción + foto diaria de stock | **Aprobado** (2026-10-05) |
| ADR-019 | Promociones como descuentos con origen por línea; el precio de lista nunca se modifica | **Aprobado** (2026-10-05) |
| ADR-004 | `rusqlite` + SQLCipher en lugar de SQLx | **Aprobado** (2026-10-05) |
| ADR-005 | Un archivo de base de datos por empresa + `app.db` de registro | **Aprobado** (2026-10-05) |
| ADR-006 | Dinero como enteros en unidad mínima + `rust_decimal`; prohibido `f64` | **Aprobado** (2026-10-05) |
| ADR-007 | Libro de movimientos de stock como fuente de verdad; costo promedio ponderado móvil | **Aprobado** (2026-10-05) |
| ADR-008 | Documentos inmutables tras confirmar; corrección por documentos de ajuste | **Aprobado** (2026-10-05) |
| ADR-009 | Normativa como datos versionados, con fuente y paquetes firmados | **Aprobado** (2026-10-05) |
| ADR-010 | Monolito modular hexagonal en 5 crates | **Aprobado** (2026-10-05) |
| ADR-011 | Cero telemetría; toda conexión saliente es opt-in explícito | **Aprobado** (2026-10-05) |
| ADR-012 | Auditoría con hash encadenado | **Aprobado** (2026-10-05) |
| ADR-013 | PK entera + `uid` UUIDv7 en entidades principales | **Aprobado** (2026-10-05) |
| ADR-014 | Asistente inteligente detrás de una interfaz de proveedor; IA externa solo con consentimiento por consulta | **Aprobado** (2026-10-05) |

---

## 21. Decisiones (todas aprobadas el 2026-10-05)

> El dueño del producto aprobó todas las decisiones según la recomendación indicada en cada fila. Notas: **D-07** — conseguir un contador colaborador es requisito antes de la Fase 9. **D-13** — código abierto, licencia **AGPL-3.0-or-later**.

| ID | Pregunta | Mi recomendación |
|---|---|---|
| **D-01** | ¿Incluir el **motor de asientos automáticos** en el MVP (aunque la UI contable completa llegue en V2)? | **Sí.** Agregarlo después obliga a reprocesar todo el historial y es la base para atraer contadores. |
| **D-02** | ¿Cifrado **activado por defecto** con clave de recuperación obligatoria, u opcional? | **Por defecto.** Es coherente con "Tu empresa. Tus datos." El costo es educar sobre la clave de recuperación. |
| **D-03** | ¿Aceptas que el MVP sea **un solo computador** (varios usuarios) y que el uso en red local llegue en V3? | **Sí.** Compartir SQLite por red corrompe datos; hacerlo bien requiere el Modo Servidor Local. |
| **D-04** | **Modelo comercial** | ✅ **Aprobado (2026-10-05): gratuito, completo y sin activación, con donaciones voluntarias.** |
| **D-05** | ¿Tablas de documentos **separadas** (cotizaciones, notas de venta, ventas… como pediste) o una tabla de documentos unificada por tipo? | **Separadas** por etapa del ciclo + `document_links` para trazabilidad: reglas más claras y constraints más estrictos. |
| **D-06** | ¿Incluir los **tres perfiles** (Emprendedor, Negocio, Empresa) en el MVP? | **Sí**: son configuración de menú sobre el mismo modelo de datos. Sucursales y proyectos quedan para V1.1. |
| **D-07** | ¿Cuentas con un **contador colaborador** para validar casos golden y la Fase 11? | Necesario antes de la Fase 9. Sin validación profesional, los criterios 6 y R-08 no se cumplen. |
| **D-08** | Nombre del ejecutable y de la extensión de respaldo | `NucleoERPSetup.exe` y `.erpbackup` (como pediste). |
| **D-09** | Título de la factura interna impresa | ✅ **Aprobado: FACTURA INTERNA**, numeración FV-000001 y leyenda fija **DOCUMENTO INTERNO — NO TRIBUTARIO**. |
| **D-10** | ¿Se mantiene el **IVA estimado** como cifra informativa (útil para saber cuánto dinero reservar), y se elimina definitivamente la "Renta guiada"? | **Sí a ambas.** El IVA estimado ayuda a planificar la caja sin declarar nada; se puede desactivar. La renta guiada se acerca demasiado a "declarar" y la saqué del roadmap. |
| **D-11** | ¿Cómo se **combinan las promociones** cuando una venta califica para varias? | **No acumulables por defecto**: se aplica la de mayor beneficio para el cliente. Cada promoción puede marcarse "acumulable". El descuento por nivel de fidelidad se configura aparte. Guardia de margen activa. |
| **D-12** | ¿Apruebas el **reparto por versiones** de la inteligencia comercial? | **MVP:** captura de datos, stock real y futuro, velocidad, cobertura, riesgo de quiebre, sin movimiento, capital inmovilizado, dashboard del dueño, ficha del cliente, etapas/ETA/timeline de importación. **V1.1:** promociones, "¿Qué debo comprar?", proveedores, segmentos, matriz, Centro de oportunidades. **V1.2:** Fidelidad. Así el MVP no crece tanto, y cuando llegue V1.1 ya habrá meses de historia para analizar. |
| **D-13** | ¿El código será **abierto** (cualquiera puede verlo y revisarlo) o **cerrado** (programa gratuito, pero el código es solo tuyo)? | **Abierto:** cualquiera puede comprobar que NÚCLEO no envía datos, lo que da más confianza; puede recibir ayuda de otros desarrolladores; y garantiza que el programa sobrevive aunque el proyecto se detenga (encaja con "Tus datos. Tu computador."). Riesgo: otros pueden copiarlo, aunque con una licencia como AGPL cualquier copia también debe publicar su código. **Cerrado:** mantienes el control total de la marca y del código. Es una decisión tuya; me inclino por abierto. |
| **D-14** | ¿Recordatorio de donación? | Ninguna ventana al abrir. Solo un botón "Apoyar NÚCLEO" y, como máximo, un aviso amable una vez al año o al cumplir un hito, siempre fácil de cerrar. |

---

**Fin de la Fase 0.** Al aprobar este Blueprint (con las decisiones D-01 a D-14), la siguiente instrucción iniciará la **Fase 1 — Arquitectura**: creación del monorepo, los archivos de control, los ADR y los spikes técnicos, sin construir todavía módulos de negocio.
