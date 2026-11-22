# NÚCLEO ERP — Integraciones: Mercado Libre, Bluexpress y NÚCLEO en línea

> Estado: **diseño aprobado el 2026-11-21** (decisiones del dueño: versión en línea **cifrada**, cuenta
> empresa en Bluexpress, Mercado Libre trae **venta y stock, por facturar y pagos**; orden de trabajo
> 1 → 2 → 3). Mercado Libre (I1) en construcción.

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

## I2 · Bluexpress (órdenes de transporte desde Envíos)

Objetivo: en **Envíos**, un botón «Crear orden de transporte en Bluexpress» que cotiza, emite la OT,
guarda el n.º de seguimiento y la etiqueta (PDF) en el envío, y actualiza el estado con el tracking.

Bluexpress no publica la documentación de su API. Con la cuenta empresa hay que pedir al ejecutivo:

1. Documentación de la API de emisión de OT (o la que usan sus integraciones con WooCommerce/Shopify).
2. Credenciales de producción y de pruebas: llave de API / token, código de cliente (cuenta corriente) y
   código de usuario.
3. Servicios contratados (express, prioritario, Punto Blue), dimensiones y pesos máximos.
4. Endpoints de: cotización, emisión de OT, etiqueta, seguimiento y retiro.

Con eso se agrega `nucleo-app::carrier_ops` con un adaptador por courier (Bluexpress primero; el mismo
diseño sirve para Starken, Chilexpress o un integrador como Enviame) y los campos del envío: servicio,
peso, medidas, valor declarado, OT, etiqueta adjunta y último estado.

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
