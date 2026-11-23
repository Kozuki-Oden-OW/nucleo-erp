# Receta: revisar las ventas de Mercado Libre (portal de vendedores)

> Estado: recorrida a mano con la sesión del colaborador de solo lectura el 23-11-2026 (Data Logger).
> Es la base de la receta del robot / extensión de Chrome (docs/INTEGRACIONES.md I7, docs/AGENTE_CLAUDE.md §7).

**Regla del dueño:** el listado no basta. Hay que abrir el **detalle de cada venta**: ahí están los datos
del cliente, si pide factura y la factura que ya se subió al portal.

## Dónde

| Qué | Dirección |
|---|---|
| Listado (últimos 2 meses, sin el filtro «Envíos de hoy») | `https://vendedores.mercadolibre.cl/ventas/omni/listado?filters=&subFilters=&search=&limit=50&offset=0&startPeriod=WITH_DATE_CLOSED_2M_OLD` |
| Detalle de una venta | `https://www.mercadolibre.cl/ventas/<n.º de venta>/detalle` |

El listado parte filtrado en «Envíos de hoy»: sin quitar ese filtro solo se ven las ventas por despachar.
Algunas filas del listado dicen «No pudimos mostrar la información de esta venta»; el detalle sí la trae.

## Qué leer en el detalle

| Sección | Dato | Para qué |
|---|---|---|
| Encabezado | N.º de venta, n.º de envío, fecha y hora, reputación | Identificar la venta (referencia «ML» en NÚCLEO) |
| Comprador | Nombre, apodo, RUT, «Negocio» si es empresa, mensajes nuevos | Cliente; avisar si hay mensajes sin leer |
| Estado | Por despachar (con hora límite), en camino, entregado y fecha; reclamo o mediación y cómo terminó | Qué despachar hoy; qué ventas tienen reembolso |
| Productos | Título, SKU, precio, unidades (una venta puede traer varios paquetes o productos) | Líneas de la venta; el SKU calza con el producto de NÚCLEO |
| Datos del envío | Tipo de envío, dirección, referencia, comuna, región, código de seguimiento | Envío en NÚCLEO |
| Datos para su recibo de cobro | Persona: nombre completo, RUT, dirección. Empresa: **razón social, RUT, dirección y giro comercial** | Receptor de la factura |
| Facturas | Archivo subido y fecha (p. ej. `514-dl.pdf` = factura N° 514), o «Adjuntar factura» si no hay ninguna. Si la sección no aparece, la venta va con boleta | Saber si ya se facturó y con qué folio |
| Cobro | N.º de cobro, precio, cargos por venta, envíos, anulaciones, total; si el dinero ya está disponible | Cuadrar el depósito de Mercado Pago |

El RUT viene sin puntos ni guion (`782864335` = 78.286.433-5).

## Mensajes de la venta

`https://vendedores.mercadolibre.cl/ventas/nueva/mensajeria/<n.º de venta>` (o «Ver mensajes» en el detalle).
Se leen **todos** los de las ventas con mensajes, no solo los nuevos: ahí el comprador pide boleta o
factura, entrega otros datos de facturación (otra razón social o RUT que los del portal) o reclama.

- Abrir la conversación la marca como leída. Después de leer se presiona **«Marcar como no leído»** para
  que el dueño conserve el aviso.
- No se responde ni se adjunta nada sin que el dueño lo pida.
- Lo aprendido el 23-11-2026: las facturas que se suben tarde terminan en reclamo y «reputación afectada»
  (dos casos). Conviene facturar y adjuntar el mismo día de la venta.

## Lo que deja cada venta

Con los montos de la sección «Cobro» (pesos con IVA):

```
recibido en Mercado Pago = precio − cargos por venta − envíos − anulaciones
IVA de la venta          = precio × tasa ÷ (1 + tasa)        (tasa de IVA de la empresa en NÚCLEO)
queda antes del costo    = recibido − IVA de la venta
ganancia                 = queda antes del costo − costo de los productos (costo en NÚCLEO)
```

- Los cargos y envíos que cobra Mercado Libre traen su propia factura: su IVA es crédito fiscal y baja el
  IVA a pagar. Se confirma en «Facturación» del portal antes de contarlo.
- El envío se cobra **por unidad** en los productos bajo cierto precio (40 unidades = 40 envíos): en
  ventas de muchas unidades es el cargo que más pesa. Revisarlo siempre.
- Una venta con reembolso parcial trae «Anulaciones»: se informa aparte.

## Qué informar

1. **Por despachar hoy**, con la hora límite y si la etiqueta ya está impresa.
2. **Con factura subida:** folio, cliente, RUT, producto y total (se cruza con la factura en NÚCLEO).
3. **Empresas sin factura subida** (traen razón social y giro): candidatas a facturar.
4. **Personas con «Adjuntar factura» sin archivo** y ventas con boleta.
5. Reclamos, reembolsos (monto anulado) y **qué pide cada comprador en los mensajes** (factura o boleta
   pendiente, datos de facturación distintos a los del portal).
6. Lo que deja cada venta y el total del período: precio, comisión, envío, recibido, IVA y lo que queda;
   con el costo de NÚCLEO, la ganancia.
7. Cruce con NÚCLEO: qué ventas ya están (por la referencia ML o el folio de la factura) y cuáles faltan.

## Registrar en NÚCLEO

Con la herramienta `registrar_ventas_mercadolibre` (una llamada con todas las ventas leídas):

| Venta | Cómo se registra |
|---|---|
| Con factura subida (`514-dl.pdf`) | `factura: "514"`: se enlaza a la venta FE-514 que ya está en NÚCLEO. No crea otra venta |
| Por despachar o despachada después del último conteo de stock, sin factura | `descontar_stock: true`: venta al contado que descuenta stock; con razón social queda «por facturar» |
| Antigua, sin factura | Sin `factura` ni `descontar_stock`: queda «por revisar» (falta su boleta o factura) |

Decisiones del dueño (Data Logger, 23-11-2026): se descuenta stock **solo de lo despachado desde el
23-11-2026** (el stock de NÚCLEO ya refleja lo anterior) y el «RC-5+» de Mercado Libre (SKU
EFI255100000, con o sin sonda) es el producto **P-00004** de NÚCLEO. Los demás: Tlog-10E = P-00001,
RC-51H = P-00011, GSP-6 Pro = P-00003, RCW-800 THE = P-00007.

## Límites

- Sesión de **colaborador de solo lectura**. No se responde mensajes, no se imprime ni se cambia nada (salvo
  volver a marcar como no leído lo que se abrió), no se adjuntan facturas ni se aceptan cookies opcionales sin que el dueño lo pida.
- La clave del colaborador no la escribe el asistente: la sesión la inicia la persona o NÚCLEO con su
  autorización (Configuración → Integraciones → Accesos).
