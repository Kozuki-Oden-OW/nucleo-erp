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
   carpeta o del costo; el seguro, por valor.
3. **Derechos**: si se ingresaron los montos de la declaración, se usan y se reparten según el
   arancel de cada producto; si no, arancel del producto × su valor aduanero.
4. **IVA de importación**: montos de la declaración (repartidos por valor aduanero + derechos) o la
   tasa ingresada × (valor aduanero + derechos). Si se recupera como crédito, no suma al costo.
5. **Gastos locales** (agente, puerto, almacenaje, transporte, banco, otros): se reparten por valor,
   peso o unidades; si falta el peso de algún producto, se reparte por valor y se avisa.
6. **Costo unitario** = total del producto ÷ cantidad. Al recibir, entra a stock con ese costo.

## Casos golden

`golden/comex.json` (tasas de EJEMPLO). Los ejecutan `cargo test -p nucleo-domain --test golden_comex`
y `vitest` (`src/data/comex.test.ts`). **Estado: pendientes de revisión y firma** por un contador o
agente de aduana (D-07). Lo ideal es agregar 3 a 5 importaciones reales cerradas (declaración de
ingreso, factura del proveedor y gastos) como casos adicionales.

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
