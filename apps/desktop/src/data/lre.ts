// Libro de Remuneraciones Electrónico (DT): archivo de carga masiva — espejo exacto de
// `nucleo-io/src/lre.rs`. `golden/lre.json` se ejecuta contra ambos. En el escritorio, Rust escribe el
// archivo en Windows-1252; la demostración lo descarga desde el navegador.

export const LRE_FORMAT = "DT-LRE-2022";
export const LRE_HEADERS: [number, string][] = [
  [1101, "Rut trabajador"],
  [1102, "Fecha inicio contrato"],
  [1103, "Fecha de término de contrato"],
  [1104, "Causal de término del contrato"],
  [1105, "Región de prestación de los servicios"],
  [1106, "Comuna de prestación de los servicios"],
  [1170, "Tipo de impuesto a la renta"],
  [1146, "Técnico extranjero exención de cotizaciones previsionales (ley 18.156)"],
  [1107, "Código tipo de jornada"],
  [1108, "Persona con discapacidad/pensionado por invalidez"],
  [1109, "Pensionado por vejez"],
  [1141, "AFP"],
  [1142, "IPS (ExINP)"],
  [1143, "FONASA / ISAPRE"],
  [1151, "AFC"],
  [1110, "CCAF"],
  [1152, "Org. administrador ley 16.744"],
  [1111, "Número cargas familiares legales autorizadas"],
  [1112, "Número de cargas familiares maternales"],
  [1113, "Número de cargas familiares invalidez"],
  [1114, "Tramo asignación familiar"],
  [1171, "Rut organización sindical 1"],
  [1172, "Rut organización sindical 2"],
  [1173, "Rut organización sindical 3"],
  [1174, "Rut organización sindical 4"],
  [1175, "Rut organización sindical 5"],
  [1176, "Rut organización sindical 6"],
  [1177, "Rut organización sindical 7"],
  [1178, "Rut organización sindical 8"],
  [1179, "Rut organización sindical 9"],
  [1180, "Rut organización sindical 10"],
  [1115, "Número días trabajados en el mes"],
  [1116, "Número días de licencia médica en el mes"],
  [1117, "Número días de vacaciones en el mes"],
  [1118, "Subsidio trabajador joven"],
  [1154, "Puesto trabajo pesado"],
  [1155, "Ahorro previsional voluntario individual"],
  [1157, "Ahorro previsional voluntario colectivo"],
  [1131, "Indemnización a todo evento (Art. 164)"],
  [1132, "Tasa indemnización a todo evento (Art. 164)"],
  [2101, "Sueldo"],
  [2102, "Sobresueldo"],
  [2103, "Comisiones (mensual)"],
  [2104, "Semana corrida mensual (Art. 45)"],
  [2105, "Participación (mensual)"],
  [2106, "Gratificación (mensual)"],
  [2107, "Recargo 30% día domingo (Art. 38)"],
  [2108, "Remuneración variable pagada en vacaciones (Art. 71)"],
  [2109, "Remuneración variable pagada en clausura (Art. 38 DFL 2)"],
  [2110, "Aguinaldo"],
  [2111, "Bonos u otras remuneraciones fijas mensuales"],
  [2112, "Tratos (mensual)"],
  [2113, "Bonos u otras remuneraciones variables mensuales o superiores a un mes"],
  [2114, "Ejercicio opción no pactada en contrato (Art. 17 N°8 LIR)"],
  [2115, "Beneficios en especie constitutivos de remuneración"],
  [2116, "Remuneraciones bimestrales (devengo en dos meses)"],
  [2117, "Remuneraciones trimestrales (devengo en tres meses)"],
  [2118, "Remuneraciones cuatrimestral (devengo en cuatro meses)"],
  [2119, "Remuneraciones semestrales (devengo en seis meses)"],
  [2120, "Remuneraciones anuales (devengo en doce meses)"],
  [2121, "Participación anual (devengo en doce meses)"],
  [2122, "Gratificación anual (devengo en doce meses)"],
  [2123, "Otras remuneraciones superiores a un mes"],
  [2124, "Pago por horas de trabajo sindical"],
  [2161, "Sueldo empresarial"],
  [2201, "Subsidio por incapacidad laboral por licencia médica - total mensual"],
  [2202, "Beca de estudio (Art. 17 N°18 LIR)"],
  [2203, "Gratificaciones de zona (Art. 17 N°27)"],
  [2204, "Otros ingresos no constitutivos de renta (Art. 17 N°29 LIR)"],
  [2301, "Colación total mensual (Art. 41)"],
  [2302, "Movilización total mensual (Art. 41)"],
  [2303, "Viáticos total mensual (Art. 41)"],
  [2304, "Asignación de pérdida de caja total mensual (Art. 41)"],
  [2305, "Asignación de desgaste herramienta total mensual (Art. 41)"],
  [2311, "Asignación familiar legal total mensual (Art. 41)"],
  [2306, "Gastos por causa del trabajo (Art. 41)"],
  [2307, "Gastos por cambio de residencia (Art. 53)"],
  [2308, "Sala cuna (Art. 203)"],
  [2309, "Asignación trabajo a distancia o teletrabajo"],
  [2347, "Depósito convenido hasta UF 900"],
  [2310, "Alojamiento por razones de trabajo (Art. 17 N°14 LIR)"],
  [2312, "Asignación de traslación (Art. 17 N°15 LIR)"],
  [2313, "Indemnización por feriado legal"],
  [2314, "Indemnización años de servicio"],
  [2315, "Indemnización sustitutiva del aviso previo"],
  [2316, "Indemnización fuero maternal (Art. 163 bis)"],
  [2331, "Indemnización a todo evento (Art. 164)"],
  [2417, "Indemnizaciones voluntarias tributables"],
  [2418, "Indemnizaciones contractuales tributables"],
  [3141, "Cotización obligatoria previsional (AFP o IPS)"],
  [3143, "Cotización obligatoria salud 7%"],
  [3144, "Cotización voluntaria para salud"],
  [3151, "Cotización AFC - trabajador"],
  [3146, "Cotizaciones técnico extranjero para seguridad social fuera de Chile"],
  [3147, "Descuento depósito convenido hasta UF 900 anual"],
  [3155, "Cotización ahorro previsional voluntario individual modalidad A"],
  [3156, "Cotización ahorro previsional voluntario individual modalidad B hasta UF 50"],
  [3157, "Cotización ahorro previsional voluntario colectivo modalidad A"],
  [3158, "Cotización ahorro previsional voluntario colectivo modalidad B hasta UF 50"],
  [3161, "Impuesto retenido por remuneraciones"],
  [3162, "Impuesto retenido por indemnizaciones"],
  [3163, "Mayor retención de impuestos solicitada por el trabajador"],
  [3164, "Impuesto retenido por reliquidación remuneraciones devengadas en otros períodos"],
  [3165, "Diferencia de impuesto por reliquidación remuneraciones devengadas en este período"],
  [3166, "Retención préstamo clase media 2020 (Ley 21.252)"],
  [3167, "Rebaja zona extrema DL 889"],
  [3171, "Cuota sindical 1"],
  [3172, "Cuota sindical 2"],
  [3173, "Cuota sindical 3"],
  [3174, "Cuota sindical 4"],
  [3175, "Cuota sindical 5"],
  [3176, "Cuota sindical 6"],
  [3177, "Cuota sindical 7"],
  [3178, "Cuota sindical 8"],
  [3179, "Cuota sindical 9"],
  [3180, "Cuota sindical 10"],
  [3110, "Crédito social CCAF"],
  [3181, "Cuota vivienda o educación (Art. 58)"],
  [3182, "Crédito cooperativas de ahorro (Art 54. Ley Coop.)"],
  [3183, "Otros descuentos autorizados y solicitados por el trabajador"],
  [3154, "Cotización adicional trabajo pesado - trabajador"],
  [3184, "Donaciones culturales y de reconstrucción"],
  [3185, "Otros descuentos (Art. 58)"],
  [3186, "Pensiones de alimentos"],
  [3187, "Descuento mujer casada (Art. 59)"],
  [3188, "Descuentos por anticipos y préstamos"],
  [4151, "Aporte AFC - empleador"],
  [4152, "Aporte empleador seguro accidentes del trabajo y Ley SANNA (Ley 16.744)"],
  [4131, "Aporte empleador indemnización a todo evento (Art. 164)"],
  [4154, "Aporte adicional trabajo pesado - empleador"],
  [4155, "Aporte empleador seguro invalidez y sobrevivencia"],
  [4157, "Aporte empleador ahorro previsional voluntario colectivo"],
  [5201, "Total haberes"],
  [5210, "Total haberes imponibles y tributables"],
  [5220, "Total haberes imponibles no tributables"],
  [5230, "Total haberes no imponibles y no tributables"],
  [5240, "Total haberes no imponibles y tributables"],
  [5301, "Total descuentos"],
  [5361, "Total descuentos impuestos a las remuneraciones"],
  [5362, "Total descuentos impuestos por indemnizaciones"],
  [5341, "Total descuentos por cotizaciones del trabajador"],
  [5302, "Total otros descuentos"],
  [5410, "Total aportes empleador"],
  [5501, "Total líquido"],
  [5502, "Total indemnizaciones"],
  [5564, "Total indemnizaciones tributables"],
  [5565, "Total indemnizaciones no tributables"],
];

export interface LreRow {
  rut: string; start_date: string; end_date?: string | null; end_cause?: number | null; region: number; comuna: number; jornada: number;
  disability?: number; pensioner?: boolean; afp: number; health: number; afc?: boolean; ccaf?: number; mutual: number;
  family_loads?: number; invalid_loads?: number; allowance_bracket?: string | null; days: number; young_subsidy?: boolean; apvi?: boolean;
  amounts?: Record<string, number>;
}

const ddmmyyyy = (iso: string) => (iso.length === 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function lreTotals(a: Record<string, number>): Record<number, number> {
  const e = Object.entries(a).map(([k, v]) => [Number(k), v] as const);
  const sum = (f: (k: number) => boolean) => e.filter(([k]) => f(k)).reduce((s, [, v]) => s + v, 0);
  const g = (k: number) => a[String(k)] ?? 0;
  const h21 = sum((k) => k >= 2100 && k < 2200), h22 = sum((k) => k >= 2200 && k < 2300), h23 = sum((k) => k >= 2300 && k < 2400), h24 = sum((k) => k >= 2400 && k < 2500);
  const d31 = sum((k) => k >= 3100 && k < 3200 && k !== 3164);
  const d5341 = [3141, 3143, 3144, 3146, 3151, 3154, 3155, 3156, 3157, 3158].reduce((s, k) => s + g(k), 0);
  const indem = [2313, 2314, 2315, 2316, 2331, 2417, 2418].reduce((s, k) => s + g(k), 0);
  const trib = g(2417) + g(2418);
  return {
    5201: h21 + h22 + h23 + h24, 5210: h21, 5220: h22, 5230: h23, 5240: h24, 5301: d31, 5361: g(3161) + g(3165), 5362: g(3162), 5341: d5341,
    5302: d31 - g(3161) - g(3165) - g(3162) - d5341, 5410: sum((k) => k >= 4100 && k < 4200), 5501: h21 + h22 + h23 + h24 - d31,
    5502: indem, 5564: trib, 5565: indem - trib,
  };
}

function cell(r: LreRow, code: number, tot: Record<number, number>): string {
  const b = (v?: boolean) => (v ? "1" : "0");
  switch (code) {
    case 1101: return r.rut;
    case 1102: return ddmmyyyy(r.start_date);
    case 1103: return r.end_date ? ddmmyyyy(r.end_date) : "";
    case 1104: return r.end_cause != null ? String(r.end_cause) : "";
    case 1105: return String(r.region);
    case 1106: return String(r.comuna);
    case 1170: return "1";
    case 1146: case 1142: case 1112: case 1116: case 1117: case 1157: case 1131: return "0";
    case 1107: return String(r.jornada);
    case 1108: return String(r.disability ?? 0);
    case 1109: return b(r.pensioner);
    case 1141: return String(r.afp);
    case 1143: return String(r.health);
    case 1151: return b(r.afc);
    case 1110: return String(r.ccaf ?? 0);
    case 1152: return String(r.mutual);
    case 1111: return String(r.family_loads ?? 0);
    case 1113: return String(r.invalid_loads ?? 0);
    case 1114: return r.allowance_bracket ?? "S";
    case 1115: return String(r.days);
    case 1118: return b(r.young_subsidy);
    case 1155: return b(r.apvi);
    case 1154: case 1132: return "";
  }
  if (code >= 1171 && code <= 1180) return "";
  if (code >= 5000) return String(tot[code] ?? 0);
  return String(Math.max(r.amounts?.[String(code)] ?? 0, 0));
}

export function buildLre(rows: LreRow[]): string {
  let out = LRE_HEADERS.map(([c, n]) => `${n}(${c})`).join(";") + "\r\n";
  for (const r of rows) {
    const tot = lreTotals(r.amounts ?? {});
    out += LRE_HEADERS.map(([c]) => cell(r, c, tot)).join(";") + "\r\n";
  }
  return out;
}

export const lreFileName = (employerRut: string, period: string) => `${employerRut.replace(/[^0-9A-Za-z]/g, "").toUpperCase()}_${period.replace("-", "")}.csv`;

const strip = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
export function lreAfpCode(name: string | null): number | null {
  if (name == null) return 100;
  return ({ provida: 6, planvital: 11, cuprum: 13, habitat: 14, uno: 19, capital: 31, modelo: 103 } as Record<string, number>)[strip(name)] ?? null;
}
export function lreHealthCode(kind: string, isapre: string | null): number | null {
  if (kind === "fonasa" || kind === "ninguna") return 102;
  if (!isapre) return null;
  return ({ cruzblanca: 1, banmedica: 3, colmena: 4, colmenagoldencross: 4, consalud: 9, vidatres: 12 } as Record<string, number>)[strip(isapre)] ?? null;
}
export const CCAF_NAMES = ["Sin caja de compensación", "Los Andes", "La Araucana", "Los Héroes", "18 de Septiembre"];
export const MUTUAL_NAMES = ["ISL", "ACHS", "Mutual de Seguridad CChC", "IST"];
export const REGIONS: [number, string][] = [
  [15, "Arica y Parinacota"], [1, "Tarapacá"], [2, "Antofagasta"], [3, "Atacama"], [4, "Coquimbo"], [5, "Valparaíso"], [13, "Metropolitana"],
  [6, "O'Higgins"], [7, "Maule"], [16, "Ñuble"], [8, "Biobío"], [9, "La Araucanía"], [14, "Los Ríos"], [10, "Los Lagos"], [11, "Aysén"], [12, "Magallanes"],
];
export const JORNADAS: [number, string][] = [[101, "Ordinaria (art. 22)"], [201, "Parcial (art. 40 bis)"], [701, "Excluida de límite de jornada (art. 22 inc. 2°)"]];
