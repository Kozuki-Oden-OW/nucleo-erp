# Receta: el día con el Navegador de NÚCLEO (SII y banco)

Para el agente de NÚCLEO. Todo ocurre en la ventana «Navegador NÚCLEO», no en el navegador de la
persona. Reglas en `docs/AGENTE_CLAUDE.md` («Gestor de contraseñas y Navegador de NÚCLEO») y
`docs/DECISIONS.md` (D-NAV-01…04).

**Regla estricta: todo se hace en el Navegador de NÚCLEO.** No se abre Chrome ni otro navegador para
ninguna parte de estas tareas. Si un paso no se puede hacer aquí, se le avisa a la persona.

## Antes de empezar (lo hace la persona, una vez al día)

- **SII**: abre el navegador (Configuración → Integraciones → Navegador → «Abrir navegador») y entra
  con su certificado digital. La sesión queda abierta en esa ventana.
- **Banco y otros sitios con clave**: «Autorizar por hoy» en el acceso guardado. Si falta, `web_ingresar`
  lo dice: avisar y esperar, no insistir.
- **Carpeta de descargas**: la de las facturas (por ejemplo `D:\Facturas`).

## 0. Entrar al SII (lo hace el agente; no preguntar)

La sesión del SII dura poco: si una página del SII devuelve «Error 501» o aparece «Identificación de
Contribuyentes», hay que entrar de nuevo. **No se le pide a la persona que entre: se pulsa el ingreso con
certificado.**

1. `web_abrir` con la página de ingreso seguida del destino:
   `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?<dirección a la que se quiere llegar>`
2. `web_clic` en «Ingresar con Certificado Digital». Entra con el certificado instalado en Windows y
   llega al destino. (Abrir directo `herculesr.sii.cl/…CAutInicio.cgi` NO sirve: queda en blanco.) Si
   Windows pide elegir certificado, ese clic es de la persona: avisar en una línea y volver a leer.
3. Si aparece «Selección de empresa»: elegir **DATA LOGGER CHILE SPA 77334963-0** en la lista
   (`web_escribir` sobre la lista) y `web_clic` en «Enviar».
4. La Clave Tributaria no se usa ni se guarda: nunca escribir en ese campo.

## 0.0 La ficha del cliente como la conoce el SII (antes de facturarle)

Cuando el cliente es nuevo o `ver_venta` / `crear_venta_borrador` avisan que al receptor le falta algo:

1. **Situación tributaria de terceros** (pública, sin clave): `web_abrir {direccion:
   "https://www2.sii.cl/stc/noauthz"}` → `web_escribir` el RUT con puntos y guion en el campo
   «12.345.678-9» → `web_clic` «Consultar Situación Tributaria». Entrega la razón social exacta, si
   tiene inicio de actividades y desde cuándo, y si es empresa de menor tamaño. `web_clic` en «VER
   ACTIVIDADES ECONÓMICAS VIGENTES» muestra el giro. No entrega dirección. Si dice que no tiene
   inicio de actividades o trae observaciones, avisar a la persona antes de facturar.
2. **Dirección y comuna**: las completa el formulario de factura al escribir el RUT del receptor
   (§0.1, paso 2); copiarlas de ahí.
3. **Ciudad**: el SII no la tiene. NÚCLEO la propone desde la comuna («Santiago» para las comunas del
   Gran Santiago; en el resto, la misma comuna).
4. Guardar todo con `actualizar_cliente {cliente: RUT, nombre, giro, direccion, comuna, ciudad}`. Si
   el cliente compra con orden de compra, `trabaja_con_oc: true` (NÚCLEO también lo aprende solo al
   guardar una venta con orden de compra).

## 0.1 Emitir una factura en el SII (probado el 26-11-2026 con la factura 536)

1. Con el resumen aprobado por la persona (receptor, líneas, forma de pago, total), abrir
   `https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=33&TIPO=4` (guía de despacho:
   `OPCION=52`). Si la venta ya está en NÚCLEO, `ver_venta` la entrega en el mismo orden del
   formulario: se copia campo por campo. Después de cada `web_escribir` llega solo lo que cambió; los
   números de los controles no cambian mientras la página sea la misma.
2. Receptor: RUT sin dígito en «Rut» y el dígito en el campo siguiente. El SII completa razón social,
   dirección, comuna y giro. «Ciudad» queda vacía: escribir la de la ficha de NÚCLEO (si falta, la
   validación no avanza y la página lo dice en un «Aviso de la página»). «Tipo de Compra» queda en
   «Del Giro» salvo que la venta diga otra cosa; «Contacto» y «Rut solicita» solo si la venta los trae.
3. Detalle: nombre, cantidad y precio neto de cada línea; «Agrega línea de Detalle» para las
   siguientes. Si la línea tiene descripción extendida en NÚCLEO, marcar la casilla «Descrip.» de esa
   línea y escribirla en el cuadro que aparece. El SII calcula subtotal, neto, IVA y total: comprobar
   que calzan con el resumen.
4. Forma de pago (Contado / Crédito / Sin Costo; el formulario parte en «Crédito»: elegir siempre la
   de la venta). Referencias: marcar la casilla «Referencias» y llenar una fila por cada una: «Tipo de
   documento» (Orden de Compra, Hoja Entrada Servicio, Guia despacho elec.…), «Folio Ref.», la fecha
   (día, mes y año en tres listas) y «Razón Referencia». Un cliente que trabaja con orden de compra
   no se factura sin ella: pedirla a la persona.
5. «Validar y visualizar» → vista previa («Revisión de documento») → «Firmar» → pantalla «Firma de
   documento tributario electrónico» (pide la clave del certificado; todavía no se emite nada).
6. **Firma**: con la clave de firma guardada en NÚCLEO (Configuración → Integraciones → Accesos),
   `web_firmar {venta: "FV-…"}`: NÚCLEO muestra a la persona un aviso con la venta, el cliente y el
   total; con su clic en «Firmar», NÚCLEO escribe la clave y firma. Sin clave guardada, la escribe
   la persona en la página y pulsa «Firmar». El agente no la escribe ni pulsa «Firmar» por su
   cuenta.
7. Emitida: abrir el PDF, `web_guardar {nombre: "factura-nueva.pdf"}` (devuelve el texto con el
   folio), renombrar a `NNN-DL.pdf` en la carpeta y registrar la venta en NÚCLEO
   (`crear_venta_borrador` con `documento: "factura"`, la forma de pago, las referencias y el
   `detalle` de cada línea → `confirmar_venta` → `documentar_venta`); si ya estaba pagada, cruzarla
   con el abono del banco.

## 0.2 Flujo completo de una factura (probado el 26-11-2026: facturas 536 y 537)

Orden exacto, sin preguntar entre pasos:

1. **Entrar al SII con el certificado digital** (§0): página de ingreso → «Ingresar con Certificado
   Digital». El certificado es el de Nicolás Mariangel (RUT 17.256.184-5). Si Windows pide elegirlo o
   pide su clave, eso lo resuelve NÚCLEO con la **clave del certificado digital** guardada (ver
   abajo); mientras no esté construido, lo hace la persona.
2. **Elegir la empresa**: DATA LOGGER CHILE SPA 77334963-0 → «Enviar».
3. **Llenar la factura** (§0.1): RUT y dígito del receptor, «Ciudad» si quedó vacía, líneas (nombre,
   cantidad, precio neto; «Agrega línea de Detalle»), forma de pago. Comprobar neto, IVA y total
   contra la cotización o el pedido.
4. «Validar y visualizar» → «Firmar» (en la vista previa) → pantalla de firma.
5. **Firma**: `web_firmar {venta: "FV-…"}` (extensión 0.12.0). NÚCLEO abre un aviso de la aplicación
   con la venta, el cliente y el total; la persona pulsa «Firmar» ahí y NÚCLEO escribe la **clave de
   firma de documentos** y pulsa «Firmar» en la página. Un clic por documento. Respuestas: «firmado»
   (leer la página y comprobar el folio), «rechazado» (no insistir: preguntar qué corregir) o
   «esperando» (el aviso sigue abierto: no llamar otra vez). Si la clave no está guardada, la
   escribe la persona en la página. El agente nunca la escribe.
6. **Guardar el PDF**: con el documento a la vista, `web_guardar {nombre: "factura-nueva.pdf"}`; leer
   el folio en el texto devuelto y renombrar a `NNN-DL.pdf` en la carpeta de facturas.
7. **Registrar en NÚCLEO de inmediato y descontar stock** (regla del dueño, 26-11-2026: apenas se
   emite la factura, sin preguntar): `crear_venta_borrador` (`documento: "factura"`, productos por
   SKU, fecha del documento, forma de pago y referencias iguales a las de la factura) → `confirmar_venta` → `documentar_venta` (folio, fecha, referencias). Comprobar después
   el stock de cada producto y avisar si alguno quedó en cero o negativo.
8. **Cruzar el pago**: si el abono ya está en la conciliación del banco, `conciliar_movimiento_banco`
   con «cobrar» contra esa venta; si no, queda por cobrar.
9. Informar: folio, total, archivo guardado, venta en NÚCLEO y estado del pago.

## 0.3 Al revés: la venta nace en NÚCLEO y se factura en el SII de inmediato

Cuando el dueño hace la venta en NÚCLEO y pide facturarla («factura la FV-000030»), o cuando una venta
efectuada aparece en `listar_ventas {vista: "pendientes_doc"}` y él confirma que va con factura:

1. Leer la venta en NÚCLEO con `ver_venta`: documento, receptor completo, líneas con su «Descrip.»,
   referencias y forma de pago, en el orden del formulario del SII. Esos son los datos de la factura:
   no se cambia nada. Si avisa que falta algo (ciudad, giro, orden de compra), completarlo primero
   (§0.0) o pedírselo a la persona.
2. Emitir en el SII con los pasos de §0.2 (1 a 5), comprobando que neto, IVA y total del SII sean los
   de la venta. Si no calzan, detenerse y avisar antes de firmar.
3. Guardar el PDF como `NNN-DL.pdf`.
4. **No crear otra venta**: `documentar_venta` sobre la que ya existe, con el folio y la fecha. El
   stock ya se descontó cuando la venta se efectuó; si todavía está en borrador, confirmarla primero
   (`confirmar_venta`) y luego documentarla.
5. Cruzar el pago si ya llegó e informar.

En los dos sentidos la regla es la misma: una factura del SII y una venta de NÚCLEO, enlazadas por el
folio, sin duplicar ninguna.

### La clave que guarda NÚCLEO para este flujo (construido el 27-11-2026, D-NAV-08)

- **Entrar al SII** no usa ninguna clave guardada: se pulsa «Ingresar con Certificado Digital» y el
  certificado instalado en el computador hace el resto.
- **Clave de firma de documentos**: la del certificado centralizado que el SII pide en «Firma de
  documento tributario electrónico». La persona la escribe una vez en Configuración → Integraciones
  → Accesos, bloque «Clave de firma de documentos (SII)»; queda cifrada y no se muestra. NÚCLEO la
  usa solo en la página de firma del SII y con la aprobación de la persona para cada documento (un
  aviso de la aplicación con la venta y el total), porque emitir no se puede deshacer. Nunca se
  envía por chat y el agente no la ve.

## 1. Documentos emitidos en el SII

1. `web_abrir {direccion: "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi"}`. Si aparece
   el ingreso del SII, pedir a la persona que entre con su certificado y volver a leer.
2. `web_leer`: cada fila trae RUT, razón social, tipo, folio, fecha, monto y estado. La lista muestra
   100 documentos por página; lo nuevo está arriba.
3. Comparar con NÚCLEO (`listar_ventas`) y con lo ya guardado en la carpeta. Nombres de archivo:
   factura `536-DL.pdf`, guía `GD-36-DL.pdf`, nota de crédito `NC-24-DL.pdf`.
4. Por cada documento que falte: `web_clic` en el enlace «ver» de su fila → `web_guardar {nombre}`
   (guarda el PDF que la página muestra y devuelve su texto: cliente, ítems, series, referencias,
   totales) → `web_clic {volver: true}`.
5. Con ese texto, anotar en NÚCLEO:
   - Documento con fecha desde el 20-11-2026: venta real (`crear_venta_borrador` con producto por SKU
     → `confirmar_venta` → `documentar_venta`), descuenta stock.
   - Factura de una mercadería que salió antes con guía: no descuenta stock dos veces; referencia a la
     guía.
   - Nota de crédito que anula una factura: anular esa venta en NÚCLEO con el folio y la fecha de la
     nota como motivo, y pasar el pago a la factura que la reemplaza.
6. En la página «Documento emitido» **nunca** pulsar «Generar Nota de Crédito…», «Nota de Débito»,
   «Copiar Documento» ni «Cesión Electrónica».

## 2. Cartola del banco (BCI Pyme)

1. `web_ingresar {acceso: "BCI Pyme"}`. Si el banco pide un código o segunda clave, lo resuelve la
   persona en la ventana.
2. Inicio → «Mis Movimientos»; abrir «Filas por página» y elegir 100.
3. `web_leer`: los movimientos vienen en el texto del marco. Comprobar la cadena de saldos (saldo
   anterior ± monto = saldo de la fila) antes de registrar.
4. `registrar_movimientos_banco` → `conciliacion_banco` → mostrar a la persona cada propuesta y
   `conciliar_movimiento_banco` con su «sí» (detalle en `docs/recetas/cobranza-y-banco.md`).
5. En el banco no se pulsa «Transferir», «Pagar» ni nada que mueva dinero o cambie datos.

## 3. Entrar a Blue Express (probado el 26-11-2026)

1. `web_abrir {direccion: "https://app.bluex.cl/dashboard"}`. Si la sesión sigue abierta, muestra
   «Hola Nicolas!». Si queda en blanco, la sesión venció.
2. Sesión vencida: `web_abrir {acceso: "Bluexpress"}` (página de ingreso) → `web_clic` en el botón de
   ingreso con correo («ui_login_email») → `web_ingresar {acceso: "Bluexpress"}`. No usar «Iniciar
   sesión con Google».
3. Comprar un envío sigue la receta `bluexpress-envio-unitario.md`: llenar y detenerse antes de
   «Pagar»; el pago lo aprueba y lo hace el dueño por cada envío.

## Si algo no sale

- «no está entre los sitios permitidos» o «Bloqueado: la página quiso ir a…»: la persona agrega ese
  dominio en Configuración → Integraciones → Navegador. No buscar otro camino.
- «La página todavía no termina de cargar»: esperar y `web_leer` otra vez.
- «El sitio devolvió una página y no un archivo»: la sesión venció; pedir a la persona que entre.
- `web_guardar` no trae texto del PDF: el archivo quedó guardado igual; leerlo con otra herramienta o
  pedir los datos a la persona.
- Los números de los controles (`w12`) cambian en cada lectura: leer antes de cada clic.
