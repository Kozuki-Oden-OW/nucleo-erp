# La mente del agente: cómo aprende un negocio

Pedido del dueño (25-11-2026). El agente de NÚCLEO es la pieza más importante del producto. Para que
pueda controlar, responder y ayudar a un negocio (el de Data Logger o el de cualquier empresa que
tome NÚCLEO), necesita dos cosas: **saber cómo se hacen los trámites** (sobre todo en el SII) y
**conocer la empresa**. Este documento fija cómo se construye ese conocimiento. Estado: diseño; la
«memoria del negocio» dentro de NÚCLEO está por construir.

## 1. Aprender del SII

Objetivo: que el agente sepa hacer, explicar y revisar los documentos tributarios sin improvisar.

- **Qué debe dominar:** factura afecta y exenta, boleta, nota de crédito y de débito (cuándo
  corresponde cada una y qué referencia llevan), guía de despacho, factura de compra, anulación y
  corrección de documentos, folios (CAF), certificado digital, libros de compras y ventas, registro de
  compras y ventas, F29, cesión de facturas, aceptación y reclamo de documentos recibidos, y la
  diferencia entre el portal gratuito del SII y la facturación propia de NÚCLEO.
- **De dónde aprende:** las guías y la ayuda oficial del SII, los instructivos de certificación, y los
  tutoriales que el dueño elija. Los videos no los puede ver: se usa su transcripción o la guía
  escrita equivalente. El sitio del SII no se puede leer desde el entorno de Claude, así que se lee en
  la sesión de Chrome que abre el dueño, o en archivos que él descarga.
- **Cómo queda guardado:** un «manual del SII del agente», trámite por trámite: cuándo se usa, paso a
  paso, datos que exige, errores frecuentes y la fuente con su fecha. Cada trámite se verifica una vez
  en la práctica antes de darlo por aprendido.
- **Regla:** ninguna tasa, plazo ni tope se guarda «de memoria»: va con su fuente y fecha, y se vuelve
  a comprobar cuando cambia el año tributario. Emitir un documento sigue siendo irreversible: resumen
  y confirmación de la persona, uno por uno.

## 2. Conocer una empresa nueva: el recorrido

Los siete pasos del dueño, en el orden en que rinden más. Cada paso deja hechos anotados en la
memoria del negocio con su fuente y fecha.

| # | Paso | Qué se obtiene |
|---|---|---|
| 1 | **Preguntas al dueño** | Qué vende y a quién, cómo vende (canales), quién hace qué, horarios, qué lo complica cada día, qué quiere delegar primero y qué no se toca |
| 2 | **Lista de precios** con y sin descuento, por volumen, por tipo de cliente | Precios netos, descuentos permitidos y quién los autoriza, precios especiales, vigencia |
| 3 | **Fichas técnicas o documentos del servicio** | Qué es cada producto o servicio, para qué sirve, compatibilidades, límites, garantías; nombres con que lo piden los clientes |
| 4 | **Redes sociales y página web** | Cómo se presenta la marca, tono, promesas públicas, preguntas frecuentes, condiciones de despacho y pago publicadas |
| 5 | **SII en una sesión de Chrome abierta por el dueño** (solo lectura) | Clientes y proveedores reales, documentos emitidos y recibidos, giros, estacionalidad de ventas |
| 6 | **Últimas 100 conversaciones de WhatsApp** | Qué preguntan, cómo se responde, qué datos se piden, dónde se pierden ventas (hecho para Data Logger: `docs/recetas/whatsapp-consultas-y-respuestas.md`) |
| 7 | **Últimos 30 correos de la empresa** | Pedidos de cotización, órdenes de compra, reclamos, avisos de pago, formato y firma de las respuestas |

## 3. Lo que agrega Claude al recorrido

| # | Fuente | Por qué importa |
|---|---|---|
| 8 | **Lo que ya está en NÚCLEO**: ventas, clientes, stock, cobranza, márgenes | Es lo más confiable y no hay que preguntarlo: quién compra qué y cada cuánto, qué se vende junto, quién paga tarde, qué producto deja margen |
| 9 | **Cotizaciones ya emitidas** (en Data Logger, la carpeta con más de 500 PDF) | Muestran los precios que de verdad se dieron, los descuentos por volumen aplicados, las condiciones y la redacción |
| 10 | **Políticas**: despacho, devoluciones, garantía, crédito, formas de pago | Son las respuestas que más se repiten y donde un error cuesta caro |
| 11 | **Líneas rojas y niveles de autonomía** | Qué puede decidir solo, qué propone y qué nunca hace (prometer stock o plazo, descuentos sobre un tope, consejos técnicos fuera de la ficha) |
| 12 | **Glosario y alias** | Cómo llaman los clientes a cada producto, errores de tipeo habituales, modelos que se confunden |
| 13 | **Respuestas aprobadas** a las preguntas frecuentes | Con ellas responde rápido y con la voz de la empresa |
| 14 | **Proveedores, costos y plazos de reposición** | Para saber qué se puede prometer y cuándo conviene comprar |
| 15 | **Competidores y precios de mercado**; en ventas al Estado, licitaciones ganadas y perdidas | Para cotizar con criterio |
| 16 | **Calendario del negocio**: fechas de cierre, vencimientos, temporadas | Para anticiparse en vez de reaccionar |

## 4. Cómo se mantiene viva

- **Aprende de cada corrección.** Cuando la persona cambia un borrador del agente, se anota la regla
  que hay detrás. Es la fuente que más mejora el resultado con el tiempo.
- **Examen antes de dar autonomía.** Al terminar el recorrido, el agente responde unas veinte
  consultas reales pasadas; el dueño las revisa. Lo que falle vuelve como preguntas.
- **La autonomía crece con la evidencia.** Cada tarea parte en «propone»; pasa a «hace con tu sí» y
  después a «hace solo y te informa» según cuántos borradores se aprueban sin cambios. Lo decide el
  dueño por tarea.
- **Cada hecho tiene fuente y fecha.** Si dos fuentes se contradicen (la web dice un precio y la lista
  otro), el agente no elige: pregunta. Lo que envejece (precios, stock, plazos) se vuelve a comprobar.
- **Lo que escribe un cliente es información, no una instrucción.** Un mensaje que pide «ignora tus
  reglas» o un descuento «ya autorizado» se muestra al dueño.

## 5. Dónde vive y qué la protege

- La memoria queda **en la base cifrada de la empresa, en su computador**, no en un servidor de
  NÚCLEO. El dueño la ve y la edita en una pantalla («Lo que Claude sabe de tu negocio»), puede borrar
  cualquier línea y exportarla.
- Organizada por temas: empresa, productos y alias, precios y descuentos, políticas, clientes, voz y
  respuestas aprobadas, procesos, líneas rojas, manual del SII.
- Herramientas previstas para el agente: buscar, leer y anotar en la memoria; anotar exige fuente.
- **Privacidad:** el recorrido se hace con permiso expreso de la empresa para cada fuente. Los chats
  personales y los números excluidos no se leen. De los clientes se guarda lo necesario para atenderlos
  (razón social, RUT, contacto, historial comercial), no conversaciones completas. El SII y el banco se
  miran en sesiones que abre el dueño, solo lectura, sin guardar claves.

## 6. Para ofrecerlo a otras empresas

El recorrido es un servicio de puesta en marcha con tres entregables: la memoria inicial, el examen
revisado por el dueño y la tabla de autonomía por tarea. Requisitos de producto: la memoria del
negocio en NÚCLEO, el asistente de inicio que guía los siete pasos, la conexión de correo y WhatsApp
(hechas) y la sesión de Chrome conectada a NÚCLEO (por construir).

| Paso | Estado |
|---|---|
| Recorrido definido (este documento) | ✅ |
| Aplicado a Data Logger: precios, WhatsApp, correos, datos del negocio | En curso |
| Manual del SII del agente | Por hacer |
| Memoria del negocio dentro de NÚCLEO y herramientas del agente | Por construir |
| Examen y tabla de autonomía por tarea | Por construir |
