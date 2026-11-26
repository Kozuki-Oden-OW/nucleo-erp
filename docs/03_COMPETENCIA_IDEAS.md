# Competencia: qué hacen Kame, relBase, Chipax y Facto, y qué ideas sirven a NÚCLEO

Revisión del 25-11-2026 sobre las páginas públicas de cada uno (inicio, precios, integraciones y los
módulos principales). No es exhaustiva: no se leyeron el punto de venta ni «Kame Taxes» de Kame, la
página de características de relBase, ni remuneraciones y API de Facto. Los precios son los publicados
ese día, en UF o pesos más IVA.

## Resumen de cada uno

| | Kame (Siigo) | relBase | Chipax | Facto |
|---|---|---|---|---|
| Qué es | ERP y contabilidad en la nube | Ventas con boleta y factura, 100 % web | Finanzas: se conecta al SII y a los bancos | Facturación y gestión comercial en línea |
| Dice tener | Más de 25.000 empresas | Más de 3.000 pymes | Más de 3.000 empresas | Más de 3.600 clientes |
| Precio de entrada | Gratis (1 usuario); pagados desde UF 1/mes | UF 1/mes (1.000 documentos, 10 usuarios) | Gratis (1 usuario); pagados desde UF 2/mes | Gratis hasta $5 millones emitidos al mes; pagados desde $290.000 al año |
| Cómo cobra | Por plan, usuarios y módulos | Por documentos, usuarios, sucursales y cada integración | Por usuarios y cuentas corrientes | Por monto emitido al mes; remuneraciones por trabajador |
| Lo más fuerte | Amplitud: remuneraciones, producción, licitaciones, factoring | Marketplaces y tiendas en línea; picking con lector | Conciliación con reglas e IA; conector para Claude, ChatGPT y Gemini | Cobranza automática con link de pago; contabilidad con reglas |
| Límite visible | Solo nube; una empresa por plan; módulos aparte | Conciliación de 50 movimientos al mes; integraciones pagadas aparte | Entra al banco y al SII con claves guardadas en su nube | Conciliación con dos bancos y cartola cargada a mano |

Ninguno de los cuatro ofrece modo local ni sin conexión, y ninguno muestra integración con WhatsApp
ni con couriers.

## Ideas que sirven a NÚCLEO

Ordenadas por lo que aportan al objetivo «NÚCLEO + Claude manejan el negocio».

**Estado al 26-11-2026:** las ideas 1 a 6 están construidas (cobranza automática, reglas de
conciliación que aprenden, cobros recurrentes, inicio con los registros del SII, números de serie con
certificado e informe por correo con meta de ventas). Ver `docs/CHANGELOG.md` y las decisiones
D-AUTO-01 a D-AUTO-04, D-BANK-RULES, D-SERIE-01 y D-SII-INICIO. De la idea 7 quedó hecha la parte de
la ronda (quién debe más y desde cuándo); faltan los días promedio de pago por cliente.

| # | Idea | De quién | Qué tiene NÚCLEO hoy | Qué faltaría |
|---|---|---|---|---|
| 1 | **Cobranza automática**: avisos de vencimiento programados (días y hora), primero lo más vencido, con los datos de transferencia y un link de pago | Chipax, Facto | Borrador de correo de cobro; envío por correo con permiso (D-AGENT-07) | Programar la ronda y que el agente la ejecute; adjuntar datos de transferencia y link |
| 2 | **Reglas de conciliación y clasificación** del tipo «cuando la glosa coincida con… haz…», que aprenden de lo ya conciliado | Chipax, Facto | Conciliación con sugerencias por monto y fecha | Reglas del usuario y memoria de decisiones anteriores |
| 3 | **Facturación y cobro recurrente**: un documento programado que se emite solo y llega por correo | relBase, Facto | Gastos recurrentes | Ventas y cotizaciones recurrentes (sirve al monitoreo por suscripción) |
| 4 | **Partir con los datos reales del SII**: la prueba ya muestra las ventas y compras de la empresa | Kame, Chipax, relBase | Importa el registro de compras y ventas y ventas históricas | Un asistente de inicio «trae tus datos del SII» en minutos, sin entregar claves |
| 5 | **Números de serie, lotes y packs** por producto | relBase, Facto | No | Serie por unidad vendida; para Data Logger, unir serie con certificado de calibración |
| 6 | **Informe periódico por correo** con la frecuencia elegida, y una IA que explica el balance | Kame | Tablero y alertas dentro del programa | Informe diario o semanal al dueño (ya pedido) |
| 7 | **Tablero de cobranza**: promedio de días que tarda cada cliente en pagar y los cinco mayores deudores | Chipax | «Te deben» y proyección de caja | Esos dos indicadores |
| 8 | **Presupuesto contra real** por línea de negocio o centro de costo | Chipax, Kame | Presupuesto mensual por categoría de gasto | Líneas de negocio y comparación mensual |
| 9 | **Picking con lector**: validar SKU a SKU antes de despachar | relBase | «Productos por despachar» | Validación con lector de código de barras |
| 10 | **Link de pago por el monto del documento**, que al pagarse marca la factura como pagada | Kame, Facto | Botón de Webpay con el enlace fijo del comercio | Integrar un medio de pago que avise el pago (requiere servidor) |
| 11 | **Licitaciones de Mercado Público** como módulo | Kame | Agente aparte, fuera de NÚCLEO | Traer oportunidades y postulaciones a NÚCLEO |
| 12 | **Más canales**: Falabella, Ripley, Paris, Walmart, Shopify, Jumpseller, Tiendanube | relBase, Kame, Facto | Mercado Libre y WooCommerce | Según demanda |
| 13 | **Orden de compra con aprobación** y rendición de gastos | Facto, Chipax, Kame | Órdenes de compra sin aprobación | Flujo de aprobación; rendiciones |

## Lo que confirma el rumbo de NÚCLEO

- **La IA que ejecuta ya es producto en la competencia.** Chipax ofrece un conector para Claude,
  ChatGPT y Gemini que no solo consulta: también «actualiza el SII» y «concilia los movimientos
  pendientes», y lo cobra como complemento («Piloto automático», UF 0,5 al mes). NÚCLEO ya tiene 56
  herramientas para Claude, y corren en el computador del dueño.
- **La privacidad es una diferencia real.** Los cuatro son solo nube. Chipax declara que entra al banco
  y al SII con claves que guarda cifradas. NÚCLEO no pide esas claves ni saca los datos del computador.
- **El cobro por usuario, documento o integración es la norma.** relBase cobra aparte cada marketplace
  y cada tienda; Kame, los módulos; Chipax, cada cuenta corriente. NÚCLEO puede competir con «todo
  incluido, sin límite de usuarios ni de documentos».
- **Todos tienen plan gratuito o prueba sin tarjeta.** Es lo esperado para entrar.
- **WhatsApp y couriers no los tiene ninguno** en lo que publican: el puente de WhatsApp y los envíos
  con Bluexpress son ventaja de NÚCLEO.

## Ideas de entrada y soporte

- Inicio en cuatro pasos con resultado inmediato (Chipax: crear cuenta, conectar, ver números,
  ejecutivo asignado; Facto: crear cuenta, activar emisión, organizar, vender).
- Migración sin costo: carga del historial desde el SII (relBase ofrece hasta 3.000 XML).
- Academia con videos y centro de ayuda (relBase); capacitación por horas según el plan (Kame).
- Tiempo de respuesta del soporte como promesa («~5 minutos», Kame).

## Fuentes

- Kame: https://www.kame.cl/ · https://www.kame.cl/planes-precios-siigo-chile · https://www.kame.cl/erp-siigo-chile/ · https://www.kame.cl/sistema-de-facturacion-electronica/ · https://www.kame.cl/software-de-inventario/ · https://www.kame.cl/software-de-remuneraciones/
- relBase: https://www.relbase.cl/ · https://www.relbase.cl/precios · https://www.relbase.cl/recursos/integraciones · https://www.relbase.cl/faqs · https://www.relbase.cl/recursos/api-relbase
- Chipax: https://www.chipax.com/ · https://www.chipax.com/precios · https://www.chipax.com/integraciones · https://www.chipax.com/gratis · https://www.chipax.com/funcionalidades/conecta-tu-ia
- Facto: https://www.facto.cl/ · https://facto.cl/precios/ · https://facto.cl/facturacion/ · https://facto.cl/inventario/ · https://facto.cl/contabilidad/ · https://facto.cl/complementos/integracion-facto-e-commerce/
