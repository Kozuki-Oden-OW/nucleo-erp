# NÚCLEO ERP — Diseño: app móvil y sincronización por cable o WiFi

> Estado: **en construcción** (diseño aprobado el 2026-10-10). S0 terminado el 2026-10-24: registro de
> cambios con reloj lógico híbrido, paquete de sincronización y fusión probados en
> `crates/nucleo-app/tests/sincronizacion.rs`. Las pantallas de la app (S2) ya funcionan en modo
> demostración (`apps/desktop/movil.html`); falta empaquetarlas para Android y el transporte (S1).
>
> Decisiones del dueño: «solo cobramos a la persona que quiera obtener la app en su celular; que también
> funcione sin internet y luego se sincronice a través de un cable con el PC o por WiFi de la misma
> red».

## 1. Qué se quiere lograr

- El programa de escritorio sigue **gratis, de código abierto y local**, sin cuenta y sin internet.
- Quien quiera, compra la **app de NÚCLEO para el celular por $1.000** (pago único en Google Play o
  App Store). Es la fuente de ingresos del proyecto.
- La app **funciona sin conexión**: guarda sus datos cifrados en el celular y se puede usar en terreno
  (ver el resumen del negocio, stock, clientes; registrar una venta rápida, un gasto con la foto de la
  boleta o un cobro).
- Celular y computador se **sincronizan entre ellos, sin pasar por internet**:
  1. **por cable USB**, o
  2. **por WiFi**, cuando ambos están en la misma red.
- **No hay servidor de NÚCLEO** que guarde o reenvíe datos: no existe un tercero que pueda verlos, ni
  costo mensual que cobrar. «Tu empresa. Tus datos. Tu computador» se cumple al pie de la letra.

## 2. Cómo se ve para la persona

1. En el escritorio: **Configuración → Celular → Emparejar un celular**. El escritorio muestra un
   código QR (válido 10 minutos). La app lo escanea y quedan emparejados. Sin correo ni contraseña.
2. Para sincronizar, la persona elige en el escritorio **«Sincronizar ahora»** (o lo deja automático
   mientras el celular esté conectado):
   - **Con cable:** conecta el celular al computador. NÚCLEO lo detecta y sincroniza.
   - **Por WiFi:** con ambos en la misma red, la app aparece en el escritorio y sincroniza.
3. Un indicador muestra: *Celular sin sincronizar desde ayer* · *Sincronizado hace 2 min* · *3 cambios
   del celular por revisar*.
4. Si el celular se pierde: **Dispositivos → Quitar**. Ese celular deja de sincronizar y la llave del
   negocio se cambia. Los datos del celular perdido siguen cifrados.
5. El escritorio nunca abre conexiones hacia internet para esto; solo escucha en la red local o en el
   cable mientras la sincronización está activada.

## 3. Arquitectura

```
 Escritorio (Tauri, Windows)                               App móvil (Tauri 2: Android e iOS)
 SQLCipher + registro de cambios   ⇄  cable USB o WiFi local  ⇄   SQLCipher + registro de cambios
 autoridad de numeración y documentos    (TLS con llaves fijadas al emparejar)     borradores y consultas
```

- **Misma base de código:** la app es la misma interfaz React y el mismo núcleo Rust compilados con
  Tauri 2 para Android e iOS. Los cálculos (`nucleo-domain`) y las reglas no se duplican.
- **Registro de cambios (op-log):** cada tabla sincronizable escribe una fila en `change_log` en la
  misma transacción (entidad, `uid` estable, campos cambiados, reloj lógico híbrido y dispositivo).
  Todas las entidades ya tienen `uid` y la auditoría encadenada registra cada cambio.
- **Un solo protocolo sobre dos caminos:** el escritorio y la app conversan por TCP con TLS mutuo
  (cada lado conoce la llave del otro desde el emparejamiento). El camino cambia, el protocolo no:

| Camino | Android | iPhone |
|---|---|---|
| **WiFi (misma red)** | Descubrimiento local (mDNS) y conexión directa | Igual (iOS pide permiso de «red local» la primera vez) |
| **Cable USB** | «Anclaje de USB» del celular, que crea una red privada entre el cable y el PC; si el celular no lo permite, el protocolo de accesorios de Android (AOA) | El servicio de Apple para dispositivos conectados por cable (el mismo que usa «Dispositivos Apple» o iTunes en Windows), que permite conectar a un puerto de la app por el cable |

## 4. Seguridad y privacidad

| Elemento | Diseño |
|---|---|
| Llave del negocio | Simétrica (XChaCha20-Poly1305), generada en el escritorio |
| Emparejamiento | El QR lleva un secreto de un solo uso y la llave pública del escritorio; intercambio X25519; la llave del negocio viaja cifrada al celular |
| Conexión | TLS mutuo con llaves fijadas: un tercero en la misma WiFi no puede leer ni hacerse pasar por el celular o el computador |
| Datos en el celular | Base cifrada (SQLCipher) con la llave guardada en el almacén seguro del sistema (Keystore de Android, Keychain de iOS) |
| Internet | No se usa para sincronizar. Solo la tienda necesita internet al comprar la app |
| Revocación | Quitar un dispositivo cambia la llave y el escritorio deja de aceptarlo |
| Respaldos | Siguen siendo los `.erpbackup` locales del escritorio |
| Datos personales | NÚCLEO (el proveedor) no recibe ningún dato del negocio |

## 5. Reglas de sincronización (sin conflictos sorpresa)

- **El escritorio es la autoridad** de lo que tiene efecto legal o numeración: folios internos (VEN,
  COM, GAS…), estados de documentos, liquidaciones emitidas, F29 y F22. El celular crea **borradores o
  solicitudes** (venta rápida, gasto, cobro) que el escritorio confirma y numera al recibirlos.
- **Fichas (clientes, proveedores, productos):** se fusionan campo por campo; si dos lados cambian el
  mismo campo, gana el cambio más reciente según el reloj lógico híbrido y queda en la auditoría.
- **Movimientos (pagos, stock, gastos):** solo se agregan; anular es otro movimiento. El stock se
  recalcula desde los movimientos.
- **Qué recibe el celular:** resumen del negocio, por cobrar y por pagar, stock, clientes y productos,
  más sus propios borradores. Contabilidad, impuestos y remuneraciones solo si el dueño lo autoriza
  para ese dispositivo.
- **Sin conexión por días:** ambos lados trabajan normal; los cambios esperan en cola hasta el próximo
  cable o WiFi.
- **La misma ficha creada en los dos lados** (mismo RUT, mismo SKU o categoría con el mismo nombre) no
  se duplica: el escritorio conserva su identificador y anota el del celular como alias; el celular
  adopta el identificador del escritorio. Si los datos difieren, queda un aviso informativo.
- **Las solicitudes del celular** (venta rápida, gasto, cobro) viajan como operaciones con
  identificador propio: el escritorio las aplica una sola vez aunque el paquete llegue repetido, y
  confirma cuáles recibió para que el celular las saque de su cola.

### Cómo está hecho (S0)

- **Migración 33** (`0033_sincronizacion.sql`): `sync_state` (identificador del dispositivo, rol y
  reloj), `change_log` (un registro por campo cambiado), `sync_peers`, `sync_outbox`, `sync_applied`,
  `sync_aliases` y `sync_conflicts`. Disparadores en categorías, clientes, proveedores y productos
  anotan cada cambio con su reloj; las referencias viajan por identificador (`category_uid`,
  `parent_uid`), nunca por id interno.
- **Reloj lógico híbrido** como texto ordenable `MMMMMMMMMMMMM-CCCCC-dispositivo` (milisegundos,
  contador y desempate por dispositivo).
- **Paquete** (`nucleo-app::sync_ops::SyncPackage`, JSON, formato 1): cambios desde lo último que el
  otro lado confirmó, operaciones pendientes y los acuses de lo recibido. Solo se aceptan paquetes de
  dispositivos emparejados y dirigidos a este dispositivo.
- **Aplicar** es idempotente: un cambio se ignora si el campo ya tiene ese valor o uno más reciente; las
  violaciones de restricciones quedan en `sync_conflicts` sin detener el resto.

## 6. Modelo de cobro

| | Escritorio | App móvil |
|---|---|---|
| Precio | Gratis (AGPL) | **$1.000 pago único**, con IVA incluido, en Google Play y App Store |
| Quién paga | — | Solo quien quiera la app en su celular. La sincronización por cable o WiFi está incluida |
| Cobro y boleta | — | Los hace la tienda; FAVOR SpA recibe el pago neto de comisión |
| Ingreso neto estimado | — | Del precio se descuenta el IVA y la comisión de la tienda (15 % en los programas para desarrolladores pequeños, por verificar): cerca de $700 por compra |
| Costo de operación | — | Prácticamente cero: no hay servidor |
| Licencia de la compra | — | Se valida dentro del celular con la firma de la tienda (Google Play y StoreKit 2 entregan compras firmadas verificables sin conexión) |

- Más adelante se puede evaluar una versión «Pro» o funciones adicionales, pero el pago único cubre la
  app y la sincronización.
- **Licencia en iOS:** la App Store no es compatible con la AGPL cuando el código tiene aportes de
  terceros. Por eso FAVOR SpA, titular del proyecto, recibe los aportes externos bajo el
  [Acuerdo de Contribución](../CLA.md), que le permite publicar la app con licencia propia
  (doble licencia) mientras la versión de escritorio sigue libre.

## 7. Fases

| Fase | Entrega | Criterio de salida |
|---|---|---|
| S0 | `change_log` con reloj lógico híbrido en las tablas sincronizables; exportar e importar cambios a un archivo | Dos bases quedan iguales intercambiando archivos, con pruebas de conflictos |
| S1 | Protocolo de sincronización con TLS mutuo y emparejamiento por QR, probado entre dos escritorios en la misma red | Dos computadores sincronizan sin internet; un tercero en la red no puede leer ni inyectar datos |
| S2 | App Android: datos sin conexión, resumen, stock, clientes, venta rápida, gasto con foto, cobro; sincronización por WiFi y por cable | Cinco pymes la usan una semana sin perder datos |
| S3 | App iOS con sincronización por WiFi y por cable | Aprobada en la App Store |
| S4 | Publicación de pago ($1.000) en Google Play y App Store, gestión de dispositivos | Compras validadas sin conexión |

## 8. Riesgos y pendientes

1. **Cable en iPhone desde Windows:** depende del servicio de Apple instalado con «Dispositivos Apple»
   o iTunes; si no está, NÚCLEO avisa y ofrece la WiFi.
2. **Anclaje de USB en Android:** algunos fabricantes u operadores lo bloquean; queda el protocolo de
   accesorios (AOA) o la WiFi.
3. **Conflictos de inventario** al vender el mismo producto en ambos lados sin sincronizar: se acepta
   stock negativo con aviso (ya existe la opción) y el escritorio concilia.
4. **Tiendas:** confirmar que existe el tramo de precio de $1.000 en Chile y el porcentaje de comisión.
5. **Sin servidor no hay recuperación remota:** si se pierden el computador y el respaldo, los datos no
   se pueden recuperar (es la promesa de privacidad).
