# NÚCLEO ERP — Facturación electrónica propia con el SII

> Estado: **plan aprobado el 2026-11-22** (decisión del dueño: integración propia con el SII, sin
> proveedor intermedio). Cambia la decisión D-F10-01 («NÚCLEO no emite documentos tributarios»): la
> emisión pasa a ser un **módulo opcional**; quien no lo active sigue igual que hoy.

## Por qué así

- Sin costo anual de proveedor: el SII no cobra por sus servicios ni por la certificación. Solo se
  paga el certificado digital (firma electrónica), que ya se usa para entrar al SII.
- Los documentos van directo del computador al SII: nadie más ve los datos («tu empresa, tus datos»).
- Más adelante, NÚCLEO puede inscribirse como software de mercado para otras pymes.

## Quién hace qué

- **FAVOR SpA** (giro servicios informáticos, titular del proyecto NÚCLEO) desarrolla la integración y
  es el **proveedor del software**. En la postulación o en el ambiente de certificación, el «Nombre del
  software» se informa como **NÚCLEO ERP — FAVOR SpA**.
- **Cada empresa emisora se certifica a su nombre** usando NÚCLEO: los sets de pruebas se emiten con el
  RUT de la empresa que va a facturar. La primera es **Data Logger Chile SpA** (ya emisora autorizada,
  no postula de nuevo). FAVOR puede certificarse también como emisora para facturar sus propios
  servicios con NÚCLEO.
- El SII publica una nómina **informativa** de empresas que ofrecen software de facturación («el SII no
  certifica el software de estas empresas»); FAVOR puede pedir aparecer ahí cuando NÚCLEO tenga
  clientes. La acreditación de **proveedor certificado / enrolador fast track** (incorporación
  expedita de clientes; Res. Ex. SII 45/2003, 81/2005 y 2/2007) es una etapa posterior y opcional.
  ([Proveedores y fast track](https://www.sii.cl/factura_electronica/factura_mercado/prov_enrol.htm),
  [nómina informativa](https://www.sii.cl/factura_electronica/factura_mercado/emp_prov_fe.htm))

## Lo que ya sabemos del SII

- **Corrección (22-11-2026, revisado en maullin):** Data Logger usa el **sistema gratuito del SII** y
  **no está inscrito en Postulación** («el contribuyente no está inscrito en Postulación»; pedir folios
  de certificación responde «no está autorizado»). La regla de «no postular de nuevo» del SII vale para
  quien ya postuló alguna vez (software propio o de mercado). Hay que **postular**: sii.cl → Factura
  electrónica → Sistema de facturación de mercado → Inscríbase aquí → Postule aquí
  (`maullin.sii.cl/cvc_cgi/dte/pe_ingrut`), como representante legal con certificado.
- **Aviso del SII al postular desde el sistema gratuito:** «al momento de autorizarse, perderá su calidad
  de usuario activo del Sistema de Facturación SII»; recomienda respaldar los documentos antes de terminar
  la certificación. Según ese texto, el sistema gratuito sigue activo durante las pruebas y el cambio ocurre
  con la autorización final (después de la declaración de cumplimiento). **Pendiente:** confirmarlo con la
  mesa de ayuda del SII antes de postular (el dueño no puede quedar sin facturar). No se envió la postulación.
- Antes de la autorización final: respaldo completo del sistema gratuito (PDF y XML; faltan FE 43–81, FE 519,
  NC 1–3, GD 7–9).
- Quien entra: el **representante legal con certificado digital**; el usuario administrador de DTE
  debe ser empleado de la empresa (el representante puede nombrarse a sí mismo).
- Documentos mínimos a certificar: **factura (33), nota de crédito (61) y nota de débito (56)**.
  Opcionales: guía de despacho (52) y factura exenta (34).
- Etapas: set de pruebas → set de simulación → intercambio de información → muestras de impresión →
  declaración de cumplimiento → registro como emisor con el software propio.
  ([Proceso de certificación](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm))
- **Ojo:** el SII saca del ambiente de certificación a quien no registra actividad en 6 meses. Por eso
  el set de pruebas se pide cuando NÚCLEO ya sabe armar, firmar y enviar documentos (fase 2).
- Boletas electrónicas: certificación aparte, después (set pedido en
  `www4.sii.cl/certBolElectDteInternet/?SET=1`, revisión de 10 a 15 días hábiles, 5 envíos por correo
  y declaración de cumplimiento).

## Fases

| Fase | Qué se construye | Quién | Salida |
|---|---|---|---|
| F0 | Certificado digital vigente del representante (archivo .pfx/.p12 y su clave). Folios (CAF) de prueba descargados del ambiente de certificación | Kozuki | Certificado y CAF de prueba en el computador |
| F1 ✅ | Núcleo técnico en Rust: XML del DTE (encabezado, detalle, referencias, descuentos), timbre electrónico (TED) firmado con la llave del CAF, firma XML del documento y del sobre (EnvioDTE) con el certificado. *Hecho el 22-11-2026 en `crates/nucleo-dte`; el código PDF417 pasa a F5* | Claude | Factura, exenta, guía, NC y sobre validan contra los XSD del SII; firmas verificadas con xmlsec |
| F2 🟡 | Conexión con el SII: semilla → token con el certificado, envío del sobre al ambiente de certificación, consulta del estado (track id), control de folios. *Código listo el 22-11-2026 (`nucleo-app::sii_ops`, Configuración → Facturación SII), probado con un SII simulado. **22-11-2026: semilla → token aceptado por maullin con el certificado de Kozuki (firma XML validada por el SII).** Falta postular (ver arriba) para obtener CAF de certificación y hacer un envío de prueba* | Claude (+ Kozuki carga certificado y CAF) | Un documento de prueba aceptado en certificación |
| F3 🟡 | *22-11-2026: FAVOR SpA (78.477.921-1) postulada y aceptada; CAF de certificación 33 (1–50), 61 (1–10) y 56 (1–10); set básico obtenido (atención 5198396: 4 facturas, 3 NC, 1 ND; libro de ventas 5198397 y de compras 5198398). Pantalla y herramientas de Claude para emitir/enviar/consultar listas; descuento global agregado; libros de compras y ventas (IECV, `nucleo-dte::libro`, tabla `sii_libros`) listos y validados contra LibroCV_v10.xsd. Falta: instalar la versión, emitir y enviar el set, luego los libros* Pedir el **set de pruebas** y emitirlo desde NÚCLEO; luego el set de simulación (documentos parecidos a los reales) | Kozuki pide el set, Claude lo emite | Sets aprobados por el SII |
| F4 | Intercambio: recibir y responder documentos de otro contribuyente (acuse de recibo, aceptación o reclamo) | Claude | Intercambio aprobado |
| F5 | PDF de la factura con el timbre (muestras impresas) y declaración de cumplimiento | Claude arma, Kozuki declara | Autorización para emitir con NÚCLEO |
| F6 | En NÚCLEO: botón «Emitir en el SII» en cada venta (factura, nota de crédito al anular, guía), folios de producción, PDF guardado en el computador, envío del XML al cliente, venta documentada sola | Claude | Emisión real desde NÚCLEO |
| F7 | Boletas electrónicas (certificación aparte) | Ambos | Boletas desde NÚCLEO |

Tiempo estimado: F1–F2 de 3 a 6 semanas de desarrollo; F3–F5 depende de las revisiones del SII
(1 a 3 meses en total).

## Diseño técnico

- **Dónde vive:** crate `nucleo-dte` (armado del XML, timbre, firma, sobre y mensajes de los
  servicios del SII; sin red, probado con certificado y CAF generados en las pruebas),
  `nucleo-app::sii_ops` (folios, certificado, envío, estados, auditoría) y la pantalla de la venta.
- **Verificación de F1:** `cargo test -p nucleo-dte` escribe los XML de prueba en
  `target/tmp/dte/`; se revisaron con `xmllint --schema EnvioDTE_v10.xsd` (esquemas del SII de
  2011, copia pública) y con `xmlsec` (firma del documento, de cada DTE dentro del sobre y del sobre).
- **Firma:** RSA-SHA1 con el certificado (.pfx) según XMLDSig. NÚCLEO arma el XML como árbol y
  calcula él mismo la forma canónica (C14N 1.0 inclusiva): lo que se firma es exactamente lo que se
  escribe, sin depender de una biblioteca de canonicalización. El certificado y su
  clave se guardan cifrados en la base de la empresa; la clave también puede pedirse en cada sesión.
- **Folios:** cada CAF (rango autorizado) se guarda con su llave privada cifrada; NÚCLEO avisa cuando
  quedan pocos folios y nunca usa un folio dos veces (transacción con auditoría).
- **Ambientes:** certificación y producción separados; un documento de prueba nunca se mezcla con uno
  real.
- **Responsabilidad:** emitir es irreversible; NÚCLEO muestra el documento completo y pide confirmar
  antes de enviarlo. Una venta con documento emitido solo se corrige con nota de crédito.

## Próximo paso

F1 listo y F2 en código. Para cerrar F2 en maullin, Kozuki (con la nueva versión instalada):

1. Configuración → Mi negocio: RUT, razón social y dirección de Data Logger.
2. Configuración → Facturación SII: giro, actividades económicas, comuna, fecha de resolución (en
   certificación, la de la postulación; número 0).
3. Carga su certificado .pfx y escribe la clave ahí mismo.
4. Presiona «Probar conexión»: si el SII entrega el token, el certificado y la firma funcionan.
5. Descarga en maullin un CAF de prueba de factura (33) y lo carga.

Con eso Claude emite un documento de prueba y lo envía a certificación (cada envío se confirma antes).
