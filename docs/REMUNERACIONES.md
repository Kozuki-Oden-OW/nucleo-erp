# NÚCLEO ERP — Especificación funcional: Remuneraciones, imposiciones, LRE, Previred y F29

> Estado: **borrador de analista para revisión del contador colaborador (D-07)**. Fecha: 2026-10-07.
> Alcance: pyme simple (trabajadores dependientes del sector privado, AFP o sin AFP, Fonasa/Isapre,
> AFC, mutual/ISL, jornada ordinaria art. 22 o parcial art. 40 bis). NÚCLEO **prepara, valida, explica y
> exporta**; no envía nada a la DT, Previred ni al SII.
>
> Regla de oro (TAX_RULES.md, ADR-009): **ningún valor normativo en el código**. Todas las tasas, topes,
> tramos, UF, UTM, IMM y tablas van en paquetes `nucleo-rules` con `source`, `valid_from`, `valid_until`.
> Donde este documento muestra un número, es **solo para explicar o para casos golden**, con su fuente y fecha.

Fuentes base (abreviaturas usadas en el documento):

- **[MINEDUC]** Guía de aprendizaje N°1 "Cálculo de remuneración, finiquitos y obligaciones laborales",
  MINEDUC / PIIE, valores de **noviembre 2016** (89 págs). Las páginas citadas son las impresas al pie.
- **[LRE]** Dirección del Trabajo, *Suplemento: Manual Libro de Remuneraciones Electrónico*, enero 2022
  (77 págs). Páginas citadas = números impresos.
- **[SP-NCG368]** Superintendencia de Pensiones, Compendio de Normas del Sistema de Pensiones, Libro II,
  Título IX, Letra B, Anexo N°2 "Metodología de cálculo de liquidación de cotizaciones previsionales
  impagas" (texto reemplazado por NCG N°368 de 20-07-2026).
- Fuentes web 2025-2026 citadas en línea con su URL (sección 0).

---

## 0. Cambios estructurales vigentes que afectan el diseño (verificar al cargar cada paquete)

Las dos guías base son de 2016 y 2022. Desde entonces cambiaron reglas **estructurales** (no solo valores).
Se verificaron en la web el 2026-10-07; cada una debe reconfirmarse con el contador antes de cargar el paquete.

| # | Cambio | Efecto en NÚCLEO | Fuente |
|---|---|---|---|
| 0.1 | **Reforma de pensiones, Ley 21.735**: nueva **cotización del empleador** (no se descuenta al trabajador). **Ago-2025 a jul-2026: 1 %** = 0,1 % a cuenta individual (AFP) + 0,9 % al FAPP (compensación expectativa de vida). **Desde ago-2026: 3,5 %** = 0,1 % cuenta individual + 0,9 % "Cotización con Rentabilidad Protegida" + 2,5 % Seguro Social Previsional (incluye **SIS** y compensación por expectativa de vida). Luego sube gradualmente cada año hasta 7 % + SIS (≈ 8,5 % total). Se declara y paga **por Previred**, mismos plazos; el IPS recauda y traspasa al FAPP. Aplica también a trabajadoras de casa particular afiliadas. | Nuevos aportes del empleador con tasas por tramo de fechas (`COT_EMPL_*`). **El SIS deja de ser un aporte separado a la AFP desde ago-2026**: se imputa dentro del 2,5 %. El motor no puede tener "SIS" ni "cotización empleador" fijos: cada componente es un parámetro con vigencia. | SP: https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-10906.html ; Hacienda: https://www.hacienda.cl/noticias-y-eventos/noticias/implementacion-de-la-reforma-previsional-nueva-cotizacion-del-empleador-regira ; BioBio 30-07-2026: https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/07/30/a-partir-de-agosto-sube-la-cotizacion-previsional-quien-paga-el-aumento-y-que-cambia-con-la-reforma.shtml ; KPMG alerta 02-07-2026: https://assets.kpmg.com/content/dam/kpmgsites/cl/pdf/alerta-laboral/2026/07/Nueva%20CCE%20-%2002.07.2026%20CFS%20(002).pdf.coredownload.inline.pdf |
| 0.2 | Desglose operativo desde ago-2026 según un proveedor de remuneraciones (Buk): CI 0,1 % y Rentabilidad Protegida 0,9 % sobre **renta imponible de días trabajados**; SIS y Expectativa de Vida sobre **RI + RIMA de licencias** (de cargo del empleador); no aplica a pensionados ni a "activo mayor de 65"; en la nómina Previred se usan campos 95 (Rentabilidad Protegida), 29 (SIS, aunque recaude el Seguro Social) y 92 (RIMA). En el LRE el SIS sigue en **cód. 4155**. Hay discrepancia en la tasa SIS: KPMG cita **SIS 1,62 % desde abril 2026**; Buk desglosa SIS 1,5 % + Expectativa de Vida 1 %. | Distinguir bases: "imponible días trabajados" vs "imponible + RIMA licencias". **No hay códigos LRE nuevos** documentados para la cotización del empleador (manual de carga DT v8.0, mar-2023, último código 5565) → pregunta abierta §8. | Buk, "Reforma Previsional 2026": https://info.buk.cl/hubfs/Reforma%20Previsional%202026.pdf ; KPMG (arriba) |
| 0.3 | **Topes imponibles 2026**: **90 UF** (AFP, salud, Ley 16.744) y **135,2 UF** (seguro de cesantía) desde 01-02-2026. La SP **rectificó** una resolución de enero 2026 (89,9 UF / 135,1 UF) el 24-02-2026. | Los paquetes deben poder **reemplazar** un valor ya publicado (nueva versión del paquete con la corrección y recálculo de liquidaciones afectadas). | CNC, feb-2026: https://cnc.cl/wp-content/uploads/2026/02/03.-ACTUALIZACION-TOPES-DE-COTIZACIONES.pdf ; AAFP: https://www.aafp.cl/noticias/alza-topes-imponibles-2026-90-uf/ |
| 0.4 | **Ley 21.561 (40 horas)**: jornada máxima 44 h desde 26-04-2024; **42 h desde 26-04-2026**; 40 h en 2028. Factor HE: 0,0079545 (44 h), **0,0083333 (42 h)**. | `JORNADA_MAX_SEMANAL_HORAS` con vigencia; factor HE calculado desde la jornada pactada. Las guías (45 h, 0,0077777) quedan **obsoletas** salvo para goldens 2016. | Buk, cálculo hora extra: https://www.buk.cl/blog/calculo-hora-extra |
| 0.5 | **LRE**: obligatorio desde año comercial 2021 (Ley 21.327); carga masiva **CSV o TXT delimitado por ";"**, con encabezados, nombre `rutempleador_aaaamm`; plazo: la DT indica "dentro de los 15 días … del mes siguiente" (una página dice "15 días hábiles", otra "el día 15"; confirmar). | Ver §3. | DT: https://dt.gob.cl/portal/1626/w3-article-119843.html ; https://dt.gob.cl/portal/1628/w3-article-119853.html ; Manual de carga: https://static-content.api.dirtrab.cl/dt-docs/lre/lre_instrucciones_de_carga.pdf |
| 0.6 | **Cotizaciones impagas**: el anexo de liquidación de deuda fue reemplazado por NCG SP N°368 (20-07-2026): para cotizaciones devengadas **desde sept-2025 ya no hay recargo**; la deuda se actualiza con el "factor de reajuste e intereses" publicado mensualmente por la SP. | NÚCLEO no calcula deuda previsional; si se implementa un aviso de "cotizaciones atrasadas", debe usar la tabla oficial de la SP (no fórmulas propias). | [SP-NCG368] (archivo `fo-article-7322`) |
| 0.7 | **IUSC**: tabla mensual vigente con 8 tramos desde Ley 21.210 (2020) — distinta a la de 2016 de [MINEDUC]; primer tramo exento hasta 13,5 UTM ([LRE] p. 28). | Guardar tabla en UTM con vigencia; cuadrar contra la tabla en pesos publicada por el SII cada mes. | Art. 43 N°1 LIR; tabla SII mensual (www.sii.cl › Valores y fechas › Impuesto 2ª categoría) |

> Advertencia de fuentes: 0.1 está respaldado por la SP (fuente oficial). 0.2 y la tasa SIS vienen de
> asesores privados (Buk, KPMG) y **deben confirmarse** con la circular de la SP / instructivo Previred
> antes de cargar valores.

---

## 1. Algoritmo de la liquidación mensual (paso a paso, en orden)

### 1.0 Convenciones generales

- **Moneda y redondeo.** Todos los montos de la liquidación son pesos enteros (CLP). Regla propuesta (a
  confirmar con contador, parámetro `REM_REDONDEO_MODO`): calcular cada concepto con decimales
  (`rust_decimal`) y **redondear al peso más cercano (half-up) al final de cada concepto**, no en
  pasos intermedios. Así lo hace [MINEDUC] (p. ej. 860.815 × 11,44 % = 98.477,2 → 98.477, p. 75;
  547.006 × 10,77 % = 58.912,5 → 58.913, p. 76). Las sumas (totales) se hacen sobre conceptos ya
  redondeados (eso es lo que cuadra en los ejemplos).
- **Valores en UF** (tope imponible, plan Isapre, tope indemnización): se convierten con la UF del
  día que corresponda (ver parámetro de cada paso) y luego se redondean a peso.
  - Topes imponibles: UF del **último día del mes** de las remuneraciones (práctica Previred; confirmar
    con contador — [MINEDUC] p. 43 usa un único valor "noviembre 2016": 74,3 UF = $1.955.095).
  - Plan Isapre pactado: UF del **último día del mes** de la remuneración ([MINEDUC] p. 51 usa "Valor UF
    mes de noviembre $26.261,51", p. 57 usa 26.056,89; la guía es inconsistente, ver §8).
  - Tope indemnización por años de servicio y aviso previo (art. 172 CdT): UF del **último día del mes
    anterior al pago** ([LRE] p. 15).
- **Valores en UTM** (impuesto único): UTM **del mes en que se paga** la remuneración (tabla mensual SII).
- **Mes comercial de 30 días** para días trabajados y valor día ([LRE] p. 39-40, Dict. DT 5700/353 de 1999).
- Cada liquidación persistida guarda: `rule_set_code` (versión del paquete), UF y UTM usadas, y el
  detalle de cada paso (traza explicable "¿por qué este monto?").

### 1.1 Entradas del período

Por cada trabajador y período (`AAAA-MM`):

| Entrada | Origen | Notas |
|---|---|---|
| Contrato vigente | maestro `contratos` | sueldo base, tipo (indefinido/plazo fijo/obra), jornada (h/sem), gratificación pactada, haberes fijos pactados |
| Días trabajados, días de licencia, ausencias injustificadas, días de vacaciones | registro de asistencia del mes | LRE 1115, 1116, 1117 |
| Horas extra del mes (por tipo de recargo) | registro de asistencia | requiere pacto escrito (art. 32 CdT) |
| Haberes variables del mes (comisiones, tratos, bonos) | ingreso manual o importación | con su clasificación LRE (21xx…24xx) |
| Haberes no imponibles (colación, movilización, viático, desgaste, pérdida de caja) | contrato o ingreso manual | 23xx; validar "razonable y prudente" |
| Cargas familiares acreditadas y tramo | ficha trabajador | LRE 1111-1114 |
| Descuentos voluntarios / judiciales / anticipos | ingreso manual | 31xx; topes art. 58 CdT |
| Previsión (AFP o IPS), salud (Fonasa / Isapre y plan en UF o en $), AFC sí/no, APV | ficha trabajador | |
| Parámetros del período | paquete normativo | UF, UTM, IMM, topes, tasas, tabla IUSC, tabla asignación familiar |

### 1.2 Paso 1 — Sueldo base del mes (proporcional a días)

```
dias_pagables = dias_trabajados_LRE_1115           # 30 si trabajó todo el mes (aunque el mes tenga 28/29/31)
valor_dia     = sueldo_base_mensual / 30
sueldo_mes    = round(valor_dia × dias_pagables)    # si dias_pagables = 30 → sueldo_base_mensual exacto
```

Reglas para `dias_trabajados` ([LRE] p. 39-40):
1. Ingreso a mitad de ciclo: días efectivamente trabajados contados de corrido (ingreso el día 27 en mes
   de 31 días → 5 días).
2. Licencia médica: `días_del_mes_calendario − días_licencia` (mes de 31 con 10 días de licencia → 21).
   Los días de licencia **no los paga el empleador** (los paga Fonasa/Isapre/CCAF como subsidio), salvo
   convenio de pago directo (cód. 2201) — fuera del alcance V1.
3. Ausencia injustificada: `30 − días_ausencia` (descuento = sueldo/30 por día).
4. Si se combinan (1 o 2) con (3): primero 1/2, luego restar ausencias.

Parámetros: ninguno normativo. Validación: sueldo base proporcional ≥ IMM proporcional para jornada
ordinaria (`IMM_GENERAL`, o `IMM_MENOR18_MAYOR65`, proporcional a la jornada si es parcial; art. 44 CdT).

> Nota golden: en [MINEDUC] p. 36/76 (Luisa, "faltó dos días sin justificación") la guía **no descuenta**
> los días y paga sueldo base completo; NÚCLEO sí debe descontar. Ver §7 y §8.

### 1.3 Paso 2 — Horas extraordinarias (sobresueldo, LRE 2102)

Fórmula general (sueldo mensual, [LRE] p. 44, Dict. DT 2078/1985):

```
valor_hora_ordinaria = (sueldo_base_mensual / 30) × 28 / (jornada_semanal_horas × 4)
valor_hora_extra     = valor_hora_ordinaria × (1 + recargo)          # recargo ≥ 50 % (REM_HE_RECARGO_MIN)
monto_HE             = round(valor_hora_extra × horas_extra_mes)
```

- Con jornada de 45 h: 28/180 × 1,5 / 30 = **factor 0,0077777** ([LRE] p. 45; [MINEDUC] p. 20).
- **La jornada ordinaria máxima ya no es 45 h** (Ley 21.561, "40 horas"): ver §0. El factor **no** se
  guarda como constante: se calcula con la jornada pactada del contrato (que no puede superar el
  máximo legal vigente, parámetro `JORNADA_MAX_SEMANAL_HORAS`). Ej.: 44 h → 28/(30×176)×1,5;
  42 h → 28/(30×168)×1,5 = 0,0083333.
- Sueldo semanal: `sueldo_semanal / horas_semana × 1,5` (factor 0,0333333 con 45 h, [LRE] p. 45).
- Sueldo diario: `sueldo_diario × factor` (0,2 si 6 días; 0,1666667 si 5 días, con 45 h; [LRE] p. 45);
  generalizar: `(sueldo_diario × días_semana) / jornada_semanal × 1,5`.
- **Base mínima**: no se puede calcular HE sobre un sueldo inferior al IMM ([MINEDUC] p. 18): si
  `sueldo_base_mensual < IMM` (jornada completa), usar el IMM como base.
- Validaciones: máx. 2 HE por día (art. 31 CdT), pacto escrito vigente (máx. 3 meses, art. 32). NÚCLEO
  advierte; no bloquea.
- Redondeo: al peso, sobre el total del concepto (no por hora). [MINEDUC] p. 20: 10 HE × 2.002,75 = 20.028.

### 1.4 Paso 3 — Haberes variables y otros imponibles

- **Comisiones** (2103), **tratos** (2112), **bonos fijos** (2111), **bonos variables** (2113),
  **aguinaldo** (2110), **participación** (2105), **recargo domingo** (2107), **beneficios en especie**
  (2115): suma directa de lo ingresado, cada uno clasificado con su código LRE.
- **Semana corrida** (2104, art. 45 CdT): obligatoria si el trabajador tiene remuneración variable que
  se devenga **diariamente** (comisiones por venta individual, tratos). Algoritmo semanal ([MINEDUC]
  p. 23-24; [LRE] p. 46):
  ```
  para cada semana s del período:
      variable_s  = Σ remuneración variable diaria devengada en s
      dias_leg_s  = días que legalmente debió trabajar en s
                    − festivos − días con licencia médica (justificados)
                    (las ausencias injustificadas NO se restan)
      valor_dia_s = variable_s / dias_leg_s
      semana_corrida_s = valor_dia_s × (nº domingos + festivos de s)
  semana_corrida = round(Σ semana_corrida_s)
  ```
  Variante mensual admitida por la DT (Dict. 110/1 de 2009): `Σ variable mes / días que debió trabajar
  en el mes × (domingos + festivos del mes)`. NÚCLEO debe permitir elegir el método por contrato
  (`metodo_semana_corrida = semanal | mensual`). Requiere un **calendario de feriados** por año como
  paquete normativo (`FERIADOS_NACIONALES`), con fuente (ley/decreto).
  - Base: solo remuneraciones principales, ordinarias y de devengo diario ([LRE] p. 46-47). Excluye
    bonos mensuales, gratificación, no imponibles.

### 1.5 Paso 4 — Gratificación legal (2106)

Dos regímenes; el contrato define cuál (`gratificacion_modo`):

**(a) Art. 50 CdT — 25 % con tope (el habitual en pymes, pago mensual anticipado):**
```
base_grat      = sueldo_mes + HE + comisiones + semana_corrida + tratos + bonos imponibles del mes
                 (remuneraciones mensuales devengadas; DT: incluye horas extra — [MINEDUC] p. 20, "Cálculo N°1")
grat_25        = base_grat × 25 %                                   # GRAT_ART50_TASA
tope_mensual   = IMM × 4,75 / 12                                    # GRAT_ART50_TOPE_IMM_FACTOR, IMM vigente
gratificacion  = round(min(grat_25, tope_mensual))
```
- El tope anual es 4,75 IMM; mensualizado = 4,75 × IMM / 12 ([MINEDUC] p. 20: 257.500 × 4,75 / 12 =
  101.927, IMM 1-jul-2016).
- **¿Qué IMM?** El vigente en el mes (si el IMM cambia a mitad de año el tope mensual cambia). Al cierre
  del ejercicio (o al término del contrato) corresponde **reliquidar** el tope anual: suma de
  gratificaciones pagadas ≤ 4,75 × IMM vigente al cierre (criterio DT). V1: advertir; V2: reliquidación
  anual automática. **Pregunta para contador** (§8).
- Si el contrato es por fracción de año / ingreso a mitad de año: tope proporcional a meses trabajados.
- Proporcionalidad por días: el 25 % ya se aplica sobre remuneraciones proporcionales; el **tope**
  mensual, ¿se proporciona por días trabajados? (práctica habitual: sí, tope × días/30). **Pregunta (§8).**

**(b) Art. 47 CdT — 30 % de la utilidad líquida**, repartida en proporción a remuneraciones anuales:
```
factor = (30 % utilidad_liquida) / total_remuneraciones_devengadas_año
grat_anual_trab = factor × remuneración_anual_trab
```
([MINEDUC] p. 20: 19.604.000 / 43.850.400 = 0,4471; 0,4471 × 3.090.000 = 1.381.539.) Se paga una vez al
año (2122 / 2113 con reliquidación por devengo anual, [LRE] p. 49-50). **Fuera de V1**: NÚCLEO solo
registra el monto ingresado y avisa de la reliquidación previsional/tributaria.

**(c) Gratificación convencional** (monto pactado ≥ legal): monto fijo del contrato; NÚCLEO compara con
el art. 50 y avisa si es menor.

### 1.6 Paso 5 — Total imponible (LRE 5210 + 5220)

```
total_imponible = Σ haberes 21xx (imponibles y tributables) + Σ haberes 22xx (imponibles no tributables)
```
Una asignación **es imponible si es remuneración (art. 41 CdT), aunque supere el tope** ([LRE] p. 11).
Todo lo que no esté expresamente en la lista de no-remuneraciones del art. 41 inc. 2 es remuneración
([MINEDUC] p. 33). NÚCLEO clasifica cada concepto del catálogo con su código LRE y sus banderas
`imponible`, `tributable`, `base_gratificacion`, `base_semana_corrida`, `base_indemnizacion`.

### 1.7 Paso 6 — Topes imponibles (renta imponible afecta)

```
uf_cierre        = UF del último día del mes de remuneraciones
tope_afp_salud   = round(TOPE_IMPONIBLE_AFP_UF × uf_cierre)         # mismo tope: AFP, SIS, salud, Ley 16.744, SANNA, trabajo pesado
tope_afc         = round(TOPE_IMPONIBLE_AFC_UF × uf_cierre)         # seguro de cesantía (tope mayor)
tope_ips         = round(TOPE_IMPONIBLE_IPS_UF × uf_cierre)         # régimen antiguo IPS: 60 UF sin reajuste ([LRE] p. 12)

imponible_prev   = min(total_imponible, tope_afp_salud)    # (o tope_ips si está en IPS)
imponible_afc    = min(total_imponible, tope_afc)
```
- El tope AFP/salud lo fija cada año la Superintendencia de Pensiones según índice de remuneraciones
  reales INE ([LRE] p. 11 nota 5; [MINEDUC] p. 41). Valores históricos de referencia: 74,3 UF (2016,
  [MINEDUC] p. 43), 81,6 UF (2021-2022, Res. Ex. SP N°8/2021, [LRE] p. 11); AFC 111,4 UF (2016) y
  122,6 UF (2021-2022, Res. Ex. SP N°7/2021, [LRE] p. 12). **Valor 2026: ver §0 / §5.**
- **Renta mínima imponible**: si el trabajador trabajó el mes completo, el imponible no puede ser
  inferior al IMM (proporcional en jornada parcial). Parámetros `IMM_GENERAL`, `IMM_MENOR18_MAYOR65`,
  `IMM_CASA_PARTICULAR` ([MINEDUC] p. 43). NÚCLEO advierte si `total_imponible < IMM × días/30`.
- **Remuneraciones devengadas en más de un mes** (bonos trimestrales, gratificación anual): para el tope
  se prorratean a sus meses de devengo y se reliquida ([LRE] p. 12-13). V1: advertir y permitir
  ingreso manual de la reliquidación; V2: automatizar.

### 1.8 Paso 7 — Cotización AFP del trabajador (LRE 3141)

```
cot_afp_obligatoria = imponible_prev × AFP_COTIZACION_OBLIGATORIA      # 10 % (art. 17 DL 3.500)
cot_afp_comision    = imponible_prev × AFP_COMISION[afp, periodo]      # comisión de la AFP del trabajador
cot_afp_total       = round(imponible_prev × (10 % + comisión))        # LRE 3141
```
- [MINEDUC] p. 43-44 trata la tasa como una sola ("Capital 11,44 %") y redondea **una sola vez** sobre
  la tasa sumada: 381.006 × 11,44 % = 43.587; 1.955.095 × 11,48 % = 224.445. Previred también declara la
  AFP como un monto (10 % + comisión). Regla propuesta: **una multiplicación con la tasa total**.
- La comisión es **por AFP y por mes** (las AFP la cambian): parámetro tabla `AFP_COMISION` con vigencia,
  fuente SP (www.spensiones.cl) o tabla Previred de indicadores.
- Excepciones: pensionado por vejez (1109 = 1) **no** cotiza 10 % obligatorio ni SIS (puede seguir
  cotizando salud; confirmar con contador), trabajador "no está en AFP" (1141 = 100, p. ej. IPS o
  técnico extranjero Ley 18.156, 1146 = 1).
- Trabajo pesado (1154): cotización adicional trabajador `TRAB_PESADO_TASA` (1 % o 2 % según calificación,
  [MINEDUC] p. 41) → LRE 3154, y aporte igual del empleador → LRE 4154.
- APV (3155/3156/3157/3158) y depósito convenido (3147): descuentos voluntarios con efecto tributario
  (modalidad B rebaja la base del IUSC hasta `APV_B_TOPE_MENSUAL_UF`, 50 UF, [LRE] p. 69).

### 1.9 Paso 8 — SIS (Seguro de Invalidez y Sobrevivencia)

```
sis_empleador = round(imponible_prev × SIS_TASA[periodo])           # LRE 4155, de cargo del EMPLEADOR
```
- De cargo del empleador desde julio 2011 ([MINEDUC] p. 41; [LRE] p. 67, 75). Excepción: trabajador
  joven con subsidio previsional (1118 = 1) → el SIS lo paga el trabajador y se suma en 3141; 4155 = 0.
- Tasa SIS cambia con cada licitación del seguro; con la reforma de pensiones (Ley 21.735) el SIS se
  integra/ajusta (ver §0). Parámetro con vigencia.
- No aplica a pensionados ([MINEDUC] p. 43 nota 2).

### 1.10 Paso 9 — Salud (LRE 3143 y 3144)

```
salud_7  = round(imponible_prev × SALUD_COTIZACION_LEGAL)           # 7 % — LRE 3143

si salud = FONASA:
    descuento_salud = salud_7 ; adicional = 0
si salud = ISAPRE:
    plan_pesos = round(plan_UF × UF_periodo)   # o plan en $ / o plan en % pactado
    adicional  = max(0, plan_pesos − salud_7)  # "cotización adicional voluntaria" — LRE 3144
    descuento_salud = salud_7 + adicional      # = max(plan_pesos, salud_7)
    # si salud_7 > plan_pesos, la diferencia queda como "excedente" en la Isapre; igual se descuenta el 7 %
```
- [MINEDUC] p. 51: plan 5,5 UF × 26.261,51 = 144.438; 7 % = 26.670; adicional 117.768.
  p. 52: plan 5,0 UF = 126.053 < 7 % 136.857 → se descuenta 136.857 (excedente).
- **Tributación**: según [LRE] p. 67, "solo será tributable aquella parte de la cotización voluntaria
  que supere el monto que resulte de calcular el 7 % del tope máximo imponible en UF".
  Es decir: `rebaja_salud_IUSC = min(salud_7 + adicional, round(SALUD_COTIZACION_LEGAL × tope_afp_salud))`.
  Nota: [MINEDUC] p. 75 rebaja solo el 7 % (60.257), no el plan completo (78.171), aunque 78.171 < 7 % del
  tope; **contradice** la regla del [LRE]. **Pregunta crítica para el contador (§8).**
- Fonasa con CCAF: el 7 % se informa completo en 3143; la distribución (CCAF 0,6 % / Fonasa 6,4 %) la hace
  Previred ([LRE] p. 67). NÚCLEO no necesita la tasa CCAF para la liquidación, sí para la planilla
  Previred (parámetro `CCAF_TASA_SALUD`, ver §4).
- Ley 21.674 / GES / "plan en %": admitir plan pactado en UF, en pesos o en % del imponible.

### 1.11 Paso 10 — Seguro de cesantía (AFC) (LRE 3151 / 4151)

```
si afiliado_afc (1151 = 1):
    segun tipo_contrato:
      indefinido:          trab = AFC_TRAB_INDEF (0,6 %)  ; empl = AFC_EMPL_INDEF (2,4 %)
      plazo fijo / obra:   trab = 0                         ; empl = AFC_EMPL_PLAZO (3,0 %)
    # tras 11 años de cotización en la misma relación laboral (indefinido):
    si antigüedad > AFC_MAX_ANIOS_CI (11):  trab = 0 ; empl = AFC_EMPL_SOLIDARIO_POST11 (0,8 %)
    afc_trabajador = round(imponible_afc × trab)    # LRE 3151
    afc_empleador  = round(imponible_afc × empl)    # LRE 4151
```
- Tasas y división cuenta individual / fondo solidario: [MINEDUC] p. 54-55 (indefinido 0,6 + 1,6/0,8;
  plazo fijo 2,8/0,2); 11 años: [LRE] p. 35 (art. 9 Ley 19.728). Confirmar vigencia 2026 (§0).
- Tope distinto y mayor (`TOPE_IMPONIBLE_AFC_UF`).
- Licencia médica: el 0,6 % del trabajador por los días de licencia lo paga la entidad pagadora del
  subsidio; el empleador cotiza su parte normalmente ([MINEDUC] p. 55). En la liquidación del mes se usa
  el imponible efectivamente pagado; **la cotización del empleador sobre días de licencia** (aporte 2,4 %
  sobre la última remuneración) es una regla especial → **pregunta (§8)**.
- Trabajadores de casa particular, menores de 18 años, pensionados (excepto invalidez parcial),
  contratos de aprendizaje: no cotizan AFC (Ley 19.728 art. 2) — validar con contador.
- Contratos anteriores al 02-10-2002 pueden no estar afiliados (1151 = 0) ([LRE] p. 35).

### 1.12 Paso 11 — Aportes del empleador (no se descuentan al trabajador)

| Aporte | Fórmula | LRE | Parámetro |
|---|---|---|---|
| SIS | `imponible_prev × SIS_TASA` | 4155 | `SIS_TASA` |
| Seguro cesantía empleador | ver 1.11 | 4151 | `AFC_EMPL_*` |
| Ley 16.744 (accidentes) + SANNA | `imponible_prev × (LEY16744_TASA_BASICA + tasa_adicional_empresa + SANNA_TASA)` | 4152 | `LEY16744_TASA_BASICA` (valor por verificar), tasa adicional diferenciada por empresa (D.S. 67, la informa la mutual/ISL), `SANNA_TASA` (0,03 % según art. 24 Ley 21.063, [LRE] p. 75) |
| Trabajo pesado empleador | `imponible_prev × TRAB_PESADO_TASA` | 4154 | |
| Indemnización a todo evento (art. 164) | `min(imponible, 90 UF) × tasa_pactada (≥ 4,11 %)` | 4131 (+1131, 1132) | `IAS_TODO_EVENTO_TASA_MIN` ([LRE] p. 43) |
| APV colectivo empleador | pactado | 4157 | |
| **Cotización empleador Ley 21.735 (reforma de pensiones)** | `imponible_prev × COT_EMPLEADOR_*[periodo]` (gradual desde ago-2025) | ver §0 y §3 | `COT_EMPL_CI_TASA`, `COT_EMPL_SEGURO_SOCIAL_TASA` / `COT_EMPL_FAPP` |

- La tasa Ley 16.744 es **por empresa** (cotización básica + adicional según siniestralidad), se guarda
  en la configuración del empleador con vigencia, no en el paquete nacional. El paquete nacional guarda
  solo la básica y SANNA.
- Total aportes empleador = LRE 5410. Costo empresa = total haberes + aportes empleador.

### 1.13 Paso 12 — Base tributable e Impuesto Único de Segunda Categoría (IUSC)

```
base_tributable = Σ haberes tributables (21xx + 24xx; excluye 22xx y 23xx)
                − cot_afp_total (3141)                          # rebajable hasta el tope imponible (ya topada)
                − rebaja_salud (ver 1.10: 7 % y adicional hasta 7 % × tope)
                − afc_trabajador (3151)                         # exento (art. 42 N°1 LIR; [MINEDUC] p. 53)
                − trabajo pesado trabajador (3154)
                − APV modalidad B (3156/3158), con tope APV_B_TOPE_MENSUAL_UF
                − rebaja zona extrema DL 889 (3167), si aplica
                # NO se rebaja: SIS (empleador), aportes empleador, cuota sindical NO es rebaja (art. 17 N°11
                #   es para el sindicato), descuentos voluntarios, anticipos, préstamos.

tramo           = buscar en IUSC_TABLA[mes de pago] el tramo donde cae base_tributable
                  (tabla en UTM: desde/hasta × UTM_mes; factor; cantidad a rebajar en UTM × UTM_mes)
impuesto        = round(base_tributable × factor − rebaja_pesos)   # ≥ 0
                                                                    # LRE 3161
```
- Tabla mensual SII: 8 tramos, primer tramo exento hasta 13,5 UTM ([LRE] p. 28, art. 43 N°1 LIR),
  tasa marginal máxima 40 % ([MINEDUC] p. 59). La tabla se publica en pesos por mes; NÚCLEO la debe
  guardar **en UTM** (factor y rebaja en UTM) y convertir con la UTM del mes, o guardar la tabla en
  pesos del SII mes a mes — **decisión: guardar en UTM** con `UTM_MENSUAL` por mes y verificar contra la
  tabla publicada por el SII (test de cuadratura en el paquete).
  - Referencia [MINEDUC] p. 60 (noviembre 2016, UTM = 46.091 implícita: 622.228,50 / 13,5):
    | Desde | Hasta | Factor | Rebaja |
    |---|---|---|---|
    | — | 622.228,50 | exento | — |
    | 622.228,51 | 1.382.730,00 | 0,04 | 24.889,14 |
    | 1.382.730,01 | 2.304.550,00 | 0,08 | 80.198,34 |
    | 2.304.550,01 | 3.226.370,00 | 0,135 | 206.948,59 |
    | 3.226.370,01 | 4.148.190,00 | 0,23 | 513.453,74 |
    | 4.148.190,01 | 5.530.920,00 | 0,304 | 820.419,80 |
    | 5.530.920,01 | 6.913.650,00 | 0,355 | 1.102.496,72 |
    | 6.913.650,01 | y más | 0,40 | 1.413.610,97 |
    (Los tramos y factores **cambiaron** con la Ley 21.210 de 2020; esta tabla es solo para el golden 2016.)
- Ejemplo [MINEDUC] p. 60: imponible 982.326 − AFP 166.909 − salud 87.126 − AFC 7.468 = 720.823;
  720.823 × 0,04 − 24.889,14 = 3.943,78 → **3.944**.
- **Redondeo** del impuesto: al peso ([MINEDUC] usa half-up: 2.987,5 → 2.988, p. 75). Confirmar con SII
  (algunas planillas truncan). Parámetro `IUSC_REDONDEO`.
- Mayor retención voluntaria (3163), reliquidaciones de períodos anteriores (3164/3165): V2.
- Varios empleadores: cada empleador retiene por separado; reliquidación anual la hace el trabajador.
- Sueldo empresarial (2161) también paga IUSC (3161), pero sin rebaja Ley 16.744 ([LRE] p. 56-58).
- Obrero agrícola (1170 = 2) e impuesto adicional (1170 = 3): fuera de V1, marcar "no soportado".

### 1.14 Paso 13 — Haberes no imponibles (23xx)

```
colacion     = monto_diario × dias_trabajados   (o monto mensual pactado)      # 2301
movilizacion = monto_diario × dias_trabajados   (o mensual)                    # 2302
viatico      = ingresado (con respaldo)                                        # 2303
perdida_caja, desgaste_herramientas, sala_cuna, teletrabajo, …                 # 2304, 2305, 2308, 2309
asignacion_familiar = valor_por_carga[tramo] × n_cargas (× proporcional)      # 2311
```
- Asignación familiar ([LRE] p. 36-38; [MINEDUC] p. 31-32):
  - El **tramo** se determina por el **promedio de la remuneración del semestre enero-junio anterior**
    ([LRE] p. 37), no por el imponible del mes (la guía [MINEDUC] p. 32 usa el imponible del mes; es una
    simplificación pedagógica → §8). Para plazo fijo/obra ≤ 6 meses: promedio julio-junio.
  - Proporcional a días con remuneración imponible (mes de 30 días); con 25 o más días se paga completa
    ([LRE] p. 36).
  - El empleador la paga y la **recupera** descontándola de las cotizaciones a pagar (Previred, ver §4).
  - Tabla de tramos y montos: parámetro `ASIG_FAMILIAR_TRAMOS` (cambia normalmente cada año por ley de
    reajuste; [LRE] p. 37 cita D.S. N°2 Hacienda 2022: $14.366 hasta $366.987, etc.).
- Validación "razonable y prudente": NÚCLEO compara colación/movilización con un umbral configurable
  por la empresa y advierte (no hay valor legal; [MINEDUC] p. 28-29).

### 1.15 Paso 14 — Total haberes

```
total_haberes (5201) = 5210 + 5220 + 5230 + 5240
```

### 1.16 Paso 15 — Descuentos voluntarios, judiciales y anticipos

| Descuento | LRE | Regla / tope |
|---|---|---|
| Cuota sindical 1..10 | 3171-3180 (+ RUT sindicato 1171-1180) | obligatorio a requerimiento (art. 262 CdT) |
| Crédito social CCAF | 3110 | se retiene y remesa a la CCAF por Previred; límites Suseso (Circ. 2.052/2.824) |
| Cuota vivienda/educación art. 58 | 3181 | tope 30 % (inc. 2 art. 58) |
| Crédito cooperativa | 3182 | hasta 25 % (Ley 19.832) |
| Otros autorizados por el trabajador | 3183 | tope 15 % de la remuneración total (inc. 3 art. 58) |
| Donaciones | 3184 | |
| Otros art. 58 | 3185 | |
| Pensión de alimentos | 3186 | orden judicial; prioridad |
| Descuento mujer casada art. 59 | 3187 | orden judicial |
| Anticipos / préstamos del empleador | 3188 | |

- **Tope conjunto** de descuentos facultativos (incisos 2 y 3 art. 58): **45 %** de la remuneración total
  ([MINEDUC] p. 63-64; Dict. DT 4565/094). NÚCLEO calcula `% sobre remuneración total` y **bloquea con
  confirmación** si supera los topes (15 % / 30 % / 45 %).
- **Anticipos**: se descuentan después del "alcance líquido" ([MINEDUC] p. 69, 75: alcance líquido
  823.314 − anticipo 150.000 = 673.314). En el LRE el [LRE] p. 74 define 3188 como "anticipos y préstamos
  otorgados en períodos mensuales previos"; **¿el anticipo pagado dentro del mismo mes va en 3188 o no se
  informa?** → §8. Propuesta: informarlo en 3188 (práctica común) previa validación.

### 1.17 Paso 16 — Líquido

```
total_descuentos (5301) = Σ 31xx (excepto 3164, informativo)
alcance_liquido         = total_haberes − (descuentos previsionales + impuesto + otros descuentos excepto anticipo)
liquido_a_pagar         = total_haberes − total_descuentos          # LRE 5501 (incluye anticipo en 3188)
```
- Validar que `liquido_a_pagar ≥ 0` y que las cotizaciones obligatorias e impuesto se descuentan antes
  que los voluntarios (orden de prelación: legales → judiciales → voluntarios). Si el líquido no alcanza,
  NÚCLEO avisa y no descuenta lo voluntario que no cabe.
- Subtotales LRE: 5341 (cotizaciones trabajador = 3141+3143+3144+3146+3151+3154+3155+3156+3157+3158),
  5361 (3161+3165), 5362 (3162), 5302 (= 5301 − 5361 − 5362 − 5341), 5410 (Σ 41xx) — [LRE] p. 76-77.

### 1.18 Resumen del orden de cálculo (pipeline)

```
1 días → 2 sueldo proporcional → 3 HE → 4 variables + semana corrida → 5 gratificación
→ 6 total imponible → 7 topes → 8 AFP → 9 SIS → 10 salud → 11 AFC → 12 aportes empleador
→ 13 base tributable → 14 IUSC → 15 no imponibles + asig. familiar → 16 total haberes
→ 17 descuentos voluntarios/judiciales (con topes) → 18 anticipos → 19 líquido → 20 totales LRE
```
Cada paso es una función pura `fn(paso_input, &ReglasPeriodo) -> PasoResultado { monto, traza }`
en `nucleo-core` (sin I/O), probada con los casos golden.

---

## 2. Finiquito básico

> [MINEDUC] **no trae un ejemplo resuelto de finiquito** (el módulo lo enuncia en la introducción, p. 6,
> pero la guía N°1 solo cubre liquidaciones). Las reglas siguientes salen de [LRE] p. 14-21 y del CdT.
> **No hay caso golden de finiquito en el material**: hay que pedirlo al contador (§8).

### 2.1 Componentes y orden

```
finiquito = (a) remuneración del mes de término (liquidación proporcional normal, §1, con días hasta la fecha de término)
          + (b) feriado: pendiente (anualidades no tomadas) + proporcional          → LRE 2313
          + (c) indemnización sustitutiva del aviso previo (si corresponde)         → LRE 2315
          + (d) indemnización por años de servicio (si corresponde)                 → LRE 2314
          + (e) otras: fuero (2316), a todo evento art. 164 (2331), tiempo servido obra/faena,
                contractual/voluntaria (parte no renta en 2313/2314/2315; exceso tributable en 2417/2418)
          − descuentos: cotizaciones e impuesto SOLO sobre (a) (las indemnizaciones legales no son
                imponibles ni renta, art. 41 inc. 2 y art. 178 CdT), préstamos/anticipos pendientes,
                y (si causal art. 161) aporte del empleador a la cuenta individual AFC (art. 13 Ley 19.728)
```

### 2.2 Base de cálculo "última remuneración mensual" (art. 172 CdT; [LRE] p. 15)

```
base_172 = Σ lo que percibía por sus servicios al terminar (sueldo, bonos fijos, comisiones, especies,
           INCLUIDAS las cotizaciones de cargo del trabajador)
         − EXCLUIDOS: asignación familiar, horas extra, beneficios esporádicos o anuales
           (gratificación anual, aguinaldos)
si remuneración variable: promedio de los últimos 3 meses calendario
base_172 = min(base_172, TOPE_IAS_UF (90) × UF del último día del mes anterior al pago)
```
- **Pregunta**: ¿la gratificación mensual (art. 50) pagada todos los meses entra en la base? Hay
  jurisprudencia dividida → parámetro por empresa `ias_incluye_gratificacion_mensual` + §8.
- No-imponibles (colación, movilización): la DT y la jurisprudencia los incluyen si son permanentes y se
  pagan en dinero; también a confirmar.

### 2.3 Fórmulas

| Concepto | Procede | Fórmula | Tope |
|---|---|---|---|
| Años de servicio (IAS) | Causal art. 161 (necesidades de la empresa = 18, desahucio = 19) con ≥ 1 año | `años = años completos + (1 si fracción > 6 meses)`; `IAS = base_172 × min(años, IAS_TOPE_ANIOS)` | 330 días = 11 años (contratos desde 14-08-1981); base tope 90 UF ([LRE] p. 15) |
| Aviso previo | Art. 161 sin aviso escrito con 30 días | `= base_172` (una remuneración) | 90 UF |
| Feriado proporcional | Siempre al terminar (cualquier causal) | ver 2.4 | — |
| Tiempo servido obra/faena | Causal 159 N°5 (= 7), contrato ≥ 1 mes | `días_por_mes × meses (+1 si fracción > 15 días) × base/30`; contratos desde 01-01-2022: 2,5 días/mes ([LRE] p. 17-18) | `OBRA_FAENA_DIAS_POR_MES` por fecha de contrato |
| A todo evento (art. 164) | Pacto, años 7 a 11 | saldo acumulado en AFP (aportes 4131) | tasa ≥ 4,11 %, base 90 UF ([LRE] p. 43) |

Causales LRE 1104 ([LRE] p. 22-23): 3 mutuo acuerdo, 4 renuncia, 5 muerte, 6 vencimiento plazo,
7 conclusión obra, 8 caso fortuito, 24-29 art. 160 N°1 a)-f), 11-16 art. 160 N°2-7, 18 necesidades de la
empresa, 19 desahucio, 20 art. 163 bis (liquidación concursal).

Recargos judiciales (art. 168: 30 %-100 %) y la Ley Bustos (nulidad del despido por cotizaciones
impagas, art. 162) quedan **fuera de V1**, pero NÚCLEO debe **bloquear/advertir** el finiquito por
art. 161 si hay cotizaciones del trabajador no pagadas (alerta: "el despido podría ser nulo").

### 2.4 Feriado (vacaciones) pendiente y proporcional

```
días_hábiles_anuales = FERIADO_DIAS_HABILES_BASE (15) + progresivo (1 día por cada 3 años sobre 10 años
                       de trabajo, acreditados; art. 68)
feriado_pendiente_hábiles   = anualidades cumplidas no gozadas × días_hábiles_anuales − días ya tomados
feriado_proporcional_hábiles = días_hábiles_anuales / 12 × meses desde la última anualidad
                              (+ fracción de mes: /30 por día)   # 15/12 = 1,25 día hábil por mes
días_a_pagar (corridos)      = convertir hábiles a corridos contando desde el día siguiente al término:
                              se agregan los sábados, domingos y festivos que caigan en ese lapso
                              (sábado inhábil para feriado, art. 69 CdT) — requiere FERIADOS_NACIONALES
valor_día                    = remuneración íntegra art. 71 / 30
                              (fija: sueldo; variable: promedio últimos 3 meses trabajados; incluye
                               semana corrida desde Ley 20.613, [LRE] p. 17 nota 17)
indemnización_feriado        = round(días_a_pagar × valor_día)                → LRE 2313
```
No es imponible ni renta si respeta los límites ([LRE] p. 16-17, Circ. SII 73/1997).

### 2.5 Tributación de indemnizaciones ([LRE] p. 14-21)

- Legales (2313, 2314, 2315, 2316, obra/faena) dentro de límites: **no renta** (art. 178 CdT).
- Contractuales / voluntarias: no renta hasta `promedio_24m_reajustado_IPC × años_servicio −
  indemnizaciones_legales_pagadas` (art. 17 N°13 LIR, excluye gratificaciones/bonos del promedio);
  el exceso es tributable → 2417 (voluntaria) / 2418 (contractual), con IUSC calculado por art. 46 LIR
  (se entiende devengada en los últimos 12 meses → reliquidación) → impuesto en 3162.
  **V1: no calcular; pedir al usuario el monto tributable y advertir "requiere contador".**
- Tiempo servido < 6 meses: las contractuales/voluntarias son íntegramente tributables.

### 2.6 Cómo se informa en el LRE

En el LRE del **mes en que termina** la relación (o en que se paga):
- 1103 Fecha término (dd/mm/aaaa), 1104 Causal (código tabla), 1115 días trabajados hasta el término.
- Haberes del mes normales (21xx...) con sus cotizaciones (3141, 3143, 3151, 41xx) e impuesto 3161.
- 2313 feriado, 2314 IAS, 2315 aviso previo, 2316 fuero, 2331 todo evento, 2417/2418 exceso tributable.
- 3162 impuesto por indemnizaciones; 3188 anticipos/préstamos descontados.
- Totales: 5502 = 2313+2314+2315+2316+2331+2417+2418; 5564 = 2417+2418; 5565 = 2313+2314+2315+2316+2331;
  5362 = 3162. Los 23xx entran en 5230 y los 24xx en 5240 (y por tanto en 5201 y 5501).
- El descuento del aporte AFC del empleador (art. 13 Ley 19.728) se registraría como descuento: **¿en qué
  código?** (¿3185 "otros art. 58" o se neto contra 2314?) → §8.

---

## 3. Estructura del LRE (Libro de Remuneraciones Electrónico)

### 3.1 Formato del archivo

| Aspecto | Regla | Fuente |
|---|---|---|
| Tipo | CSV o TXT | DT art. 119843 / 119853; manual de carga |
| Separador | punto y coma `;` | ídem |
| Encabezados | obligatorios, una columna por concepto, nombre con el código entre paréntesis, p. ej. `Rut trabajador(1101)`, `Sueldo(2101)`, `Total haberes(5201)`. **No se pueden agregar ni eliminar columnas** respecto del formato establecido. | Manual de carga DT (texto exacto de los headers: tomarlo de la planilla oficial, ver §8) |
| Nombre | `rutempleador_aaaamm` (RUT sin DV según ejemplo `615020001_202103`; confirmar si lleva DV) | DT art. 119853 |
| Codificación | ANSI (Windows-1252) según el manual | manual de carga |
| RUT | sin puntos, con guion, sin cero inicial: `12345678-9` | [LRE] p. 22 |
| Fechas | `dd/mm/aaaa` | [LRE] p. 22 |
| Montos | enteros positivos, sin separador de miles | manual de carga |
| Decimales | solo 1115, 1116 (días) y 1132 (tasa) | manual de carga |
| Largo máx. por concepto | 40 caracteres | manual de carga |
| Una fila | por trabajador y período (incluye finiquitados del mes) | [LRE] |
| Rectificación | se re-carga el período completo; necesaria para reliquidaciones (2116-2122, 3165) | [LRE] p. 49-55, 70-71 |
| Plazo | dentro de los 15 días del mes siguiente al pago (confirmar hábiles/corridos) | DT |

### 3.2 Campos (código, nombre, tipo, origen en NÚCLEO)

Tipo: `T` texto/código, `F` fecha, `N` entero, `D` decimal. Obl. = obligatorio según manual de carga DT
(marcados ✔); ◐ = obligatorio para una pyme simple cuando aplica.

**A. Identificación (11xx)** — [LRE] p. 22-43

| Cód | Nombre | Tipo | Obl. | Origen NÚCLEO |
|---|---|---|---|---|
| 1101 | Rut trabajador | T | ✔ | `trabajadores.rut` |
| 1102 | Fecha inicio contrato | F | ✔ | `contratos.fecha_inicio` (relación laboral) |
| 1103 | Fecha término contrato | F | ◐ | `finiquitos.fecha_termino` si termina en el mes |
| 1104 | Causal término | T (tabla) | ◐ (si 1103) | `finiquitos.causal_lre` |
| 1105 | Región prestación servicios | N (1-16) | ✔ | `contratos.region_lre` (tabla regiones, ojo: código 8 = "Concepción" en el manual = Biobío) |
| 1106 | Comuna prestación servicios | N (tabla CUT) | ✔ | `contratos.comuna_lre` (ej. Frutillar = 10105) |
| 1170 | Tipo impuesto a la renta | N (1/2/3) | ✔ | `contratos.tipo_impuesto` (V1: siempre 1) |
| 1146 | Técnico extranjero Ley 18.156 | N (0/1) | ✔ | `trabajadores.tecnico_extranjero` |
| 1107 | Tipo de jornada | N (101, 201, 301, 401-412, 501, 601, 701) | ✔ | `contratos.tipo_jornada_lre` (V1: 101 ordinaria, 201 parcial, 701 exenta art. 22) |
| 1108 | Discapacidad / pensión invalidez | N (0-3) | ✔ | `trabajadores.discapacidad_lre` |
| 1109 | Pensionado por vejez | N (0/1) | ✔ | `trabajadores.pensionado_vejez` |
| 1141 | AFP | N (100 no AFP, 6 Provida, 11 PlanVital, 13 Cuprum, 14 Habitat, 19 Uno, 31 Capital, 103 Modelo) | ✔ | `afiliaciones.afp_codigo` |
| 1142 | IPS (ex INP) | N (0 = no; tabla regímenes) | ✔ | `afiliaciones.ips_regimen` |
| 1143 | Fonasa / Isapre | N (102 Fonasa, 1 Cruz Blanca, 3 Banmédica, 4 Colmena, 9 Consalud, 12 Vida Tres, 37-43 cerradas/otras) | ✔ | `afiliaciones.salud_codigo` |
| 1151 | AFC | N (0/1) | ✔ | `afiliaciones.afc` |
| 1110 | CCAF | N (0 no, 1 Los Andes, 2 La Araucana, 3 Los Héroes, 4 18 de Septiembre) | ✔ | `empleador.ccaf_codigo` |
| 1152 | Org. administrador Ley 16.744 | N (0 ISL, 1 ACHS, 2 Mutual CChC, 3 IST) | ✔ | `empleador.mutual_codigo` |
| 1111 | Nº cargas familiares legales | N | ✔ | `cargas_familiares` (vigentes, tipo simple) |
| 1112 | Nº cargas maternales | N | ✔ | ídem |
| 1113 | Nº cargas invalidez | N | ✔ | ídem |
| 1114 | Tramo asignación familiar | T (A/B/C/D/S) | ✔ | `trabajadores.tramo_asig_familiar` (por semestre) |
| 1171-1180 | Rut organización sindical 1..10 | T | ◐ | `descuentos_sindicales.rut_sindicato` |
| 1115 | Días trabajados en el mes | D | ✔ | paso 1 (§1.2) |
| 1116 | Días licencia médica | D | ✔ | asistencia |
| 1117 | Días vacaciones | N | ✔ | asistencia (días hábiles gozados en el ciclo) |
| 1118 | Subsidio trabajador joven | N (0/1) | ✔ | `trabajadores.subsidio_joven` |
| 1154 | Puesto trabajo pesado | T (nombre puesto, vacío si no) | ◐ | `contratos.puesto_trabajo_pesado` |
| 1155 | APVI | N (0/1) | ✔ | `afiliaciones.apvi` |
| 1157 | APVC | N (0/1) | ✔ | `afiliaciones.apvc` |
| 1131 | Indemnización a todo evento | N (0/1) | ✔ | `contratos.pacto_art164` |
| 1132 | Tasa indemnización a todo evento | D (2 dec., ≥ 4,11) | ◐ | `contratos.tasa_art164` |

> El manual de carga marca como obligatorios mínimos 1101, 1102, 1105, 1106, 1107 y 1115; los demás
> 11xx son columnas del formato que deben ir con valor (0 / vacío) — confirmar con la planilla oficial
> qué columnas aceptan vacío.

**B. Haberes (2xxx)** — [LRE] p. 44-66

| Cód | Nombre | Grupo | Origen (concepto NÚCLEO) |
|---|---|---|---|
| 2101 | Sueldo ✔ | Imp. y trib. (21xx) | paso 1 |
| 2102 | Sobresueldo (horas extra) | 21xx | paso 2 |
| 2103 | Comisiones (mensual) | 21xx | novedades |
| 2104 | Semana corrida mensual (art. 45) | 21xx | paso 3 |
| 2105 | Participación (mensual) | 21xx | novedades |
| 2106 | Gratificación (mensual) | 21xx | paso 4 |
| 2107 | Recargo 30 % día domingo (art. 38) | 21xx | novedades |
| 2108 | Rem. variable pagada en vacaciones (art. 71) | 21xx | cálculo vacaciones |
| 2109 | Rem. variable pagada en clausura | 21xx | — |
| 2110 | Aguinaldo | 21xx | novedades |
| 2111 | Bonos u otras rem. fijas mensuales | 21xx | contrato |
| 2112 | Tratos (mensual) | 21xx | novedades |
| 2113 | Bonos u otras rem. variables mensuales o superiores a un mes | 21xx | novedades (cuota del mes) |
| 2114 | Ejercicio opción no pactada | 21xx | — (fuera de alcance) |
| 2115 | Beneficios en especie constitutivos de remuneración | 21xx | novedades |
| 2116-2120 | Rem. bimestrales / trimestrales / cuatrimestrales / semestrales / anuales (cuotas de meses de devengo) | 21xx | rectificación (V2) |
| 2121 | Participación anual | 21xx | V2 |
| 2122 | Gratificación anual (cuotas de meses de devengo) | 21xx | V2 |
| 2123 | Otras rem. superiores a un mes (sin devengo proporcional) | 21xx | novedades |
| 2124 | Pago horas trabajo sindical | 21xx | novedades (+3183) |
| 2161 | Sueldo empresarial | 21xx | módulo socios (V2) |
| 2201 | Subsidio incapacidad laboral (pago directo) | Imp. no trib. (22xx) | — |
| 2202 | Beca de estudio | 22xx | novedades |
| 2203 | Gratificación de zona (legal) | 22xx | — |
| 2204 | Otros ingresos no renta art. 17 N°29 | 22xx | — |
| 2301 | Colación | No imp. no trib. (23xx) | paso 13 |
| 2302 | Movilización | 23xx | paso 13 |
| 2303 | Viáticos | 23xx | novedades |
| 2304 | Pérdida de caja | 23xx | contrato |
| 2305 | Desgaste herramientas | 23xx | contrato |
| 2311 | Asignación familiar legal | 23xx | paso 13 |
| 2306 | Gastos por causa del trabajo / representación | 23xx | uso excepcional |
| 2307 | Gastos cambio de residencia (art. 53) | 23xx | — |
| 2308 | Sala cuna (art. 203) | 23xx | novedades |
| 2309 | Asignación teletrabajo | 23xx | contrato |
| 2347 | Depósito convenido hasta 900 UF | 23xx | (+3147) |
| 2310 | Alojamiento por razones de trabajo | 23xx | — |
| 2312 | Asignación de traslación | 23xx | — |
| 2313 | Indemnización feriado legal | 23xx | finiquito |
| 2314 | Indemnización años de servicio | 23xx | finiquito |
| 2315 | Indemnización sustitutiva aviso previo | 23xx | finiquito |
| 2316 | Indemnización fuero maternal | 23xx | finiquito |
| 2331 | Indemnización a todo evento | 23xx | finiquito |
| 2417 | Indemnizaciones voluntarias tributables | No imp. trib. (24xx) | finiquito |
| 2418 | Indemnizaciones contractuales tributables | 24xx | finiquito |

**C. Descuentos (3xxx)** — [LRE] p. 67-74

| Cód | Nombre | Origen |
|---|---|---|
| 3141 | Cotización obligatoria previsional (AFP 10 % + comisión, o IPS) ✔ | paso 8 (incluye SIS si subsidio joven) |
| 3143 | Cotización obligatoria salud 7 % ✔ | paso 10 |
| 3144 | Cotización voluntaria salud (adicional Isapre) | paso 10 |
| 3151 | Cotización AFC trabajador | paso 11 |
| 3146 | Cotización técnico extranjero (exterior) | — |
| 3147 | Depósito convenido | (=2347) |
| 3155 / 3156 | APVI modalidad A / B (≤ 50 UF) | ficha APV |
| 3157 / 3158 | APVC modalidad A / B | ficha APV |
| 3161 | Impuesto retenido por remuneraciones ✔ | paso 14 |
| 3162 | Impuesto retenido por indemnizaciones | finiquito |
| 3163 | Mayor retención solicitada (art. 88 LIR) | ficha |
| 3164 | Impuesto retenido por reliquidación de otros períodos (informativo) | V2 |
| 3165 | Diferencia de impuesto por reliquidación de este período | V2 (rectificación) |
| 3166 | Retención préstamo clase media 2020 (Ley 21.252, 3 %) | ficha (marcador "tiene préstamo") |
| 3167 | Rebaja zona extrema DL 889 | — |
| 3171-3180 | Cuota sindical 1..10 | descuentos sindicales |
| 3110 | Crédito social CCAF | descuentos |
| 3181 | Cuota vivienda o educación (art. 58) | descuentos |
| 3182 | Crédito cooperativas | descuentos |
| 3183 | Otros descuentos autorizados y solicitados por el trabajador | descuentos |
| 3154 | Cotización adicional trabajo pesado (trabajador) | paso 8 |
| 3184 | Donaciones culturales y reconstrucción | descuentos |
| 3185 | Otros descuentos (art. 58) | descuentos |
| 3186 | Pensión de alimentos | judicial |
| 3187 | Descuento mujer casada (art. 59) | judicial |
| 3188 | Descuento por anticipos o préstamos | anticipos/préstamos |

**D. Aportes del empleador (41xx)** — [LRE] p. 75

| Cód | Nombre | Origen |
|---|---|---|
| 4151 | Aporte AFC empleador | paso 11 |
| 4152 | Aporte seguro accidentes Ley 16.744 + SANNA ✔ | paso 12 |
| 4131 | Aporte indemnización a todo evento | paso 12 |
| 4154 | Aporte adicional trabajo pesado | paso 12 |
| 4155 | Aporte SIS ✔ | paso 9 (desde ago-2026: componente SIS de la cotización del empleador, §0.2) |
| 4157 | Aporte APVC empleador | ficha |
| ¿? | **Cotización empleador Ley 21.735 (0,1 % CI, 0,9 % FAPP/CRP, expectativa de vida)** | sin código LRE documentado → §8 |

**E. Totales (5xxx)** — [LRE] p. 76-77 (todos ✔ salvo 5361/5362/5502/5565 que el manual no lista)

| Cód | Fórmula |
|---|---|
| 5201 | 5210 + 5220 + 5230 + 5240 |
| 5210 | Σ 21xx |
| 5220 | Σ 22xx |
| 5230 | Σ 23xx |
| 5240 | Σ 24xx |
| 5301 | Σ 31xx excepto 3164 |
| 5361 | 3161 + 3165 |
| 5362 | 3162 |
| 5341 | 3141 + 3143 + 3144 + 3146 + 3151 + 3154 + 3155 + 3156 + 3157 + 3158 |
| 5302 | 5301 − 5361 − 5362 − 5341 |
| 5410 | Σ 41xx |
| 5501 | 5201 − 5301 (total líquido) |
| 5502 | 2313 + 2314 + 2315 + 2316 + 2331 + 2417 + 2418 |
| 5564 | 2417 + 2418 |
| 5565 | 2313 + 2314 + 2315 + 2316 + 2331 |

### 3.3 Mínimo para una pyme simple (V1)

Columnas con valor real: 1101, 1102, (1103, 1104), 1105, 1106, 1170=1, 1146=0, 1107, 1108, 1109, 1141,
1142, 1143, 1151, 1110, 1152, 1111-1114, 1115-1118, 1155, 1157, 1131=0; 2101, 2102, 2103, 2104, 2106,
2111, 2113, 2301, 2302, 2303, 2305, 2311; 3141, 3143, 3144, 3151, 3161, 3171, 3110, 3183, 3188;
4151, 4152, 4155; todos los totales 5xxx. El resto se exporta en 0 o vacío según la planilla oficial.

### 3.4 Validaciones previas a exportar (NÚCLEO)

1. Cuadratura de todos los totales 5xxx (recalculados, no copiados).
2. 5501 de cada fila = líquido de la liquidación emitida.
3. 3161 del período = Σ impuesto de las liquidaciones = monto para F29 cód. 48 (§4.3).
4. 1103 informado ⇔ 1104 informado.
5. 1115 + días de licencia coherentes (≤ 30/31); 1151 = 1 ⇒ 3151/4151 coherentes con tipo contrato.
6. RUT con DV válido (módulo 11); sin puntos.
7. Encabezados exactamente iguales a la planilla oficial vigente (paquete `LRE_FORMATO` versionado).

---

## 4. Relación con Previred y con el F29

### 4.1 Qué se paga por Previred y a quién (planilla del mes siguiente al de remuneraciones)

| Institución | Concepto | De cargo de | LRE |
|---|---|---|---|
| AFP del trabajador | Cotización obligatoria 10 % + comisión | trabajador | 3141 |
| AFP | APV / depósito convenido (si se descuenta por planilla) | trabajador | 3155-3158, 3147 |
| AFP | SIS (hasta jul-2026) | empleador | 4155 |
| AFP | Cotización empleador Ley 21.735 – 0,1 % cuenta individual (desde ago-2025) | empleador | ¿? |
| AFP | Trabajo pesado (trabajador + empleador) | ambos | 3154, 4154 |
| AFP (cuenta indemnización) | Indemnización a todo evento art. 164 | empleador | 4131 |
| IPS / Seguro Social Previsional (FAPP) | Cotización empleador Ley 21.735: 0,9 % (ago-25/jul-26); desde ago-2026 0,9 % rentabilidad protegida + 2,5 % (SIS + expectativa de vida) | empleador | 4155 (SIS) + ¿? |
| IPS | Cotización régimen antiguo (si 1142 ≠ 0) | trabajador | 3141 |
| Fonasa | 7 % salud (menos la parte que va a la CCAF si la empresa está afiliada: la distribución la hace Previred) | trabajador | 3143 |
| CCAF | Parte del 7 % de trabajadores Fonasa (`CCAF_TASA_SALUD`, a verificar) ; crédito social ; ahorro | trabajador | 3143 (incluida), 3110 |
| Isapre | 7 % + cotización adicional pactada | trabajador | 3143 + 3144 |
| AFC | Seguro de cesantía trabajador + empleador | ambos | 3151 + 4151 |
| Mutual (ACHS/Mutual CChC/IST) o ISL | Ley 16.744 básica + adicional + SANNA | empleador | 4152 |
| (compensación) | **Asignación familiar** pagada al trabajador: se **descuenta** de lo que se paga a la CCAF (o IPS si no hay CCAF) | Estado | 2311 |

- Plazo: dentro de los 10 primeros días del mes siguiente; hasta el día 13 si se declara y paga
  electrónicamente ([MINEDUC] p. 42, 45, 55; SP para la cotización del empleador).
- NÚCLEO genera: (1) un **resumen por institución** (monto a pagar a cada AFP, Isapre, Fonasa, CCAF, AFC,
  mutual, IPS/FAPP) que cuadra con las liquidaciones; (2) a futuro, el **archivo de nómina Previred**
  (formato posicional/delimitado de ~105 campos por línea; los campos 29, 92, 95 citados en §0.2 indican
  esa numeración). **El formato exacto del archivo Previred no está en el material**: se debe obtener el
  instructivo oficial de Previred antes de implementarlo (§8). V1: solo resumen + checklist "ingresa
  estos montos en Previred".
- Contabilización sugerida (asiento de centralización mensual): Debe Gasto remuneraciones (haberes) +
  Gasto leyes sociales (aportes empleador); Haber Cotizaciones previsionales por pagar (3141+3143+3144+
  3151+3154+APV + aportes 41xx − asignación familiar), Impuesto único por pagar (3161+3162), Descuentos
  varios por pagar (sindicato, CCAF, judiciales), Anticipos (3188), Remuneraciones por pagar (5501).

### 4.2 Cotizaciones impagas

Si no se pagan a tiempo: declarar sin pagar ("declaración y no pago") evita multas mayores; la deuda se
reajusta (UF) y devenga interés; desde cotizaciones devengadas en sept-2025 ya no hay recargo
([SP-NCG368]). NÚCLEO solo alerta y enlaza a la tabla de la SP; no calcula la deuda.

### 4.3 F29 (declaración mensual SII, mes siguiente al pago)

| Código F29 | Línea | Contenido | Origen NÚCLEO |
|---|---|---|---|
| **48** | 60 | Impuesto Único de Segunda Categoría retenido sobre rentas art. 42 N°1 (sueldos), **menos** créditos por donaciones culturales (cód. 751) y Fondo Reconstrucción (cód. 735); incluye IUSC de **sueldos empresariales** y la **mayor retención** del art. 88 | Σ (3161 + 3165 [+ 3162 de indemnizaciones tributables] + 3163) − donaciones 3184 imputadas como crédito, del mes de **pago** |
| 49 | 63 | Retención 3 % préstamo tasa 0 % (Ley 21.252 art. 9 a) sobre rentas art. 42 N°1, aunque esté en tramo exento | Σ 3166 |
| **151** | 61 | Retención de **honorarios** (boletas de honorarios recibidas, rentas art. 42 N°2), tasa según art. 5° transitorio Ley 21.133 | módulo **compras/honorarios**, no remuneraciones (no va en el LRE) |
| 155 | 64 | Retención 3 % préstamo tasa 0 % sobre honorarios | módulo honorarios |

Fuente: SII, Instrucciones F29 (archivo `instrucciones_f29_20241112.pdf`, líneas 60-64).

- El F29 se rige por **fecha de pago** (retención al pagar, art. 74 N°1 LIR), el LRE por período de
  remuneración: si se pagan sueldos de septiembre el 2 de octubre, el IUSC va en el F29 de noviembre
  (período octubre). NÚCLEO debe guardar `fecha_pago` por liquidación.
- La tasa de retención de honorarios (cód. 151) es un parámetro con vigencia anual
  (`HONORARIOS_RETENCION_TASA`), fuente Ley 21.133 art. 5° transitorio; verificar el valor 2026 en sii.cl.
- La cotización previsional de honorarios (independientes) se resuelve en la Operación Renta, no en el
  F29 — fuera de alcance.

---

## 5. Catálogo de parámetros normativos propuesto

Formato del paquete según TAX_RULES.md (`code`, `data.type`, `valid_from`, `valid_until`, `source`).
"Valor ejemplo" solo documenta el dato histórico de la fuente; **no se carga sin verificación**.

| Código | Descripción | Tipo / unidad | Fuente oficial | Valor ejemplo (fuente, fecha) |
|---|---|---|---|---|
| `UF_DIARIA` | Valor UF por día | table fecha→CLP | Banco Central / CMF | 26.261,51 (usado en [MINEDUC] p. 51, nov-2016) |
| `UTM_MENSUAL` | Valor UTM por mes | table mes→CLP | SII | 46.091 implícito (nov-2016, [MINEDUC] p. 60) |
| `IMM_GENERAL` | Ingreso mínimo mensual 18-65 años | decimal CLP | Ley de reajuste IMM | 257.500 (1-jul-2016, [MINEDUC] p. 20) |
| `IMM_MENOR18_MAYOR65` | IMM menores 18 / mayores 65 | decimal CLP | ídem | 192.230 (2016, [MINEDUC] p. 43) |
| `IMM_FINES_NO_REMUNERACIONALES` | IMM no remuneracional | decimal CLP | ídem | 166.103 (2016) |
| `IMM_CASA_PARTICULAR` | Renta mínima casa particular | decimal CLP | ídem | 257.500 (2016) |
| `JORNADA_MAX_SEMANAL_HORAS` | Jornada ordinaria máxima | integer h | Ley 21.561 | 45 (hasta 25-04-2024), 44, 42 (desde 26-04-2026) |
| `HE_RECARGO_MIN` | Recargo mínimo horas extra | decimal | art. 32 CdT | 0,50 |
| `HE_MAX_DIARIAS` | Máx. HE por día | integer | art. 31 CdT | 2 |
| `HE_METODO_REDONDEO` | factor DT truncado (0,0077777) vs fórmula exacta | text | decisión contador | — |
| `GRAT_ART50_TASA` | Gratificación art. 50 | decimal | art. 50 CdT | 0,25 |
| `GRAT_ART50_TOPE_IMM_FACTOR` | Tope anual en IMM | decimal | art. 50 CdT | 4,75 |
| `GRAT_ART47_TASA_UTILIDAD` | % utilidad art. 47 | decimal | art. 47 CdT | 0,30 |
| `TOPE_IMPONIBLE_AFP_UF` | Tope AFP/salud/16.744 | decimal UF | Res. SP anual | 74,3 (2016); 81,6 (2021-22); **90,0 (desde 01-02-2026)** |
| `TOPE_IMPONIBLE_AFC_UF` | Tope seguro cesantía | decimal UF | Res. SP anual | 111,4 (2016); 122,6 (2021-22); **135,2 (desde 01-02-2026)** |
| `TOPE_IMPONIBLE_IPS_UF` | Tope régimen antiguo | decimal UF | DFL 163/1968; [LRE] p. 12 | 60 (sin reajuste) |
| `AFP_COTIZACION_OBLIGATORIA` | 10 % cuenta individual | decimal | art. 17 DL 3.500 | 0,10 |
| `AFP_COMISION` | Comisión por AFP | table AFP→decimal, mensual | SP / Previred | Capital 1,44 %, Cuprum 1,48 %, Habitat 1,27 %, PlanVital 0,41 %, Provida 1,54 %, Modelo 0,77 % (nov-2016, [MINEDUC] p. 43, como tasa total − 10 %) |
| `AFP_CODIGOS_LRE` | Tabla código AFP | table | [LRE] p. 31 | 6, 11, 13, 14, 19, 31, 103, 100 |
| `SIS_TASA` | Prima SIS empleador | decimal | SP (licitación SIS) / Ley 21.735 | 1,41 % (nov-2016, [MINEDUC] p. 43); 1,62 % desde abr-2026 (KPMG, por verificar) |
| `COT_EMPL_CI_TASA` | Cotiz. empleador a cuenta individual | decimal | Ley 21.735; SP | 0,1 % (desde ago-2025) |
| `COT_EMPL_FAPP_EV_TASA` | Cotiz. empleador al FAPP (expectativa de vida) | decimal | Ley 21.735; SP | 0,9 % (ago-2025 a jul-2026) |
| `COT_EMPL_RENT_PROTEGIDA_TASA` | Cotización con rentabilidad protegida | decimal | Ley 21.735; SP | 0,9 % (desde ago-2026) |
| `COT_EMPL_SSP_TASA` | Seguro Social Previsional (incluye SIS + CEV) | decimal | Ley 21.735; SP | 2,5 % (desde ago-2026) |
| `COT_EMPL_CRONOGRAMA` | Tabla de alzas anuales hasta 7 % (+SIS) | table | Ley 21.735 | por cargar con texto legal |
| `TRAB_PESADO_TASA` | Cotiz. adicional trabajo pesado (trab. y empl.) | table calificación→decimal | art. 17 bis DL 3.500; CEN | 1 % o 2 % ([MINEDUC] p. 41) |
| `SALUD_COTIZACION_LEGAL` | Cotización salud | decimal | Ley 18.469 / DFL 1 Salud | 0,07 |
| `CCAF_TASA_SALUD` | Parte del 7 % Fonasa que va a la CCAF | decimal | Suseso | por verificar |
| `ISAPRE_CODIGOS_LRE` | Tabla salud | table | [LRE] p. 34 | 102 Fonasa, 1, 3, 4, 9, 12, 37-43 |
| `AFC_TRAB_INDEF` | AFC trabajador indefinido | decimal | Ley 19.728 | 0,6 % ([MINEDUC] p. 54) |
| `AFC_EMPL_INDEF` | AFC empleador indefinido (CI 1,6 + FCS 0,8) | decimal | Ley 19.728 | 2,4 % |
| `AFC_EMPL_PLAZO` | AFC empleador plazo fijo/obra (2,8 + 0,2) | decimal | Ley 19.728 | 3,0 % ([MINEDUC] p. 55) |
| `AFC_EMPL_SOLIDARIO_POST11` | Aporte empleador tras 11 años | decimal | art. 9 Ley 19.728 | 0,8 % ([LRE] p. 35) |
| `AFC_MAX_ANIOS_CI` | Años máx. cotización a CI | integer | art. 9 Ley 19.728 | 11 |
| `LEY16744_TASA_BASICA` | Cotización básica accidentes | decimal | Ley 16.744 art. 15 | por verificar |
| `SANNA_TASA` | Ley SANNA | decimal | art. 24 Ley 21.063 | 0,03 % ([LRE] p. 75, vigencia por verificar) |
| `IAS_TODO_EVENTO_TASA_MIN` | Tasa mínima art. 164 | decimal | art. 165 CdT | 4,11 % ([LRE] p. 43) |
| `IUSC_TABLA` | Tramos IUSC mensual en UTM (desde, hasta, factor, rebaja) | table | art. 43 N°1 LIR; SII | ver §1.13 (nov-2016) |
| `IUSC_EXENTO_UTM` | Límite exento | decimal UTM | art. 43 N°1 LIR | 13,5 ([LRE] p. 28) |
| `IUSC_REDONDEO` | Redondeo del impuesto | text | SII / contador | half-up a peso ([MINEDUC] p. 75) |
| `APV_B_TOPE_MENSUAL_UF` | Tope rebaja APV B | decimal UF | art. 20 L DL 3.500 | 50 ([LRE] p. 69) |
| `DEPOSITO_CONVENIDO_TOPE_ANUAL_UF` | Tope depósito convenido | decimal UF | art. 20 DL 3.500 | 900 ([LRE] p. 63) |
| `RETENCION_PRESTAMO_21252_TASA` | Retención préstamo tasa 0 | decimal | Ley 21.252 | 3 % ([LRE] p. 71; F29 cód. 49) |
| `ASIG_FAMILIAR_TRAMOS` | Tramos (ingreso desde/hasta) y monto por carga | table | Ley 18.987 / DS Hacienda / ley reajuste | 2016: A ≤270.196 → 10.577; B ≤394.651 → 6.491; C ≤615.521 → 2.052; D 0 ([MINEDUC] p. 31). 2022: 14.366/8.815/2.786, límites 366.987/536.023/836.014 ([LRE] p. 37-38, DS 2/2022) |
| `ASIG_FAMILIAR_DIAS_COMPLETA` | Días mínimos para pago completo | integer | art. 12 DFL 150 | 25 ([LRE] p. 36) |
| `DESC_VOLUNTARIOS_TOPE_15` / `_30` / `_45` / `_COOP_25` | Topes art. 58 CdT y Ley 19.832 | decimal | art. 58 CdT | 15 %, 30 %, 45 %, 25 % ([MINEDUC] p. 63-64) |
| `IAS_DIAS_POR_ANIO` / `IAS_TOPE_ANIOS` | IAS | integer | art. 163 CdT | 30 / 11 (330 días) ([LRE] p. 15) |
| `IAS_TOPE_BASE_UF` | Tope base art. 172 | decimal UF | art. 172 CdT | 90 ([LRE] p. 15) |
| `OBRA_FAENA_DIAS_POR_MES` | Indemnización obra/faena por fecha de contrato | table | art. 163 + 23 transitorio CdT | 1 / 1,5 / 2 / 2,5 días ([LRE] p. 18) |
| `FERIADO_DIAS_HABILES_BASE` | Feriado anual | integer | art. 67 CdT | 15 |
| `FERIADO_PROGRESIVO` | 1 día por cada 3 años sobre 10 | table | art. 68 CdT | — |
| `FERIADOS_NACIONALES` | Calendario festivos | table fecha | leyes de feriados | por año |
| `HONORARIOS_RETENCION_TASA` | Retención boletas honorarios (F29 151) | decimal | Ley 21.133 art. 5° trans. | por verificar 2026 |
| `LRE_FORMATO` | Lista ordenada de encabezados de la planilla LRE | table | DT, manual de carga | v8.0 (mar-2023) |
| `LRE_TABLAS` | Regiones, comunas, causales, jornadas, CCAF, mutuales, IPS | table | [LRE] p. 22-36 | — |
| `REM_REDONDEO_MODO` | Redondeo por concepto | text | contador | half-up por concepto |

---

## 6. Datos mínimos por trabajador y contrato (modelo propuesto)

Migración nueva `00xx_remuneraciones.sql` (no existe nada de trabajadores hoy; solo el permiso
`remuneraciones.ver` en `0011_core.sql` y la categoría de gasto "Remuneraciones" en `0007_dinero.sql`).
Datos sensibles (salud, pensiones de alimentos, discapacidad, cargas): acceso solo con permiso
`remuneraciones.*`, nunca en reportes generales; considerar cifrado en reposo (ver SECURITY.md).

```
trabajadores
  id, rut (UNIQUE, validado mód. 11), nombres, apellido_paterno, apellido_materno, fecha_nacimiento,
  sexo, nacionalidad, domicilio, comuna_codigo, email, telefono,
  banco/cuenta para pago (opcional),
  pensionado_vejez (0/1), discapacidad_lre (0-3), tecnico_extranjero (0/1), subsidio_joven (0/1),
  tramo_asig_familiar (A/B/C/D/S) + semestre_referencia,
  prestamo_ley21252 (bool), mayor_retencion_monto, activo

afiliaciones_trabajador        (versionada con valid_from/valid_until)
  trabajador_id, afp_codigo (LRE 1141) | ips_regimen (1142),
  salud_codigo (1143), isapre_plan_tipo (UF | CLP | PORC), isapre_plan_valor, isapre_fun/contrato,
  afc (0/1), fecha_afiliacion_afc, apvi (0/1), apvi_modalidad (A/B), apvi_monto, apvi_institucion,
  apvc (0/1), apvc_modalidad, apvc_monto, apvc_aporte_empleador

cargas_familiares
  trabajador_id, rut_carga, nombre, tipo (simple | maternal | invalidez), valid_from, valid_until,
  resolucion_ips_ccaf (n°, fecha)

contratos                      (un registro por relación laboral; anexos = versiones)
  id, trabajador_id, empleador_id, fecha_inicio (1102), fecha_termino_pactada (plazo fijo),
  tipo (INDEFINIDO | PLAZO_FIJO | OBRA_FAENA | APRENDIZAJE | CASA_PARTICULAR),
  cargo, region_lre (1105), comuna_lre (1106), tipo_jornada_lre (1107), jornada_horas_semanales,
  dias_semana (5/6), forma_pago (MENSUAL | SEMANAL | DIARIO | POR_HORA),
  sueldo_base, gratificacion_modo (ART50 | ART47 | CONVENCIONAL | NINGUNA), gratificacion_monto_pactado,
  semana_corrida_metodo (SEMANAL | MENSUAL | NO_APLICA),
  pacto_horas_extra (desde, hasta, recargo), puesto_trabajo_pesado (1154) + calificacion,
  pacto_art164 (1131), tasa_art164 (1132), tipo_impuesto (1170, default 1)

contrato_versiones / anexos    (valid_from, cambios de sueldo, jornada, cargo)

contrato_haberes_fijos
  contrato_id, concepto_codigo, monto, periodicidad (MENSUAL | POR_DIA_TRABAJADO), valid_from/until

conceptos_remuneracion         (catálogo; semilla desde el paquete LRE)
  codigo_interno, nombre, codigo_lre (2xxx/3xxx/4xxx), clase (HABER | DESCUENTO | APORTE),
  imponible, tributable, base_gratificacion, base_semana_corrida, base_indemnizacion, devengo_diario,
  orden_prelacion (descuentos), tope_regla (DESC_15 | DESC_30 | …)

empleador_remuneraciones       (config del emisor, versionada)
  ccaf_codigo (1110), mutual_codigo (1152), tasa_16744_adicional, tasa_16744_vigencia,
  rut_representante, dia_pago_habitual

periodos_remuneracion
  id, periodo (AAAA-MM), estado (ABIERTO | CALCULADO | CERRADO | EXPORTADO_LRE | PAGADO_PREVIRED),
  rule_set_code, uf_usada, utm_usada, fecha_pago, cerrado_por, cerrado_en

asistencia_mensual
  periodo_id, contrato_id, dias_trabajados (1115), dias_licencia (1116), dias_vacaciones (1117),
  dias_ausencia_injustificada, horas_extra (por recargo), domingos_festivos, detalle_semanal (JSON)

novedades                      (movimientos variables del mes)
  periodo_id, contrato_id, concepto_codigo, monto | cantidad × valor, glosa, origen (manual | import)

descuentos_recurrentes / prestamos_trabajador
  contrato_id, concepto_codigo (3110, 3171…, 3181…, 3186, 3188), rut_beneficiario (sindicato/CCAF),
  cuota, n_cuota, total_cuotas, saldo, resolucion_judicial (alimentos)

anticipos
  contrato_id, periodo_id, fecha, monto, medio_pago

liquidaciones
  id, periodo_id, contrato_id, version, estado (BORRADOR | EMITIDA | ANULADA),
  imponible, imponible_afc, tributable, total_haberes, total_descuentos, liquido,
  costo_empresa, rule_set_code, calculado_en, hash
liquidacion_lineas
  liquidacion_id, concepto_codigo, codigo_lre, cantidad, base, tasa, monto, orden
liquidacion_traza
  liquidacion_id, paso, formula_texto, insumos (JSON), resultado, parametro_codigos

finiquitos
  contrato_id, fecha_termino (1103), causal_lre (1104), aviso_previo_dado (bool, fecha),
  anios_servicio, base_172, ias, aviso_previo, feriado_dias_habiles, feriado_dias_corridos,
  feriado_monto, otras_indemnizaciones, descuento_afc_art13, impuesto_indemnizaciones, liquido,
  estado (BORRADOR | FIRMADO | PAGADO), ministro_de_fe

exportaciones_remuneraciones
  periodo_id, tipo (LRE | PREVIRED_RESUMEN | PREVIRED_NOMINA | F29_RESUMEN), archivo, hash,
  formato_version, generado_en, generado_por
```

Integraciones internas: el cierre del período genera el asiento contable (§4.1) y alimenta el resumen
F29 (cód. 48/49) del módulo de impuestos; los pagos (líquidos, Previred, F29) se registran en
`0007_dinero` como cuentas por pagar con vencimiento (líquido: día de pago; Previred: día 10/13;
F29: según calendario SII).

---

## 7. Casos golden de [MINEDUC]

Convención: "G-x tal cual" reproduce **exactamente** la guía (con sus parámetros 2016) para probar el
motor con un paquete de prueba `TEST-MINEDUC-2016-11`; "G-x corregido" es lo que NÚCLEO **debería**
calcular con las reglas de este documento, **pendiente de validación del contador**.

Paquete de prueba `TEST-MINEDUC-2016-11` (todos de [MINEDUC]): IMM 257.500 (p. 20, 43); tope AFP/salud
74,3 UF = $1.955.095 (p. 43; implica UF 26.313,53); tope AFC 111,4 UF = $2.931.327 (p. 43); AFP Capital
11,44 %, Cuprum 11,48 %, Habitat 11,27 %, PlanVital 10,41 %, Provida 11,54 %, Modelo 10,77 %; SIS 1,41 %
(p. 43); salud 7 %; AFC 0,6 / 2,4 / 3,0 % (p. 54-55); tabla IUSC nov-2016 (p. 60); asignación familiar
2° semestre 2016 (p. 31); HE factor 0,0077777 (p. 20).

### G-1 Patricio Rojas Muñoz — jefe RRHH, Viña Santa Inés Ltda., nov-2016 ([MINEDUC] datos p. 26, 35, 57, 67; liquidación resuelta p. 75)

Datos: sueldo base 600.000; 19 HE (sueldo mensual, 45 h); bono responsabilidad 85.000; gratificación
25 % con tope 4,75 IMM; colación 3.000 y locomoción 2.000 por día, 22 días; viático 85.000; 2 cargas;
AFP Capital 11,44 %; Isapre Consalud 3 UF, UF 26.056,89; seguro de cesantía (indefinido); préstamo Banco
Chile 25.700; seguro escolar MetLife 12.000; Coopeuch 10.000; anticipo 150.000.

| Concepto | G-1 tal cual (p. 75) | Cálculo | G-1 corregido |
|---|---|---|---|
| Sueldo base | 600.000 | | 600.000 |
| Horas extra (19) | **73.888** | guía usa recargo 25 % y trunca (600.000/30×28/180×1,25×19 = 73.888,9) | **88.666** (600.000 × 0,0077777 × 19 = 88.665,8) |
| Bono responsabilidad | 85.000 | | 85.000 |
| Gratificación | 101.927 | tope 257.500×4,75/12 = 101.927,08 (25 % de 758.888 = 189.722 > tope) | 101.927 |
| **Total imponible** | **860.815** | | **875.593** |
| Asignación familiar (2) | 0 | tramo D (> 615.521) | 0 |
| Movilización | 44.000 | 2.000 × 22 | 44.000 |
| Colación | 66.000 | 3.000 × 22 | 66.000 |
| Viático | 85.000 | | 85.000 |
| **Total haber** | **1.055.815** | | **1.070.593** |
| AFP Capital 11,44 % | 98.477 | 860.815 × 0,1144 = 98.477,2 | 100.168 |
| Isapre pactada 3 UF | 78.171 | 3 × 26.056,89 = 78.170,67 | 78.171 |
| — de ello 7 % obligatorio | 60.257 | 860.815 × 0,07 = 60.257,05 | 61.292 |
| — diferencia Isapre (adicional) | 17.914 | 78.171 − 60.257 | 16.879 |
| Seguro cesantía 0,6 % | 5.165 | 860.815 × 0,006 = 5.164,9 | 5.254 |
| Descuentos previsionales para impuesto | 163.899 | 98.477 + 60.257 + 5.165 | 166.714 (si solo se rebaja el 7 %) |
| Base tributable | 696.916 | 860.815 − 163.899 | 708.879 |
| Impuesto (0,04; rebaja 24.889,14) | 27.877 − 24.889 = **2.988** | 696.916 × 0,04 = 27.876,64; −24.889,14 = 2.987,5 → 2.988 | 3.466 |
| Préstamo + seguro escolar + Coopeuch | 25.700 + 12.000 + 10.000 | | ídem |
| **Total descuentos** | **232.501** | 98.477+78.171+5.165+2.988+47.700 | 234.759 |
| Alcance líquido | 823.314 | | 835.834 |
| Anticipo | 150.000 | | 150.000 |
| **Saldo líquido** | **673.314** | | **685.834** |

Aportes empleador (no en la guía, derivables): SIS 1,41 % = 12.137; AFC 2,4 % = 20.660 (860.815 base).
Variante de la regla [LRE] p. 67 (rebajar toda la cotización de salud hasta 7 % del tope): base
696.916 − 17.914 = 679.002 → impuesto 2.271 (en vez de 2.988). **Define cuál es correcta el contador.**

### G-2 Luisa Morales Freire — operaria a trato, Cartus S.A., nov-2016 ([MINEDUC] datos p. 27, 36, 58, 68; resuelta p. 76)

Datos: sueldo base 265.000; comisión $75 por caja; semana corrida; gratificación 25 %; 15 HE; colación
30.000; locomoción 25.000; desgaste herramientas 5.000; 3 cargas; 20 días trabajados ("faltó dos días
sin justificación"); AFP Modelo 10,77 %; Fonasa 7 %; AFC; préstamo CCAF La Araucana 15.600; seguro de
vida 5.600; anticipo 50.000. Producción (cajas): S1 145/feriado/128/127/136; S2 123/130/119/118/132;
S3 115/falta/falta/120/licencia; S4 licencia/licencia/125/125/138.

| Concepto | G-2 tal cual (p. 76) | Cálculo | G-2 corregido |
|---|---|---|---|
| Sueldo base | 265.000 | la guía **no descuenta** las 2 ausencias | 247.333 (265.000/30 × 28) |
| Horas extra (15) | 30.916 | 265.000 × 0,0077777 × 15 = 30.916,4 | 30.916 |
| Comisión | 133.575 | 1.781 cajas × 75 | 133.575 |
| Semana corrida | 43.536 | S1 40.200/4 × 2 (dom + festivo) = 20.100; S2 46.650/5 = 9.330; S3 17.625/4 = 4.406,25 (faltas S/J no restan, licencia sí); S4 29.100/3 = 9.700 → 43.536,25 | 43.536 |
| Gratificación 25 % | 73.979 | guía: 25 % de (265.000 + 30.916) solamente | 101.927 (25 % de 455.360 = 113.840 > tope) |
| **Total imponible** | **547.006** | | **557.287** |
| Asignación familiar 3 cargas | 6.156 | tramo C 2.052 × 3 (por imponible del mes) | 6.156 (tramo debería venir del semestre ene-jun) |
| Movilización / colación / desgaste | 25.000 / 30.000 / 5.000 | | ídem |
| **Total haber** | **613.162** | | **623.443** |
| AFP Modelo 10,77 % | 58.913 | 547.006 × 0,1077 = 58.912,5 | 60.020 |
| Fonasa 7 % | 38.290 | 38.290,4 | 39.010 |
| AFC 0,6 % | 3.282 | 3.282,04 | 3.344 |
| Descuentos previsionales | 100.485 | | 102.374 |
| Base tributable | 446.521 | < 622.228,50 → exento | 454.913 → exento |
| Impuesto | 0 | | 0 |
| CCAF + seguro de vida | 15.600 + 5.600 | | ídem |
| **Total descuentos** | **121.685** | | **123.574** |
| Alcance líquido | 491.477 | | 499.869 |
| Anticipo | 50.000 | | 50.000 |
| **Saldo líquido** | **441.477** | | **449.869** |

(La p. 76 rotula a la trabajadora como "Luisa Rojas Muñoz"; es la misma Luisa Morales Freire del caso.)

### G-3 Casos unitarios (para tests de cada paso)

| ID | Paso | Entrada | Esperado | Página |
|---|---|---|---|---|
| G-3a | Gratificación con HE | sueldo 257.500, 10 HE | HE 20.028; grat 25 % de 277.528 = 69.382 | p. 20 |
| G-3b | Tope gratificación | IMM 257.500 | 101.927 mensual | p. 20 |
| G-3c | Gratificación art. 47 | 30 % utilidad 19.604.000; rem. total 43.850.400; trab. 3.090.000 | factor 0,4471; 1.381.539 | p. 20 |
| G-3d | Semana corrida mixta | sueldo 165.000 + $500/prenda; tabla 4 semanas | comisiones 65.500; semana corrida 23.000; total 253.500 | p. 23-24 |
| G-3e | Asignación familiar | imponible 313.000, 3 cargas, tabla 2016 | tramo B 6.491 × 3 = 19.473 | p. 32 |
| G-3f | AFP sin tope | 381.006 × 11,44 % | 43.587 | p. 44 |
| G-3g | AFP con tope | 2.075.000 → tope 1.955.095 × 11,48 % | 224.445 | p. 44 |
| G-3h | Fonasa | 381.006 × 7 %; 1.955.095 × 7 % | 26.670; 136.857 | p. 47-48 |
| G-3i | Isapre con adicional | 381.006; plan 5,5 UF × 26.261,51 | pactada 144.438; 7 % 26.670; adicional 117.768 | p. 51 |
| G-3j | AFC indefinido | 300.000 | trab. 1.800; empl. 7.200 (4.800 CI + 2.400 FCS) | p. 54 |
| G-3k | AFC plazo fijo | 300.000 | trab. 0; empl. 9.000 (8.400 + 600) | p. 55 |
| G-3l | IUSC | imponible 982.326; AFP 166.909; salud 87.126; AFC 7.468 | base 720.823; impuesto 3.944 | p. 60 |

**No usar como golden** (errores de la guía): p. 51 "le descontarán $26.261 por cotización obligatoria"
(debe ser 26.670); p. 52 María Patricia: plan 5,0 UF × 26.261,51 = 131.308, la guía dice 126.053 y
calcula el excedente con 123.053 (136.857 − 123.053 = 13.804); con el plan correcto el excedente sería
5.549.

---

## 8. Riesgos y preguntas para el contador / experto laboral

### 8.1 Riesgos

1. **Normativa en movimiento (Ley 21.735)**: tasas del empleador cambian cada agosto; el SIS cambió de
   destino en ago-2026; hay discrepancias entre fuentes privadas (SIS 1,5 % vs 1,62 %). Un error aquí se
   traduce en pagos mal hechos en Previred y en el LRE. Mitigación: paquetes versionados con fuente SP y
   botón "este período usa la normativa X; revisada por el contador el…".
2. **Rectificaciones de valores oficiales** (topes 2026 cambiaron de 89,9 a 90 UF tras un mes): el
   sistema debe soportar nueva versión de paquete y **recálculo** de liquidaciones ya emitidas, con
   diferencias a pagar en el período siguiente.
3. **Responsabilidad legal**: liquidaciones y finiquitos tienen efectos laborales (Ley Bustos, multas
   DT). NÚCLEO debe rotularse como "preparado por NÚCLEO, revisar antes de firmar/pagar" y nunca omitir
   advertencias.
4. **Formatos externos no documentados en el material**: encabezados exactos del CSV del LRE y el
   archivo Previred. Si se implementan por inferencia, la carga será rechazada.
5. **Redondeos**: la guía mezcla truncar y redondear; Previred/DT validan cuadraturas al peso.
6. **Datos sensibles** (salud, discapacidad, pensiones de alimentos, sindicato): requieren permisos
   finos y no deben aparecer en el "Modo simple" ni en respaldos sin cifrar.
7. **Guías base desactualizadas** (2016: jornada 45 h, tabla IUSC anterior a la Ley 21.210, tasas SIS/AFP de
   2016; 2022: sin reforma de pensiones). Toda regla de este documento derivada de ellas debe re-validarse para 2026.
8. **Casos fuera de alcance** que una pyme puede tener sin saberlo: trabajadores de casa particular,
   obreros agrícolas, extranjeros sin RUT definitivo, pensionados que trabajan, licencias largas, sueldo
   empresarial de socios. NÚCLEO debe detectarlos y decir "no soportado aún".

### 8.2 Preguntas concretas

1. **Rebaja de salud en la base del IUSC** con Isapre: ¿solo el 7 % (como [MINEDUC] p. 75) o toda la
   cotización pactada hasta el 7 % del tope imponible (regla [LRE] p. 67)? (G-1: 2.988 vs 2.271.)
2. **Horas extra**: ¿factor DT de 7 decimales (0,0077777 / 0,0083333) o fórmula exacta? Diferencias de
   $1 (88.666 vs 88.667).
3. **Gratificación art. 50**: ¿base incluye comisiones y semana corrida (G-2: 73.979 vs 101.927)? ¿El tope
   mensual se proporciona por días trabajados? ¿Cómo y cuándo reliquidar el tope anual si cambia el IMM?
4. **Ausencias injustificadas**: confirmar descuento sueldo/30 por día y su efecto en semana corrida,
   gratificación y asignación familiar (G-2).
5. **Asignación familiar**: confirmar tramo por promedio enero-junio (no por imponible del mes) y tabla
   vigente 2026.
6. **UF a usar**: tope imponible (¿UF último día del mes?), plan Isapre (¿UF último día del mes o del día
   de pago?), tope art. 172 (UF último día del mes anterior al pago).
7. **Ley 21.735 en el LRE**: ¿en qué código(s) se informan la cotización empleador 0,1 % CI, la de
   rentabilidad protegida y la de expectativa de vida? ¿Todo el 2,5 % va en 4155? ¿Hay planilla LRE
   nueva? ¿Es renta para el trabajador?
8. **Previred**: ¿exportar nómina (archivo de ~105 campos) o solo resumen por institución en V1? ¿Dónde
   obtener el instructivo oficial vigente?
9. **Licencias médicas**: cotización del empleador (AFC 2,4 %, SIS, expectativa de vida, SANNA) sobre
   días de licencia; uso de RIMA; ¿cómo se informa?
10. **Anticipo del mismo mes**: ¿va en LRE 3188 (definido como "otorgados en períodos previos")?
11. **Finiquito**: base art. 172 (¿incluye gratificación mensual, colación y movilización?); descuento del
    aporte AFC del empleador (art. 13 Ley 19.728) y en qué código LRE; conversión de feriado proporcional a
    días corridos con jornada de 5 días; ¿nos puede dar 2-3 finiquitos reales anonimizados como golden?
12. **Mutual / Ley 16.744**: tasa básica y SANNA vigentes 2026 y cómo obtener la adicional de la empresa.
13. **Pensionados que trabajan y mayores de 65**: qué cotizaciones aplican (AFP, SIS, AFC, salud,
    cotización empleador).
14. **IUSC y F29**: redondeo oficial; mes del F29 cuando el sueldo de un mes se paga al mes siguiente;
    tratamiento de donaciones (cód. 735/751).
15. **Honorarios (cód. 151)**: tasa 2026 y si NÚCLEO debe emitir certificado anual de honorarios / DJ 1879
    (y DJ 1887 para sueldos) — fuera de este documento pero relacionado.
16. **Plazo LRE**: ¿día 15 o 15 días hábiles del mes siguiente?

---

*Fin del documento. Fuentes web consultadas el 2026-10-07: SP (spensiones.cl), Hacienda, DT (dt.gob.cl y
manual de carga LRE), CNC, AAFP, Buk, KPMG, BioBioChile. Material local: [MINEDUC], [LRE], [SP-NCG368],
Instrucciones F29 SII (nov-2024).*
