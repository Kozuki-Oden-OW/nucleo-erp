# Receta: cierre diario (Mercado Libre + banco)

> Para el agente (Claude con la extensión de NÚCLEO y Claude en Chrome). Escrita el 24-11-2026.
> Objetivo: que cada día queden en NÚCLEO las ventas de Mercado Libre y los movimientos del banco, y
> saber qué falta despachar, facturar y cobrar. El dueño lo pide con una frase («haz el cierre de hoy»).

## Antes de empezar

| Qué | Quién | Cómo |
|---|---|---|
| NÚCLEO abierto en el negocio, con acceso completo para Claude | Dueño | Configuración → Claude |
| Sesión de Mercado Libre abierta (colaborador de solo lectura) | Dueño | Inicia sesión en Chrome; dura días o semanas |
| Sesión del banco abierta | Dueño | Inicia sesión justo antes de pedir el cierre: dura pocos minutos |

**Pestañas.** Cada vez que haga falta mirar Mercado Libre o el banco, el agente abre la pestaña que
corresponde: ventas de Mercado Libre en `https://vendedores.mercadolibre.cl/ventas/omni/listado` y el
banco en `https://www.bci.cl/corporativo/banco-en-linea/pyme`. Si aparece el formulario de ingreso, deja
la pestaña abierta y avisa al dueño.

**Cómo se entra a los sitios.** El agente no escribe claves ni pulsa botones que las completen. Si una
sesión está cerrada, lo dice y espera: el dueño entra (con la clave guardada en el gestor de Chrome son
dos clics) y el agente sigue. Códigos de verificación y captchas los resuelve el dueño.

## 0. Correos: transferencias recibidas (método acordado el 24-11-2026)

No necesita sesión del banco: los bancos de los clientes avisan por correo cada transferencia.

1. Con la extensión de correo Titan, `buscar_correos` con el texto «transferencia» en las cuatro
   cuentas (`ventas@elitechchile.cl` concentra casi todos los avisos; `contacto@elitechchile.cl` recibe
   los de Banco de Chile; en las de `datalogger.cl` llegan comprobantes que envían los clientes), desde
   la fecha del último cierre.
2. Abre solo los avisos de bancos (BCI, Banco de Chile, BancoEstado, Santander, Itaú, BICE, Falabella)
   y anota: fecha, quién transfiere y su RUT, monto, mensaje (OC, cotización o factura) y número de
   operación. No marca nada como leído.
3. Cruza con `listar_ventas` (por cobrar y por nombre del cliente): pago de una venta por cobrar →
   proponer el cobro; pago sin venta en NÚCLEO → avisar que falta registrar o facturar.
4. Límite: solo aparecen las transferencias cuyo banco de origen envía aviso. Depósitos de Mercado
   Pago, Webpay y transferencias sin aviso se ven en el banco (paso 2).

## 1. Mercado Libre

Sigue `mercadolibre-revision-ventas.md`:

1. Lista de ventas (últimos 2 meses). Compara con `pedidos_mercadolibre`: solo se abren las ventas que
   NÚCLEO no tiene o que cambiaron de estado (cancelada, reclamo, reembolso).
2. En cada venta nueva: detalle (comprador, RUT, giro, factura subida, cobros) y mensajes; al salir,
   «Marcar como no leído».
3. Muestra el resumen al dueño y, con su aprobación, `registrar_ventas_mercadolibre`. Lo despachado
   desde el 23-11-2026 lleva `descontar_stock: true`.

## 2. Banco (solo lectura)

1. `cuentas_dinero` para saber la cuenta de NÚCLEO que corresponde.
2. En el portal del banco, con la sesión que abrió el dueño, abre **últimos movimientos / cartola** de
   la cuenta. Solo mirar: nunca transferencias, pagos, cambios ni descargas sin permiso.
3. Copia cada movimiento desde el último ya cargado: fecha, glosa completa, número de operación, monto
   (abono positivo, cargo negativo) y saldo. `registrar_movimientos_banco` (no duplica).
4. `conciliacion_banco`: revisa los pendientes y las sugerencias de NÚCLEO.
5. Propón al dueño, en una tabla, qué abono paga qué venta. Con su aprobación,
   `conciliar_movimiento_banco` (acción «cobrar» o «vincular»). Lo dudoso queda pendiente: no se adivina.
6. Los retiros de Mercado Pago que llegan al banco son un **traspaso** entre cuentas propias (Mercado
   Pago → banco), no una venta: las ventas de Mercado Libre ya quedaron cobradas en Mercado Pago.

## 3. Informe

Entrega al dueño, corto y en este orden: ventas nuevas registradas, por despachar hoy, por facturar,
abonos conciliados, abonos sin identificar, ventas vencidas sin pago, y diferencia de saldo entre el
banco y NÚCLEO.

## Lo que no hace el agente

Escribir claves, transferir o pagar, responder mensajes de Mercado Libre, adjuntar facturas, emitir
documentos al SII sin confirmación, ni descargar archivos sin permiso.
