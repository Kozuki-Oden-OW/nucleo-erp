# NÚCLEO ERP — Diseño: botón «Conectar», sincronización y app móvil

> Estado: **diseño aprobado para planificar** (2026-10-10). Se implementa después del MVP de escritorio
> (fase S, ver `ROADMAP.md`). Pedido del dueño del proyecto: «un botón de conectar a internet o
> sincronizar con la app; una manera de ganar dinero sería cobrar $1.000 por la app a quien quiera
> usarla desde el celular, y deben sincronizarse mutuamente».

## 1. Qué se quiere lograr

- El programa de escritorio sigue siendo **gratis, de código abierto y local**: funciona completo sin
  internet y sin cuenta.
- Quien quiera, aprieta **«Conectar»** y empareja su celular. Desde la app ve el negocio (ventas del
  día, dinero por cobrar, stock, clientes) y registra cosas en terreno (una venta rápida, un gasto con
  la foto de la boleta, un cobro). Lo que se hace en un lado aparece en el otro.
- La **app cuesta $1.000 al mes** (suscripción en Google Play y App Store). Es la fuente de ingresos del
  proyecto y paga el servidor de sincronización.
- **Privacidad intacta:** «Tu empresa. Tus datos. Tu computador.» El servidor de NÚCLEO no puede leer
  nada: solo guarda y reenvía paquetes cifrados que únicamente abren los dispositivos del negocio.

## 2. Cómo se ve para la persona

1. En el escritorio, **Configuración → Celular y sincronización → Conectar un celular**. El botón está
   apagado por defecto; mientras esté apagado, el programa no abre ninguna conexión.
2. El escritorio muestra un **código QR** (válido 10 minutos). La app lo escanea y queda emparejada. No
   se pide correo ni contraseña.
3. Un indicador en la barra superior dice el estado: *Sin conexión* · *Sincronizado hace 2 min* ·
   *3 cambios por enviar*. Un clic muestra qué se envió y cuándo.
4. Para quitar un celular perdido: **Dispositivos → Quitar**. Ese celular deja de recibir datos y la
   llave del negocio se rota.
5. Si la suscripción vence, la app queda en **solo lectura de lo último sincronizado**; el escritorio no
   pierde nada.

## 3. Arquitectura

```
 Escritorio (Tauri)                     Servidor NÚCLEO Sync                   App móvil (Tauri 2 móvil)
 SQLCipher + registro de cambios  ⇄  relé ciego: buzones cifrados,  ⇄  SQLCipher + registro de cambios
 autoridad de numeración              verificación de suscripción         borradores y consultas
        ⇅ (misma red WiFi, sin servidor: descubrimiento local + TLS con llave fijada)
```

- **Misma base de código:** la app móvil es la misma interfaz React y el mismo núcleo Rust compilados
  con Tauri 2 para Android e iOS. Los cálculos (`nucleo-domain`) y las reglas no se duplican.
- **Registro de cambios (op-log):** cada tabla sincronizable escribe una fila en `change_log` en la
  misma transacción (entidad, id estable `uid`, campos cambiados, reloj lógico híbrido y dispositivo).
  Ya existe la base: todas las entidades tienen `uid` y la auditoría encadenada registra cada cambio.
- **Dos transportes:**
  1. **Red local (gratis):** si el celular y el computador están en la misma red, se sincronizan
     directo, sin pasar por internet.
  2. **NÚCLEO Sync por internet (pagado):** buzones de almacenar y reenviar. El servidor guarda
     paquetes cifrados por 30 días o hasta que todos los dispositivos los confirman.

## 4. Seguridad y privacidad

| Elemento | Diseño |
|---|---|
| Llave del negocio | Simétrica (XChaCha20-Poly1305), generada en el escritorio; nunca sale sin cifrar |
| Emparejamiento | El QR lleva un secreto de un solo uso y la llave pública del escritorio; intercambio X25519 y la llave del negocio viaja cifrada al celular |
| Qué ve el servidor | Identificador anónimo del espacio, identificadores de dispositivos, tamaños y horas de los paquetes. Nunca montos, nombres, RUT ni productos |
| Cuenta | No hay correo ni contraseña. La suscripción se valida con el recibo de la tienda, asociado al identificador anónimo |
| Revocación | Quitar un dispositivo rota la llave; los paquetes nuevos ya no los puede abrir |
| Respaldos | Siguen siendo locales (`.erpbackup`); el servidor no es un respaldo |
| Ley de datos personales | Minimización: el servidor no trata datos personales de clientes del negocio porque no puede leerlos (Ley 19.628 y Ley 21.719) |
| Código | El servidor también es AGPL: cualquiera puede revisarlo o montar su propio relé |

## 5. Reglas de sincronización (sin conflictos sorpresa)

- **El escritorio es la autoridad** de lo que tiene efecto legal o numeración: folios internos (VEN,
  COM, GAS…), estados de documentos, liquidaciones emitidas, F29 y F22. El celular crea **borradores o
  solicitudes** (venta rápida, gasto, cobro) que el escritorio confirma y numera al recibirlos.
- **Fichas (clientes, proveedores, productos):** se fusionan campo por campo; si dos dispositivos cambian
  el mismo campo, gana el cambio más reciente según el reloj lógico híbrido y queda en la auditoría.
- **Movimientos (pagos, stock, gastos):** solo se agregan, nunca se sobrescriben; anular es otro
  movimiento. El stock se recalcula desde los movimientos, por lo que no se pisa.
- **Lo que el celular recibe:** vistas de lectura (resumen del día, por cobrar y por pagar, stock,
  clientes y productos) más los borradores que él mismo creó. No recibe la contabilidad completa ni
  remuneraciones salvo que el dueño lo active por dispositivo (permisos por dispositivo).
- **Sin conexión:** ambos lados trabajan normal y los cambios esperan en cola.

## 6. Modelo de cobro

| | Escritorio | App móvil |
|---|---|---|
| Precio | Gratis (AGPL) | $1.000 al mes con IVA incluido, por negocio (no por dispositivo) |
| Cobro | — | Suscripción de Google Play y App Store (ellos cobran, emiten la boleta al consumidor y entregan el recibo) |
| Ingreso neto estimado | — | Del precio se descuenta el IVA y la comisión de la tienda (15 % en los programas para desarrolladores pequeños, por verificar): quedan cerca de $700 por negocio al mes |
| Costo del servidor | — | Muy bajo: guarda paquetes cifrados pequeños por pocos días |
| Prueba | — | 30 días gratis; la sincronización por red local podría quedar gratis siempre |

- **Licencia en iOS:** la App Store no es compatible con la AGPL si el código tiene aportes de terceros.
  Como el titular de los derechos del código puede publicar la app iOS con una licencia propia (doble licencia), conviene conservar esa titularidad.
  Para mantener esa posibilidad, **todo aporte externo debe firmar un acuerdo de contribución (CLA)**.
- Facturación a empresas que quieran factura (no boleta): fuera de la tienda, vía web, en una fase
  posterior.

## 7. Fases

| Fase | Entrega | Criterio de salida |
|---|---|---|
| S0 | `change_log` con reloj lógico híbrido en todas las tablas sincronizables; exportar e importar cambios a un archivo | Dos escritorios quedan iguales intercambiando archivos, con pruebas de conflictos |
| S1 | Sincronización por red local escritorio ⇄ escritorio | Dos computadores del mismo negocio sincronizan sin internet |
| S2 | Emparejamiento por QR, cifrado de extremo a extremo y relé NÚCLEO Sync | Prueba de seguridad: el servidor no puede leer ningún paquete |
| S3 | App móvil (Android primero): resumen, stock, clientes, venta rápida, gasto con foto, cobro | Cinco pymes la usan una semana sin perder datos |
| S4 | Suscripción en las tiendas, prueba de 30 días, gestión de dispositivos | Cobro de $1.000 funcionando en Google Play y luego App Store |

## 8. Riesgos y decisiones pendientes

1. **Conflictos de inventario** cuando se vende el mismo producto en dos lados sin conexión: se acepta
   stock negativo con aviso (ya existe la opción) y el escritorio concilia.
2. **Revisión de las tiendas:** Apple exige su sistema de pagos para suscripciones digitales; precio
   mínimo y tramos de precio en pesos chilenos por confirmar ($1.000 debe existir como tramo).
3. **Soporte:** sin cuenta no hay «recuperar contraseña»: si se pierden todos los dispositivos y el
   respaldo, no hay forma de recuperar los datos (igual que hoy, es la promesa de privacidad).
4. **Pregunta para el dueño:** ¿la sincronización entre dos computadores del mismo negocio también es
   de pago, o solo la app móvil? Propuesta: red local gratis; internet incluido en la suscripción.
