# Comercio exterior — política de NÚCLEO COMEX

NÚCLEO COMEX calcula y simula costos de importación y exportación. Los resultados son **simulaciones**
para decidir; no reemplazan la declaración aduanera ni la asesoría de un agente de aduana.

## Reglas

1. **Sin aranceles, tasas ni presunciones inventadas.** El usuario ingresa la tasa aplicable o elige un
   parámetro cargado con fuente oficial verificada.
2. Toda regla que pueda cambiar (valor aduanero, seguros o fletes presuntos, franquicias, tratamiento
   de pequeñas importaciones, IVA de importación) se modela como parámetro versionado en `nucleo-rules`.
3. Las definiciones de **Incoterms** (quién paga, riesgo, punto de transferencia) se guardan como
   contenido versionado y actualizable, no como lógica fija.
4. Tipos de cambio ingresados manualmente con fecha y origen (funciona sin Internet).
5. Cada carpeta de importación guarda la versión normativa y las tasas de cambio usadas.

## Etapas de importación (estado de stock)

| Etapa | Stock |
|---|---|
| Cotización | No cuenta |
| Ordenada · Pagada · Producción · Lista para despacho | En importación |
| Embarcada · En tránsito | En importación (en tránsito) |
| Arribada · En proceso de internación · Transporte local | En importación (en destino) |
| Recibida | En recepción → disponible al confirmar |
| Cerrada | Costos finales; recálculo de costo landed y costo promedio |

## Cálculo del costo puesto en bodega (Fase 9)

Implementado en `crates/nucleo-domain/src/comex.rs` y, con el mismo algoritmo, en
`apps/desktop/src/data/comex.ts`. Enteros (pesos y unidades mínimas de la moneda), redondeo half away
from zero y reparto por resto mayor (la suma cuadra al peso).

1. **Mercadería**: cantidad × precio unitario (moneda de la factura, según su Incoterm) → pesos con el
   tipo de cambio de la carpeta.
2. **Valor aduanero (CIF)** = mercadería + flete + seguro. El flete se reparte según el criterio de la
   carpeta o del costo; el seguro, por valor. Si no se contrató seguro, la carpeta puede llevar un
   **seguro teórico** (% de la mercadería, el que declara el agente): suma al valor aduanero —y por lo
   tanto a derechos e IVA— pero se descuenta del costo en bodega porque no se paga (D-F9-09).
3. **Derechos**: si se ingresaron los montos de la declaración, se usan y se reparten según el
   arancel de cada producto; si no, arancel del producto × su valor aduanero.
4. **IVA de importación**: montos de la declaración (repartidos por valor aduanero + derechos) o la
   tasa ingresada × (valor aduanero + derechos). Si se recupera como crédito, no suma al costo.
5. **Gastos locales** (agente, puerto, almacenaje, transporte, banco, otros): se reparten por valor,
   peso o unidades; si falta el peso de algún producto, se reparte por valor y se avisa.
6. **Costo unitario** = total del producto ÷ cantidad. Al recibir, entra a stock con ese costo.

Diferencias aceptadas con la DIN (D-F9-10, D-F9-11): la aduana calcula los impuestos en dólares por
línea arancelaria y luego convierte, y puede recalcular el FOB (por ejemplo, CPT − flete del AWB).
NÚCLEO calcula en pesos por producto; la estimación puede diferir en pocos pesos y, al ingresar los
montos reales de la DIN, estos mandan.

## Modalidades de importación (calculadora)

| Modalidad | Cuándo | Impuestos | Gastos típicos |
|---|---|---|---|
| Con agente de aduana | Sobre el máximo del courier, o carga marítima/aérea consolidada | Arancel (0 % con certificado de origen de un TLC) e IVA sobre el valor aduanero, pagados con la DIN | Honorarios y gastos de despacho del agente, EDI, puerto, almacenaje, transporte |
| Courier (envío rápido) | Hasta el máximo del despacho simplificado | Igual que con agente | Cargo del courier por el trámite y la entrega |
| Plataforma | Compras a distancia de bajo valor (plataforma inscrita en el SII) | IVA cobrado al pagar sobre producto + envío; sin arancel | Normalmente ninguno |

Los montos máximos de cada modalidad y las tasas no se escriben en el código: vienen del paquete
normativo (`COMEX_PLATAFORMA_MAX_USD_CENTS`, `COMEX_COURIER_MAX_USD_CENTS`, `SEGURO_TEORICO_PPM`,
`IVA_TASA_GENERAL_PPM`, `ARANCEL_GENERAL_PPM`). La demostración trae valores ilustrativos con su
fuente (`apps/desktop/src/data/demo/reglas-demo.json`).

Referencias consultadas (octubre 2026; verificar vigencia): IVA de bienes de hasta USD 500 comprados
a distancia, cobrado por la plataforma desde el 25-10-2025 y sin arancel ([SII](https://www.sii.cl/noticias/2025/241025noti01pcr.htm));
sobre USD 500, arancel e IVA ([ChileAtiende](https://www.chileatiende.gob.cl/fichas/4201));
despacho simplificado por empresas de envío rápido hasta USD 3.000 ([Aduana News](https://aduananews.com/chile-sube-a-tres-mil-dolares-el-maximo-para-despachos-de-empresas-de-envio-rapido/)).

Checkouts observados el 6-10-2026 (sin pagar), cuenta del usuario con dirección en Santiago:

| Plataforma | Producto | Envío | Impuestos | Total | Notas |
|---|---|---|---|---|---|
| Mercado Libre Internacional | $31.159 (mouse, envío desde China) | $5.813 tachado → gratis | $5.920 (19 % del producto) | $37.079 | Pide "datos para la aduana" (nombre y RUT); facturación con boleta; llega en 8–15 días |
| AliExpress | $11.700 (mouse) | Gratis (Cainiao estándar) | $2.224 | $13.924 | "El IVA se calcula al final"; pide información aduanera (RUT); llega en 11–22 días |
| Shein (captura del usuario) | $18.590 − cupón $11.712 = $6.878 | $4.990 tachado → gratis; garantía de envío $981 | $1.363 tachado → $681; bajo el total, "ICMS adicional" $682 | $8.540 | $8.540 = 6.878 + 981 + 681. Los impuestos completos ($681 + $682 = $1.363) equivalen al IVA contenido en ~$8.540; la etiqueta "ICMS" (impuesto brasileño) parece un error de traducción. Sin pagar, no queda claro si los $682 se cobran aparte: por eso la calculadora permite escribir el IVA que muestra el resumen |
| Shein (vista sin sesión) | $14.690 (vestido) | $4.990 bajo $14.990, gratis desde $14.990 | No visible sin iniciar sesión | — | 5–11 días hábiles |

## Caso real: DIN 2850015246 (courier DHL con agente)

Importación de dataloggers desde China (Jiangsu Jingchuang), 13 productos, factura USD 10.382,50 +
flete DHL USD 1.750 (CPT por declaración jurada), sin seguro contratado → seguro teórico 2 % del FOB
(Res. DNA 2307/2019, cap. II, 2.7 a), régimen TLC Chile–China con certificado de origen (arancel 0),
tipo de cambio aduanero 935,57, IVA pagado en la DIN $2.194.108, agente $272.835 neto (gasto de
despacho, EDI, ingreso de datos courier, honorarios) y entrega DHL $133.787 neto. La provisión de
fondos del agente incluía almacenaje y servicio de terminal ($180.000 cada uno) que no se cobraron por
ser courier. Está en `golden/comex.json` en dos versiones: la estimación (valor aduanero
$11.545.076, IVA estimado $2.193.564) y los montos reales (costo en bodega $11.757.427).

## Casos golden

`golden/comex.json`. Los ejecutan `cargo test -p nucleo-domain --test golden_comex` y `vitest`
(`src/data/comex.test.ts`). Los casos `pendiente_revision` usan tasas de EJEMPLO y esperan revisión y
firma por un contador o agente de aduana (D-07); los casos `caso_real` reproducen documentos reales y
explican la fuente de cada monto. Lo ideal es sumar 2 a 4 importaciones reales cerradas más.

## Preguntas para el contador o agente de aduana

1. Valor aduanero: costos que entran a la base; flete y seguro cuando la factura no los trae
   (¿valores presuntos?) y si los gastos en origen forman parte.
2. Derecho ad valorem: tasa general y aplicación de rebajas por tratados con certificado de origen.
3. IVA de importación: base exacta, momento de pago y su uso como crédito fiscal.
4. Otros impuestos o recargos por tipo de producto.
5. Pequeñas importaciones y courier: montos con franquicia o trámite simplificado; IVA en compras en
   línea al extranjero.
6. Tipo de cambio para la valoración aduanera, para la contabilidad y para el pago; tratamiento de la
   diferencia.
7. Qué gastos se activan como costo del producto y cuáles son gasto del período.
8. Criterio de prorrateo aceptable entre productos (valor, peso, volumen).
9. Costos y riesgos a cargo del importador en cada Incoterm (validar `0016_comex.sql`).
10. Exportaciones: venta exenta de IVA, recuperación del IVA exportador, documento de salida, valor y
    tipo de cambio para registrar la venta.
11. Asientos: anticipo al proveedor extranjero, mercadería en tránsito y cierre de la carpeta.
12. Seguro teórico: porcentaje y base vigentes (en el caso real, 2 % del FOB que recalculó la aduana).
13. Compras de una empresa por plataforma con IVA cobrado al pagar: ¿la boleta permite usar ese IVA
    como crédito fiscal? ¿Conviene comprar con factura o por courier con DIN a nombre de la empresa?
14. Provisión de fondos al agente y saldo a favor: ¿se registra como anticipo y luego se rinde contra
    sus facturas y los impuestos pagados por cuenta del importador?
15. Pago al proveedor con crédito (75 días en el caso real): diferencia entre el tipo de cambio de la
    DIN y el del pago, y cómo afecta el costo del producto.

## Respuestas del agente de aduana (octubre 2026)

Respuestas a las preguntas de valoración, impuestos, courier y exportación, revisadas con el agente
de aduana del usuario sobre la DIN 2850015246. "[Oficial]" = norma citada; "[DIN]" = lo que muestra
la declaración real; "[Por verificar]" = práctica o fuente secundaria.

| Tema | Respuesta | En NÚCLEO |
|---|---|---|
| Seguro teórico | [Oficial] 2 % del FOB en cualquier vía, solo si no se acredita una prima real (Compendio, cap. II, 2.7 a). [DIN] Sobre el FOB **declarado**: 2 % × 10.535,02 = 210,70 | Seguro teórico sobre la mercadería declarada (D-F9-09, D-F9-13) |
| Flete en facturas CPT/CFR | [Oficial] Se declara el flete del AWB/BL y el FOB = total CPT − ese flete. [DIN] 12.132,50 − 1.597,48 = 10.535,02; Aduanas repartió la diferencia entre los productos (+1,4692 % cada precio) | Campo "Flete según el AWB o BL" en la carpeta (migración 0019, D-F9-13) |
| Flete no acreditado | [Oficial] Tarifa habitual con certificado del transportista; si no: marítimo 5 % del FOB, aéreo tabla supletoria por zona (China: Asia–Oceanía), terrestre reparto interno/externo; franquicias y equipaje 10 % | Aviso: pedir a DHL el certificado de flete |
| Gastos en origen (EXW/FCA) | [Oficial] Suman al valor aduanero (todo hasta el lugar de entrada a Chile, cap. II 2.7). No suman: costos en Chile después de la llegada (THC de destino), comisiones de compra, derechos e impuestos chilenos (cap. II 2.8) | Se agregan como flete u "otros" en origen |
| Tipo de cambio | [Oficial] Equivalencia del Banco Central vigente a la aceptación de la DIN (Ordenanza art. 70; Compendio 2.6); en la práctica, valor mensual publicado por Aduanas (ago-2026 935,57; sep 925,25; oct 969,70). Pagos al proveedor: tipo del banco el día del pago, con diferencia de cambio contable (validar con contador) | Tipo de cambio de la carpeta = el aduanero; pagos al tipo del pago (D-F9-06) |
| Cálculo del IVA | [DIN] Por línea en dólares y luego a pesos (813,17 + 1.380,70 + 151,34 = US$ 2.345,21 × 935,57 = $2.194.108). [Oficial] Base = CIF + derechos; los impuestos adicionales no entran a la base del IVA | Cálculo en pesos por producto; diferencia de 1–2 pesos aceptada (D-F9-11); el monto de la DIN manda |
| Mercadería agrupada | [DIN] Repartir por valor es exacto si todas las líneas tienen la misma tasa. Con tasas distintas, usar los montos de cada línea de la DIN | Derechos e IVA ingresados se reparten por valor aduanero (y por arancel si difiere) |
| Certificado de origen tardío | [Oficial] Se paga el régimen general (6 % + IVA) dejando constancia y luego se pide devolución: 6 a 24 meses según el acuerdo; con China, 1 año (TLC art. 18; Ordenanza art. 131 bis). [DIN] La provisión de $3.741.211 se calculó con 6 %; con TLC eran $2.916.889: **$824.322 a favor del usuario**, revisar la cuenta final del agente | Pendiente: marcar "derechos con devolución pendiente" en la carpeta |
| Permisos para dataloggers | [Oficial] Sin impuesto adicional ni visto bueno ISP/SAG; la DIN salió sin aforo. [Por verificar] SUBTEL para equipos con WiFi/4G/Bluetooth; SEC para adaptadores de 220 V al comercializar | Nota en la ficha del producto (futuro) |
| Courier | [Oficial] Hasta US$ 3.000 FOB el courier tramita y paga derechos e IVA a nombre del importador y los cobra en su factura; sobre eso, agente obligatorio con DIN. Carga general sin agente solo hasta US$ 1.000 FOB (DIPS) | Límites en el paquete normativo y avisos en la calculadora |
| Factura del agente | [DIN] La provisión calculó IVA sobre honorarios, despacho, EDI, almacenaje y terminal. [Por verificar] Lo habitual: IVA sobre los servicios propios del agente; los gastos de terceros se rinden con la factura del tercero (que ya trae IVA) | Gastos de servicios se ingresan netos; revisar la cuenta final |
| Almacenaje | [DIN] DHL Express fue el almacenista: el courier sí puede cobrar almacenaje. [Oficial] No hay días libres oficiales: cada almacenista publica sus tarifas | Costo informado por el proveedor, no regla fija |
| Exportación | [Oficial] DUS en dos etapas (aceptación y legalización en 25 días); sin agente hasta US$ 2.000 FOB (DUS o DUSSI), con agente sobre eso (cap. IV). Valor FOB en dólares con factura de exportación electrónica (110), exenta; el exportador recupera el IVA de sus compras (art. 36 DL 825). Reintegro simplificado (Ley 18.480): vigente, 3 % del FOB para exportaciones no tradicionales producidas con insumos; en reventa probablemente no aplica. [Por verificar] Tipo de cambio para contabilizar la venta | Aviso en la calculadora de exportación |
| Partidas arancelarias | [DIN] 9025.8099 (registradores) y 9025.1990 (termómetros) aceptadas sin aforo; antecedente útil pero no vinculante. Guardar con fuente, versión del arancel (SA 2022) y vencimiento al 31-12-2027 (SA 2028 desde el 1-01-2028). Sensores sueltos podrían ir en 9025.90; modelos con radio, revisar SUBTEL. Para certeza: resolución anticipada de clasificación (vinculante) | Pendiente: partida con metadatos en la ficha del producto |

