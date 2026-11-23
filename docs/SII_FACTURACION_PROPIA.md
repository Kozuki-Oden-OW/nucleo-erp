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
| F3 🟡 | *22-11-2026: FAVOR SpA (78.477.921-1) postulada; CAF 33 (1–50), 61 (1–10), 56 (1–10). Set básico (atención 5198396) **aceptado por el SII**: envío 264310934 EPR sin reparos (33-9 a 12, 61-7 a 9, 56-3; receptor Data Logger); libro de ventas 264310986 y de compras 264310988 **LOK cuadrados**. Avance declarado el 22-11-2026: los tres «EN REVISIÓN». Antes: envío 264309500 rechazado por permisos (106) y 264309624 por líneas largas (ver «Lecciones»).* Luego: set de simulación | Kozuki pide el set, Claude lo emite | Sets aprobados por el SII |
| F4 🟡 | Intercambio: recibir y responder documentos de otro contribuyente (acuse de recibo, aceptación o reclamo). *22-11-2026: listo en código (`nucleo-dte::intercambio`, `nucleo-app::sii_intercambio`, Facturación SII → «Responder un envío recibido», herramienta `responder_intercambio_sii`): lee el EnvioDTE, verifica firmas y firma RecepcionEnvio, ResultadoDTE y EnvioRecibos; validado contra RespuestaEnvioDTE_v10.xsd y EnvioRecibos_v10.xsd. Falta hacerlo con el sobre real del SII cuando habilite la etapa* | Claude | Intercambio aprobado |
| F5 🟡 | PDF de la factura con el timbre (muestras impresas) y declaración de cumplimiento. *22-11-2026: representación impresa lista (`nucleo-dte::timbre` genera el PDF417 nivel 5; `nucleo-app::sii_print` lee el XML firmado; pantalla con ejemplar tributario y cedible). Falta anotar la «Unidad del SII» de FAVOR y subir las muestras cuando el SII habilite la etapa* | Claude arma, Kozuki declara | Autorización para emitir con NÚCLEO |
| F6 🟡 | En NÚCLEO: botón «Emitir en el SII» en cada venta (factura, nota de crédito al anular, guía), folios de producción, PDF guardado en el computador, envío del XML al cliente, venta documentada sola. *22-11-2026: listo el botón en la venta efectuada (`nucleo-app::sii_venta`: borrador desde la venta, no se factura dos veces, venta documentada sola en producción) y la herramienta `emitir_venta_sii`. Falta: nota de crédito al anular, guía desde el despacho, envío del XML y PDF al cliente por correo* | Claude | Emisión real desde NÚCLEO |
| F7 | Boletas electrónicas (certificación aparte) | Ambos | Boletas desde NÚCLEO |

Tiempo estimado: F1–F2 de 3 a 6 semanas de desarrollo; F3–F5 depende de las revisiones del SII
(1 a 3 meses en total).

## Lecciones del primer envío (22-11-2026, FAVOR)

1. **«106 Usuario sin permiso de envío»** (y «el RUT … no está autorizado por la empresa … para consultar»): el
   usuario administrador nombrado en la postulación parte solo con el perfil de administrador. Hay que darle
   los perfiles en **Mantención de usuarios** del ambiente de certificación
   (`www2c.sii.cl/sii-muyd-inter/`, «Actualización de datos del contribuyente», con certificado y verificación
   en dos pasos): Solicitar folios, Anular folios, Firmar documentos, Enviar documentos y Consulta y registro.
   En producción pasa lo mismo con cada empresa: revisarlo antes del primer envío.
2. **«RSC – Rechazado por Error en Schema: (ENV-3-0) CHR-00002: Line too long (4090)»**: el SII no acepta
   líneas de más de 4090 caracteres. NÚCLEO ahora escribe un elemento por línea (firmado así) y parte el
   base64 de la firma en líneas de 76. El detalle del rechazo llega al «mail contacto SII» como
   `DTEMAIL<track>.txt/.xml`.
3. **Libros «CONTENIDO NO CORRESPONDE A LO ESPERADO»** (revisión del avance, 23-11-2026; el set básico quedó
   «REVISADO CONFORME»): aunque la subida respondió «LOK – cuadrado», la revisión los rechazó. Diferencias
   con los ejemplos aceptados por el SII: en el **libro de ventas** los documentos electrónicos emitidos van
   solo en el resumen (sin `Detalle`); en el **libro de compras** la factura de compra con retención total
   lleva `MntIVA` y `OtrosImp` código 15 (y `TotOtrosImp` en el resumen), no `IVARetTotal`. Un libro ya
   enviado no se reenvía en el mismo período: el corregido va en otro período (en certificación sirve
   cualquiera).
4. Un documento ya enviado y **rechazado** no quedó registrado en el SII: su folio sigue disponible allá.
   NÚCLEO lo reutiliza en el siguiente documento del mismo tipo (D-SII-04) y guarda el rechazado como
   historial. Darlos por gastados fue un error del primer día: al pedir más folios de nota de crédito el
   SII autorizó solo 1, porque «la empresa posee folios disponibles o sin utilizar por un total de 7»
   (los 6 de los dos envíos rechazados más el último del CAF). No se reutiliza un rechazo por repetido.
5. La revisión del avance del set (libros) no es inmediata: quedó «EN REVISION» varias horas después de
   declarar. La sesión de maullin vence en poco rato y volver a entrar pide el certificado.

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
