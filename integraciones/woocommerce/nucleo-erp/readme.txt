=== NÚCLEO ERP para WooCommerce ===
Contributors: favorspa
Tags: erp, chile, inventario, facturacion, woocommerce
Requires at least: 6.2
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Conecta tu tienda con NÚCLEO ERP, el programa de gestión gratuito y local para pymes chilenas: pedidos, clientes, stock, precios y envíos.

== Description ==

**English summary:** connects a WooCommerce store to NÚCLEO ERP, a free, local-first business management app for Chilean small businesses. Paid orders become customers, sales and shipments in NÚCLEO; NÚCLEO keeps the store's stock and prices up to date. The plugin sends no data to any third-party server.

[NÚCLEO ERP](https://www.nucleoerp.cl/) es un programa de gestión gratuito, de código abierto, que funciona en el computador de la empresa: ventas, compras, inventario, clientes, envíos, finanzas e impuestos en un solo lugar, con los datos guardados cifrados en tu propio equipo.

Este plugin conecta tu tienda WooCommerce con tu NÚCLEO:

* **Pedidos → NÚCLEO.** Cada pedido pagado entra como cliente (con sus datos), venta que descuenta stock y envío por despachar con el destinatario, la dirección y el contenido, listo para crear la orden de transporte. Nada se registra dos veces.
* **Stock y precios → tienda.** NÚCLEO compara por código (SKU) y te muestra qué cambiaría antes de enviar nada.
* **Conexión en un paso.** «Crear conexión» genera la llave de la API y un código que pegas en NÚCLEO. Puedes revocarla cuando quieras.
* **Boleta o factura en el checkout (opcional).** Pregunta el tipo de documento y, para la factura, pide RUT (validado), razón social y giro. Llegan a NÚCLEO listos para facturar. Funciona en el checkout clásico y en el de bloques (WooCommerce 8.9 o superior).
* **La venta de NÚCLEO en cada pedido.** Una columna y un recuadro en el pedido muestran el número de la venta registrada en NÚCLEO.

= Privacidad =

El plugin no se comunica con ningún servidor. NÚCLEO ERP corre en tu computador y consulta tu tienda con la API REST de WooCommerce, usando una llave que tú creas y puedes revocar. FAVOR SpA, que desarrolla NÚCLEO, no recibe tus pedidos, clientes ni ventas.

= Requisitos =

* WooCommerce 7.0 o superior.
* La tienda debe usar https y enlaces permanentes distintos de «Simple».
* NÚCLEO ERP instalado en un computador con Windows (descarga gratuita en nucleoerp.cl).

== Installation ==

1. Instala y activa el plugin (Plugins → Añadir nuevo → Subir plugin).
2. Ve a WooCommerce → NÚCLEO ERP y presiona «Crear conexión». Copia el código.
3. En NÚCLEO ERP: Configuración → Integraciones → WooCommerce. Pega el código y presiona Conectar.
4. Presiona «Sincronizar pedidos» en NÚCLEO.

Para que los productos calcen, usa el mismo código (SKU) en la tienda y en NÚCLEO.

== Frequently Asked Questions ==

= ¿El plugin envía mis datos a algún servidor? =

No. Solo responde a tu propio NÚCLEO ERP, que se conecta desde tu computador con la llave que creaste.

= ¿Qué pasa si pierdo el código de conexión? =

Crea una conexión nueva: la anterior queda anulada y obtienes un código nuevo.

= ¿Puedo usarlo sin el plugin? =

Sí. NÚCLEO también se conecta con una llave creada en WooCommerce → Ajustes → Avanzado → API REST. El plugin agrega la conexión en un paso, los datos de factura en el checkout y la venta de NÚCLEO en cada pedido.

= Mi tienda ya pide el RUT con otro plugin =

Deja apagada la opción «Boleta o factura en el checkout». NÚCLEO reconoce los datos de RUT, razón social y giro que otros plugins guardan en el pedido.

= ¿Qué pedidos pasan a NÚCLEO? =

Los que están «Procesando» o «Completado». Los que esperan pago no se registran hasta que se paguen, y una cancelación o reembolso posterior se avisa en NÚCLEO para que anules la venta.

== Changelog ==

= 0.1.0 =
* Primera versión: conexión en un paso, estado para NÚCLEO, datos de boleta o factura en el checkout y venta de NÚCLEO en cada pedido.
