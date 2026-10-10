//! Libro de Remuneraciones Electrónico (LRE) de la Dirección del Trabajo: archivo de carga masiva.
//!
//! Formato (DT, "LRE: instrucciones de carga" y Suplemento LRE 2022): CSV separado por punto y coma,
//! con encabezados "Nombre(código)", una fila por persona y mes, montos enteros positivos, fechas
//! dd/mm/aaaa, RUT con guion y sin puntos, nombre `rutempleador_aaaamm`. Las columnas 2161, 3166 y
//! 3167 se agregaron en 2022 (Suplemento §1). El orden y el texto de los encabezados son de formato,
//! no normativa; deben cuadrar con la planilla vigente de la DT (ver `docs/REMUNERACIONES.md` §3).
//!
//! El archivo se escribe en Windows-1252 (Latin-1 en la práctica: los encabezados solo usan tildes y
//! la ñ). Un espejo en TypeScript (`apps/desktop/src/data/lre.ts`) arma el mismo texto y
//! `golden/lre.json` se ejecuta contra ambos.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Versión del formato (orden de columnas) que genera este módulo.
pub const FORMAT_VERSION: &str = "DT-LRE-2022";

/// Encabezados en el orden de la planilla de carga.
pub const HEADERS: &[(u32, &str)] = &[
    (1101, "Rut trabajador"),
    (1102, "Fecha inicio contrato"),
    (1103, "Fecha de término de contrato"),
    (1104, "Causal de término del contrato"),
    (1105, "Región de prestación de los servicios"),
    (1106, "Comuna de prestación de los servicios"),
    (1170, "Tipo de impuesto a la renta"),
    (
        1146,
        "Técnico extranjero exención de cotizaciones previsionales (ley 18.156)",
    ),
    (1107, "Código tipo de jornada"),
    (1108, "Persona con discapacidad/pensionado por invalidez"),
    (1109, "Pensionado por vejez"),
    (1141, "AFP"),
    (1142, "IPS (ExINP)"),
    (1143, "FONASA / ISAPRE"),
    (1151, "AFC"),
    (1110, "CCAF"),
    (1152, "Org. administrador ley 16.744"),
    (1111, "Número cargas familiares legales autorizadas"),
    (1112, "Número de cargas familiares maternales"),
    (1113, "Número de cargas familiares invalidez"),
    (1114, "Tramo asignación familiar"),
    (1171, "Rut organización sindical 1"),
    (1172, "Rut organización sindical 2"),
    (1173, "Rut organización sindical 3"),
    (1174, "Rut organización sindical 4"),
    (1175, "Rut organización sindical 5"),
    (1176, "Rut organización sindical 6"),
    (1177, "Rut organización sindical 7"),
    (1178, "Rut organización sindical 8"),
    (1179, "Rut organización sindical 9"),
    (1180, "Rut organización sindical 10"),
    (1115, "Número días trabajados en el mes"),
    (1116, "Número días de licencia médica en el mes"),
    (1117, "Número días de vacaciones en el mes"),
    (1118, "Subsidio trabajador joven"),
    (1154, "Puesto trabajo pesado"),
    (1155, "Ahorro previsional voluntario individual"),
    (1157, "Ahorro previsional voluntario colectivo"),
    (1131, "Indemnización a todo evento (Art. 164)"),
    (1132, "Tasa indemnización a todo evento (Art. 164)"),
    (2101, "Sueldo"),
    (2102, "Sobresueldo"),
    (2103, "Comisiones (mensual)"),
    (2104, "Semana corrida mensual (Art. 45)"),
    (2105, "Participación (mensual)"),
    (2106, "Gratificación (mensual)"),
    (2107, "Recargo 30% día domingo (Art. 38)"),
    (2108, "Remuneración variable pagada en vacaciones (Art. 71)"),
    (
        2109,
        "Remuneración variable pagada en clausura (Art. 38 DFL 2)",
    ),
    (2110, "Aguinaldo"),
    (2111, "Bonos u otras remuneraciones fijas mensuales"),
    (2112, "Tratos (mensual)"),
    (
        2113,
        "Bonos u otras remuneraciones variables mensuales o superiores a un mes",
    ),
    (
        2114,
        "Ejercicio opción no pactada en contrato (Art. 17 N°8 LIR)",
    ),
    (2115, "Beneficios en especie constitutivos de remuneración"),
    (2116, "Remuneraciones bimestrales (devengo en dos meses)"),
    (2117, "Remuneraciones trimestrales (devengo en tres meses)"),
    (
        2118,
        "Remuneraciones cuatrimestral (devengo en cuatro meses)",
    ),
    (2119, "Remuneraciones semestrales (devengo en seis meses)"),
    (2120, "Remuneraciones anuales (devengo en doce meses)"),
    (2121, "Participación anual (devengo en doce meses)"),
    (2122, "Gratificación anual (devengo en doce meses)"),
    (2123, "Otras remuneraciones superiores a un mes"),
    (2124, "Pago por horas de trabajo sindical"),
    (2161, "Sueldo empresarial"),
    (
        2201,
        "Subsidio por incapacidad laboral por licencia médica - total mensual",
    ),
    (2202, "Beca de estudio (Art. 17 N°18 LIR)"),
    (2203, "Gratificaciones de zona (Art. 17 N°27)"),
    (
        2204,
        "Otros ingresos no constitutivos de renta (Art. 17 N°29 LIR)",
    ),
    (2301, "Colación total mensual (Art. 41)"),
    (2302, "Movilización total mensual (Art. 41)"),
    (2303, "Viáticos total mensual (Art. 41)"),
    (
        2304,
        "Asignación de pérdida de caja total mensual (Art. 41)",
    ),
    (
        2305,
        "Asignación de desgaste herramienta total mensual (Art. 41)",
    ),
    (2311, "Asignación familiar legal total mensual (Art. 41)"),
    (2306, "Gastos por causa del trabajo (Art. 41)"),
    (2307, "Gastos por cambio de residencia (Art. 53)"),
    (2308, "Sala cuna (Art. 203)"),
    (2309, "Asignación trabajo a distancia o teletrabajo"),
    (2347, "Depósito convenido hasta UF 900"),
    (
        2310,
        "Alojamiento por razones de trabajo (Art. 17 N°14 LIR)",
    ),
    (2312, "Asignación de traslación (Art. 17 N°15 LIR)"),
    (2313, "Indemnización por feriado legal"),
    (2314, "Indemnización años de servicio"),
    (2315, "Indemnización sustitutiva del aviso previo"),
    (2316, "Indemnización fuero maternal (Art. 163 bis)"),
    (2331, "Indemnización a todo evento (Art. 164)"),
    (2417, "Indemnizaciones voluntarias tributables"),
    (2418, "Indemnizaciones contractuales tributables"),
    (3141, "Cotización obligatoria previsional (AFP o IPS)"),
    (3143, "Cotización obligatoria salud 7%"),
    (3144, "Cotización voluntaria para salud"),
    (3151, "Cotización AFC - trabajador"),
    (
        3146,
        "Cotizaciones técnico extranjero para seguridad social fuera de Chile",
    ),
    (3147, "Descuento depósito convenido hasta UF 900 anual"),
    (
        3155,
        "Cotización ahorro previsional voluntario individual modalidad A",
    ),
    (
        3156,
        "Cotización ahorro previsional voluntario individual modalidad B hasta UF 50",
    ),
    (
        3157,
        "Cotización ahorro previsional voluntario colectivo modalidad A",
    ),
    (
        3158,
        "Cotización ahorro previsional voluntario colectivo modalidad B hasta UF 50",
    ),
    (3161, "Impuesto retenido por remuneraciones"),
    (3162, "Impuesto retenido por indemnizaciones"),
    (
        3163,
        "Mayor retención de impuestos solicitada por el trabajador",
    ),
    (
        3164,
        "Impuesto retenido por reliquidación remuneraciones devengadas en otros períodos",
    ),
    (
        3165,
        "Diferencia de impuesto por reliquidación remuneraciones devengadas en este período",
    ),
    (3166, "Retención préstamo clase media 2020 (Ley 21.252)"),
    (3167, "Rebaja zona extrema DL 889"),
    (3171, "Cuota sindical 1"),
    (3172, "Cuota sindical 2"),
    (3173, "Cuota sindical 3"),
    (3174, "Cuota sindical 4"),
    (3175, "Cuota sindical 5"),
    (3176, "Cuota sindical 6"),
    (3177, "Cuota sindical 7"),
    (3178, "Cuota sindical 8"),
    (3179, "Cuota sindical 9"),
    (3180, "Cuota sindical 10"),
    (3110, "Crédito social CCAF"),
    (3181, "Cuota vivienda o educación (Art. 58)"),
    (3182, "Crédito cooperativas de ahorro (Art 54. Ley Coop.)"),
    (
        3183,
        "Otros descuentos autorizados y solicitados por el trabajador",
    ),
    (3154, "Cotización adicional trabajo pesado - trabajador"),
    (3184, "Donaciones culturales y de reconstrucción"),
    (3185, "Otros descuentos (Art. 58)"),
    (3186, "Pensiones de alimentos"),
    (3187, "Descuento mujer casada (Art. 59)"),
    (3188, "Descuentos por anticipos y préstamos"),
    (4151, "Aporte AFC - empleador"),
    (
        4152,
        "Aporte empleador seguro accidentes del trabajo y Ley SANNA (Ley 16.744)",
    ),
    (
        4131,
        "Aporte empleador indemnización a todo evento (Art. 164)",
    ),
    (4154, "Aporte adicional trabajo pesado - empleador"),
    (4155, "Aporte empleador seguro invalidez y sobrevivencia"),
    (
        4157,
        "Aporte empleador ahorro previsional voluntario colectivo",
    ),
    (5201, "Total haberes"),
    (5210, "Total haberes imponibles y tributables"),
    (5220, "Total haberes imponibles no tributables"),
    (5230, "Total haberes no imponibles y no tributables"),
    (5240, "Total haberes no imponibles y tributables"),
    (5301, "Total descuentos"),
    (5361, "Total descuentos impuestos a las remuneraciones"),
    (5362, "Total descuentos impuestos por indemnizaciones"),
    (5341, "Total descuentos por cotizaciones del trabajador"),
    (5302, "Total otros descuentos"),
    (5410, "Total aportes empleador"),
    (5501, "Total líquido"),
    (5502, "Total indemnizaciones"),
    (5564, "Total indemnizaciones tributables"),
    (5565, "Total indemnizaciones no tributables"),
];

/// Una fila del libro: identificación (11xx) y montos por código (2xxx a 4xxx).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct LreRow {
    /// RUT compacto "12345678-5".
    pub rut: String,
    pub start_date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub end_cause: Option<u32>,
    pub region: u32,
    pub comuna: u32,
    pub jornada: u32,
    #[serde(default)]
    pub disability: u32,
    #[serde(default)]
    pub pensioner: bool,
    /// Código de AFP (100 = no está en AFP).
    pub afp: u32,
    /// Código de salud (102 = Fonasa).
    pub health: u32,
    #[serde(default)]
    pub afc: bool,
    #[serde(default)]
    pub ccaf: u32,
    pub mutual: u32,
    #[serde(default)]
    pub family_loads: u32,
    #[serde(default)]
    pub invalid_loads: u32,
    #[serde(default)]
    pub allowance_bracket: Option<String>,
    pub days: u32,
    #[serde(default)]
    pub young_subsidy: bool,
    #[serde(default)]
    pub apvi: bool,
    /// Montos por código del LRE (se suman si se repiten).
    #[serde(default)]
    pub amounts: BTreeMap<u32, i64>,
}

fn ddmmyyyy(iso: &str) -> String {
    if iso.len() == 10 {
        format!("{}/{}/{}", &iso[8..10], &iso[5..7], &iso[..4])
    } else {
        String::new()
    }
}

/// Totales del libro (5xxx) a partir de los montos de la fila.
pub fn totals(a: &BTreeMap<u32, i64>) -> BTreeMap<u32, i64> {
    let sum = |f: &dyn Fn(u32) -> bool| {
        a.iter()
            .filter(|(k, _)| f(**k))
            .map(|(_, v)| *v)
            .sum::<i64>()
    };
    let g = |k: u32| a.get(&k).copied().unwrap_or(0);
    let mut t = BTreeMap::new();
    let h21 = sum(&|k| (2100..2200).contains(&k));
    let h22 = sum(&|k| (2200..2300).contains(&k));
    let h23 = sum(&|k| (2300..2400).contains(&k));
    let h24 = sum(&|k| (2400..2500).contains(&k));
    let d31 = sum(&|k| (3100..3200).contains(&k) && k != 3164);
    let d5341: i64 = [3141, 3143, 3144, 3146, 3151, 3154, 3155, 3156, 3157, 3158]
        .iter()
        .map(|k| g(*k))
        .sum();
    let indem: i64 = [2313, 2314, 2315, 2316, 2331, 2417, 2418]
        .iter()
        .map(|k| g(*k))
        .sum();
    let indem_trib = g(2417) + g(2418);
    t.insert(5201, h21 + h22 + h23 + h24);
    t.insert(5210, h21);
    t.insert(5220, h22);
    t.insert(5230, h23);
    t.insert(5240, h24);
    t.insert(5301, d31);
    t.insert(5361, g(3161) + g(3165));
    t.insert(5362, g(3162));
    t.insert(5341, d5341);
    t.insert(5302, d31 - g(3161) - g(3165) - g(3162) - d5341);
    t.insert(5410, sum(&|k| (4100..4200).contains(&k)));
    t.insert(5501, h21 + h22 + h23 + h24 - d31);
    t.insert(5502, indem);
    t.insert(5564, indem_trib);
    t.insert(5565, indem - indem_trib);
    t
}

fn cell(r: &LreRow, code: u32, tot: &BTreeMap<u32, i64>) -> String {
    let b = |v: bool| if v { "1" } else { "0" }.to_string();
    match code {
        1101 => r.rut.clone(),
        1102 => ddmmyyyy(&r.start_date),
        1103 => r.end_date.as_deref().map(ddmmyyyy).unwrap_or_default(),
        1104 => r.end_cause.map(|c| c.to_string()).unwrap_or_default(),
        1105 => r.region.to_string(),
        1106 => r.comuna.to_string(),
        1170 => "1".into(),
        1146 => "0".into(),
        1107 => r.jornada.to_string(),
        1108 => r.disability.to_string(),
        1109 => b(r.pensioner),
        1141 => r.afp.to_string(),
        1142 => "0".into(),
        1143 => r.health.to_string(),
        1151 => b(r.afc),
        1110 => r.ccaf.to_string(),
        1152 => r.mutual.to_string(),
        1111 => r.family_loads.to_string(),
        1112 => "0".into(),
        1113 => r.invalid_loads.to_string(),
        1114 => r.allowance_bracket.clone().unwrap_or_else(|| "S".into()),
        1171..=1180 | 1154 | 1132 => String::new(),
        1115 => r.days.to_string(),
        1116 | 1117 => "0".into(),
        1118 => b(r.young_subsidy),
        1155 => b(r.apvi),
        1157 | 1131 => "0".into(),
        c if c >= 5000 => tot.get(&c).copied().unwrap_or(0).to_string(),
        c => r.amounts.get(&c).copied().unwrap_or(0).max(0).to_string(),
    }
}

/// Texto del archivo (separado por punto y coma, con encabezados y salto de línea CRLF).
pub fn build(rows: &[LreRow]) -> String {
    let mut out = HEADERS
        .iter()
        .map(|(c, n)| format!("{n}({c})"))
        .collect::<Vec<_>>()
        .join(";");
    out.push_str("\r\n");
    for r in rows {
        let tot = totals(&r.amounts);
        let line = HEADERS
            .iter()
            .map(|(c, _)| cell(r, *c, &tot))
            .collect::<Vec<_>>()
            .join(";");
        out.push_str(&line);
        out.push_str("\r\n");
    }
    out
}

/// Bytes en Windows-1252 (Latin-1); un carácter fuera de rango se reemplaza por "?".
pub fn to_cp1252(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            if (c as u32) < 256 {
                c as u32 as u8
            } else {
                b'?'
            }
        })
        .collect()
}

/// Nombre del archivo: RUT del empleador sin puntos ni guion, guion bajo y el período (AAAAMM).
pub fn file_name(employer_rut: &str, period: &str) -> String {
    let rut: String = employer_rut
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    format!("{}_{}.csv", rut.to_uppercase(), period.replace('-', ""))
}

/// Códigos de AFP del LRE por nombre (tabla del Suplemento LRE, p. 31).
pub fn afp_code(name: Option<&str>) -> Option<u32> {
    let Some(n) = name else { return Some(100) };
    let n = n.trim().to_lowercase().replace(' ', "");
    Some(match n.as_str() {
        "provida" => 6,
        "planvital" => 11,
        "cuprum" => 13,
        "habitat" | "h\u{e1}bitat" => 14,
        "uno" => 19,
        "capital" => 31,
        "modelo" => 103,
        _ => return None,
    })
}

/// Códigos de salud del LRE por nombre de la Isapre (Suplemento LRE, p. 34).
pub fn health_code(kind: &str, isapre: Option<&str>) -> Option<u32> {
    match kind {
        "fonasa" | "ninguna" => Some(102),
        _ => {
            let n: String = isapre?
                .trim()
                .to_lowercase()
                .chars()
                .filter(|c| !c.is_whitespace())
                .map(|c| match c {
                    'á' => 'a',
                    'é' => 'e',
                    'í' => 'i',
                    'ó' => 'o',
                    'ú' => 'u',
                    c => c,
                })
                .collect();
            Some(match n.as_str() {
                "cruzblanca" => 1,
                "banmedica" => 3,
                "colmena" | "colmenagoldencross" => 4,
                "consalud" => 9,
                "vidatres" => 12,
                _ => return None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codigos_y_nombre() {
        assert_eq!(file_name("76.543.210-3", "2026-09"), "765432103_202609.csv");
        assert_eq!(afp_code(Some("PlanVital")), Some(11));
        assert_eq!(afp_code(None), Some(100));
        assert_eq!(health_code("isapre", Some("Banmédica")), Some(3));
        assert_eq!(health_code("isapre", Some("Otra")), None);
        assert_eq!(to_cp1252("Región ñ"), b"Regi\xf3n \xf1".to_vec());
        let mut seen = std::collections::BTreeSet::new();
        assert!(
            HEADERS.iter().all(|(c, _)| seen.insert(*c)),
            "códigos repetidos"
        );
    }
}
