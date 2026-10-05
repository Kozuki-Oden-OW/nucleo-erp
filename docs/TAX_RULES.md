# Normativa tributaria y laboral — política de NÚCLEO ERP

> NÚCLEO ERP **no es un sistema tributario**. Usa algunos parámetros normativos solo para cálculos
> **informativos** (por ejemplo, el IVA estimado o, en el futuro, liquidaciones preliminares). Nunca
> declara, emite ni envía nada.

## Reglas (Blueprint regla 50 y 51, ADR-009)

1. **Ningún valor normativo en el código.** Tasas, topes, UTM, tablas y reglas de redondeo viven en
   paquetes de `nucleo-rules` con vigencia.
2. **Fuente obligatoria.** Un valor sin fuente oficial (norma, circular o URL oficial) es rechazado al cargar.
3. **Sin vigencias superpuestas** para un mismo código.
4. **Sin valor por defecto.** Si falta el valor para la fecha, el cálculo falla con un mensaje claro.
5. **Trazabilidad.** Todo cálculo persistido guarda la versión normativa (`rule_set`) usada.
6. La CI ejecuta `tools/check_normativa.py`, que rechaza literales normativos conocidos en el código fuente.

## Formato de un paquete

```json
{
  "code": "CL-2026.1",
  "publisher": "NÚCLEO ERP",
  "values": [
    {
      "code": "CODIGO_DEL_PARAMETRO",
      "data": { "type": "decimal", "value": "0.00" },
      "valid_from": "AAAA-MM-DD",
      "valid_until": "AAAA-MM-DD",
      "source": "Norma o URL oficial",
      "notes": "Opcional"
    }
  ]
}
```

Tipos de dato: `decimal`, `integer`, `text`, `table` (JSON estructurado para tramos).

## Catálogo de parámetros (a completar con fuentes verificadas)

| Código | Uso | Fase | Fuente | Estado |
|---|---|---|---|---|
| `IVA_TASA_GENERAL` | IVA estimado informativo | 11 | Por verificar | ⏳ Sin valor cargado |
| `REDONDEO_MONTOS` | Modo de redondeo de montos | 5 | Por definir con contador | ⏳ |
| `REDONDEO_ALCANCE_IMPUESTO` | Por línea o por documento | 5 | Por definir con contador | ⏳ |
| Parámetros de remuneraciones | Liquidación preliminar | V2 | Por verificar | ⏳ |

**Ningún valor se cargará sin fuente oficial verificada y, para los casos golden, sin revisión del
contador colaborador (D-07).**
