# NÚCLEO ERP — Integraciones: ventas, envíos, bancos, correo y NÚCLEO en línea

> Estado: **diseño aprobado el 2026-11-21** (decisiones del dueño: versión en línea **cifrada**, cuenta
> empresa en Bluexpress, Mercado Libre trae **venta y stock, por facturar y pagos**; orden de trabajo
> 1 → 2 → 3). Mercado Libre (I1) construido (falta el permiso de Mercado Libre para crear la app).
> **Ampliado el 2026-11-22** (pedido del dueño: «que NÚCLEO pueda hacer todo desde el mismo lugar»):
> envíos con varios couriers (I2), bancos solo lectura (I4), correo propio (I5) y una sola pantalla de
> conexiones (I6).
> **WooCommerce (I8) construido el 2026-11-23**, con su plugin de WordPress; falta probarlo en la tienda real.

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
| WooCommerce | Lista (falta probar con la tienda real; plugin 0.1.0) |

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
5. **Robot con usuario de solo consulta (I7):** descarga la cartola desde la web del banco sin que la
   persona tenga que hacerlo.

### La clave del banco: solo de un usuario de consulta

NÚCLEO no guarda la clave de un usuario que pueda firmar o transferir: con ella se puede mover dinero.
Si el robot (I7) entra a la web del banco, lo hace con un usuario de **solo consulta** que el
administrador de la empresa crea en la banca empresas, y descarga la cartola oficial. Decisiones
D-INT-05 y D-INT-07.

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

## I7 · Robot de NÚCLEO (hace en la web lo que hoy se hace con mouse y teclado)

Propuesta del dueño (22-11-2026): donde no haya API, que NÚCLEO haga solo el mismo proceso que hoy hace
una persona en el computador: entrar a Bluexpress, crear la etiqueta con las medidas, pagar; entrar al
banco con un usuario de solo lectura y ver los movimientos para cuadrar facturas pagadas.

### Cómo funciona

- **Navegador propio del robot:** NÚCLEO abre un Chrome/Edge aparte (perfil «NÚCLEO Robot», separado del
  Chrome personal) y lo maneja por el protocolo de depuración del navegador, desde el escritorio.
- **Sesión, no contraseña:** la persona inicia sesión **una vez** en ese navegador (incluido «Entrar con
  Google»); la sesión queda guardada en el perfil y el robot la reutiliza. Cuando vence, NÚCLEO avisa
  «vuelve a iniciar sesión en Bluexpress». Así NÚCLEO no guarda la clave de Google ni del portal.
- **Recetas:** cada sitio tiene una receta versionada (pasos, campos, botones, qué esperar en cada
  pantalla): «Bluexpress: crear envío», «BCI: descargar cartola», «Banco de Chile: movimientos»…
  Las recetas son las **extensiones** que después se pueden vender y actualizar.
- **Puntos de pausa:** el robot se detiene y pide a la persona lo que no debe hacer solo: inicio de
  sesión, segundo factor, captcha, código de verificación y **confirmación de un pago**.
- **Registro:** cada ejecución guarda qué hizo, capturas de pantalla y el resultado (n.º de OT,
  etiqueta PDF, cartola descargada) en Documentos, con auditoría.
- **Visible primero:** las primeras veces corre a la vista; cuando la receta es confiable, puede correr
  minimizado y avisar al terminar.
- **Si existe API, se usa la API** (más estable); el robot es para lo que no tiene API.

### Pagos de envíos con tarjeta prepago

La idea de una **tarjeta prepago con saldo acotado** es buena (si no hay saldo, el pago se rechaza y no
hay sorpresas). Cómo hacerlo bien:

- La tarjeta se **inscribe en el portal del courier** (su pasarela la guarda tokenizada) y el robot solo
  elige «tarjeta guardada». NÚCLEO **no guarda número, fecha ni CVV**: la norma de tarjetas PCI DSS
  prohíbe guardar el CVV después de autorizar un pago, aunque esté cifrado, y tener tarjetas guardadas
  convertiría a NÚCLEO en un blanco.
- Si el portal pide el CVV en cada pago, el robot hace una pausa y la persona lo escribe (es un paso de
  segundos) o confirma el pago con el aviso de su banco.
- Antes de pagar, NÚCLEO muestra courier, servicio y monto; con un **tope por envío y por mes** que
  la empresa define, todo lo que lo supere pide confirmación.
- Mejor aún si el courier da cuenta corriente: no hay paso de pago.

### Bancos con usuario de solo lectura

En la banca empresas, el administrador puede crear usuarios adicionales con perfil de **solo consulta**
(ver saldos, movimientos y cartolas, sin firmar ni transferir). Para el robot:

1. El administrador de la empresa crea en la banca empresas un usuario «NÚCLEO consulta» con perfil
   solo consulta (se confirma con el ejecutivo que el banco lo permite y si pide segundo factor al
   entrar).
2. La persona inicia sesión con ese usuario en el navegador del robot; si el banco pide clave cada vez,
   se guarda en la base cifrada (es un usuario que **no puede mover dinero**).
3. La receta del banco descarga la **cartola oficial** (Excel/CSV) del día o del mes, en vez de leer la
   pantalla, y NÚCLEO la importa sin duplicar: saldo, ingresos, egresos y glosas.
4. Si el banco pide segundo factor o captcha, el robot hace una pausa y la persona lo resuelve.

Se revisa con cada banco y courier que sus condiciones permitan el acceso automatizado con el usuario
de la propia empresa.

### Ingresos con aprobación (decisión del dueño, 23-11-2026)

El dueño va a crear usuarios de **solo lectura** en BCI (operador con solo saldos y cartolas) y en
Mercado Libre (colaborador). Con ellos hay dos formas de entrar, y se construyen las dos:

1. **NÚCLEO entra solo y el asistente lee desde NÚCLEO** (camino principal para bancos). El robot inicia
   sesión con el usuario de solo lectura guardado en la base cifrada, a la hora programada o cuando la
   persona lo lanza; descarga cartola y ventas y las deja en NÚCLEO. El asistente (Claude por la
   extensión, o el Asistente NÚCLEO) cuadra pagos con lo ya importado y **no entra al banco**.
2. **Ingreso con aprobación** (para sitios donde el asistente necesita navegar, p. ej. crear una orden
   de transporte). El asistente **pide** el ingreso a NÚCLEO; NÚCLEO avisa a la persona («El asistente
   pide entrar a BCI con el usuario de lectura»), con botones **Autorizo / No autorizo**; si autoriza,
   NÚCLEO completa usuario y clave en el navegador del robot. El asistente **nunca ve ni escribe la
   clave**, y no existe un botón que el propio asistente pueda pulsar para completarla.

Reglas del ingreso con aprobación:

- Solo para credenciales marcadas como **solo lectura** (o de operador sin facultad de pago). Las de
  apoderado, Google o SII no se guardan ni se ofrecen.
- Cada solicitud es de **un solo uso**, vence a los pocos minutos y dice quién pide, qué sitio, con qué
  usuario y para qué. Queda en la auditoría (pedida, autorizada o rechazada, por quién y desde dónde).
- El segundo factor, los captchas y los pagos siguen siendo de la persona.

Dónde llega el aviso (pedido del dueño: correo o WhatsApp, con botón de sí y no):

| Canal | Cómo | Qué necesita | Orden |
|---|---|---|---|
| NÚCLEO en el PC | Ventana y notificación del sistema con los dos botones | Nada extra; funciona sin internet | 1.º |
| Correo | Correo con «Autorizo» y «No autorizo»; cada botón abre una página de confirmación (un clic más), para que los filtros de correo que abren enlaces no aprueben solos | Un **relevo** pequeño en nucleoerp.cl que solo lleva el sí o el no de una solicitud firmada; no recibe claves ni datos del negocio. NÚCLEO consulta el relevo | 2.º |
| WhatsApp | Mensaje con botones de respuesta rápida | Lo mismo que el correo, más la API de WhatsApp Business (verificación de la empresa en Meta, plantilla aprobada y costo por mensaje) | 3.º |
| App del celular de NÚCLEO | Aviso en la app | La app (plan S); por la red local no necesita relevo | Con la app |

Por definir: si el relevo es parte de NÚCLEO gratuito o del plan Premium (tiene costo de servidor), y si
se ofrece Telegram como alternativa gratuita a WhatsApp.

### Primeros pasos

1. **Bluexpress:** recorrer juntos el flujo real (entrar, crear envío, medidas, pago) para escribir la
   receta, deteniéndose antes de pagar; luego una prueba con un envío real confirmado.
2. **BCI:** crear el usuario de solo consulta y escribir la receta «descargar cartola».
3. Motor del robot en el escritorio (perfil separado, recetas, pausas, registro) y pantalla
   Configuración → Integraciones → Robot.

## I8 · WooCommerce (tienda propia)

Pedido del dueño (23-11-2026): «revisar los datos de la venta y del cliente y anotarlos en NÚCLEO,
revisar el stock y descontar, revisar el envío y anotarlo en Envíos para luego hacer la orden de
transporte», más stock y precios desde NÚCLEO hacia la tienda, y un plugin que se encuentre al buscar
«NÚCLEO ERP».

### Conexión

| Camino | Pasos |
|---|---|
| Con el plugin | WordPress → WooCommerce → **NÚCLEO ERP** → «Crear conexión». Muestra una sola vez un código (`nucleo-woo:…`) con la dirección y las llaves. Se pega en NÚCLEO → Configuración → Integraciones → WooCommerce |
| Sin el plugin | WooCommerce → Ajustes → Avanzado → API REST → «Añadir clave» (lectura y escritura). En NÚCLEO se escriben la dirección, la clave del cliente (`ck_…`) y la clave secreta (`cs_…`) |

Al conectar, NÚCLEO prueba las llaves contra la tienda y recién entonces las guarda (cifradas, en
`integrations`). La interfaz solo muestra los últimos caracteres de la llave. Requisitos de la tienda:
https y enlaces permanentes distintos de «Simple». El código y la clave secreta se escriben en campos de
contraseña: Claude no puede escribirlos.

### De la tienda a NÚCLEO («Sincronizar pedidos»)

| Dato del pedido | En NÚCLEO |
|---|---|
| Estado «Procesando» o «Completado» | Venta al contado efectuada (medio según el pago: transferencia, tarjeta u otro), referencia «Pedido de internet» con el n.º del pedido. Un pedido = una venta |
| Estado «En espera» o «Pendiente de pago» | No se registra (se cuenta como «esperando pago»); entra cuando se pague |
| Cancelado, reembolsado o fallido después de importado | Aviso «anula la venta»: NÚCLEO no anula solo |
| Líneas | Producto de NÚCLEO con el **mismo SKU**; cantidad; precio neto; descuento del cupón como % de la línea. Descuenta stock |
| Montos | Si la tienda calcula impuestos, sus líneas ya vienen netas. Si no (`total_tax` = 0), se tratan como IVA incluido y se llevan a neto con la tasa de la empresa |
| Envío cobrado y cargos | Línea «Envío <método>» y una línea por cargo |
| Facturación (nombre, empresa, dirección, comuna, correo) | Cliente: por RUT si viene; si no, por nombre. Se crea con su correo y dirección |
| Boleta o factura, RUT, razón social, giro (del plugin o de otros plugins de RUT) | Con factura y RUT válido: venta tipo factura «por facturar» con el receptor completo |
| Dirección de despacho y método de envío | **Envío «no despachado»** unido a la venta: destinatario, teléfono, correo, calle, depto, comuna, región, courier (si el método lo nombra), servicio, contenido y valor declarado. «Retiro en tienda» no crea envío |
| Nota del cliente, transacción | En las notas de la venta y del envío |

Lo que no calza (producto sin el mismo SKU, otra moneda, stock insuficiente con bloqueo) deja la venta
en **borrador por revisar** con el motivo; al corregirlo y sincronizar otra vez, la misma venta se
confirma. Con «Anotar en el pedido de la tienda…» activado, NÚCLEO escribe en el pedido el dato
`_nucleo_venta` con el número de la venta (el plugin lo muestra).

### De NÚCLEO a la tienda («Revisar stock», «Revisar precios»)

- Calza por SKU los productos simples y las variaciones. Muestra primero **qué cambiaría**; nada se
  envía hasta confirmar. El botón de envío es solo para la persona (`data-agent-human`).
- **Stock:** unidades disponibles = en bodega − reservado por despachar. Activa «gestionar inventario»
  en el producto de la tienda.
- **Precios:** el precio de lista de NÚCLEO es neto. Si la tienda no calcula impuestos o escribe sus
  precios con IVA incluido, se envía neto + IVA; si los escribe sin IVA, el neto. Si no se puede saber,
  los precios no se tocan.

### Plugin «NÚCLEO ERP para WooCommerce»

`integraciones/woocommerce/nucleo-erp` (GPL-2.0-or-later, requisito de WordPress.org). No envía datos a
ningún servidor. Trae: la conexión en un paso (crear, renovar, revocar), la ruta
`nucleo-erp/v1/status` (moneda, impuestos, versión; misma autenticación que WooCommerce), boleta o
factura en el checkout con RUT validado, razón social y giro (clásico y por bloques, apagado por
defecto) y la venta de NÚCLEO en una columna y un recuadro del pedido. Compatible con el almacenamiento
de pedidos de alto rendimiento.

| Paso | Estado |
|---|---|
| Código de NÚCLEO y pruebas con una tienda simulada | ✅ |
| Plugin 0.1.0 y pruebas con funciones de WordPress simuladas | ✅ |
| Prueba en un WordPress real (tienda de pruebas o copia de datalogger.cl) | ⏳ |
| Envío a revisión del directorio de WordPress.org (lo hace el dueño con su cuenta) | ⏳ |
| Enviar a la tienda el n.º de seguimiento cuando el envío se despacha | ⏳ |
| Productos de la tienda sin SKU: enlazarlos a mano, como en Mercado Libre | ⏳ |

## I3 · NÚCLEO en línea (cifrado de extremo a extremo)

Objetivo: entrar desde cualquier navegador con usuario y contraseña a la información de la empresa, sin
que NÚCLEO (FAVOR SpA) pueda leer los datos. **Desde el 23-11-2026 no es gratuito:** viene incluido en
el plan Facturación ($15.000 neto al mes) y en el plan Agente IA ($25.000 neto); el programa del
computador sigue gratis. La app del celular puede usar esta misma conexión si la empresa tiene un plan
(ver «Modelo de precios» en `ROADMAP.md`).

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
