# NÚCLEO ERP — Integraciones: ventas, envíos, bancos, correo y NÚCLEO en línea

> Estado: **diseño aprobado el 2026-11-21** (decisiones del dueño: versión en línea **cifrada**, cuenta
> empresa en Bluexpress, Mercado Libre trae **venta y stock, por facturar y pagos**; orden de trabajo
> 1 → 2 → 3). Mercado Libre (I1) construido (falta el permiso de Mercado Libre para crear la app).
> **Ampliado el 2026-11-22** (pedido del dueño: «que NÚCLEO pueda hacer todo desde el mismo lugar»):
> envíos con varios couriers (I2), bancos solo lectura (I4), correo propio (I5) y una sola pantalla de
> conexiones (I6).

## Principios que no cambian

- Los datos de la empresa siguen siendo de la empresa. Las integraciones hablan **directo** desde el
  computador del usuario con Mercado Libre y Bluexpress: no pasan por un servidor de NÚCLEO.
- Las credenciales (llaves de API, tokens) se guardan en la base cifrada de la empresa (SQLCipher),
  nunca en el código ni en archivos sueltos.
- Nada se registra dos veces: cada pedido externo queda enlazado a una sola venta.
- Lo que no calza sin duda queda **por revisar**, nunca se adivina.

## I1 · Mercado Libre

### Conexión (una vez por empresa)

1. La empresa crea su propia aplicación en <https://developers.mercadolibre.cl> (Mis aplicaciones →
   Crear). URL de redirección: `https://www.nucleoerp.cl/ml/`. Permisos: lectura de ventas y
   `offline_access`.
2. En NÚCLEO: **Configuración → Integraciones → Mercado Libre**, pega el *App ID* y la *Clave secreta*.
3. «Conectar» abre el navegador en `auth.mercadolibre.cl`. El vendedor autoriza; la página
   `www.nucleoerp.cl/ml/` devuelve el código a NÚCLEO (redirige a `127.0.0.1:<puerto>` si NÚCLEO está
   esperando; si no, muestra el código para copiarlo y pegarlo).
4. NÚCLEO cambia el código por los tokens (`/oauth/token`) y los renueva solo (el token de acceso dura
   horas; el de renovación es de un solo uso y se reemplaza en cada renovación).

Por qué la aplicación es de cada empresa: NÚCLEO es código abierto y no puede esconder una clave secreta
compartida; con una app propia, la clave y los permisos quedan en manos del vendedor y Mercado Libre no
pasa por terceros.

### Qué trae

| Dato de Mercado Libre | En NÚCLEO |
|---|---|
| Pedido pagado (`/orders/search`, por fecha) | Venta efectuada al contado (medio transferencia, operación = pago de Mercado Pago), referencia `ML` con el n.º de pedido, cliente por nombre o RUT. Un carrito (`pack_id`) = una venta |
| Productos del pedido | Líneas con el producto de NÚCLEO por **SKU del vendedor** (`seller_sku`) o por el enlace guardado publicación → producto. **Descuenta stock** |
| Precio (con IVA) | Precio neto = precio ÷ (1 + tasa de IVA de la empresa); el total de Mercado Libre queda en el pedido para cuadrar |
| Envío pagado por el comprador | Línea «Envío Mercado Libre» |
| Datos de facturación (`/orders/{id}/billing_info`) | Si el comprador entregó RUT de empresa o razón social: venta tipo factura (FV) **«Por facturar»** con receptor (RUT, razón social, giro, dirección). Si no: boleta (VEN) |
| Comisión (`sale_fee`) y costo de envío del vendedor (`/shipments/{id}/costs`) | Guardados en el pedido: total, comisión, envío, **neto a recibir**. Sirven para cuadrar los depósitos de Mercado Pago |
| Pedido cancelado después de importado | Aviso «cancelado en Mercado Libre»: la persona anula la venta (NÚCLEO no anula solo) |

Pedidos con una publicación sin producto enlazado quedan como **borrador por revisar**; al enlazar la
publicación con un producto y volver a sincronizar, la venta se confirma. Si el stock no alcanza y el
producto bloquea ventas sin stock, también queda por revisar.

### Datos

Migración 36: `integrations` (proveedor, cuenta, configuración y tokens), `ml_orders` (pedido, carrito,
venta, estado, montos, facturación, aviso) y `ml_item_links` (publicación + variación → producto).

### Cómo está hecho

- `nucleo-app::ml_ops`: cliente HTTP (`ureq`, TLS con raíces de Mozilla) **sin** tener tomada la sesión
  mientras espera a Mercado Libre; la aplicación de los pedidos a ventas corre en la sesión con su
  auditoría. El acceso a la API está detrás de un trait para probar con pedidos de ejemplo.
- Comandos: estado, guardar app, URL de autorización, canjear código, sincronizar, pedidos, enlazar
  publicación, desconectar. Herramienta de Claude `sincronizar_mercadolibre`.

## I2 · Envíos con couriers (Bluexpress, Chilexpress, Starken, Correos de Chile, Envíame)

Objetivo: en **Envíos**, un botón «Crear orden de transporte» que cotiza en los couriers conectados,
emite la OT en el elegido, guarda el n.º de seguimiento y la etiqueta (PDF/ZPL) en el envío, actualiza
el estado con el seguimiento y, si la persona quiere, avisa al cliente por correo (I5) con el link de
seguimiento.

### Dos caminos (se pueden usar los dos)

| Camino | Qué es | Credenciales | Ventaja |
|---|---|---|---|
| **Envíame** (integrador) | Una sola API para varios couriers chilenos. En su documentación aparecen los códigos `BLX` (Bluexpress), `SKN` (Starken), `CHX` y `CCH` | Llave `api-key` y ID de empresa (seller) que entrega Envíame; ambiente de pruebas `stage.api.enviame.io` y producción `api.enviame.io` | Un adaptador = varios couriers, cotización comparada, etiquetas y manifiestos. Tiene costo por envío o plan (confirmar con Envíame) |
| **Directo por courier** | La API de cada courier con la cuenta empresa | Bluexpress: documentación y llave por el ejecutivo. Chilexpress: llaves de su portal de desarrolladores. Correos de Chile: «código cliente» (ejecutivo) + credencial de servicios web (formulario en developers.correos.cl; servicios SOAP con ambiente de certificación). Starken: credenciales de cuenta corriente vía ejecutivo | Sin intermediario ni costo extra; usa las tarifas negociadas |

Recomendación: partir con el courier que más se usa por la vía directa (Bluexpress, ya hay cuenta
empresa) y sumar Envíame si se quiere comparar precios entre couriers sin pedir cuatro APIs.

### Diseño

- `nucleo-app::carrier_ops` con un trait `Courier { cotizar, emitir_ot, etiqueta, seguimiento, retiro }`
  y un adaptador por proveedor (`bluexpress`, `chilexpress`, `starken`, `correos`, `enviame`). Igual que
  Mercado Libre: la red fuera de la sesión y pruebas con respuestas de ejemplo.
- El envío guarda: courier, servicio, peso, medidas, valor declarado, n.º de OT/seguimiento, etiqueta
  adjunta (Documentos), último estado y fecha. El estado se refresca a pedido o al abrir Envíos.
- Emitir una OT puede tener costo: NÚCLEO muestra courier, servicio y valor y pide confirmar.
- Bluexpress vía plugin de WooCommerce (opción ya conversada): NÚCLEO crea el pedido en la tienda por
  la API REST de Woo con el método de envío de Bluexpress y el plugin emite la OT; el plugin queda fuera
  de las zonas de envío de la web para que no aparezca en el checkout.

### Proceso para activar cada courier (empezamos por Data Logger)

Lo que hay que pedir a cada ejecutivo (se anota la respuesta aquí y se repite igual con cada cliente
de NÚCLEO):

1. ¿La empresa tiene **cuenta corriente** (cliente empresa con contrato)? Si no, abrirla.
2. ¿Hay **API o servicios web** para emitir OT, etiqueta, seguimiento y retiro? Documentación,
   ambiente de pruebas y credenciales (llave, código de cliente, usuario de servicios web).
3. **Cómo se paga:** factura mensual con crédito (cuántos días), prepago/saldo cargado, o tarjeta
   inscrita en su portal. ¿Qué pasa si una OT se emite y no se usa (se anula sin costo)?
4. Tarifas pactadas por peso/tamaño/destino y si la API las devuelve al cotizar.
5. Retiro en bodega (horario, costo) o entrega en sucursal/Punto.

| Courier | Prioridad | Estado para Data Logger | Lo que falta |
|---|---|---|---|
| Bluexpress | 1 (el más usado) | Cuenta empresa | Documentación y llave de la API por el ejecutivo, o plugin de Woo |
| Starken | 2 | Por confirmar | Cuenta corriente pyme y credenciales de servicios web |
| Chilexpress | 3 | Por confirmar | Cuenta corriente y llave de API |
| Correos de Chile | 4 | Por confirmar | «Código cliente» (ejecutivo) + credencial de servicios web (formulario en developers.correos.cl) |
| Envíame | Opcional | — | Solo si se quiere comparar couriers con una llave; tiene costo |

### Cómo se pagan los envíos automáticos

- Lo normal con API es la **cuenta corriente con factura mensual**: cada OT emitida por NÚCLEO se
  carga a la cuenta y el courier factura a fin de mes con el crédito pactado. No hace falta tarjeta.
- Si un courier solo acepta **prepago o tarjeta inscrita**, la tarjeta (ej. una prepago empresa con
  saldo acotado) se inscribe **en el portal del courier**, por la persona. NÚCLEO no guarda ni usa
  tarjetas ni mueve dinero (regla del proyecto).
- NÚCLEO guarda el costo de cada OT; cuando llega la factura del courier, la cuadra contra las OT del
  mes (qué envío se cobró, cuál se cobró dos veces, cuál faltó) y la deja como compra por pagar.

## Catálogo de extensiones (para vender después)

Idea del dueño (22-11-2026): NÚCLEO tendrá una página de **integraciones o extensiones**; si más
adelante se vende NÚCLEO como servicio (con la facturación SII), las extensiones se pueden vender.

- Primero se prueban en Data Logger y cada una queda documentada aquí con su proceso de activación.
- Cada empresa usa **sus propias** cuentas y credenciales (su contrato con Bluexpress, su casilla de
  correo, su app de Mercado Libre, su certificado SII). FAVOR SpA vende el software y el soporte,
  nunca intermedia envíos, pagos ni datos.
- Cada extensión es un módulo que se activa en Configuración → Integraciones, con estado, «Probar» y
  «Desconectar», y su propia página en el sitio (qué hace, qué pide, cómo se activa).
- Pendiente de decidir: cómo se cobra (licencia por extensión, plan mensual, o soporte/instalación)
  sabiendo que el código de NÚCLEO es abierto.

| Extensión | Estado |
|---|---|
| Facturación SII propia | En certificación (F2 en código) |
| Correo de la empresa | Lista (falta probar con la casilla real) |
| Mercado Libre | Lista (falta el permiso de Mercado Libre para crear la app) |
| Avisos de pago por correo (bancos) | Propuesta (ver I4) |
| Bluexpress / Starken / Chilexpress / Correos | Esperando credenciales |
| WooCommerce | Esperando llave REST |

## I4 · Bancos (solo lectura: saldos y movimientos)

Objetivo: que NÚCLEO vea los saldos y movimientos de las cuentas de la empresa para **cuadrar solo**:
qué cliente pagó (y qué venta queda pagada), qué gasto salió, quién debe y quién está atrasado. NÚCLEO
nunca mueve dinero: sin transferencias ni pagos.

### Cómo conectarse gratis (plan del dueño: todo propio, sin agregadores pagados)

Lo que se averiguó (22-11-2026):

- **Ningún banco chileno ofrece hoy una API gratuita y de autoservicio** para que una pyme lea sus
  propios saldos y movimientos. BCI tiene **API Market**, pero en producción exige pedir ser
  «partner», con análisis y aprobación del banco y un posible costo; el cliente autoriza con su
  login Bci. **360 Connect** de BCI muestra saldos de otros bancos dentro de su web (se contrata con
  el banquero, sin API). Los conectores de terceros (Fintoc, Emisso) cobran y piden la clave del banco.
- Las **finanzas abiertas** obligarán a los bancos a entregar estos datos por API, pero se
  postergaron a 2027; para usarlas, FAVOR tendría que registrarse ante la CMF como proveedor.

Plan gratis y hecho por nosotros, en capas:

1. **Avisos de transferencia por correo (quién pagó).** Los bancos del que paga ya envían a
   ventas@datalogger.cl un aviso con nombre, monto y fecha: en oct-2026 llegaron de Banco de Chile
   (`serviciodetransferencias@bancochile.cl`), BCI (`transferencias@bci.cl`), Scotiabank
   (`avisos.empresa.info@scotiabank.cl`), Itaú (`info@itau.cl`) y Mach (`noreply@somosmach.com`).
   NÚCLEO lee la casilla (IMAP, solo lectura, con la misma cuenta de I5), reconoce esos remitentes,
   saca pagador, RUT si viene, monto, fecha y n.º de operación, y propone el cobro de la venta que
   calza. Gratis, sin clave del banco, sin tocar el banco.
2. **Cartola del banco (saldo, ingresos, egresos y glosa).** La cartola en Excel/CSV que se descarga de
   la web del banco ya se importa en Dinero → Conciliación. Se agrega: carpeta vigilada (se descarga la
   cartola a «Cartolas» y NÚCLEO la importa sola, sin duplicar movimientos) y formatos de los bancos
   que usa Data Logger.
3. **BCI API Market:** FAVOR SpA pide ser partner solo para el producto de cuentas (lectura). Si BCI
   aprueba sin costo, se conecta directo con el consentimiento de la empresa; si no, sigue con 1 y 2.
4. **Finanzas abiertas (2027):** cuando rijan, conexión oficial con todos los bancos.

### Por qué no «usuario y clave del banco dentro de NÚCLEO»

Guardar la clave del banco y entrar «como si fuera la persona» (raspado de la web del banco) choca con
las condiciones de uso de los bancos, se rompe con cada cambio de la web o del segundo factor, y deja en
el computador una clave que permite mover dinero. Los agregadores autorizados y las APIs de finanzas
abiertas existen justamente para leer sin esa clave. Decisión D-INT-05.

### Qué hace NÚCLEO con los movimientos

1. Trae los movimientos nuevos (avisos de transferencia del correo y cartola) a Dinero → Conciliación.
2. Abono con RUT/nombre/monto que calza con una venta por cobrar → propone «cobro de la venta X».
3. Cargo que calza con una compra o gasto por pagar → propone el pago.
4. Lo que no calza queda por revisar (como los depósitos no identificados de hoy).
5. Tablero: quién pagó, quién debe, quién está atrasado (y botón para enviarle el recordatorio de cobro
   por correo, I5).

## I5 · Correo de la empresa (avisos de envío, cobros y promociones)

Objetivo: que NÚCLEO envíe correos **desde la casilla de la empresa** (ej. ventas@datalogger.cl):
aviso de despacho con el n.º de seguimiento, recordatorio de cobro con el detalle de lo que se debe,
envío de la factura/cotización en PDF y promociones a clientes que aceptaron recibirlas.

- **Conexión con usuario y clave:** servidor SMTP de la casilla (Titan, Gmail, Outlook, cPanel…), puerto,
  usuario y **clave de aplicación** (Gmail y Outlook la exigen con segundo factor). Se guarda en la base
  cifrada. Botón «Enviar correo de prueba».
- **Plantillas** editables con datos de la venta, el envío o la deuda (`{cliente}`, `{folio}`,
  `{seguimiento}`, `{monto}`, `{vence}`), con el logo del negocio.
- **Cada envío lo inicia la persona** (vista previa → «Enviar»). Las promociones solo van a clientes con
  permiso de comunicaciones comerciales y llevan cómo darse de baja (Ley 19.496, art. 28 B).
- Registro de cada correo enviado (a quién, cuándo, asunto, documento) en la ficha del cliente.
- Claude puede **preparar** el correo; el envío lo confirma la persona.

## I6 · Una sola pantalla de conexiones

**Configuración → Integraciones** reúne todo: Mercado Libre, WooCommerce, couriers, bancos, correo y
SII. Cada conexión muestra estado (conectada / falta algo / error), última sincronización, botón
«Probar» y «Desconectar». Las credenciales (usuario y clave de correo, llaves de API, tokens) se
escriben en NÚCLEO por la persona, se guardan en la base cifrada de la empresa y nunca se muestran de
vuelta (solo «guardada»). La tabla `integrations` se abre a nuevos proveedores (migración 38).

### Orden de trabajo propuesto

1. **Correo (I5):** listo; sirve para avisos de cobro y envío.
2. **Avisos de transferencia por correo (I4, capa 1)** y cartola en carpeta vigilada (capa 2): gratis.
3. **Bluexpress (I2)** directo o por Woo, apenas estén la documentación/llave o el plugin.
4. Starken, Chilexpress y Correos de Chile, en ese orden, a medida que lleguen las credenciales.
5. Solicitud de partner en BCI API Market (FAVOR SpA).

## I3 · NÚCLEO en línea (cifrado de extremo a extremo)

Objetivo: entrar desde cualquier navegador con usuario y contraseña a la información de la empresa,
**gratis**, sin que NÚCLEO (FAVOR SpA) pueda leer los datos.

| Pieza | Diseño |
|---|---|
| Servidor | Guarda **solo paquetes cifrados** del registro de cambios (el mismo `change_log` de la sincronización S0) y las cuentas de usuario. No tiene la llave |
| Llave | La llave del negocio (la de la sincronización) se envuelve con una llave derivada de la contraseña (Argon2id en el navegador). Olvidar la contraseña y la clave de recuperación = datos irrecuperables en línea |
| Navegador | La misma interfaz React, compilada para web, con el núcleo Rust compilado a WebAssembly; base local en el navegador (SQLite WASM en OPFS). Descarga los paquetes, los descifra y trabaja igual que el escritorio |
| Escritorio | «Activar NÚCLEO en línea»: sube sus cambios cifrados y baja los de la web. El escritorio sigue siendo la autoridad de numeración y documentos (como con el celular) |
| Cuenta | Correo + contraseña (+ segundo factor opcional). El servidor solo ve el correo y el tamaño de los paquetes |

Costo: el servidor solo guarda bytes cifrados, así que sirve un almacenamiento barato (del orden de
unos pocos dólares al mes para cientos de empresas pequeñas). Fases: W0 formato de paquete cifrado y
pruebas; W1 servidor de paquetes; W2 interfaz web en solo lectura; W3 edición con la misma regla de
autoridad del escritorio.

Riesgo principal: es la pieza más grande (WebAssembly del núcleo y base en el navegador). Se hace
después de I1 e I2.
