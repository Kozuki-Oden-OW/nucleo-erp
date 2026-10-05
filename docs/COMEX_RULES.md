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

## Pendiente (Fase 9)

Fórmulas de FOB/CIF/landed cost y casos golden revisados por el contador colaborador (D-07).
