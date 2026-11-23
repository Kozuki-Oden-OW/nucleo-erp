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

## Qué informar

1. **Por despachar hoy**, con la hora límite y si la etiqueta ya está impresa.
2. **Con factura subida:** folio, cliente, RUT, producto y total (se cruza con la factura en NÚCLEO).
3. **Empresas sin factura subida** (traen razón social y giro): candidatas a facturar.
4. **Personas con «Adjuntar factura» sin archivo** y ventas con boleta.
5. Reclamos, reembolsos (monto anulado) y mensajes sin leer.
6. Cruce con NÚCLEO: qué ventas ya están (por la referencia ML o el folio de la factura) y cuáles faltan.

## Límites

- Sesión de **colaborador de solo lectura**. No se responde mensajes, no se imprime ni se cambia nada, no se
  adjuntan facturas ni se aceptan cookies opcionales sin que el dueño lo pida.
- La clave del colaborador no la escribe el asistente: la sesión la inicia la persona o NÚCLEO con su
  autorización (Configuración → Integraciones → Accesos).
