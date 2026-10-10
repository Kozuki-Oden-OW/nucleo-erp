//! Finiquito básico (Fase 10, hito B): indemnizaciones al terminar una relación laboral.
//!
//! Calcula feriado pendiente y proporcional (convertido a días corridos), indemnización sustitutiva
//! del aviso previo, indemnización por años de servicio y por tiempo servido en contratos por obra
//! o faena, con los topes legales. La remuneración del último mes se liquida aparte (liquidación
//! normal con los días trabajados). Cálculo puro y entero; ningún tope ni número de días está escrito
//! aquí: llegan en [`SeveranceRules`] (`docs/REMUNERACIONES.md` §2).

use serde::{Deserialize, Serialize};

use crate::comex::div_round;
use crate::f29::{Note, Severity};
use crate::payroll::{DeductionItem, PayLine, uf_to_clp};

/// Causal de término (con su código del Libro de Remuneraciones Electrónico).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cause {
    /// Art. 159 N°1.
    MutuoAcuerdo,
    /// Art. 159 N°2.
    Renuncia,
    /// Art. 159 N°3.
    Muerte,
    /// Art. 159 N°4.
    VencimientoPlazo,
    /// Art. 159 N°5.
    ConclusionObra,
    /// Art. 161 inciso 1°.
    NecesidadesEmpresa,
    /// Art. 161 inciso 2°.
    Desahucio,
    /// Art. 160 (causales imputables a la persona): no hay indemnizaciones legales por despido.
    Art160,
}

impl Cause {
    pub fn lre_code(self) -> Option<u32> {
        Some(match self {
            Cause::MutuoAcuerdo => 3,
            Cause::Renuncia => 4,
            Cause::Muerte => 5,
            Cause::VencimientoPlazo => 6,
            Cause::ConclusionObra => 7,
            Cause::NecesidadesEmpresa => 18,
            Cause::Desahucio => 19,
            Cause::Art160 => return None,
        })
    }
    fn is_161(self) -> bool {
        matches!(self, Cause::NecesidadesEmpresa | Cause::Desahucio)
    }
}

/// Reglas legales del finiquito (se ingresan con los indicadores del mes).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SeveranceRules {
    /// UF del último día del mes anterior al pago, × 100.
    #[serde(default)]
    pub uf_e2: i64,
    /// Tope de la remuneración base para indemnizaciones (art. 172), en UF × 10.000.
    #[serde(default)]
    pub cap_uf_e4: i64,
    /// Tope de años de la indemnización por años de servicio.
    #[serde(default)]
    pub cap_years: i64,
    /// Días hábiles de feriado por año.
    #[serde(default)]
    pub vacation_days_per_year: i64,
    /// Días de indemnización por mes en contratos por obra o faena, × 100.
    #[serde(default)]
    pub obra_days_per_month_e2: i64,
    /// Feriados nacionales (AAAA-MM-DD) para convertir días hábiles en corridos.
    #[serde(default)]
    pub holidays: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeveranceInput {
    pub rules: SeveranceRules,
    pub start_date: String,
    pub end_date: String,
    pub cause: Cause,
    /// Se dio el aviso por escrito con 30 días de anticipación.
    #[serde(default)]
    pub notice_given: bool,
    /// Última remuneración mensual (art. 172): sueldo, bonos fijos y cotizaciones del trabajador;
    /// sin horas extra, asignación familiar ni beneficios esporádicos.
    pub base_172: i64,
    /// Remuneración íntegra para el feriado (art. 71).
    pub vacation_base: i64,
    /// Días hábiles de feriado de años anteriores no tomados, × 100.
    #[serde(default)]
    pub pending_vacation_days_e2: i64,
    /// Días hábiles ya tomados del período en curso (se restan del proporcional), × 100.
    #[serde(default)]
    pub vacation_taken_days_e2: i64,
    /// Aporte del empleador a la cuenta individual del seguro de cesantía, imputable a la
    /// indemnización por años de servicio (art. 13 Ley 19.728).
    #[serde(default)]
    pub afc_offset: i64,
    #[serde(default)]
    pub deductions: Vec<DeductionItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SeveranceResult {
    pub earnings: Vec<PayLine>,
    pub deductions: Vec<PayLine>,
    pub total_earnings: i64,
    pub total_deductions: i64,
    pub to_pay: i64,
    /// Antigüedad: años, meses y días completos.
    pub service_years: i64,
    pub service_months: i64,
    pub service_days: i64,
    /// Años que se pagan como indemnización por años de servicio (con la fracción y el tope).
    pub ias_years: i64,
    /// Base del art. 172 con el tope.
    pub capped_base: i64,
    /// Feriado en días hábiles y su equivalente en días corridos, × 100.
    pub vacation_business_days_e2: i64,
    pub vacation_calendar_days_e2: i64,
    pub lre_cause: Option<u32>,
    pub notes: Vec<Note>,
    pub complete: bool,
}

/* ───────────────────────────── fechas ───────────────────────────── */

fn parse_date(s: &str) -> Option<(i64, i64, i64)> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y = s[..4].parse().ok()?;
    let m = s[5..7].parse().ok()?;
    let d = s[8..].parse().ok()?;
    ((1..=12).contains(&m) && d >= 1 && d <= days_in_month(y, m)).then_some((y, m, d))
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Días desde el 1970-01-01 (algoritmo de Howard Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn iso(z: i64) -> String {
    let (y, m, d) = civil_from_days(z);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Diferencia en años, meses y días completos entre el inicio y el día siguiente al término.
fn service(start: (i64, i64, i64), end: (i64, i64, i64)) -> (i64, i64, i64) {
    let (ey, em, ed) = civil_from_days(days_from_civil(end.0, end.1, end.2) + 1);
    let (sy, sm, sd) = start;
    let mut months = (ey - sy) * 12 + (em - sm);
    let mut days = ed - sd;
    if days < 0 {
        months -= 1;
        let (py, pm) = if em == 1 { (ey - 1, 12) } else { (ey, em - 1) };
        days += days_in_month(py, pm);
    }
    (months.div_euclid(12), months.rem_euclid(12), days)
}

fn money(v: i64) -> String {
    let s = v.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    format!("{}${out}", if v < 0 { "−" } else { "" })
}

fn dec2(e2: i64) -> String {
    if e2 % 100 == 0 {
        (e2 / 100).to_string()
    } else {
        format!("{},{:02}", e2 / 100, e2 % 100)
            .trim_end_matches('0')
            .to_string()
    }
}

fn line(key: &str, label: &str, amount: i64, lre: Option<u32>, detail: String) -> PayLine {
    PayLine {
        key: key.into(),
        label: label.into(),
        amount,
        lre,
        detail: Some(detail),
    }
}

fn note(r: &mut SeveranceResult, severity: Severity, text: impl Into<String>) {
    let text = text.into();
    if severity == Severity::Falta {
        r.complete = false;
    }
    if !r.notes.iter().any(|n| n.text == text) {
        r.notes.push(Note {
            code: None,
            severity,
            text,
        });
    }
}

/// Calcula el finiquito.
pub fn compute(input: &SeveranceInput) -> SeveranceResult {
    let rules = &input.rules;
    let mut r = SeveranceResult {
        complete: true,
        lre_cause: input.cause.lre_code(),
        ..Default::default()
    };
    let (Some(start), Some(end)) = (parse_date(&input.start_date), parse_date(&input.end_date))
    else {
        note(
            &mut r,
            Severity::Falta,
            "Las fechas de ingreso y de término deben ser válidas (AAAA-MM-DD).",
        );
        return r;
    };
    let (zs, ze) = (
        days_from_civil(start.0, start.1, start.2),
        days_from_civil(end.0, end.1, end.2),
    );
    if ze < zs {
        note(
            &mut r,
            Severity::Falta,
            "La fecha de término no puede ser anterior a la de ingreso.",
        );
        return r;
    }
    let (years, months, days) = service(start, end);
    (r.service_years, r.service_months, r.service_days) = (years, months, days);

    let cap = if rules.uf_e2 > 0 && rules.cap_uf_e4 > 0 {
        Some(uf_to_clp(rules.cap_uf_e4, rules.uf_e2))
    } else {
        None
    };
    r.capped_base = cap.map_or(input.base_172, |c| input.base_172.min(c));
    let needs_cap = input.cause.is_161();
    if needs_cap && cap.is_none() {
        note(
            &mut r,
            Severity::Falta,
            "Faltan la UF y el tope en UF de la base de las indemnizaciones (indicadores del mes).",
        );
    }
    if needs_cap && cap.is_some_and(|c| input.base_172 > c) {
        let capped = r.capped_base;
        note(
            &mut r,
            Severity::Info,
            format!(
                "La última remuneración supera el tope legal: las indemnizaciones se calculan sobre {}.",
                money(capped)
            ),
        );
    }

    // 1. Feriado: pendiente + proporcional desde el último aniversario, en días hábiles.
    if rules.vacation_days_per_year <= 0 {
        note(
            &mut r,
            Severity::Falta,
            "Faltan los días de feriado por año (indicadores del mes).",
        );
    } else {
        let partial_days = months * 30 + days;
        let proportional = div_round(
            rules.vacation_days_per_year as i128 * 100 * partial_days as i128,
            360,
        ) as i64;
        let business =
            (input.pending_vacation_days_e2 + proportional - input.vacation_taken_days_e2).max(0);
        r.vacation_business_days_e2 = business;
        // Hábiles → corridos: desde el día siguiente al término se suman sábados, domingos y
        // feriados que caigan mientras se consumen los días hábiles.
        let holidays: Vec<i64> = rules
            .holidays
            .iter()
            .filter_map(|h| parse_date(h).map(|(y, m, d)| days_from_civil(y, m, d)))
            .collect();
        if holidays.is_empty() && business > 0 {
            note(
                &mut r,
                Severity::Aviso,
                "No hay feriados nacionales en los indicadores: solo se sumaron sábados y domingos al convertir el feriado a días corridos.",
            );
        }
        let mut left = business;
        let mut calendar = 0;
        let mut day = ze;
        while left > 0 {
            day += 1;
            let weekday = (day + 4).rem_euclid(7); // 0 = domingo, 6 = sábado
            if weekday == 0 || weekday == 6 || holidays.contains(&day) {
                calendar += 100;
            } else {
                let take = left.min(100);
                left -= take;
                calendar += take;
            }
        }
        r.vacation_calendar_days_e2 = calendar;
        if calendar > 0 {
            let amount = div_round(input.vacation_base as i128 * calendar as i128, 3_000) as i64;
            r.earnings.push(line(
                "feriado",
                "Indemnización por feriado",
                amount,
                Some(2313),
                format!(
                    "{} días hábiles (hasta el {}) = {} días corridos × {} / 30",
                    dec2(business),
                    iso(day),
                    dec2(calendar),
                    money(input.vacation_base)
                ),
            ));
        }
    }

    // 2. Aviso previo y años de servicio (art. 161).
    if input.cause.is_161() {
        if !input.notice_given {
            r.earnings.push(line(
                "aviso_previo",
                "Indemnización sustitutiva del aviso previo",
                r.capped_base,
                Some(2315),
                "Una remuneración mensual (no se dio aviso con 30 días)".into(),
            ));
        }
        if years >= 1 {
            let fraction = months > 6 || (months == 6 && days > 0);
            let paid = years + i64::from(fraction);
            r.ias_years = if rules.cap_years > 0 {
                paid.min(rules.cap_years)
            } else {
                note(
                    &mut r,
                    Severity::Falta,
                    "Falta el tope de años de la indemnización (indicadores del mes).",
                );
                paid
            };
            let ias = r.capped_base * r.ias_years;
            r.earnings.push(line(
                "anios_servicio",
                "Indemnización por años de servicio",
                ias,
                Some(2314),
                format!(
                    "{} × {} año(s){}",
                    money(r.capped_base),
                    r.ias_years,
                    if fraction {
                        " (la fracción de más de seis meses cuenta como año)"
                    } else {
                        ""
                    }
                ),
            ));
            if input.afc_offset > 0 {
                let off = input.afc_offset.min(ias);
                r.deductions.push(line(
                    "aporte_afc",
                    "Aporte del empleador al seguro de cesantía (art. 13 Ley 19.728)",
                    off,
                    Some(3185),
                    "Se descuenta de la indemnización por años de servicio".into(),
                ));
            } else {
                note(
                    &mut r,
                    Severity::Info,
                    "Por necesidades de la empresa, el empleador puede descontar de la indemnización su aporte a la cuenta individual del seguro de cesantía: pide el certificado a la AFC.",
                );
            }
        } else {
            note(
                &mut r,
                Severity::Info,
                "Con menos de un año de servicio no corresponde indemnización por años de servicio.",
            );
        }
    }

    // 3. Contrato por obra o faena: días por mes trabajado.
    if input.cause == Cause::ConclusionObra {
        let worked_months = years * 12 + months + i64::from(days > 15);
        if rules.obra_days_per_month_e2 <= 0 {
            note(
                &mut r,
                Severity::Falta,
                "Faltan los días por mes de la indemnización por obra o faena (indicadores del mes).",
            );
        } else if worked_months >= 1 {
            let days_e2 = rules.obra_days_per_month_e2 * worked_months;
            let amount = div_round(input.base_172 as i128 * days_e2 as i128, 3_000) as i64;
            r.earnings.push(line(
                "obra_faena",
                "Indemnización por tiempo servido (obra o faena)",
                amount,
                Some(2314),
                format!(
                    "{} días × {} mes(es) × {} / 30",
                    dec2(rules.obra_days_per_month_e2),
                    worked_months,
                    money(input.base_172)
                ),
            ));
        }
    }

    if input.cause == Cause::Art160 {
        note(
            &mut r,
            Severity::Aviso,
            "Con una causal del art. 160 no hay indemnización por años de servicio ni aviso previo. Si la persona reclama y el juez no la acoge, se pagan con recargo: asesórate.",
        );
    }

    for d in input.deductions.iter().filter(|d| d.amount != 0) {
        r.deductions.push(PayLine {
            key: "descuento".into(),
            label: d.label.clone(),
            amount: d.amount,
            lre: d.lre,
            detail: None,
        });
    }
    r.total_earnings = r.earnings.iter().map(|l| l.amount).sum();
    r.total_deductions = r.deductions.iter().map(|l| l.amount).sum();
    r.to_pay = r.total_earnings - r.total_deductions;
    note(
        &mut r,
        Severity::Info,
        "El sueldo de los días trabajados del último mes se paga con su liquidación normal. El finiquito se firma ante un ministro de fe (notario, inspección del trabajo) o en el portal de la Dirección del Trabajo.",
    );
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fechas() {
        for z in [-1000, 0, 19_000, 20_727] {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(iso(days_from_civil(2026, 10, 10)), "2026-10-10");
        // 2026-10-10 es sábado.
        assert_eq!((days_from_civil(2026, 10, 10) + 4).rem_euclid(7), 6);
        assert_eq!(service((2020, 3, 1), (2026, 9, 30)), (6, 7, 0));
        assert_eq!(service((2024, 1, 15), (2026, 3, 10)), (2, 1, 24));
    }
}
