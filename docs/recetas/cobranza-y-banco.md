# Receta: cobranza y cuadrar el banco

Para el agente de NÚCLEO. Todo se hace con las herramientas de NÚCLEO; el dinero no se mueve nunca
(el banco es de solo lectura) y cada registro de dinero en NÚCLEO lo confirma la persona.

## Cobranza

1. `ronda_cobranza`: quién debe, cuánto, desde cuándo y el estado de cada cliente.
   - «listo»: le saldría el recordatorio. «reciente»: ya se le escribió hace poco. «sin_correo»: falta
     el correo en su ficha (pedírselo al dueño). «excluido»: el dueño pidió no escribirle; no insistir.
2. Mostrar al dueño la lista (cliente, total, días de atraso) y preguntar si se envía.
3. Con su «sí»: `enviar_cobranza` (todos los listos) o `enviar_cobranza {clientes: [...]}` (solo esos;
   sirve para insistir a uno «reciente»). Requiere «Acceso completo» y el permiso de correo.
4. El correo lleva todos los documentos del cliente, los datos de transferencia y el enlace de pago.
   No redactar otro texto ni prometer plazos: si el dueño quiere un mensaje distinto, usar
   `enviar_correo` con el texto que él apruebe.
5. La ronda programada (días, hora, «avisar» o «enviar sola») la configura el dueño en Dinero →
   Cobranza. Claude no la programa ni cambia a quién se excluye.

## Cuadrar las ventas con el banco

1. El dueño abre el portal del banco con su usuario de consulta. Leer los últimos movimientos y, en el
   detalle de cada transferencia recibida, **quién transfirió (RUT y nombre) y su comentario**.
2. `registrar_movimientos_banco` con cada movimiento tal cual: fecha, glosa completa, número de
   operación, monto (positivo abono, negativo cargo), saldo, y `rut`, `nombre`, `comentario` cuando
   aparezcan. Repetir la lectura no duplica: completa lo que faltaba.
3. `conciliacion_banco`: para cada pendiente, NÚCLEO propone qué es. Las sugerencias «por regla»
   vienen de lo ya conciliado antes (aprendidas) o de reglas del dueño.
4. Mostrar al dueño «este abono de $X del día D, de N, es el pago de la venta V de C» y, con su «sí»,
   `conciliar_movimiento_banco` (acción y destino de la sugerencia). Un abono menor que la deuda es un
   abono parcial: decirlo antes de registrarlo.
5. Lo que no se reconoce se pregunta, no se adivina. Cuando el dueño explica un movimiento que se
   repite («eso siempre es de tal cliente», «eso es combustible»), dejarlo en `guardar_regla_banco`.
6. Cerrar con: saldo según el banco contra saldo según NÚCLEO, y lo que quedó pendiente.

## BCI Pyme: cómo se lee (aprendido el 26-11-2026)

- Entrada: `https://www.bci.cl/corporativo/banco-en-linea/pyme`. El dueño inicia sesión (clave y código
  son suyos); el agente solo lee.
- Inicio → «Mis Movimientos». Abajo, «Filas por página» → 100, para ver todo el rango de una vez.
- El contenido vive en un marco de otro origen: no se puede leer como texto ni con JavaScript. Se lee
  por capturas, bajando de a una pantalla, y se comprueba la cadena de saldos (saldo anterior ± monto
  = saldo de la fila) antes de registrar: si no calza, falta una fila.
- No tocar «Transferir», «Descargar» ni «Imprimir». La sesión avisa antes de caducar.
- La cuenta en NÚCLEO parte con el saldo del banco al cierre del día anterior al primer movimiento
  registrado (saldo inicial + fecha): así «según NÚCLEO» y «según el banco» difieren solo en lo
  pendiente de conciliar.
- Un abono mayor que la factura con devolución posterior (cliente que pagó de más): se cobra la factura
  por su total y los dos movimientos del banco se dejan «ignorados» con una nota que explique el neto.
- Un pago anterior a la fecha de inicio de la cuenta bancaria en NÚCLEO no se registra en esa cuenta
  (descuadraría el banco).

## Cobros recurrentes, informe y meta

- `cobros_recurrentes`: qué se cobra solo, a quién y cuándo toca. Si uno dice «TOCA GENERARLO»,
  NÚCLEO lo hace en su próxima vuelta mientras esté abierto; el dueño también puede pulsar «Generar
  ahora». La boleta o factura de esa venta la emite el dueño (confirmación por documento).
- `informe_negocio`: cómo va el día, el mes y la meta («faltan $X: $Y por día hábil»). Es el mismo
  texto del informe que le llega por correo.

## Series y certificados

- Al recibir equipos: `registrar_series {producto, series[]}`. Con el certificado a la vista:
  `certificado {numero, laboratorio, fecha, proxima_calibracion, archivo}` (una llamada por serie si los
  certificados son distintos).
- Al vender: `registrar_series {producto, series[], venta}` deja las series en esa venta.
- «¿A quién le vendimos la serie X?» → `buscar_series {buscar}`. «¿Qué calibraciones vencen?» →
  `buscar_series {vencen_en_dias: 30}`: es la lista para ofrecer recalibración.
