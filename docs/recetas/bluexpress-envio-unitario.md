# Receta del robot: Bluexpress — envío unitario (app.bluex.cl)

Levantada el 2026-11-22 recorriendo el portal con la cuenta de Data Logger (pedido web #1253, Clínica
Rauquen, Curicó). Se detuvo antes de pagar. Ver docs/INTEGRACIONES.md, I7.

## Entrada

- Sesión iniciada por la persona en `login.blue.cl` (correo o Google); el robot reutiliza la sesión.
- Datos desde NÚCLEO (venta/envío): destinatario (nombre, apellido, teléfono, correo), región, comuna,
  calle, número, depto, referencia, descripción del contenido, valor declarado, talla.

## Pasos

| Paso | URL | Campos | Notas |
|---|---|---|---|
| 0 | `app.bluex.cl/dashboard` | botón «Nuevo Envío» → modal con «Envío unitario», «Envío múltiple» (hasta 20, mismo origen) y «Carga masiva» (hasta 50, planilla Excel) | La carga masiva con planilla es la vía más estable para el robot: NÚCLEO llena la planilla y la sube |
| 1 Origen | `/envio-unitario/origen` | Empresa que envía (select: Data logger spa / Insumos Agricolas Growcenter Limitada), teléfono, correo, dirección del remitente (buscar o manual), depto, referencia; región y comuna de origen; Punto Blue Express de origen (lista y mapa) | Viene precargado con el perfil (Brown Sur 306, Ñuñoa, RM). Botón «Siguiente» |
| 2 Destino | `/envio-unitario/destino` | Nombre*, Apellido*, Teléfono móvil*, Correo*; «Enviar a un Punto Blue Express» o «Enviar a domicilio»; dirección: **usar «Ingresar manual»** → Región* (select, valores `CL-ML`…), Comuna* (select con código, ej. Curicó `7301`), Calle*, Número* (o «Sin número»), Depto/Oficina, Referencia | El buscador de direcciones cambió «Avenida Lyon 1801, Curicó» por «Villa Andrés Bello 1801»: con el ingreso manual no hay errores de geocodificación. Opción «Quiero guardar como destino frecuente» |
| 3 Paquete | `/envio-unitario/paquete` | Check «Mi envío no contiene Mercancías Peligrosas»* (ácidos, alcoholes, combustibles, explosivos, material radiactivo, aerosoles); «Garantía extendida» (recomendada sobre $85.000); Descripción del contenido*; Valor del contenido*; Talla: XS (sobre o caja hasta 0,5 kg), S (hasta 3 kg o 20×20×30 cm), M (hasta 6 kg o 30×30×25), L (hasta 20 kg o 70×70×70) | **Pausa:** la declaración de mercancías peligrosas la confirma la persona. La talla mal elegida retiene el envío y puede bloquear la cuenta: la talla sale de las medidas/peso del producto en NÚCLEO. Cotización al elegir talla: S a Curicó = **$5.600, hasta 2 días hábiles** (el cliente pagó $5.000 en la web) |
| 4 Pago | `/envio-unitario/pago` | Resumen (quien envía, destino, talla, tipo 48 h, valor neto + IVA); RUT beneficiario Full Copec (precargado, acumula puntos); medio de pago: **Webpay Plus** (Transbank: tarjeta de crédito, débito o prepago), **BancoEstado**, o **Envío por pagar destinatario**; check «Acepto términos y condiciones»; código de descuento; botón «Pagar» | **Pausa obligatoria.** No hay tarjeta guardada: Webpay pide la tarjeta en la página de Transbank en cada pago, así que ahí paga la persona (o se usa prepago con saldo acotado). Pedido #1253: $5.600 = $4.706 + $894 IVA |

| 5 Webpay | página de Transbank | «Tarjetas» (crédito, débito, prepago) u **Onepay / billeteras** con código QR (Mach, Banco de Chile, Itaú, Scotia, Santander, Tenpo, Líder Bci, Dale…) y «código de compra» | La persona paga escaneando el QR con Mach (así lo hace Data Logger). El monto cobrado puede diferir de la cotización: pedido #1253 cotizó $5.600 y se pagó **$3.920** |
| 6 Confirmación | «Envío confirmado» | **Número de seguimiento** (ej. 2480522914), botón «Descargar etiqueta», «Encuentra tu Punto con impresora», guía de embalaje, talla, destino, **monto pagado**, **n.º de transacción**, medio de pago (WEBPAY), puntos Full | El robot lee estos datos y descarga la etiqueta PDF |

## Salida esperada

Número de seguimiento, etiqueta PDF, monto pagado y n.º de transacción; se guardan en el envío de NÚCLEO
(con el costo real del envío) y se puede avisar al cliente por correo con el seguimiento.

## Pago: lo que hace la persona

No hay API pública para que un programa pague un QR con Mach ni con otra billetera: la aprobación del pago
ocurre en el teléfono de la persona. El robot deja la pantalla de Webpay lista (o muestra el QR en
NÚCLEO y avisa al celular) y la persona lo paga en segundos. Para reducir pagos: usar **Envío múltiple**
(hasta 20) o **Carga masiva** (hasta 50) y pagar todos los envíos del día con **un solo QR** (por confirmar en el portal), o pedir
cuenta corriente empresa (sin paso de pago).

## Observaciones

- Reglas de Data Logger (dueño, 22-11-2026): talla **S hasta 16 equipos, M desde 17**; marcar siempre «no contiene mercancías peligrosas»; origen Ñuñoa con el **Punto Blue Express Market Plaza Ñuñoa** (Irarrázaval 3601).
- Como Webpay no guarda la tarjeta, el robot llega hasta «Pagar» y la persona termina el pago en Transbank; con cuenta corriente empresa el paso desaparecería.

- La cuenta es de persona con empresas asociadas («¿Tienes una empresa? Inscribe tu negocio»): conviene
  inscribir la empresa para factura y, si Bluexpress lo ofrece, cuenta corriente con pago mensual.
- Origen por defecto en Ñuñoa (RM): revisar si es la bodega desde donde se despacha.
- El envío a domicilio permite «pre-pago o por pagar».
