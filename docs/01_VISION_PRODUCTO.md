# NÚCLEO ERP — Introducción y visión del producto

> **Todo tu negocio. Un solo núcleo.**
> **Privado. Local. Simple.**
> **Desde tu primera venta hasta tu empresa.**
> **Tu negocio. Tus datos. Tu computador.**

*Documento rector del producto. Fuente: definición del dueño del producto (2026-10-05). Ante cualquier diferencia con otro documento técnico, prevalece este.*

---

## Introducción al proyecto

NÚCLEO ERP es un software de gestión empresarial **privado, local y simple**, creado para administrar un negocio completo desde un computador, independientemente de si se trata de un emprendimiento informal, una persona con inicio de actividades o una empresa constituida.

Su principio fundamental es: **Todo tu negocio. Un solo núcleo.**

NÚCLEO ERP nace para resolver un problema común: muchas personas necesitan organizar correctamente su negocio, pero no necesariamente necesitan —ni quieren— contratar múltiples plataformas mensuales para controlar ventas, inventario, clientes, proveedores, compras, costos, caja, cotizaciones y administración.

NÚCLEO propone una alternativa diferente: una aplicación instalada directamente en el computador del usuario, donde la información permanece bajo su control y donde el funcionamiento del negocio no depende de entregar permanentemente sus datos comerciales a terceros.

**Tu negocio. Tus datos. Tu computador.**

---

## NÚCLEO ERP no es un sistema tributario

Esta definición es fundamental para el proyecto. NÚCLEO ERP:

- no emite documentos tributarios electrónicos;
- no solicita credenciales tributarias;
- no guarda contraseñas;
- no se conecta automáticamente con plataformas fiscales;
- no envía ventas;
- no informa clientes;
- no transmite inventario;
- no comparte proveedores;
- no declara impuestos;
- no obtiene folios tributarios;
- no firma documentos tributarios;
- no requiere certificación como software de facturación para cumplir su función principal.

**NÚCLEO ERP administra el negocio.** Los documentos tributarios oficiales, cuando correspondan, se realizan posteriormente y de manera independiente mediante los mecanismos oficiales disponibles para el contribuyente. NÚCLEO nunca necesita conocer las credenciales utilizadas para realizar ese proceso.

---

## Documentos internos de NÚCLEO

Dentro del software, el usuario podrá crear todos los documentos administrativos que necesite, por ejemplo: cotizaciones, presupuestos, notas de venta, órdenes de pedido, órdenes de compra, documentos de venta, comprobantes internos, proformas, facturas internas, registros de servicios, comprobantes de pago y registros de abonos.

Estos documentos tendrán una **numeración propia de NÚCLEO**. Ejemplo:

```
COT-000001   COT-000002
VEN-000001   VEN-000002
PRO-000001
FV-000001    FV-000002
```

La numeración pertenece exclusivamente al sistema administrativo interno. No corresponde a un folio tributario ni pretende reemplazarlo.

Todo documento que pueda confundirse con un documento tributario debe mostrar claramente:

> **DOCUMENTO INTERNO — NO TRIBUTARIO**

De esta manera, una persona puede organizar profesionalmente su negocio sin confundir la administración interna con sus obligaciones tributarias externas.

---

## El concepto de venta

Una cotización podrá convertirse directamente en una venta.

1. **Cotización.** El usuario prepara cliente, producto, cantidad, precio, descuento y total. NÚCLEO asigna `COT-000147`.
2. El cliente acepta.
3. El usuario selecciona **CONVERTIR EN VENTA** y NÚCLEO crea `VEN-000089`.

### Estados de una venta

BORRADOR · COTIZADA · ACEPTADA · EFECTUADA · PAGADA · PENDIENTE DE DOCUMENTACIÓN · DOCUMENTADA · CERRADA · ANULADA

Esto permite separar completamente **la operación comercial** de **la documentación tributaria externa**.

### Venta efectuada

Cuando el usuario marque **VENTA EFECTUADA**, NÚCLEO deberá registrar automáticamente: fecha, cliente, productos, cantidades, costo, precio, margen, medio de pago, inventario, caja, cuenta por cobrar, vendedor y utilidad.

Y, cuando corresponda según la configuración del negocio, podrá mostrar una alerta:

> **Esta venta está pendiente de documentación tributaria.**

La aplicación no intentará emitirla, no abrirá sesiones automáticamente, no utilizará contraseñas y no enviará información. Simplemente recordará al usuario que existe una operación pendiente.

### Documentación externa

Posteriormente, el usuario realiza la gestión tributaria correspondiente fuera de NÚCLEO ERP. Cuando haya terminado, podrá volver a NÚCLEO y seleccionar **MARCAR COMO DOCUMENTADA**. Opcionalmente podrá ingresar manualmente: tipo de documento, número o folio externo, fecha de emisión y observación.

Ejemplo:

| Campo | Valor |
|---|---|
| Venta NÚCLEO | VEN-000089 |
| Estado | DOCUMENTADA |
| Referencia externa | Factura Nº 563 |

NÚCLEO solamente guarda la referencia que el propio usuario decide registrar. No necesita descargar ni consultar información desde sistemas externos.

---

## Dos sistemas completamente separados

| Sistema | Responsabilidad |
|---|---|
| **NÚCLEO ERP** | Administra el negocio |
| **Sistema tributario externo** | Administra la documentación tributaria oficial |

NÚCLEO no necesita convertirse en intermediario entre ambos. Esto mantiene el software simple, privado, económico, independiente y fácil de mantener.

---

## Para negocios informales y formales

NÚCLEO ERP no estará diseñado solamente para empresas constituidas. Cualquier persona podrá utilizarlo. Existirán diferentes perfiles de operación.

### Emprendedor

Para una persona que está comenzando. Puede administrar productos, servicios, costos, precios, clientes, proveedores, inventario, cotizaciones, ventas internas, gastos, caja, utilidades, presupuestos y proyectos. No será obligatorio ingresar información tributaria empresarial para comenzar.

### Negocio

Para una persona que ya vende regularmente y necesita mayor control. Podrá administrar ventas, compras, stock, clientes, proveedores, cuentas por cobrar, cuentas por pagar, caja, bancos, empleados, gastos, reportes y rentabilidad.

### Empresa

Para una empresa constituida que necesita una administración más completa. Podrá agregar múltiples usuarios, sucursales, bodegas, centros de costos, permisos, contabilidad interna, remuneraciones, activos, proyectos, comercio exterior y reportes avanzados.

**Todos utilizan el mismo núcleo.**

---

## No existe una barrera entre informal y formal

Una persona podría comenzar hoy vendiendo productos desde su casa: crear 10 productos, 5 proveedores, 20 clientes, 30 cotizaciones y 15 ventas; registrar gastos, conocer su utilidad y controlar inventario.

Meses después puede formalizar su actividad. No necesita cambiar de software, no necesita perder información y no necesita comenzar nuevamente. Simplemente actualiza el perfil de su negocio, y NÚCLEO continúa funcionando exactamente con la misma base de información.

---

## El software empieza antes que la empresa

La mayoría de los ERP comienza cuando ya existe una empresa. NÚCLEO ERP comienza antes:

```
IDEA → EMPRENDIMIENTO → PRIMEROS CLIENTES → PRIMERAS VENTAS → ORGANIZACIÓN → FORMALIZACIÓN → EMPRESA → CRECIMIENTO
```

El sistema acompaña todo ese proceso.

---

## Sin mensualidades obligatorias para administrar el negocio

Uno de los objetivos conceptuales de NÚCLEO es reducir la dependencia permanente de servicios externos. El usuario instala el programa, su información permanece localmente y el software continúa funcionando sin necesidad de almacenar la operación de la empresa en servidores del proveedor.

Esto permite plantear modelos comerciales diferentes al SaaS tradicional, por ejemplo: licencia permanente, pago único, actualizaciones opcionales, módulos adicionales y soporte opcional.

**La arquitectura del producto no debe obligar técnicamente a cobrar una mensualidad simplemente para que el empresario pueda acceder a sus propios datos.**

> **Decisión (2026-10-05): NÚCLEO ERP será un programa GRATUITO.** Si a alguien le agrada, puede hacer una **donación voluntaria**, al estilo de WinRAR. Sin licencias, sin activación y sin funciones bloqueadas.

---

## Privacidad como principio

NÚCLEO no necesita saber cuánto vende el negocio, cuánto gana, quiénes son sus clientes o proveedores, qué productos vende, cuáles son sus márgenes, cuánto inventario mantiene, quiénes trabajan en la empresa, cuáles son sus costos ni cuáles son sus operaciones.

La información permanece bajo control del usuario. **La privacidad no será una característica adicional: será parte de la arquitectura del producto.**

---

## Un ERP para trabajar, no para declarar

NÚCLEO ERP debe concentrarse en responder preguntas reales del empresario:

- ¿Cuánto vendí hoy?
- ¿Cuánto gané?
- ¿Qué clientes me deben?
- ¿Qué tengo que pagar?
- ¿Cuánto stock tengo?
- ¿Qué producto me deja más dinero?
- ¿Cuál proveedor es más conveniente?
- ¿Cuánto efectivo tengo?
- ¿Cuánto cuesta realmente importar este producto?
- ¿Cuánto necesito vender para cubrir mis gastos?
- ¿Qué ventas todavía tengo pendientes de documentar?

Esas son las preguntas que NÚCLEO debe resolver.

---

## Visión del producto

NÚCLEO ERP pretende convertirse en el **centro operativo privado del negocio**: ventas, compras, clientes, proveedores, inventario, cotizaciones, caja, finanzas, costos, rentabilidad, remuneraciones, proyectos, importaciones, exportaciones, documentos y reportes.

Todo relacionado. Todo organizado. Todo dentro de un mismo sistema. Sin obligar al empresario a compartir la operación completa de su empresa con el proveedor del software.

---

### NÚCLEO ERP

**Todo tu negocio. Un solo núcleo.**
**Privado. Local. Simple.**
**Desde tu primera venta hasta tu empresa.**
**Tu negocio. Tus datos. Tu computador.**
