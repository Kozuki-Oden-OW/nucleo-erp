# Receta del agente: hacer una cotización

Levantada el 2026-11-24 con Data Logger. Ver D-COT-01, D-COT-02 y D-COT-03 en docs/DECISIONS.md.

## Antes de cotizar: la numeración

Regla del dueño: **cada cotización sigue el correlativo de la carpeta de cotizaciones**
(`D:\Datalogger spa\Cotizaciones`, archivos `COT-1001.pdf` … `COT-1523.pdf` al 24-11-2026; la serie tiene
saltos y eso está bien: se continúa después del número más alto, no se rellenan huecos).

- Desde la versión con D-COT-02, NÚCLEO lo hace solo al crear la cotización: mira la carpeta y continúa
  después del número más alto. Configuración → Cotizaciones muestra «La próxima cotización será la …».
- Aun así, el agente lo comprueba antes de crear: lista la carpeta, toma el número más alto y confirma
  que coincide con lo que muestra NÚCLEO. Si NÚCLEO va atrás (versión antigua o casilla desmarcada), se
  corrige en Configuración → Numeración → Cotización («Próximo número») antes de crear.
- La numeración de NÚCLEO quedó en prefijo `COT`, 4 dígitos (`COT-1524`), igual que la serie del dueño.
- Nunca se reutiliza un número ni se emite sobre un archivo de otra cotización.

## Precios: siempre netos

Regla del dueño (24-11-2026): **las cotizaciones deben salir con el precio correcto**. Ese día los 17
productos tenían el precio con IVA guardado como neto y la cotización sumaba el IVA dos veces; se
corrigieron contra la lista de precios de Data Logger.

- En NÚCLEO el precio de lista es **neto**; el IVA lo agrega el documento. La lista del dueño trae las
  dos columnas («Precio NETO» y «Con IVA»): se copia la neta, o se escribe el valor con IVA en el campo
  «Precio de venta (Con IVA)» de la ficha, que calcula el neto solo.
- Antes de emitir, el agente comprueba cada línea: precio unitario × (1 + IVA) debe dar el «Con IVA» de
  la lista (RC-5+ con sonda: neto $23.445 → $27.900). Si no calza, se detiene y avisa; no emite.
- El envío es un servicio aparte: «Envio» $5.000 neto.
- Un producto que no está en NÚCLEO no se inventa: se pide el precio al dueño y se crea con su neto.

## Pasos (todo con herramientas de NÚCLEO, extensión 0.8.7)

1. Cliente: `buscar_clientes` por RUT o nombre. Si no existe, `crear_cliente` con RUT, razón social,
   giro, dirección y correo (pedir lo que falte); si solo está consultando, se cotiza como `prospecto`.
2. `crear_cotizacion` con el cliente y las líneas (producto por SKU o nombre; sin `precio_neto` usa el
   de lista; validez 15 días salvo que se diga otra cosa). La respuesta trae cada línea en neto y con
   IVA y una lista «para revisar con la persona»: precios distintos de la lista, descuentos y líneas
   escritas a mano. Si aparece algo en esa lista que el dueño no pidió, se detiene y pregunta.
3. `emitir_cotizacion`: crea el PDF «COT-NNNN Cliente.pdf» en la carpeta, con la plantilla, el logo, los
   colores, los datos de transferencia y el botón de pago. Se puede repetir.
4. Envío: `enviar_correo` con `cotizaciones: ["COT-NNNN"]` adjunta el PDF y deja la cotización como
   enviada. Solo cuando el dueño pidió enviar ese correo a ese destinatario; si el texto lo redactó el
   agente, se lo muestra antes. Requiere el permiso «Permitir que Claude envíe los correos que le
   pidas» (Configuración → Integraciones → Correo); sin él, el agente entrega el texto y el dueño envía.
5. `correos_enviados` muestra el registro (qué salió, a quién y con qué cotización).

## Qué lleva el documento

- Datos de transferencia del negocio (Configuración → Cotizaciones). El número de cuenta lo escribe el
  dueño: el agente no escribe números de cuenta bancaria.
- Botón «Pagar con tarjeta (Webpay)» con el enlace de pago del comercio, para quien prefiera tarjeta.
- Logo: Configuración → Cotizaciones → «Subir logo» (lo elige el dueño; PNG, JPG o WebP).

## Lo que no hace el agente

- No envía la cotización ni responde al cliente sin que la persona lo haya pedido para ese destinatario.
- No cambia precios de lista ni inventa descuentos.
- No borra archivos de la carpeta.
