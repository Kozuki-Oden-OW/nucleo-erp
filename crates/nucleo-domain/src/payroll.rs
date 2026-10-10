//! Liquidación mensual de sueldo (Fase 10, hito B).
//!
//! Cálculo puro y entero (pesos) del sueldo de un trabajador o del **sueldo empresarial** del
//! dueño: haberes, topes imponibles en UF, cotización AFP, salud (Fonasa o Isapre), seguro de
//! cesantía, impuesto único de segunda categoría por tramos en UTM, descuentos, líquido y aportes
//! del empleador. Ninguna tasa, tope ni tramo está escrito aquí: todo llega en
//! [`PayrollParams`] (los "indicadores del mes" que publica Previred y la tabla del SII).
//!
//! Redondeo: cada concepto se calcula con una sola multiplicación exacta y se redondea al peso
//! (mitad hacia arriba) al final del concepto; los totales suman conceptos ya redondeados
//! (`docs/REMUNERACIONES.md` §1.0, como la guía MINEDUC).

use serde::{Deserialize, Serialize};

use crate::comex::div_round;
use crate::f29::{Note, Severity};

const PPM: i128 = 1_000_000;

/// Un tramo de la tabla mensual del impuesto único (art. 43 N°1 LIR), en UTM.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxBracket {
    /// Límite superior del tramo en UTM × 10.000 (`None` = "y más").
    #[serde(default)]
    pub up_to_utm_e4: Option<i64>,
    /// Factor en partes por millón (4 % = 40.000; exento = 0).
    pub factor_ppm: i64,
    /// Cantidad a rebajar en UTM × 10.000.
    #[serde(default)]
    pub rebate_utm_e4: i64,
}

/// Sobre qué base se calcula un aporte del empleador.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmployerBase {
    /// Renta imponible con el tope de AFP y salud (SIS, cotización del empleador Ley 21.735).
    #[default]
    Pension,
    /// Renta imponible con el tope del seguro de cesantía.
    Afc,
}

/// Un aporte de cargo del empleador que no se descuenta al trabajador (SIS, cuenta individual,
/// rentabilidad protegida, expectativa de vida…). Lo define el período, con su nombre.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmployerRate {
    pub code: String,
    pub label: String,
    pub rate_ppm: i64,
    #[serde(default)]
    pub base: EmployerBase,
    /// Código del Libro de Remuneraciones Electrónico (4155 para el SIS), si tiene uno.
    #[serde(default)]
    pub lre: Option<u32>,
    /// A quién se entera en Previred: "afp" (la AFP de la persona) o "seguro_social".
    #[serde(default)]
    pub payee: Option<String>,
}

/// Un tramo de la asignación familiar: ingreso de referencia hasta el que aplica y monto por carga.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AllowanceBracket {
    /// Ingreso mensual de referencia hasta el que aplica (`None` = "más de").
    #[serde(default)]
    pub up_to_income: Option<i64>,
    /// Monto mensual por carga (0 en el último tramo).
    pub amount: i64,
}

/// Asignación familiar (DFL 150): tramos y días con remuneración para pagarla completa.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AllowanceRule {
    #[serde(default)]
    pub brackets: Vec<AllowanceBracket>,
    /// Días con remuneración desde los cuales se paga completa (bajo eso, proporcional).
    #[serde(default)]
    pub full_days: i64,
}

/// Cómo se rebaja la cotización de salud de la base del impuesto único.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthDeduction {
    /// Toda la cotización de salud (7 % + adicional Isapre) hasta el 7 % del tope imponible
    /// (manual del Libro de Remuneraciones Electrónico, DT 2022, p. 67).
    #[default]
    UpToCap,
    /// Solo la cotización legal (criterio de la guía MINEDUC 2016, p. 75).
    LegalOnly,
}

/// Gratificación legal del art. 50 del Código del Trabajo (25 % con tope de 4,75 IMM al año).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GratificationRule {
    pub rate_ppm: i64,
    /// Tope anual en ingresos mínimos × 10.000 (4,75 = 47.500).
    pub cap_imm_e4: i64,
}

/// Seguro de cesantía (Ley 19.728).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AfcRates {
    #[serde(default)]
    pub worker_indefinite_ppm: i64,
    #[serde(default)]
    pub employer_indefinite_ppm: i64,
    #[serde(default)]
    pub employer_fixed_ppm: i64,
}

/// Indicadores del mes: todo valor normativo que usa la liquidación.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PayrollParams {
    /// UF del último día del mes de remuneraciones, × 100 (0 = falta).
    #[serde(default)]
    pub uf_e2: i64,
    /// UTM del mes (0 = falta).
    #[serde(default)]
    pub utm: i64,
    /// Ingreso mínimo mensual (0 = no se ingresó).
    #[serde(default)]
    pub imm: i64,
    /// Tope imponible AFP, salud y accidentes del trabajo, en UF × 10.000.
    #[serde(default)]
    pub cap_pension_uf_e4: i64,
    /// Tope imponible del seguro de cesantía, en UF × 10.000.
    #[serde(default)]
    pub cap_afc_uf_e4: i64,
    /// Cotización legal de salud.
    #[serde(default)]
    pub health_ppm: i64,
    #[serde(default)]
    pub afc: AfcRates,
    /// Aportes del empleador del período (SIS, Ley 21.735…).
    #[serde(default)]
    pub employer: Vec<EmployerRate>,
    /// Ley 16.744 de la empresa (básica + adicional + Ley SANNA), si está afiliada a una mutual o al ISL.
    #[serde(default)]
    pub accident_ppm: i64,
    #[serde(default)]
    pub tax_brackets: Vec<TaxBracket>,
    #[serde(default)]
    pub gratification: Option<GratificationRule>,
    /// Recargo mínimo de las horas extra (art. 32 CdT), si el contrato no fija otro.
    #[serde(default)]
    pub overtime_surcharge_ppm: i64,
    #[serde(default)]
    pub health_deduction: HealthDeduction,
    #[serde(default)]
    pub family_allowance: Option<AllowanceRule>,
    /// Tope mensual de la rebaja del APV régimen B en la base del impuesto, en UF × 10.000.
    #[serde(default)]
    pub apv_b_cap_uf_e4: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContractKind {
    #[default]
    Indefinido,
    PlazoFijo,
    /// Sueldo empresarial del dueño o socio: sin contrato de trabajo.
    SinContrato,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Health {
    #[default]
    Fonasa,
    /// Plan pactado en UF × 10.000 o en pesos.
    Isapre {
        #[serde(default)]
        plan_uf_e4: Option<i64>,
        #[serde(default)]
        plan_clp: Option<i64>,
    },
    Ninguna,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WorkerTerms {
    #[serde(default)]
    pub contract: ContractKind,
    /// Sueldo empresarial (código 2161 del Libro de Remuneraciones) en vez de sueldo (2101).
    #[serde(default)]
    pub owner_salary: bool,
    /// Tasa total de la AFP (10 % + comisión); `None` = no cotiza en AFP (pensionado, otro régimen).
    #[serde(default)]
    pub afp_ppm: Option<i64>,
    #[serde(default)]
    pub afp_name: Option<String>,
    #[serde(default)]
    pub health: Health,
    #[serde(default)]
    pub health_name: Option<String>,
    /// Cotiza seguro de cesantía.
    #[serde(default)]
    pub afc: bool,
    /// Le corresponden los aportes del empleador del período (SIS, Ley 21.735).
    #[serde(default = "yes")]
    pub employer_contrib: bool,
    /// Cubierto por la Ley 16.744 de la empresa.
    #[serde(default = "yes")]
    pub accident: bool,
    /// Jornada semanal pactada (para las horas extra).
    #[serde(default)]
    pub weekly_hours: Option<i64>,
    /// Cargas familiares simples y maternales acreditadas.
    #[serde(default)]
    pub family_loads: i64,
    /// Cargas por invalidez (reciben el doble).
    #[serde(default)]
    pub invalid_loads: i64,
    /// Ingreso de referencia para el tramo de asignación familiar (promedio del semestre
    /// enero-junio anterior); `None` = lo imponible del mes, con aviso.
    #[serde(default)]
    pub allowance_income: Option<i64>,
    #[serde(default)]
    pub apv: Option<Apv>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApvRegime {
    /// Régimen A: bonificación fiscal, sin efecto en el impuesto del mes.
    A,
    /// Régimen B: se rebaja de la base del impuesto único hasta el tope mensual.
    B,
}

/// Ahorro previsional voluntario individual descontado por planilla.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Apv {
    pub regime: ApvRegime,
    /// Monto mensual en pesos o en UF × 10.000.
    #[serde(default)]
    pub amount_clp: Option<i64>,
    #[serde(default)]
    pub amount_uf_e4: Option<i64>,
    #[serde(default)]
    pub institution: Option<String>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GratificationMode {
    #[default]
    Ninguna,
    /// Art. 50: 25 % de lo imponible del mes con tope mensual de 4,75 IMM / 12.
    Art50,
    /// Monto fijo pactado.
    Fija,
}

/// Haber adicional del mes (bono, comisión, colación, movilización…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EarningItem {
    pub label: String,
    pub amount: i64,
    /// Imponible y tributable (bonos, comisiones) o no (colación, movilización, viático).
    #[serde(default = "yes")]
    pub taxable: bool,
    /// Código del Libro de Remuneraciones Electrónico, si se conoce.
    #[serde(default)]
    pub lre: Option<u32>,
}

/// Descuento voluntario o judicial (préstamo, cuota sindical, seguro…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeductionItem {
    pub label: String,
    pub amount: i64,
    #[serde(default)]
    pub lre: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PayslipInput {
    pub params: PayrollParams,
    pub worker: WorkerTerms,
    /// Sueldo base mensual pactado.
    pub base_salary: i64,
    /// Días trabajados del mes comercial de 30 días.
    #[serde(default = "thirty")]
    pub days: i64,
    /// Horas extra × 100 (1,5 h = 150).
    #[serde(default)]
    pub overtime_hours_e2: i64,
    /// Recargo pactado de las horas extra; `None` = el mínimo legal del período.
    #[serde(default)]
    pub overtime_surcharge_ppm: Option<i64>,
    #[serde(default)]
    pub gratification: GratificationMode,
    #[serde(default)]
    pub gratification_amount: i64,
    #[serde(default)]
    pub items: Vec<EarningItem>,
    #[serde(default)]
    pub deductions: Vec<DeductionItem>,
    /// Anticipo pagado durante el mes (se descuenta después del alcance líquido).
    #[serde(default)]
    pub advance: i64,
}

fn thirty() -> i64 {
    30
}

/// Una línea de la liquidación, con la explicación de su cálculo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayLine {
    pub key: String,
    pub label: String,
    pub amount: i64,
    #[serde(default)]
    pub lre: Option<u32>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PayslipResult {
    /// Haberes imponibles y tributables.
    pub taxable_earnings: Vec<PayLine>,
    /// Haberes no imponibles (colación, movilización…).
    pub other_earnings: Vec<PayLine>,
    /// Cotizaciones e impuesto (descuentos legales).
    pub legal_deductions: Vec<PayLine>,
    /// Descuentos voluntarios o judiciales.
    pub other_deductions: Vec<PayLine>,
    /// Aportes del empleador.
    pub employer: Vec<PayLine>,
    pub total_taxable: i64,
    pub cap_pension: i64,
    pub cap_afc: i64,
    pub pension_base: i64,
    pub afc_base: i64,
    /// Base del impuesto único (renta tributable).
    pub tax_base: i64,
    pub tax: i64,
    /// Tramo aplicado (1 = exento).
    pub tax_bracket: usize,
    /// Tramo de asignación familiar ("A", "B"…), si tiene cargas.
    #[serde(default)]
    pub allowance_bracket: Option<String>,
    pub total_earnings: i64,
    pub total_deductions: i64,
    /// Total haberes − total descuentos.
    pub net: i64,
    pub advance: i64,
    /// Saldo líquido a pagar (alcance líquido − anticipo).
    pub to_pay: i64,
    pub employer_total: i64,
    /// Costo total para la empresa (haberes + aportes del empleador).
    pub employer_cost: i64,
    pub notes: Vec<Note>,
    pub complete: bool,
}

fn note(notes: &mut Vec<Note>, complete: &mut bool, severity: Severity, text: String) {
    if severity == Severity::Falta {
        *complete = false;
    }
    if !notes.iter().any(|n| n.text == text) {
        notes.push(Note {
            code: None,
            severity,
            text,
        });
    }
}

fn mul_ppm(base: i64, rate_ppm: i64) -> i64 {
    div_round(base as i128 * rate_ppm as i128, PPM) as i64
}

/// Monto en UF × 10.000 → pesos con la UF × 100.
pub fn uf_to_clp(amount_uf_e4: i64, uf_e2: i64) -> i64 {
    div_round(amount_uf_e4 as i128 * uf_e2 as i128, 1_000_000) as i64
}

fn pct(ppm: i64) -> String {
    // 114.400 ppm → "11,44 %"; hasta 4 decimales, sin ceros sobrantes.
    let whole = ppm / 10_000;
    let frac = (ppm % 10_000).abs();
    if frac == 0 {
        format!("{whole} %")
    } else {
        let f = format!("{frac:04}");
        format!("{whole},{} %", f.trim_end_matches('0'))
    }
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

/// Número × 10.000 con coma decimal y sin ceros sobrantes (47.500 → "4,75").
fn dec4(e4: i64) -> String {
    let whole = e4 / 10_000;
    let frac = e4 % 10_000;
    if frac == 0 {
        whole.to_string()
    } else {
        format!("{whole},{}", format!("{frac:04}").trim_end_matches('0'))
    }
}

fn utm_txt(e4: i64) -> String {
    format!("{} UTM", dec4(e4))
}

fn line(
    key: &str,
    label: impl Into<String>,
    amount: i64,
    lre: Option<u32>,
    detail: Option<String>,
) -> PayLine {
    PayLine {
        key: key.into(),
        label: label.into(),
        amount,
        lre,
        detail,
    }
}

/// Calcula la liquidación del mes.
pub fn compute(input: &PayslipInput) -> PayslipResult {
    let p = &input.params;
    let w = &input.worker;
    let mut r = PayslipResult {
        complete: true,
        ..Default::default()
    };

    // 1. Sueldo (o sueldo empresarial) proporcional a los días del mes comercial de 30 días.
    let days = input.days.clamp(0, 30);
    if days != input.days {
        note(
            &mut r.notes,
            &mut r.complete,
            Severity::Aviso,
            "Los días trabajados deben estar entre 0 y 30 (mes comercial).".into(),
        );
    }
    let salary = if days == 30 {
        input.base_salary
    } else {
        div_round(input.base_salary as i128 * days as i128, 30) as i64
    };
    let (key, label, lre) = if w.owner_salary {
        ("sueldo_empresarial", "Sueldo empresarial", 2161)
    } else {
        ("sueldo", "Sueldo base", 2101)
    };
    r.taxable_earnings.push(line(
        key,
        label,
        salary,
        Some(lre),
        (days != 30).then(|| format!("{} / 30 × {days} días", money(input.base_salary))),
    ));

    // 2. Horas extra: sueldo / 30 × 28 / (jornada × 4) × (1 + recargo) × horas.
    let mut overtime = 0;
    if input.overtime_hours_e2 > 0 {
        let surcharge = input
            .overtime_surcharge_ppm
            .unwrap_or(p.overtime_surcharge_ppm);
        match w.weekly_hours.filter(|h| *h > 0) {
            None => note(&mut r.notes, &mut r.complete,
                Severity::Falta,
                "Para calcular las horas extra falta la jornada semanal del contrato.".into(),
            ),
            Some(_) if surcharge <= 0 => note(&mut r.notes, &mut r.complete,
                Severity::Falta,
                "Falta el recargo de las horas extra (en los indicadores del mes o en el contrato).".into(),
            ),
            Some(h) => {
                // No se calculan horas extra sobre un sueldo menor al ingreso mínimo.
                let base = if p.imm > 0 && input.base_salary < p.imm {
                    p.imm
                } else {
                    input.base_salary
                };
                overtime = div_round(
                    base as i128 * 28 * (PPM + surcharge as i128) * input.overtime_hours_e2 as i128,
                    30 * h as i128 * 4 * PPM * 100,
                ) as i64;
                r.taxable_earnings.push(line(
                    "horas_extra",
                    "Horas extra",
                    overtime,
                    Some(2102),
                    Some(format!(
                        "{} / 30 × 28 / ({h} h × 4) × (1 + {}) × {} h",
                        money(base),
                        pct(surcharge),
                        hours_txt(input.overtime_hours_e2)
                    )),
                ));
            }
        }
    }

    // 3. Haberes imponibles del mes.
    let mut taxable_items = 0;
    for it in input.items.iter().filter(|i| i.taxable && i.amount != 0) {
        taxable_items += it.amount;
        r.taxable_earnings
            .push(line("haber", it.label.clone(), it.amount, it.lre, None));
    }

    // 4. Gratificación.
    match input.gratification {
        GratificationMode::Ninguna => {}
        GratificationMode::Fija => {
            if input.gratification_amount > 0 {
                r.taxable_earnings.push(line(
                    "gratificacion",
                    "Gratificación",
                    input.gratification_amount,
                    Some(2106),
                    Some("Monto pactado".into()),
                ));
            }
        }
        GratificationMode::Art50 => match (&p.gratification, p.imm) {
            (Some(g), imm) if imm > 0 => {
                let base = salary + overtime + taxable_items;
                // min(base × tasa, IMM × factor / 12), comparando en fracciones exactas.
                let a = base as i128 * g.rate_ppm as i128 * 12 * 10_000;
                let b = imm as i128 * g.cap_imm_e4 as i128 * PPM;
                let capped = b < a;
                let amount = div_round(a.min(b), 12 * 10_000 * PPM) as i64;
                r.taxable_earnings.push(line(
                    "gratificacion",
                    "Gratificación legal (art. 50)",
                    amount,
                    Some(2106),
                    Some(if capped {
                        format!(
                            "Tope mensual: {} ingresos mínimos de {} / 12",
                            dec4(g.cap_imm_e4),
                            money(imm)
                        )
                    } else {
                        format!("{} de {}", pct(g.rate_ppm), money(base))
                    }),
                ));
            }
            _ => note(&mut r.notes, &mut r.complete,
                Severity::Falta,
                "Para la gratificación del art. 50 faltan el ingreso mínimo y la regla de gratificación en los indicadores del mes.".into(),
            ),
        },
    }
    r.total_taxable = r.taxable_earnings.iter().map(|l| l.amount).sum();

    // 5. Topes imponibles en UF.
    if p.uf_e2 <= 0 || p.cap_pension_uf_e4 <= 0 {
        note(
            &mut r.notes,
            &mut r.complete,
            Severity::Falta,
            "Faltan la UF del cierre del mes y el tope imponible (indicadores del mes).".into(),
        );
    }
    let cap_pension = if p.uf_e2 > 0 && p.cap_pension_uf_e4 > 0 {
        uf_to_clp(p.cap_pension_uf_e4, p.uf_e2)
    } else {
        i64::MAX
    };
    let cap_afc = if p.uf_e2 > 0 && p.cap_afc_uf_e4 > 0 {
        uf_to_clp(p.cap_afc_uf_e4, p.uf_e2)
    } else {
        i64::MAX
    };
    // En el resultado, 0 = sin tope (faltan los indicadores).
    r.cap_pension = if cap_pension == i64::MAX {
        0
    } else {
        cap_pension
    };
    r.cap_afc = if cap_afc == i64::MAX { 0 } else { cap_afc };
    r.pension_base = r.total_taxable.min(cap_pension).max(0);
    r.afc_base = r.total_taxable.min(cap_afc).max(0);
    if r.total_taxable > cap_pension {
        note(
            &mut r.notes,
            &mut r.complete,
            Severity::Info,
            format!(
                "Lo imponible supera el tope de {}: las cotizaciones se calculan sobre {}.",
                uf_label(p.cap_pension_uf_e4),
                money(r.cap_pension)
            ),
        );
    }
    if days == 30 && p.imm > 0 && r.total_taxable < p.imm && w.weekly_hours.is_none_or(|h| h >= 30)
    {
        note(
            &mut r.notes,
            &mut r.complete,
            Severity::Aviso,
            format!(
                "Lo imponible ({}) es menor que el ingreso mínimo ({}).",
                money(r.total_taxable),
                money(p.imm)
            ),
        );
    }

    // 6. AFP (10 % + comisión, una sola multiplicación con la tasa total).
    let mut afp = 0;
    if let Some(rate) = w.afp_ppm {
        afp = mul_ppm(r.pension_base, rate);
        r.legal_deductions.push(line(
            "afp",
            match &w.afp_name {
                Some(n) => format!("AFP {n}"),
                None => "AFP".into(),
            },
            afp,
            Some(3141),
            Some(format!("{} × {}", money(r.pension_base), pct(rate))),
        ));
    }

    // 7. Salud.
    let mut health_deduction = 0;
    match &w.health {
        Health::Ninguna => {}
        h => {
            if p.health_ppm <= 0 {
                note(
                    &mut r.notes,
                    &mut r.complete,
                    Severity::Falta,
                    "Falta la tasa de cotización legal de salud en los indicadores del mes.".into(),
                );
            }
            let legal = mul_ppm(r.pension_base, p.health_ppm);
            let name = w.health_name.clone();
            r.legal_deductions.push(line(
                "salud",
                match (h, &name) {
                    (Health::Fonasa, _) => "Salud (Fonasa)".to_string(),
                    (_, Some(n)) => format!("Salud {n} (cotización legal)"),
                    _ => "Salud Isapre (cotización legal)".to_string(),
                },
                legal,
                Some(3143),
                Some(format!("{} × {}", money(r.pension_base), pct(p.health_ppm))),
            ));
            let mut additional = 0;
            if let Health::Isapre {
                plan_uf_e4,
                plan_clp,
            } = h
            {
                let plan = match (plan_uf_e4, plan_clp) {
                    (Some(uf), _) if p.uf_e2 > 0 => Some((
                        uf_to_clp(*uf, p.uf_e2),
                        format!("Plan {} × UF {}", uf_label(*uf), uf_value(p.uf_e2)),
                    )),
                    (_, Some(c)) => Some((*c, "Plan pactado en pesos".to_string())),
                    _ => None,
                };
                match plan {
                    None => note(
                        &mut r.notes,
                        &mut r.complete,
                        Severity::Falta,
                        "Falta el valor del plan de Isapre (en UF o en pesos).".into(),
                    ),
                    Some((plan, txt)) => {
                        additional = (plan - legal).max(0);
                        if additional > 0 {
                            r.legal_deductions.push(line(
                                "salud_adicional",
                                "Salud: adicional del plan Isapre",
                                additional,
                                Some(3144),
                                Some(format!("{txt} = {} − {}", money(plan), money(legal))),
                            ));
                        } else {
                            note(
                                &mut r.notes,
                                &mut r.complete,
                                Severity::Info,
                                format!(
                                    "La cotización legal de {} ({}) cubre el plan de Isapre ({}): la diferencia queda como excedente en la Isapre.",
                                    pct(p.health_ppm),
                                    money(legal),
                                    money(plan)
                                ),
                            );
                        }
                    }
                }
            }
            health_deduction = match p.health_deduction {
                HealthDeduction::LegalOnly => legal,
                HealthDeduction::UpToCap => {
                    let cap = if cap_pension == i64::MAX {
                        i64::MAX
                    } else {
                        mul_ppm(cap_pension, p.health_ppm)
                    };
                    (legal + additional).min(cap)
                }
            };
        }
    }

    // 8. Seguro de cesantía.
    let mut afc_worker = 0;
    if w.afc {
        match w.contract {
            ContractKind::SinContrato => note(&mut r.notes, &mut r.complete,
                Severity::Aviso,
                "El seguro de cesantía exige contrato de trabajo: con sueldo empresarial normalmente no se cotiza. Confírmalo con tu contador.".into(),
            ),
            ContractKind::Indefinido => {
                afc_worker = mul_ppm(r.afc_base, p.afc.worker_indefinite_ppm);
                if afc_worker > 0 {
                    r.legal_deductions.push(line(
                        "afc",
                        "Seguro de cesantía",
                        afc_worker,
                        Some(3151),
                        Some(format!(
                            "{} × {}",
                            money(r.afc_base),
                            pct(p.afc.worker_indefinite_ppm)
                        )),
                    ));
                }
            }
            ContractKind::PlazoFijo => {}
        }
    }

    // 8 bis. APV individual descontado por planilla.
    let mut apv_tax_rebate = 0;
    if let Some(apv) = &w.apv {
        let amount = match (apv.amount_clp, apv.amount_uf_e4) {
            (Some(c), _) if c > 0 => Some(c),
            (_, Some(uf)) if uf > 0 && p.uf_e2 > 0 => Some(uf_to_clp(uf, p.uf_e2)),
            _ => None,
        };
        match amount {
            None => note(
                &mut r.notes,
                &mut r.complete,
                Severity::Falta,
                "Falta el monto del APV (en pesos o en UF, con la UF del mes).".into(),
            ),
            Some(amount) => {
                let (lre, label) = match apv.regime {
                    ApvRegime::A => (3155, "APV régimen A"),
                    ApvRegime::B => (3156, "APV régimen B"),
                };
                let mut detail = apv.institution.clone().unwrap_or_default();
                if apv.regime == ApvRegime::B {
                    if p.apv_b_cap_uf_e4 > 0 && p.uf_e2 > 0 {
                        let cap = uf_to_clp(p.apv_b_cap_uf_e4, p.uf_e2);
                        apv_tax_rebate = amount.min(cap);
                        if amount > cap {
                            detail = format!(
                                "{detail}{}rebaja el impuesto hasta {} ({})",
                                if detail.is_empty() { "" } else { " · " },
                                uf_label(p.apv_b_cap_uf_e4),
                                money(cap)
                            );
                        }
                    } else {
                        note(
                            &mut r.notes,
                            &mut r.complete,
                            Severity::Falta,
                            "Para el APV régimen B falta su tope mensual en UF (indicadores del mes).".into(),
                        );
                    }
                }
                r.legal_deductions.push(line(
                    "apv",
                    label,
                    amount,
                    Some(lre),
                    (!detail.is_empty()).then_some(detail),
                ));
            }
        }
    }

    // 9. Impuesto único de segunda categoría.
    r.tax_base = (r.total_taxable - afp - health_deduction - afc_worker - apv_tax_rebate).max(0);
    if p.utm <= 0 || p.tax_brackets.is_empty() {
        note(
            &mut r.notes,
            &mut r.complete,
            Severity::Falta,
            "Faltan la UTM del mes y la tabla del impuesto único (indicadores del mes).".into(),
        );
    } else {
        let base_e4 = r.tax_base as i128 * 10_000;
        let idx = p
            .tax_brackets
            .iter()
            .position(|b| {
                b.up_to_utm_e4
                    .is_none_or(|u| base_e4 <= u as i128 * p.utm as i128)
            })
            .unwrap_or(p.tax_brackets.len() - 1);
        let b = &p.tax_brackets[idx];
        r.tax_bracket = idx + 1;
        let tax_e6 = r.tax_base as i128 * b.factor_ppm as i128
            - b.rebate_utm_e4 as i128 * p.utm as i128 * 100;
        r.tax = div_round(tax_e6.max(0), PPM) as i64;
        let detail = if b.factor_ppm == 0 {
            format!(
                "Base {}: tramo exento (hasta {})",
                money(r.tax_base),
                b.up_to_utm_e4.map(utm_txt).unwrap_or_default()
            )
        } else {
            format!(
                "{} × {} − {} × {}",
                money(r.tax_base),
                pct(b.factor_ppm),
                utm_txt(b.rebate_utm_e4),
                money(p.utm)
            )
        };
        r.legal_deductions.push(line(
            "impuesto",
            "Impuesto único",
            r.tax,
            Some(3161),
            Some(detail),
        ));
    }

    // 9 bis. Asignación familiar (la paga el empleador y la descuenta de lo que entera en Previred).
    let loads = w.family_loads.max(0) + 2 * w.invalid_loads.max(0);
    if loads > 0 {
        match p
            .family_allowance
            .as_ref()
            .filter(|a| !a.brackets.is_empty())
        {
            None => note(
                &mut r.notes,
                &mut r.complete,
                Severity::Falta,
                "Para la asignación familiar faltan sus tramos en los indicadores del mes.".into(),
            ),
            Some(rule) => {
                let income = match w.allowance_income {
                    Some(v) => v,
                    None => {
                        note(
                            &mut r.notes,
                            &mut r.complete,
                            Severity::Aviso,
                            "El tramo de asignación familiar se calculó con lo imponible del mes: la ley usa el promedio del semestre enero-junio anterior. Ingrésalo en la ficha.".into(),
                        );
                        r.total_taxable
                    }
                };
                let idx = rule
                    .brackets
                    .iter()
                    .position(|b| b.up_to_income.is_none_or(|u| income <= u))
                    .unwrap_or(rule.brackets.len() - 1);
                let letter = char::from(b'A' + idx.min(25) as u8).to_string();
                let per_load = rule.brackets[idx].amount;
                r.allowance_bracket = Some(letter.clone());
                if per_load > 0 {
                    let full = per_load * loads;
                    let amount = if rule.full_days > 0 && days < rule.full_days {
                        div_round(full as i128 * days as i128, 30) as i64
                    } else {
                        full
                    };
                    let mut detail = format!(
                        "Tramo {letter}: {} × {loads} carga(s){}",
                        money(per_load),
                        if w.invalid_loads > 0 {
                            " (invalidez cuenta doble)"
                        } else {
                            ""
                        }
                    );
                    if amount != full {
                        detail.push_str(&format!(" × {days}/30 días"));
                    }
                    r.other_earnings.push(line(
                        "asignacion_familiar",
                        "Asignación familiar",
                        amount,
                        Some(2311),
                        Some(detail),
                    ));
                } else {
                    note(
                        &mut r.notes,
                        &mut r.complete,
                        Severity::Info,
                        format!(
                            "Con un ingreso de {} corresponde el tramo {letter}, que no recibe asignación familiar.",
                            money(income)
                        ),
                    );
                }
            }
        }
    }

    // 10. Haberes no imponibles.
    for it in input.items.iter().filter(|i| !i.taxable && i.amount != 0) {
        r.other_earnings
            .push(line("haber", it.label.clone(), it.amount, it.lre, None));
    }

    // 11. Descuentos voluntarios.
    for d in input.deductions.iter().filter(|d| d.amount != 0) {
        r.other_deductions
            .push(line("descuento", d.label.clone(), d.amount, d.lre, None));
    }

    r.total_earnings = r.total_taxable + r.other_earnings.iter().map(|l| l.amount).sum::<i64>();
    r.total_deductions = r.legal_deductions.iter().map(|l| l.amount).sum::<i64>()
        + r.other_deductions.iter().map(|l| l.amount).sum::<i64>();
    r.net = r.total_earnings - r.total_deductions;
    r.advance = input.advance.max(0);
    r.to_pay = r.net - r.advance;
    if r.to_pay < 0 {
        note(&mut r.notes, &mut r.complete,
            Severity::Aviso,
            "Los descuentos y el anticipo superan lo que corresponde pagar: revisa los descuentos voluntarios.".into(),
        );
    }

    // 12. Aportes del empleador.
    if w.employer_contrib {
        for e in p.employer.iter().filter(|e| e.rate_ppm > 0) {
            let base = match e.base {
                EmployerBase::Pension => r.pension_base,
                EmployerBase::Afc => r.afc_base,
            };
            r.employer.push(line(
                &e.code,
                e.label.clone(),
                mul_ppm(base, e.rate_ppm),
                e.lre,
                Some(format!("{} × {}", money(base), pct(e.rate_ppm))),
            ));
        }
    }
    if w.afc {
        let rate = match w.contract {
            ContractKind::Indefinido => p.afc.employer_indefinite_ppm,
            ContractKind::PlazoFijo => p.afc.employer_fixed_ppm,
            ContractKind::SinContrato => 0,
        };
        if rate > 0 {
            r.employer.push(line(
                "afc_empleador",
                "Seguro de cesantía (empleador)",
                mul_ppm(r.afc_base, rate),
                Some(4151),
                Some(format!("{} × {}", money(r.afc_base), pct(rate))),
            ));
        }
    }
    if w.accident && p.accident_ppm > 0 {
        r.employer.push(line(
            "ley16744",
            "Accidentes del trabajo (Ley 16.744)",
            mul_ppm(r.pension_base, p.accident_ppm),
            Some(4152),
            Some(format!(
                "{} × {}",
                money(r.pension_base),
                pct(p.accident_ppm)
            )),
        ));
    }
    r.employer_total = r.employer.iter().map(|l| l.amount).sum();
    r.employer_cost = r.total_earnings + r.employer_total;
    r
}

fn hours_txt(e2: i64) -> String {
    if e2 % 100 == 0 {
        (e2 / 100).to_string()
    } else {
        format!("{},{:02}", e2 / 100, e2 % 100)
            .trim_end_matches('0')
            .to_string()
    }
}

fn uf_label(e4: i64) -> String {
    format!("{} UF", dec4(e4))
}

fn uf_value(e2: i64) -> String {
    format!(
        "{},{:02}",
        money(e2 / 100).trim_start_matches('$'),
        e2 % 100
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn textos() {
        assert_eq!(pct(114_400), "11,44 %");
        assert_eq!(pct(70_000), "7 %");
        assert_eq!(pct(300), "0,03 %");
        assert_eq!(uf_label(900_000), "90 UF");
        assert_eq!(uf_label(1_352_000), "135,2 UF");
        assert_eq!(utm_txt(5_400), "0,54 UTM");
        assert_eq!(uf_value(4_105_720), "41.057,20");
        assert_eq!(hours_txt(150), "1,5");
    }
}
