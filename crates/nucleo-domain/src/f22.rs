//! Borrador del Formulario 22 (renta anual) de una empresa Pro Pyme general (art. 14 letra D) N°3
//! LIR), Fase 10 hito C.
//!
//! Criterio de caja: ingresos percibidos y egresos pagados en el año comercial (recuadro 17), incentivo
//! al ahorro del art. 14 letra E) como opción, impuesto de primera categoría (línea 54), PPM
//! reajustados (código 36), resultado (305 → 90 o 85), capital propio tributario simplificado
//! (recuadro 19), rentas afectas a impuestos finales (recuadro 18) y las columnas RAI y REX del
//! recuadro 20. El recuadro 21 (SAC) y la asignación de créditos a los retiros quedan para el
//! contador (aviso). Ningún valor normativo está escrito aquí: tasa, porcentaje y tope del 14 E, UF
//! y factores de reajuste llegan en [`F22Params`] y en los PPM (`docs/F22.md` §1.1).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::comex::div_round;
use crate::f29::{Note, Severity};

const PPM: i128 = 1_000_000;

/// Signo de un código del recuadro 17: ingreso (+) o egreso (−). `None` = no es de ese recuadro.
pub fn r17_kind(code: u32) -> Option<i64> {
    Some(match code {
        // Ingresos.
        1400 | 1817 | 1401 | 1587 | 1588 | 1402 | 1403 => 1,
        // Egresos.
        1406 | 1409 | 1818 | 1411 | 1412 | 1413 | 1415 | 1419 | 1422 | 1424 | 1425 | 1426 => -1,
        _ => return None,
    })
}

/// Glosa corta de cada código que NÚCLEO llena (formulario 22 AT 2026).
pub fn label(code: u32) -> &'static str {
    match code {
        1400 => "Ingresos del giro percibidos",
        1817 => "Ingresos devengados en años anteriores y percibidos en el año",
        1401 => "Rentas de fuente extranjera percibidas",
        1587 => "Ingresos de operaciones con empresas relacionadas del art. 14 A",
        1588 => "Otros ingresos percibidos o devengados",
        1402 => "Ingresos por intereses y reajustes",
        1403 => "Otros ingresos del giro",
        1410 => "Total de ingresos anuales",
        1406 => "Existencias al ingresar al régimen",
        1409 => "Existencias, insumos y servicios del negocio, pagados",
        1818 => "Existencias, insumos y servicios adeudados en años anteriores y pagados en el año",
        1411 => "Remuneraciones pagadas",
        1412 => "Honorarios pagados",
        1413 => "Adquisición de bienes del activo fijo, pagados",
        1415 => "Arriendos pagados",
        1419 => "Intereses y reajustes pagados por préstamos",
        1422 => "Partidas del art. 21 inc. 1° (impuestos, multas e intereses fiscales)",
        1424 => "Otros gastos deducibles",
        1425 => "Gastos de operaciones con empresas relacionadas del art. 14 A",
        1426 => "Pérdida tributaria de años anteriores",
        1430 => "Total de egresos anuales",
        1431 => "Partidas del art. 21 inc. 1° (se agregan)",
        1729 => "Base imponible antes del incentivo al ahorro",
        1432 => "Incentivo al ahorro (art. 14 letra E)",
        1440 => "Base imponible afecta a impuesto de primera categoría (o pérdida)",
        18 => "Base imponible de primera categoría (línea 54)",
        19 => "Rebajas al impuesto",
        20 => "Impuesto de primera categoría",
        36 => "Pagos provisionales mensuales reajustados",
        305 => "Resultado de la liquidación anual",
        90 => "Impuesto a pagar",
        85 => "Saldo a favor",
        1445 => "Capital propio tributario simplificado inicial",
        1705 => "Base imponible afecta a impuesto de primera categoría",
        1726 => "Retiros o dividendos percibidos en el año",
        1479 => "Retiros o dividendos repartidos en el año",
        1708 => "Partidas del art. 21 inc. 1°",
        1379 => "Crédito por impuestos pagados en el exterior imputable a impuestos finales",
        1710 => "Incentivo al ahorro (se suma de vuelta)",
        1545 => "Capital propio tributario simplificado final",
        1703 => "CPTS final",
        1704 => "Retiros o dividendos repartidos en el año",
        1720 => "Subtotal",
        1493 => "Saldo del registro REX al término del año",
        1494 => "Capital aportado histórico",
        1500 => "Rentas afectas a impuestos finales (RAI) del año",
        1451 => "RAI: remanente del año anterior",
        1459 => "RAI: reverso del remanente",
        1463 => "RAI: aumentos del año",
        1475 => "RAI: retiros imputados",
        1484 => "RAI: remanente para el año siguiente",
        1454 => "REX: remanente del año anterior",
        1470 => "REX: aumentos del año",
        1487 => "REX: remanente para el año siguiente",
        _ => "",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F22Params {
    /// Tasa del impuesto de primera categoría del año comercial (partes por millón).
    #[serde(default)]
    pub idpc_rate_ppm: i64,
    /// Porcentaje de la base invertida que se rebaja con el incentivo 14 E.
    #[serde(default)]
    pub incentive_rate_ppm: i64,
    /// Tope del incentivo, en UF × 10.000.
    #[serde(default)]
    pub incentive_cap_uf_e4: i64,
    /// UF del 31 de diciembre × 100.
    #[serde(default)]
    pub uf_e2: i64,
}

/// Un PPM pagado y su factor de reajuste (× 1.000.000) hasta el cierre del año.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PpmPaid {
    #[serde(default)]
    pub period: Option<String>,
    pub amount: i64,
    pub factor_e6: i64,
}

/// Una partida del recuadro 17 (de NÚCLEO o ingresada a mano), con su origen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct F22Line {
    pub code: u32,
    pub amount: i64,
    #[serde(default)]
    pub label: Option<String>,
}

/// Saldos y movimientos de los registros (del F22 del año anterior y del año).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Registers {
    /// CPTS inicial (código 1545 del F22 anterior).
    #[serde(default)]
    pub cpts_initial: i64,
    #[serde(default)]
    pub dividends_received: i64,
    /// Retiros o dividendos repartidos en el año (históricos).
    #[serde(default)]
    pub withdrawals: i64,
    #[serde(default)]
    pub foreign_tax_credit_final: i64,
    #[serde(default)]
    pub capital_historic: i64,
    /// Saldo final del registro REX.
    #[serde(default)]
    pub rex_final: i64,
    #[serde(default)]
    pub rai_initial: i64,
    #[serde(default)]
    pub rex_initial: i64,
    #[serde(default)]
    pub rex_increase: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F22Input {
    pub params: F22Params,
    #[serde(default)]
    pub lines: Vec<F22Line>,
    /// Pagos de impuesto a la renta, multas e intereses fiscales del año (art. 21 inc. 1°): se
    /// rebajan como egreso (1422) y se vuelven a agregar (1431).
    #[serde(default)]
    pub art21: i64,
    /// Acoge el incentivo al ahorro del art. 14 letra E).
    #[serde(default)]
    pub incentive: bool,
    /// Código 19: rebajas al impuesto (crédito por impuestos pagados en el exterior, etc.).
    #[serde(default)]
    pub rebates: i64,
    #[serde(default)]
    pub ppm: Vec<PpmPaid>,
    #[serde(default)]
    pub registers: Option<Registers>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F22Result {
    pub codes: BTreeMap<u32, i64>,
    /// Impuesto de primera categoría antes de rebajas.
    pub idpc_gross: i64,
    pub notes: Vec<Note>,
    pub complete: bool,
}

fn note(r: &mut F22Result, severity: Severity, code: Option<u32>, text: impl Into<String>) {
    let text = text.into();
    if severity == Severity::Falta {
        r.complete = false;
    }
    if !r.notes.iter().any(|n| n.text == text) {
        r.notes.push(Note {
            code,
            severity,
            text,
        });
    }
}

/// Calcula el borrador del F22 (régimen 14 D N°3).
pub fn compute(input: &F22Input) -> F22Result {
    let p = &input.params;
    let mut r = F22Result {
        complete: true,
        ..Default::default()
    };
    let mut codes: BTreeMap<u32, i64> = BTreeMap::new();

    // PPM reajustados (36) y su reajuste como otro ingreso (1588).
    let mut ppm_total = 0i64;
    let mut ppm_nominal = 0i64;
    for x in &input.ppm {
        if x.factor_e6 <= 0 {
            note(
                &mut r,
                Severity::Falta,
                Some(36),
                "Falta el factor de reajuste de algún PPM (tabla del SII de reajuste de PPM).",
            );
        }
        let f = if x.factor_e6 > 0 {
            x.factor_e6
        } else {
            PPM as i64
        };
        ppm_total += div_round(x.amount as i128 * f as i128, PPM) as i64;
        ppm_nominal += x.amount;
    }

    // Recuadro 17.
    for l in &input.lines {
        match r17_kind(l.code) {
            Some(_) => *codes.entry(l.code).or_insert(0) += l.amount,
            None => note(
                &mut r,
                Severity::Aviso,
                Some(l.code),
                format!(
                    "El código {} no es del recuadro 17: no se consideró.",
                    l.code
                ),
            ),
        }
    }
    if ppm_total != ppm_nominal {
        *codes.entry(1588).or_insert(0) += ppm_total - ppm_nominal;
    }
    if input.art21 != 0 {
        *codes.entry(1422).or_insert(0) += input.art21;
    }
    let income: i64 = codes
        .iter()
        .filter(|(c, _)| r17_kind(**c) == Some(1))
        .map(|(_, v)| *v)
        .sum();
    let expenses: i64 = codes
        .iter()
        .filter(|(c, _)| r17_kind(**c) == Some(-1))
        .map(|(_, v)| *v)
        .sum();
    codes.insert(1410, income);
    codes.insert(1430, expenses);
    if input.art21 != 0 {
        codes.insert(1431, input.art21);
    }
    let before = income - expenses + input.art21;
    codes.insert(1729, before);

    // Incentivo al ahorro (art. 14 E).
    let withdrawals = input.registers.as_ref().map_or(0, |g| g.withdrawals);
    let mut incentive = 0;
    if input.incentive {
        if p.incentive_rate_ppm <= 0 || p.incentive_cap_uf_e4 <= 0 || p.uf_e2 <= 0 {
            note(
                &mut r,
                Severity::Falta,
                Some(1432),
                "Para el incentivo al ahorro faltan su porcentaje, el tope en UF y la UF del 31 de diciembre.",
            );
        } else {
            let invested = before - withdrawals - input.art21;
            let cap = div_round(p.incentive_cap_uf_e4 as i128 * p.uf_e2 as i128, PPM) as i64;
            incentive = (div_round(invested as i128 * p.incentive_rate_ppm as i128, PPM) as i64)
                .max(0)
                .min(cap);
            codes.insert(1432, incentive);
        }
    }
    let base = before - incentive;
    codes.insert(1440, base);

    // Línea 54: impuesto de primera categoría.
    if p.idpc_rate_ppm <= 0 {
        note(
            &mut r,
            Severity::Falta,
            Some(20),
            "Falta la tasa del impuesto de primera categoría del año comercial.",
        );
    }
    let taxable = base.max(0);
    r.idpc_gross = div_round(taxable as i128 * p.idpc_rate_ppm as i128, PPM) as i64;
    let tax = (r.idpc_gross - input.rebates.max(0)).max(0);
    if base < 0 {
        note(
            &mut r,
            Severity::Info,
            Some(1440),
            "El año terminó con pérdida tributaria: no hay impuesto de primera categoría y la pérdida se rebaja el próximo año (código 1426).",
        );
    }
    codes.insert(18, taxable);
    if input.rebates > 0 {
        codes.insert(19, input.rebates);
    }
    codes.insert(20, tax);
    if ppm_total != 0 {
        codes.insert(36, ppm_total);
    }
    let result = tax - ppm_total;
    codes.insert(305, result);
    if result > 0 {
        codes.insert(90, result);
    } else if result < 0 {
        codes.insert(85, -result);
        note(
            &mut r,
            Severity::Info,
            Some(85),
            "Queda saldo a favor: en el F22 eliges si lo devuelven (código 87) o lo dejas para el año siguiente.",
        );
    }

    // Recuadros 19, 18 y 20.
    match &input.registers {
        None => note(
            &mut r,
            Severity::Aviso,
            None,
            "Sin los saldos del F22 del año anterior no se calculan el capital propio tributario ni las rentas afectas a impuestos finales.",
        ),
        Some(g) => {
            let cpts = g.cpts_initial + taxable + g.dividends_received
                - g.withdrawals
                - input.art21
                - g.foreign_tax_credit_final
                + incentive;
            for (c, v) in [
                (1445, g.cpts_initial),
                (1705, taxable),
                (1726, g.dividends_received),
                (1479, g.withdrawals),
                (1708, input.art21),
                (1379, g.foreign_tax_credit_final),
                (1710, incentive),
            ] {
                if v != 0 {
                    codes.insert(c, v);
                }
            }
            codes.insert(1545, cpts);
            let subtotal = cpts.max(0) + g.withdrawals;
            let rai = (subtotal - g.rex_final - g.capital_historic).max(0);
            codes.insert(1703, cpts.max(0));
            if g.withdrawals != 0 {
                codes.insert(1704, g.withdrawals);
            }
            codes.insert(1720, subtotal);
            if g.rex_final != 0 {
                codes.insert(1493, g.rex_final);
            }
            if g.capital_historic != 0 {
                codes.insert(1494, g.capital_historic);
            }
            codes.insert(1500, rai);
            // Recuadro 20: el RAI se recalcula cada año; los retiros se imputan primero al RAI y
            // luego al REX.
            let imputed = g.withdrawals.min(rai);
            let rex_available = g.rex_initial + g.rex_increase;
            let to_rex = (g.withdrawals - imputed).min(rex_available);
            if g.withdrawals - imputed - to_rex > 0 {
                note(
                    &mut r,
                    Severity::Aviso,
                    Some(1475),
                    "Los retiros superan las rentas acumuladas: hay retiros en exceso. Revísalo con tu contador.",
                );
            }
            for (c, v) in [
                (1451, g.rai_initial),
                (1459, g.rai_initial),
                (1463, rai),
                (1475, imputed),
                (1484, rai - imputed),
                (1454, g.rex_initial),
                (1470, g.rex_increase),
                (1487, rex_available - to_rex),
            ] {
                if v != 0 {
                    codes.insert(c, v);
                }
            }
            if g.withdrawals > 0 {
                note(
                    &mut r,
                    Severity::Info,
                    Some(1475),
                    "Hubo retiros: el crédito que les corresponde (recuadro 21, DJ 1948 y certificado) lo calcula tu contador.",
                );
            }
        }
    }
    r.codes = codes;
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signos() {
        assert_eq!(r17_kind(1400), Some(1));
        assert_eq!(r17_kind(1411), Some(-1));
        assert_eq!(r17_kind(1440), None);
        assert!(!label(1432).is_empty());
    }
}
