# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [0.7.0] — 2026-10-17

- **Inicio renovado:**
  - Bloques «Hoy» (ventas, utilidad, clientes y disponible) y «Este mes» (ventas comparadas con el mes anterior a la misma fecha, compras, gastos, utilidad, margen, lo que te deben, lo que debes e IVA estimado).
  - Gráfico de 12 meses de ventas o de margen.
- **Requiere tu atención (alertas):**
  - 13 avisos: caja proyectada negativa, clientes atrasados, pagos atrasados y por vencer, productos agotados que se venden, por agotarse, con margen bajo o pérdida, detenidos, proveedores que subieron precios, clientes que dejaron de comprar, importaciones en camino, gastos sobre el presupuesto y ventas por documentar.
  - Cada aviso explica por qué aparece, muestra ejemplos y lleva al detalle.
  - Se configuran en Configuración → Alertas: cuáles ver y sus umbrales. La campana muestra los mismos avisos.
- **Análisis de productos y clientes** (Análisis y reportes → Productos / Clientes):
  - Productos: estrellas, que mueven volumen, oportunidades, por revisar, creciendo, cayendo, margen bajo, detenidos y sin ventas; clase ABC, margen, variación y evolución de 12 meses.
  - Clientes: activos, nuevos, en riesgo, perdidos, ocasionales y con deuda; clase ABC, cada cuánto compran, ticket promedio y explicación de su estado.
- **Contabilidad automática** (Impuestos y contabilidad → Contabilidad):
  - Los asientos se arman solos desde ventas, cobros, compras, pagos, gastos, inventario, importaciones, traspasos y remuneraciones.
  - Plan de cuentas editable con subcuentas, y cuenta asignada a cada movimiento.
  - Asientos manuales con reversa, y cierre y reapertura de meses.
  - Nuevos reportes: libro diario, libro mayor, balance de comprobación de 8 columnas, estado de resultados y balance general, exportables a Excel.
- **Conciliación bancaria** (Dinero → Conciliación bancaria):
  - Se sube la cartola del banco (CSV o Excel) y lo que ya está registrado se concilia solo.
  - Para el resto sugiere el cobro de una venta, el pago de una compra o gasto, un gasto nuevo con su categoría (COPEC → Combustible, ENTEL → Internet y telefonía…), un traspaso entre tus cuentas o ignorarlo con una nota.
  - Compara el saldo del banco con el de NÚCLEO y muestra lo registrado que no aparece en la cartola. Subir la misma cartola dos veces no duplica movimientos.

## [0.6.2] — 2026-10-15

- **Inventario · Agregar stock:**
  - Botón «Agregar stock» junto a «Realizar inventario» (y en la ficha de cada producto) para ingresar la mercadería que llegó.
  - Por producto: cantidad y costo unitario (neto, o con IVA y el sistema lo descuenta). Si dejas el costo vacío, entra al costo promedio actual.
  - Bodega, fecha de llegada y, si quieres, proveedor, documento de respaldo (factura, guía) y notas.
  - Muestra cuánto queda en bodega, en cuánto queda el costo promedio y el total que ingresa.
  - Queda como documento ING en el kárdex, en la pestaña «Movimientos» y en la auditoría. No crea deuda con el proveedor ni IVA crédito: para eso se registra una compra.

## [0.6.1] — 2026-10-13

- **Referencias de la venta:**
  - Nuevos tipos: Mercado Libre, pedido de internet, pedido por WhatsApp y pedido por redes sociales.
  - Puedes crear tipos propios («+ Nuevo tipo…» en la lista o el botón «Tipos»), por ejemplo Falabella, Ripley o feria, y archivarlos cuando ya no los uses.

## [0.6.0] — 2026-10-12

- **Gastos (nuevo módulo en el menú):**
  - Se anota cada gasto con cantidad × valor (ej. 40 litros de bencina a $1.289) y «Guardar y anotar otro».
  - Botones de «Anotar rápido»: bencina, transporte, comida, viajes, alojamiento, arriendo, estudios, publicidad, peajes y oficina.
  - Categorías nuevas agrupadas (vehículo y transporte, viajes y comidas, local y oficina, personas y estudios, ventas y publicidad, operación, servicios, impuestos y finanzas). Cada una puede tener presupuesto mensual, y el sistema avisa cuando se supera.
  - Resumen: lo gastado en el mes, los gastos promedio, la venta necesaria y lo que queda (o se pierde) al mes. Incluye un gráfico mes a mes y en qué se va el dinero.
  - Gastos fijos (recurrentes) en el mismo módulo.
  - «¿Cuánto necesito vender?» calcula:
    - el punto de equilibrio y la venta necesaria con una utilidad meta (al mes, por semana y por día de venta);
    - cuánto se cubre hoy;
    - una proyección a 12 meses con crecimiento;
    - el reparto de la utilidad entre reserva, reinversión, publicidad, inversiones y retiro;
    - los meses de colchón.

    Si recién empiezas, puedes simular con un margen estimado.
- **Análisis y reportes:** reporte nuevo «¿Cuánto necesito vender? (punto de equilibrio)» con la venta necesaria por mes, la media mensual y diaria, y el cumplimiento.
- **Productos en varias categorías:**
  - Un producto puede estar en varias categorías, por ejemplo «Ropa» y «One Piece».
  - La principal se usa en los reportes por categoría.
  - El filtro de productos y las promociones por categoría consideran todas sus categorías.
- **Inventario:** «Valor del inventario» pasa a llamarse «Total invertido» (stock × costo). Se agrega «Valor total neto» (stock × precio de venta sin IVA), que muestra lo que ganarías al venderlo todo.
- Los montos negativos se muestran como −$5.000.
- Dinero: los gastos se registran ahora desde el módulo Gastos.

## [0.5.1] — 2026-10-12

- **Precio de venta:** dos campos enlazados, «Precio de venta (Con IVA)» y «Precio neto (sin IVA)». Al escribir uno, el otro se calcula con la tasa de IVA del negocio (19 % sobre el neto). Ejemplo: $39.000 con IVA son $32.773 netos.
- **Dos márgenes:** la ficha, la lista de productos, la venta y los reportes muestran el **margen sobre la venta** ((neto − costo) ÷ neto) y la **ganancia sobre el costo** ((neto − costo) ÷ costo), ambos sin IVA. Ejemplo: neto $32.773 y costo $17.575 dan 46,37 % sobre la venta y 86,48 % sobre el costo.

## [0.5.0] — 2026-10-12

- **Descuentos y promociones (nuevo módulo):**
  - Tipos de promoción: pack a precio fijo o con %, descuento por cantidad con tramos (opcionalmente sumando productos), lleva X paga Y, descuento por cliente y para clientes preferenciales.
  - Cada promoción tiene vigencia por fechas y se puede pausar.
  - Al vender, «Aplicar promociones» las aplica como descuento por línea. Si varias tocan el mismo producto, se usa la de mayor ahorro.
  - Avisa si un pack o una línea queda bajo el costo.
- **Envíos (nuevo módulo):**
  - Datos del envío: agencia, número de orden de transporte o seguimiento, nombre, apellido, celular, dirección, comuna, fecha de envío y de recepción.
  - Estados con color: no despachado y no entregado (problemas) en rojo, en camino en amarillo, entregado en verde.
  - Se crean desde la venta, que guarda el historial.
- **Si no hay stock, por producto:**
  - Opciones: usar la regla del negocio, no vender sin stock, vender igual o tomar reservas.
  - Con reservas, la venta aparta lo que hay y deja pendiente lo que falta. Se ve en Inventario → «Por despachar» y en la venta, y el stock se descuenta al despachar.
- **Realizar inventario:**
  - Muestra de inmediato todos los productos de la bodega, con las columnas «Inventario» y «Stock actual».
  - Cada producto tiene su botón «Actualizar stock». También hay «Copiar stock actual» y, al final, «Actualizar inventario completo».
  - Se quitó la opción «Diferencia (+/−)».
- **Empresas:**
  - El selector muestra todas las empresas y permite agregar una nueva.
  - Cada empresa puede tener su color (Mi negocio → Color de la empresa).
  - Cualquier empresa se puede abrir en otra ventana; la ventana lleva el nombre de la empresa.
- **Clientes:** marca de «cliente preferencial».
- **Sitio web:** rediseño, una página por módulo (`/funciones/`), capturas reales de la 0.5.0 en tema claro y oscuro, JSON-LD, `llms.txt`, sitemap automático, IndexNow y verificación de Search Console lista.

## [0.4.0] — 2026-10-12

- **Crédito a clientes:** opción «Habilitar crédito» en la ficha con días, monto (cupo) y condiciones.
  Documentos de respaldo opcionales (situación tributaria en el SII, carpeta tributaria, certificado de
  vigencia, inscripción con anotaciones marginales, inscripción de poderes, informe comercial Dicom/Equifax
  y otros): estado, fechas, archivo adjunto cifrado, guía de dónde obtenerlo, cómo verificarlo y qué mirar,
  aviso de documentos antiguos y consejos. «Exportar carpeta del cliente» crea una carpeta con su nombre y
  RUT y los documentos ordenados.
- **Venta a crédito:** aviso (sin bloquear) si el cliente no tiene crédito habilitado, tiene saldos
  vencidos o la venta supera su cupo.
- **Productos:** lápiz al final de cada fila para editar; en la ficha, «Editar producto» destacado sobre
  «Ver kárdex».
- **Inventario:** el botón «Ajuste o conteo» ahora se llama «Realizar inventario».

## [0.3.0] — 2026-10-10

- **Análisis y reportes:** 13 reportes (ventas por período, cliente, producto y categoría; ¿gano o pierdo?;
  compras por proveedor; gastos por categoría; inventario valorizado y rotación; por cobrar y por pagar con
  antigüedad; flujo de caja; IVA estimado; importaciones) con indicadores, gráfico y exportación a Excel y CSV.
- **Productos:** categorías (seis iniciales, crear, renombrar, eliminar y agregar productos en lote, filtro
  en la lista); precio escrito neto o con IVA, columnas «Precio neto» y «Con IVA», margen sobre el neto;
  costo avanzado (compra en dólares u otra moneda, transporte, envío, mano de obra, otros y unidades del lote).
- **Clientes:** ficha completa y opcional (persona o empresa, nombre de fantasía, giro, dirección, comuna,
  ciudad, región, contacto, correo para facturas, días de crédito, cupo y notas).
- **Venta y factura interna:** forma de pago (efectivo, tarjeta de débito o crédito, transferencia con
  banco y fecha, crédito con días y vencimiento, cheque), referencias como en el facturador del SII (OC,
  HES, HEM, nota de pedido, nota de venta, guía de despacho, contrato, ChileCompra) y datos del receptor
  que se completan desde la ficha; todo aparece al imprimir y al marcar la venta como efectuada.

## [0.2.0] — 2026-10-10

Primera versión con impuestos y remuneraciones. Reúne las entradas «Sin publicar» de abajo desde la
0.1.0 (fase 9):

- **Impuestos:** borrador del F29 mensual y del F22 anual (Pro Pyme transparente).
- **Remuneraciones:** trabajadores, indicadores del mes, liquidaciones, sueldo empresarial, Previred,
  Libro de Remuneraciones Electrónico y finiquito.
- **COMEX:** seguro teórico, compras por courier o plataforma y caso real de DIN.
- Logo del negocio, firma opcional del instalador y acuerdo de contribución (CLA).
- Al instalar sobre la 0.1.0 los datos se conservan; la base se actualiza sola al abrir.

## [Sin publicar] — Fase 10: Previred, LRE, finiquito y F22

### Agregado
- Remuneraciones → «Previred y libro»: cuánto pagar en Previred a cada institución (AFP, salud,
  seguro de cesantía, Seguro Social, mutual) con la asignación familiar descontada y el vencimiento;
  archivo del Libro de Remuneraciones Electrónico para la DT (incluye el sueldo empresarial) con
  avisos de lo que falta; datos del empleador (caja, mutual, región y comuna).
- Liquidaciones con asignación familiar por tramo (cargas simples e invalidez, proporcional a los días)
  y APV régimen A o B (el B rebaja el impuesto hasta su tope).
- Calculadora de finiquito imprimible: feriado pendiente y proporcional en días corridos, aviso previo,
  años de servicio con topes, obra o faena y descuento del aporte al seguro de cesantía.
- Impuestos → «Renta anual (F22)» del régimen Pro Pyme general: recuadro 17 desde lo cobrado y lo
  pagado en el año (con explicación y ajuste por código), remuneraciones, PPM de los F29 declarados
  con su reajuste, incentivo al ahorro 14 E con comparación, impuesto, saldo a favor y recuadros 18 a
  20. El cálculo reproduce al peso la planilla oficial del SII.
- Diseño de la app móvil de pago único, sin conexión y sincronizada por cable o WiFi local
  (`docs/SINCRONIZACION.md`).
- Acuerdo de contribución (`CLA.md`) y guía para contribuir (`CONTRIBUTING.md`); titular del proyecto:
  FAVOR SpA.

## [Sin publicar] — Fase 10, hito B: sueldo empresarial y liquidaciones

### Agregado
- Remuneraciones (menú "Remuneraciones"): liquidación mensual del sueldo empresarial del dueño y de
  los trabajadores, con haberes, gratificación legal, horas extra, topes imponibles en UF, AFP,
  salud (Fonasa o Isapre con plan en UF o pesos), seguro de cesantía, impuesto único por tramos en
  UTM, descuentos, anticipo, líquido a pagar y aportes del empleador (SIS, cotización del empleador
  de la Ley 21.735, cesantía, accidentes del trabajo). Cada monto explica su cálculo.
- Indicadores del mes: UF, UTM, ingreso mínimo, topes, tasas de AFP, aportes del empleador y tabla
  del impuesto único, copiados de Previred y del SII con su fuente; cada mes parte con los del mes
  anterior y pide confirmarlos. Ningún valor normativo está escrito en el programa.
- Emitir congela la liquidación (indicadores, condiciones y resultado) con su fecha de pago; su
  impuesto único pasa solo al código 48 del F29 del mes de pago. Anular exige motivo y que ese F29
  no esté marcado como declarado.
- Liquidación imprimible con el logo y los datos del negocio y línea de firma.
- Casos golden compartidos Rust/TypeScript (`golden/remuneraciones.json`): guía MINEDUC (Patricio,
  topes de AFP y Fonasa) y casos 2026 ilustrativos, verificados con un modelo de referencia
  independiente.

## [Sin publicar] — Logo del negocio y firma del instalador

### Agregado
- Logo del negocio en Configuración → Mi negocio: se reduce solo, aparece en el menú y en las
  cotizaciones, comprobantes de venta y órdenes de compra impresas (y en las liquidaciones cuando
  existan). Se valida que sea una imagen PNG, JPG o WebP real de hasta 400 KB.
- Sitio: página "Política de firma de código" (`/firma/`) y ayuda en la descarga para cuando un
  antivirus bloquea el instalador; estado del proyecto actualizado.
- Publicación: firma opcional del instalador con SignPath (se activa con una variable y un secreto
  del repositorio) y verificación de la firma antes de publicar. Guía en `docs/FIRMA_CODIGO.md`.
- Instalador: sitio web y descripción en sus propiedades.

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
