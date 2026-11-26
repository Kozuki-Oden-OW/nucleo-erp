# Receta: el día con el Navegador de NÚCLEO (SII y banco)

Para el agente de NÚCLEO. Todo ocurre en la ventana «Navegador NÚCLEO», no en el navegador de la
persona. Reglas en `docs/AGENTE_CLAUDE.md` («Gestor de contraseñas y Navegador de NÚCLEO») y
`docs/DECISIONS.md` (D-NAV-01…04).

## Antes de empezar (lo hace la persona, una vez al día)

- **SII**: abre el navegador (Configuración → Integraciones → Navegador → «Abrir navegador») y entra
  con su certificado digital. La sesión queda abierta en esa ventana.
- **Banco y otros sitios con clave**: «Autorizar por hoy» en el acceso guardado. Si falta, `web_ingresar`
  lo dice: avisar y esperar, no insistir.
- **Carpeta de descargas**: la de las facturas (por ejemplo `D:\Facturas`).

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

## Si algo no sale

- «no está entre los sitios permitidos» o «Bloqueado: la página quiso ir a…»: la persona agrega ese
  dominio en Configuración → Integraciones → Navegador. No buscar otro camino.
- «La página todavía no termina de cargar»: esperar y `web_leer` otra vez.
- «El sitio devolvió una página y no un archivo»: la sesión venció; pedir a la persona que entre.
- `web_guardar` no trae texto del PDF: el archivo quedó guardado igual; leerlo con otra herramienta o
  pedir los datos a la persona.
- Los números de los controles (`w12`) cambian en cada lectura: leer antes de cada clic.
