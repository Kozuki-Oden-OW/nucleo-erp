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
