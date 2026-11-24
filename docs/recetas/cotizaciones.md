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

## Pasos

1. Cliente: buscarlo por RUT o nombre; si no existe, crearlo con RUT, razón social, giro, dirección y
   correo (pedir lo que falte: es lo mismo que se pide por WhatsApp o correo antes de cotizar).
2. Vender → Cotizaciones → «Nueva cotización»: cliente, validez (15 días si no se dice otra cosa) y las
   líneas con el producto de NÚCLEO (precio neto de lista; descuento solo si el dueño lo indicó).
3. Guardar y revisar el total con la persona cuando el monto o el descuento se salgan de lo habitual.
4. «Emitir documento (PDF)»: plantilla del negocio, condiciones (plazo de entrega, garantía, forma de
   pago). El PDF queda en la carpeta con el nombre «COT-NNNN Cliente.pdf».
5. Envío al cliente: el agente **no envía**; deja el borrador de respuesta (correo o WhatsApp) con el
   PDF indicado y la persona lo manda.

## Qué lleva el documento

- Datos de transferencia del negocio (Configuración → Cotizaciones). El número de cuenta lo escribe el
  dueño: el agente no escribe números de cuenta bancaria.
- Botón «Pagar con tarjeta (Webpay)» con el enlace de pago del comercio, para quien prefiera tarjeta.
- Logo: Configuración → Cotizaciones → «Subir logo» (lo elige el dueño; PNG, JPG o WebP).

## Lo que no hace el agente

- No envía la cotización ni responde al cliente sin el «sí» de la persona.
- No cambia precios de lista ni inventa descuentos.
- No borra archivos de la carpeta.
