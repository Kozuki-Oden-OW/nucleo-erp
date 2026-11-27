# Receta: boleta electrónica en el SII (e-Boleta) con el Navegador de NÚCLEO

Para el agente de NÚCLEO. Flujo pedido por el dueño el 26-11-2026. e-Boleta (`https://eboleta.sii.cl/`)
no entra con certificado digital: solo con **RUT y Clave Tributaria**.

## Una vez (lo hace la persona)

1. Configuración → Integraciones → Accesos → «Agregar acceso» → botón **«SII e-Boleta (RUT y clave)»**:
   deja el sitio y la dirección `https://eboleta.sii.cl/`. Escribe su RUT y su Clave Tributaria y marca
   «Entiendo que es mi Clave Tributaria y autorizo a NÚCLEO a usarla solo para e-Boleta».
2. Cada día que se vayan a hacer boletas: Navegador → «Autorizar por hoy» en ese acceso.

Límites que pone NÚCLEO (no dependen del agente): del SII solo se guarda este acceso; la clave se
escribe **únicamente en `eboleta.sii.cl`**, nunca en `zeusr.sii.cl`, Mi SII ni otro servidor del SII;
sin el permiso del día no se usa; el agente no la ve ni la escribe.

## Pasos

1. **Entrar**: `web_ingresar {acceso: "SII e-Boleta"}`. NÚCLEO abre la página, rellena RUT y clave y
   entra. Si falta el permiso del día, lo dice: avisar en una línea y esperar. Si el SII pide elegir
   empresa, elegir DATA LOGGER CHILE SPA.
2. **Datos de la venta**: `ver_venta` entrega el bloque «PARA LA e-BOLETA DEL SII» con el monto (total
   con IVA), el tipo, el método de pago, el detalle y el receptor. Si la venta todavía no existe en
   NÚCLEO, crearla primero con `crear_venta_borrador {documento: "boleta", …}`.
3. **Monto**: escribir el total con IVA (sin puntos) y continuar al formulario «Emitir e-Boleta».
4. **Llenar todo lo que se pueda**, en este orden:
   - Sucursal: la que viene (GUARDIA VIEJA 202, Providencia).
   - Tipo: «Boleta afecta» (o exenta si la venta no lleva IVA).
   - «Elija método de pago»: el de la venta (efectivo, débito, crédito, transferencia…).
   - **Receptor** (interruptor): encenderlo cuando la venta tiene cliente y llenar «RUT con DV
     receptor», «Nombre receptor», «Dirección receptor», «E-mail receptor» y «Teléfono receptor» con
     lo que haya en la ficha. Sin cliente, se deja apagado.
   - **Detalle** (interruptor encendido; el campo es obligatorio y admite 80 caracteres): productos y
     cantidades vendidas, como **`7 X RC-5+, 8 X RC-51H`**. `ver_venta` lo entrega ya armado y
     recortado a 80.
   - Vendedor: el que viene.
5. **Antes de «EMITIR»**: mostrar a la persona monto, detalle, método de pago y receptor, y esperar su
   «sí» para esa boleta. Emitir no se puede deshacer.
6. Emitida: leer el folio, guardar el PDF si la página lo ofrece (`web_guardar`, nombre
   `BOL-NNN-DL.pdf`) y `documentar_venta {tipo_documento: "Boleta electrónica", folio, fecha}` sobre
   la venta. Si la venta estaba en borrador, `confirmar_venta` primero: descuenta stock.

## Notas

- Los desplegables e interruptores de e-Boleta no son listas ni casillas estándar: aparecen como
  botones. Se abren con `web_clic` y la opción se elige con otro `web_clic` sobre su texto.
- Si la página muestra «Detalle debe definirse», el campo quedó vacío: escribirlo de nuevo.
- Primera vez: recorrer el formulario completo y anotar aquí las opciones reales de «método de pago» y
  cualquier paso que difiera.
