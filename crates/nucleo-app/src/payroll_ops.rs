//! Casos de uso de remuneraciones (Fase 10, hito B): el sueldo empresarial del dueño y las
//! liquidaciones de los trabajadores.
//!
//! NÚCLEO prepara la liquidación, explica cada monto y la deja lista para imprimir; no envía nada a
//! Previred, la Dirección del Trabajo ni el SII. Los valores normativos del mes ("indicadores": UF,
//! UTM, topes, tasas de AFP, SIS, tabla del impuesto único) los ingresa la persona desde Previred y
//! el SII y se guardan por mes con su fuente. Al emitir, la liquidación se congela (foto completa) y
//! su impuesto único pasa al código 48 del F29 del mes en que se paga.

use crate::company::CompanySession;
use crate::f29_ops::{check_period, days_in, range};
use crate::sales_ops::{log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::now_utc;
use nucleo_db::payroll::{self as db, WorkerRow, WorkerWrite};
use nucleo_domain::Rut;
use nucleo_domain::f29::{Note, Severity};
use nucleo_domain::payroll::{
    Apv, ContractKind, DeductionItem, EarningItem, GratificationMode, Health, PayrollParams,
    PayslipInput, PayslipResult, WorkerTerms, compute,
};
use nucleo_domain::severance::{self, Cause, SeveranceInput, SeveranceResult, SeveranceRules};
use nucleo_io::lre;
use serde::{Deserialize, Serialize};

/* ───────────────────────────── tipos ───────────────────────────── */

/// Tasa total de una AFP (10 % + comisión) para trabajadores dependientes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AfpRate {
    pub name: String,
    pub rate_ppm: i64,
}

/// Indicadores del mes: los parámetros del cálculo y la tabla de AFP.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Indicators {
    #[serde(default)]
    pub params: PayrollParams,
    #[serde(default)]
    pub afp: Vec<AfpRate>,
    /// Día del mes siguiente en que vence el pago en Previred.
    #[serde(default)]
    pub previred_due_day: Option<u32>,
    /// Reglas del finiquito (la UF se toma de los indicadores del mes anterior al pago).
    #[serde(default)]
    pub severance: SeveranceRules,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IndicatorsView {
    pub period: String,
    pub indicators: Indicators,
    pub source: Option<String>,
    /// `true` si este mes ya tiene indicadores guardados.
    pub saved: bool,
    /// Si no están guardados, el mes del que se proponen (los últimos guardados).
    pub from_period: Option<String>,
    pub updated_at: Option<String>,
}

/// Condiciones de la persona: contrato, sueldo, previsión y haberes o descuentos fijos.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Terms {
    /// "indefinido", "plazo_fijo" o "sin_contrato" (sueldo empresarial).
    pub contract: String,
    pub base_salary: i64,
    #[serde(default)]
    pub weekly_hours: Option<i64>,
    /// "ninguna", "art50" o "fija".
    #[serde(default = "ninguna")]
    pub gratification: String,
    #[serde(default)]
    pub gratification_amount: i64,
    #[serde(default)]
    pub overtime_surcharge_ppm: Option<i64>,
    /// Nombre de la AFP (debe estar en los indicadores del mes); `None` = no cotiza en AFP.
    #[serde(default)]
    pub afp: Option<String>,
    /// "fonasa", "isapre" o "ninguna".
    #[serde(default = "fonasa")]
    pub health: String,
    #[serde(default)]
    pub health_name: Option<String>,
    #[serde(default)]
    pub isapre_plan_uf_e4: Option<i64>,
    #[serde(default)]
    pub isapre_plan_clp: Option<i64>,
    #[serde(default)]
    pub afc: bool,
    #[serde(default = "yes")]
    pub employer_contrib: bool,
    #[serde(default = "yes")]
    pub accident: bool,
    /// Haberes de todos los meses (colación, movilización, bonos fijos).
    #[serde(default)]
    pub items: Vec<EarningItem>,
    /// Descuentos de todos los meses (cuota sindical, préstamo en cuotas).
    #[serde(default)]
    pub deductions: Vec<DeductionItem>,
    /// Cargas familiares simples y maternales acreditadas.
    #[serde(default)]
    pub family_loads: i64,
    #[serde(default)]
    pub invalid_loads: i64,
    /// Ingreso promedio del semestre enero-junio anterior (tramo de asignación familiar).
    #[serde(default)]
    pub allowance_income: Option<i64>,
    #[serde(default)]
    pub apv: Option<Apv>,
    /// Datos para el Libro de Remuneraciones Electrónico.
    #[serde(default)]
    pub region: Option<u32>,
    #[serde(default)]
    pub comuna: Option<u32>,
    #[serde(default)]
    pub jornada: Option<u32>,
    #[serde(default)]
    pub disability: u32,
    #[serde(default)]
    pub pensioner: bool,
    #[serde(default)]
    pub young_subsidy: bool,
    /// Código de salud del LRE cuando la Isapre no está en la tabla de NÚCLEO.
    #[serde(default)]
    pub health_lre_code: Option<u32>,
    /// Causal de término, si la relación terminó (snake_case de `severance::Cause`).
    #[serde(default)]
    pub end_cause: Option<Cause>,
}

fn ninguna() -> String {
    "ninguna".into()
}
fn fonasa() -> String {
    "fonasa".into()
}
fn yes() -> bool {
    true
}

impl Default for Terms {
    fn default() -> Self {
        Terms {
            contract: "indefinido".into(),
            base_salary: 0,
            weekly_hours: None,
            gratification: ninguna(),
            gratification_amount: 0,
            overtime_surcharge_ppm: None,
            afp: None,
            health: fonasa(),
            health_name: None,
            isapre_plan_uf_e4: None,
            isapre_plan_clp: None,
            afc: false,
            employer_contrib: true,
            accident: true,
            items: Vec::new(),
            deductions: Vec::new(),
            family_loads: 0,
            invalid_loads: 0,
            allowance_income: None,
            apv: None,
            region: None,
            comuna: None,
            jornada: None,
            disability: 0,
            pensioner: false,
            young_subsidy: false,
            health_lre_code: None,
            end_cause: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Worker {
    pub id: i64,
    pub rut: String,
    pub name: String,
    pub is_owner: bool,
    pub position: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub active: bool,
    pub terms: Terms,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkerInput {
    pub rut: String,
    pub name: String,
    #[serde(default)]
    pub is_owner: bool,
    pub position: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(default = "yes")]
    pub active: bool,
    pub terms: Terms,
}

/// Lo que cambia cada mes en una liquidación.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PayslipMonth {
    /// Días trabajados (mes comercial de 30); `None` = los que corresponden por fechas de ingreso y término.
    #[serde(default)]
    pub days: Option<i64>,
    #[serde(default)]
    pub overtime_hours_e2: i64,
    #[serde(default)]
    pub items: Vec<EarningItem>,
    #[serde(default)]
    pub deductions: Vec<DeductionItem>,
    #[serde(default)]
    pub advance: i64,
}

/// Foto que se guarda al emitir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Snapshot {
    worker: Worker,
    month: PayslipMonth,
    input: PayslipInput,
    result: PayslipResult,
    indicators_source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayslipView {
    pub id: Option<i64>,
    pub period: String,
    /// "nueva" (sin guardar), "borrador", "emitida" o "anulada".
    pub status: String,
    pub worker: Worker,
    pub month: PayslipMonth,
    /// Días que corresponden por las fechas de ingreso y término.
    pub days_suggested: i64,
    pub input: PayslipInput,
    pub result: PayslipResult,
    pub indicators_saved: bool,
    pub indicators_source: Option<String>,
    pub pay_date: Option<String>,
    pub default_pay_date: String,
    pub emitted_at: Option<String>,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollRow {
    pub worker: Worker,
    pub payslip_id: Option<i64>,
    /// "nueva", "borrador" o "emitida".
    pub status: String,
    pub pay_date: Option<String>,
    pub total_earnings: i64,
    pub tax: i64,
    pub to_pay: i64,
    pub employer_cost: i64,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollView {
    pub period: String,
    pub indicators_saved: bool,
    pub indicators_from: Option<String>,
    pub rows: Vec<PayrollRow>,
    pub voided: usize,
    pub total_to_pay: i64,
    pub total_tax: i64,
    pub total_employer_cost: i64,
}

/* ───────────────────────────── utilidades ───────────────────────────── */

const CONTRACTS: [&str; 3] = ["indefinido", "plazo_fijo", "sin_contrato"];
const GRATIFICATIONS: [&str; 3] = ["ninguna", "art50", "fija"];
const HEALTHS: [&str; 3] = ["fonasa", "isapre", "ninguna"];

fn worker_from_row(r: WorkerRow) -> Worker {
    Worker {
        terms: serde_json::from_str(&r.terms_json).unwrap_or_default(),
        id: r.id,
        rut: r.rut,
        name: r.name,
        is_owner: r.is_owner,
        position: r.position,
        start_date: r.start_date,
        end_date: r.end_date,
        active: r.active,
    }
}

fn valid_rate(v: i64) -> bool {
    (0..=1_000_000).contains(&v)
}

fn check_items(items: &[EarningItem], deductions: &[DeductionItem]) -> AppResult<()> {
    for i in items {
        if i.label.trim().is_empty() || i.label.chars().count() > 80 {
            return Err(AppError::Validation(
                "cada haber necesita un nombre (hasta 80 caracteres)".into(),
            ));
        }
        if i.amount < 0 {
            return Err(AppError::Validation(format!(
                "el haber «{}» no puede ser negativo",
                i.label.trim()
            )));
        }
    }
    for d in deductions {
        if d.label.trim().is_empty() || d.label.chars().count() > 80 {
            return Err(AppError::Validation(
                "cada descuento necesita un nombre (hasta 80 caracteres)".into(),
            ));
        }
        if d.amount < 0 {
            return Err(AppError::Validation(format!(
                "el descuento «{}» no puede ser negativo",
                d.label.trim()
            )));
        }
    }
    Ok(())
}

fn check_terms(t: &Terms, is_owner: bool) -> AppResult<Terms> {
    let mut t = t.clone();
    if !CONTRACTS.contains(&t.contract.as_str()) {
        return Err(AppError::Validation("tipo de contrato no válido".into()));
    }
    if !GRATIFICATIONS.contains(&t.gratification.as_str()) {
        return Err(AppError::Validation(
            "tipo de gratificación no válido".into(),
        ));
    }
    if !HEALTHS.contains(&t.health.as_str()) {
        return Err(AppError::Validation("sistema de salud no válido".into()));
    }
    if t.base_salary <= 0 {
        return Err(AppError::Validation(
            if is_owner {
                "ingresa el monto del sueldo empresarial"
            } else {
                "ingresa el sueldo base"
            }
            .into(),
        ));
    }
    if t.weekly_hours.is_some_and(|h| !(1..=60).contains(&h)) {
        return Err(AppError::Validation(
            "la jornada semanal debe estar entre 1 y 60 horas".into(),
        ));
    }
    if t.overtime_surcharge_ppm.is_some_and(|v| !valid_rate(v)) {
        return Err(AppError::Validation(
            "el recargo de las horas extra debe estar entre 0 % y 100 %".into(),
        ));
    }
    if t.gratification == "fija" && t.gratification_amount <= 0 {
        return Err(AppError::Validation(
            "ingresa el monto de la gratificación pactada".into(),
        ));
    }
    if t.health == "isapre"
        && t.isapre_plan_uf_e4.is_none_or(|v| v <= 0)
        && t.isapre_plan_clp.is_none_or(|v| v <= 0)
    {
        return Err(AppError::Validation(
            "ingresa el valor del plan de Isapre (en UF o en pesos)".into(),
        ));
    }
    if t.family_loads < 0 || t.invalid_loads < 0 || t.family_loads + t.invalid_loads > 30 {
        return Err(AppError::Validation(
            "revisa el número de cargas familiares".into(),
        ));
    }
    if t.allowance_income.is_some_and(|v| v < 0) {
        return Err(AppError::Validation(
            "el ingreso para la asignación familiar no puede ser negativo".into(),
        ));
    }
    if let Some(a) = &t.apv
        && a.amount_clp.is_none_or(|v| v <= 0)
        && a.amount_uf_e4.is_none_or(|v| v <= 0)
    {
        return Err(AppError::Validation(
            "ingresa el monto del APV (en pesos o en UF)".into(),
        ));
    }
    if t.region.is_some_and(|r| !(1..=16).contains(&r)) || t.disability > 3 {
        return Err(AppError::Validation(
            "revisa la región (1 a 16) y el código de discapacidad (0 a 3)".into(),
        ));
    }
    t.afp = opt_text(&t.afp, 40, "el nombre de la AFP")?;
    t.health_name = opt_text(&t.health_name, 40, "el nombre de la Isapre")?;
    check_items(&t.items, &t.deductions)?;
    Ok(t)
}

fn check_indicators(i: &Indicators) -> AppResult<()> {
    let p = &i.params;
    let non_neg = [p.uf_e2, p.utm, p.imm, p.cap_pension_uf_e4, p.cap_afc_uf_e4];
    if non_neg.iter().any(|v| *v < 0) {
        return Err(AppError::Validation(
            "los indicadores no pueden ser negativos".into(),
        ));
    }
    let rates = [
        p.health_ppm,
        p.afc.worker_indefinite_ppm,
        p.afc.employer_indefinite_ppm,
        p.afc.employer_fixed_ppm,
        p.accident_ppm,
        p.overtime_surcharge_ppm,
    ];
    if rates.iter().any(|v| !valid_rate(*v))
        || p.employer.iter().any(|e| !valid_rate(e.rate_ppm))
        || i.afp.iter().any(|a| !valid_rate(a.rate_ppm))
    {
        return Err(AppError::Validation(
            "las tasas deben estar entre 0 % y 100 %".into(),
        ));
    }
    if i.afp.iter().any(|a| a.name.trim().is_empty())
        || p.employer.iter().any(|e| e.label.trim().is_empty())
    {
        return Err(AppError::Validation(
            "cada AFP y cada aporte del empleador necesita un nombre".into(),
        ));
    }
    let mut prev = 0;
    for (n, b) in p.tax_brackets.iter().enumerate() {
        let last = n + 1 == p.tax_brackets.len();
        match b.up_to_utm_e4 {
            Some(u) if u > prev => prev = u,
            None if last => {}
            _ => {
                return Err(AppError::Validation(
                    "los tramos del impuesto único deben ir de menor a mayor (solo el último sin límite)".into(),
                ));
            }
        }
        if !valid_rate(b.factor_ppm) || b.rebate_utm_e4 < 0 {
            return Err(AppError::Validation(format!(
                "revisa el factor y la cantidad a rebajar del tramo {}",
                n + 1
            )));
        }
    }
    Ok(())
}

/// Días del mes comercial (30) que corresponden según las fechas de ingreso y término.
fn suggested_days(w: &Worker, period: &str) -> i64 {
    let (from, to) = range(period);
    let start = w.start_date.as_str().max(from.as_str());
    let end = w.end_date.as_deref().unwrap_or(&to).min(to.as_str());
    if start > end {
        return 0;
    }
    if start == from && end == to {
        return 30;
    }
    let d = |s: &str| s[8..10].parse::<i64>().unwrap_or(1);
    (d(end) - d(start) + 1).clamp(0, 30)
}

fn in_period(w: &Worker, period: &str) -> bool {
    let (from, to) = range(period);
    w.start_date.as_str() <= to.as_str() && w.end_date.as_deref().is_none_or(|e| e >= from.as_str())
}

fn with_code(i: &EarningItem, taxable_default: u32) -> EarningItem {
    let mut i = i.clone();
    if i.lre.is_none() && i.taxable {
        i.lre = Some(taxable_default);
    }
    i
}

fn build_input(w: &Worker, ind: &Indicators, month: &PayslipMonth, days: i64) -> PayslipInput {
    let t = &w.terms;
    let afp_ppm = t.afp.as_ref().and_then(|name| {
        ind.afp
            .iter()
            .find(|a| a.name.trim().eq_ignore_ascii_case(name.trim()))
            .map(|a| a.rate_ppm)
    });
    PayslipInput {
        params: ind.params.clone(),
        worker: WorkerTerms {
            contract: match t.contract.as_str() {
                "plazo_fijo" => ContractKind::PlazoFijo,
                "sin_contrato" => ContractKind::SinContrato,
                _ => ContractKind::Indefinido,
            },
            owner_salary: w.is_owner,
            afp_ppm,
            afp_name: t.afp.clone(),
            health: match t.health.as_str() {
                "isapre" => Health::Isapre {
                    plan_uf_e4: t.isapre_plan_uf_e4.filter(|v| *v > 0),
                    plan_clp: t.isapre_plan_clp.filter(|v| *v > 0),
                },
                "ninguna" => Health::Ninguna,
                _ => Health::Fonasa,
            },
            health_name: t.health_name.clone(),
            afc: t.afc,
            employer_contrib: t.employer_contrib,
            accident: t.accident,
            weekly_hours: t.weekly_hours,
            family_loads: t.family_loads,
            invalid_loads: t.invalid_loads,
            allowance_income: t.allowance_income,
            apv: t.apv.clone(),
        },
        base_salary: t.base_salary,
        days,
        overtime_hours_e2: month.overtime_hours_e2,
        overtime_surcharge_ppm: t.overtime_surcharge_ppm,
        gratification: match t.gratification.as_str() {
            "art50" => GratificationMode::Art50,
            "fija" => GratificationMode::Fija,
            _ => GratificationMode::Ninguna,
        },
        gratification_amount: t.gratification_amount,
        // Haberes imponibles sin código: los de la ficha son fijos (2111), los del mes variables (2113).
        items: t
            .items
            .iter()
            .map(|i| with_code(i, 2111))
            .chain(month.items.iter().map(|i| with_code(i, 2113)))
            .collect(),
        deductions: t
            .deductions
            .iter()
            .chain(&month.deductions)
            .cloned()
            .collect(),
        advance: month.advance,
    }
}

fn compute_for(w: &Worker, ind: &Indicators, input: &PayslipInput) -> PayslipResult {
    let mut r = compute(input);
    if let Some(name) = &w.terms.afp
        && input.worker.afp_ppm.is_none()
    {
        r.complete = false;
        r.notes.insert(
            0,
            Note {
                code: None,
                severity: Severity::Falta,
                text: format!(
                    "Falta la tasa de la AFP {name} en los indicadores del mes{}.",
                    if ind.afp.is_empty() {
                        ""
                    } else {
                        " (revisa que el nombre coincida)"
                    }
                ),
            },
        );
    }
    r
}

/* ───────────────────────────── casos de uso ───────────────────────────── */

impl CompanySession {
    pub fn workers(&self) -> AppResult<Vec<Worker>> {
        self.require("remuneraciones.ver")?;
        Ok(db::workers(self.db.conn())?
            .into_iter()
            .map(worker_from_row)
            .collect())
    }

    pub fn save_worker(&mut self, id: Option<i64>, input: &WorkerInput) -> AppResult<Worker> {
        self.require("remuneraciones.editar")?;
        let name = crate::registry::validate_name(&input.name)?;
        let rut = Rut::parse(input.rut.trim())
            .map_err(|e| AppError::Validation(format!("RUT: {e}")))?
            .compact();
        let start = parse_date("La fecha de ingreso", &input.start_date)?;
        let end = match opt_text(&input.end_date, 10, "la fecha de término")? {
            Some(d) => Some(parse_date("La fecha de término", &d)?),
            None => None,
        };
        if end.as_ref().is_some_and(|e| *e < start) {
            return Err(AppError::Validation(
                "la fecha de término no puede ser anterior a la de ingreso".into(),
            ));
        }
        let position = opt_text(&input.position, 80, "el cargo")?;
        let terms = check_terms(&input.terms, input.is_owner)?;
        let conn = self.db.conn();
        if let Some(other) = db::worker_by_rut(conn, &rut)?
            && Some(other.id) != id
        {
            return Err(AppError::Validation(format!(
                "ya existe una persona con el RUT {rut} ({})",
                other.name
            )));
        }
        if let Some(id) = id
            && db::worker(conn, id)?.is_none()
        {
            return Err(AppError::NotFound("esa persona".into()));
        }
        let terms_json = serde_json::to_string(&terms).unwrap_or_else(|_| "{}".into());
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        let w = WorkerWrite {
            rut: &rut,
            name: &name,
            is_owner: input.is_owner,
            position: position.as_deref(),
            start_date: &start,
            end_date: end.as_deref(),
            terms_json: &terms_json,
            active: input.active,
        };
        let id = match id {
            Some(id) => {
                db::update_worker(&tx, id, &w, &now)?;
                log(
                    &tx,
                    &user,
                    "remuneraciones.persona.editar",
                    "trabajador",
                    &id.to_string(),
                    &format!("Actualizó los datos de {name}"),
                    None,
                )?;
                id
            }
            None => {
                let id = db::insert_worker(&tx, &w, &now)?;
                log(
                    &tx,
                    &user,
                    "remuneraciones.persona.crear",
                    "trabajador",
                    &id.to_string(),
                    &format!(
                        "Agregó a {name}{}",
                        if input.is_owner {
                            " (sueldo empresarial)"
                        } else {
                            ""
                        }
                    ),
                    None,
                )?;
                id
            }
        };
        tx.commit()?;
        Ok(worker_from_row(
            db::worker(self.db.conn(), id)?
                .ok_or_else(|| AppError::NotFound("esa persona".into()))?,
        ))
    }

    /* ───────── indicadores ───────── */

    pub fn payroll_indicators(&self, period: &str) -> AppResult<IndicatorsView> {
        self.require("remuneraciones.ver")?;
        let period = check_period(period)?;
        self.load_indicators(&period)
    }

    fn load_indicators(&self, period: &str) -> AppResult<IndicatorsView> {
        let conn = self.db.conn();
        let (row, saved) = match db::indicators(conn, period)? {
            Some(r) => (Some(r), true),
            None => (db::indicators_before(conn, period)?, false),
        };
        Ok(IndicatorsView {
            period: period.to_string(),
            indicators: row
                .as_ref()
                .and_then(|r| serde_json::from_str(&r.indicators_json).ok())
                .unwrap_or_default(),
            source: row.as_ref().and_then(|r| r.source.clone()),
            saved,
            from_period: if saved {
                None
            } else {
                row.as_ref().map(|r| r.period.clone())
            },
            updated_at: row.filter(|_| saved).map(|r| r.updated_at),
        })
    }

    pub fn save_payroll_indicators(
        &mut self,
        period: &str,
        indicators: &Indicators,
        source: Option<String>,
    ) -> AppResult<IndicatorsView> {
        self.require("remuneraciones.editar")?;
        let period = check_period(period)?;
        check_indicators(indicators)?;
        let source = opt_text(&source, 200, "la fuente")?;
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        db::save_indicators(
            &tx,
            &period,
            &serde_json::to_string(indicators).unwrap_or_else(|_| "{}".into()),
            source.as_deref(),
            &now,
        )?;
        log(
            &tx,
            &user,
            "remuneraciones.indicadores",
            "indicadores",
            &period,
            &format!("Guardó los indicadores de remuneraciones de {period}"),
            None,
        )?;
        tx.commit()?;
        self.load_indicators(&period)
    }

    /* ───────── liquidaciones ───────── */

    pub fn payroll(&self, period: &str) -> AppResult<PayrollView> {
        self.require("remuneraciones.ver")?;
        let period = check_period(period)?;
        let conn = self.db.conn();
        let ind = self.load_indicators(&period)?;
        let slips = db::payslips_of_period(conn, &period)?;
        let mut rows = Vec::new();
        for w in db::workers(conn)?.into_iter().map(worker_from_row) {
            let slip = slips
                .iter()
                .find(|s| s.worker_id == w.id && s.status != "anulada");
            if slip.is_none() && !(w.active && in_period(&w, &period)) {
                continue;
            }
            let view = self.payslip_view(&w, &period, slip, &ind)?;
            rows.push(PayrollRow {
                payslip_id: view.id,
                status: view.status.clone(),
                pay_date: view.pay_date.clone(),
                total_earnings: view.result.total_earnings,
                tax: view.result.tax,
                to_pay: view.result.to_pay,
                employer_cost: view.result.employer_cost,
                complete: view.result.complete,
                worker: view.worker,
            });
        }
        Ok(PayrollView {
            period: period.clone(),
            indicators_saved: ind.saved,
            indicators_from: ind.from_period,
            voided: slips.iter().filter(|s| s.status == "anulada").count(),
            total_to_pay: rows.iter().map(|r| r.to_pay).sum(),
            total_tax: rows.iter().map(|r| r.tax).sum(),
            total_employer_cost: rows.iter().map(|r| r.employer_cost).sum(),
            rows,
        })
    }

    fn payslip_view(
        &self,
        w: &Worker,
        period: &str,
        slip: Option<&db::PayslipRow>,
        ind: &IndicatorsView,
    ) -> AppResult<PayslipView> {
        let (y, m) = (
            period[..4].parse::<i32>().unwrap_or(2000),
            period[5..].parse::<u32>().unwrap_or(1),
        );
        let default_pay_date = format!("{period}-{:02}", days_in(y, m));
        if let Some(s) = slip.filter(|s| s.status != "borrador")
            && let Some(snap) = s
                .snapshot_json
                .as_deref()
                .and_then(|j| serde_json::from_str::<Snapshot>(j).ok())
        {
            return Ok(PayslipView {
                id: Some(s.id),
                period: period.to_string(),
                status: s.status.clone(),
                days_suggested: snap.input.days,
                worker: snap.worker,
                month: snap.month,
                input: snap.input,
                result: snap.result,
                indicators_saved: true,
                indicators_source: snap.indicators_source,
                pay_date: s.pay_date.clone(),
                default_pay_date,
                emitted_at: s.emitted_at.clone(),
                voided_at: s.voided_at.clone(),
                void_reason: s.void_reason.clone(),
            });
        }
        let month: PayslipMonth = slip
            .and_then(|s| serde_json::from_str(&s.inputs_json).ok())
            .unwrap_or_default();
        let days_suggested = suggested_days(w, period);
        let input = build_input(
            w,
            &ind.indicators,
            &month,
            month.days.unwrap_or(days_suggested),
        );
        let mut result = compute_for(w, &ind.indicators, &input);
        if !ind.saved {
            result.complete = false;
            result.notes.insert(
                0,
                Note {
                    code: None,
                    severity: Severity::Falta,
                    text: match &ind.from_period {
                        Some(p) => format!(
                            "Los indicadores de este mes no están confirmados: se están usando los de {p}. Revísalos y guárdalos antes de emitir."
                        ),
                        None => "Faltan los indicadores del mes (UF, UTM, topes, tasas de AFP y tabla del impuesto único).".into(),
                    },
                },
            );
        }
        Ok(PayslipView {
            id: slip.map(|s| s.id),
            period: period.to_string(),
            status: if slip.is_some() { "borrador" } else { "nueva" }.into(),
            worker: w.clone(),
            month,
            days_suggested,
            input,
            result,
            indicators_saved: ind.saved,
            indicators_source: ind.source.clone(),
            pay_date: None,
            default_pay_date,
            emitted_at: None,
            voided_at: None,
            void_reason: None,
        })
    }

    fn worker_or_404(&self, worker_id: i64) -> AppResult<Worker> {
        Ok(worker_from_row(
            db::worker(self.db.conn(), worker_id)?
                .ok_or_else(|| AppError::NotFound("esa persona".into()))?,
        ))
    }

    pub fn payslip(&self, worker_id: i64, period: &str) -> AppResult<PayslipView> {
        self.require("remuneraciones.ver")?;
        let period = check_period(period)?;
        let w = self.worker_or_404(worker_id)?;
        let slip = db::current_payslip(self.db.conn(), worker_id, &period)?;
        let ind = self.load_indicators(&period)?;
        self.payslip_view(&w, &period, slip.as_ref(), &ind)
    }

    /// Una liquidación por id (incluye las anuladas, para reimprimirlas).
    pub fn payslip_by_id(&self, id: i64) -> AppResult<PayslipView> {
        self.require("remuneraciones.ver")?;
        let s = db::payslip(self.db.conn(), id)?
            .ok_or_else(|| AppError::NotFound("esa liquidación".into()))?;
        let w = self.worker_or_404(s.worker_id)?;
        let ind = self.load_indicators(&s.period)?;
        self.payslip_view(&w, &s.period.clone(), Some(&s), &ind)
    }

    pub fn save_payslip(
        &mut self,
        worker_id: i64,
        period: &str,
        month: &PayslipMonth,
    ) -> AppResult<PayslipView> {
        self.require("remuneraciones.editar")?;
        let period = check_period(period)?;
        let w = self.worker_or_404(worker_id)?;
        if month.days.is_some_and(|d| !(0..=30).contains(&d)) {
            return Err(AppError::Validation(
                "los días trabajados deben estar entre 0 y 30".into(),
            ));
        }
        if month.overtime_hours_e2 < 0 || month.advance < 0 {
            return Err(AppError::Validation(
                "las horas extra y el anticipo no pueden ser negativos".into(),
            ));
        }
        check_items(&month.items, &month.deductions)?;
        if db::current_payslip(self.db.conn(), worker_id, &period)?
            .is_some_and(|s| s.status == "emitida")
        {
            return Err(AppError::Validation(
                "esta liquidación ya está emitida: anúlala para prepararla de nuevo".into(),
            ));
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let id = db::save_payslip_inputs(
            &tx,
            worker_id,
            &period,
            &serde_json::to_string(month).unwrap_or_else(|_| "{}".into()),
            &now,
        )?;
        log(
            &tx,
            &user,
            "remuneraciones.liquidacion.borrador",
            "liquidacion",
            &id.to_string(),
            &format!("Preparó la liquidación de {} de {period}", w.name),
            None,
        )?;
        tx.commit()?;
        self.payslip(worker_id, &period)
    }

    pub fn emit_payslip(
        &mut self,
        worker_id: i64,
        period: &str,
        pay_date: &str,
    ) -> AppResult<PayslipView> {
        self.require("remuneraciones.editar")?;
        let period = check_period(period)?;
        let pay_date = parse_date("La fecha de pago", pay_date)?;
        if pay_date[..7] < *period.as_str() {
            return Err(AppError::Validation(
                "la fecha de pago no puede ser anterior al mes de la liquidación".into(),
            ));
        }
        let view = self.payslip(worker_id, &period)?;
        if view.status == "emitida" {
            return Err(AppError::Validation(
                "esta liquidación ya está emitida".into(),
            ));
        }
        if !view.result.complete {
            let falta: Vec<_> = view
                .result
                .notes
                .iter()
                .filter(|n| n.severity == Severity::Falta)
                .map(|n| n.text.clone())
                .collect();
            return Err(AppError::Validation(format!(
                "para emitir la liquidación falta: {}",
                falta.join(" ")
            )));
        }
        // El impuesto único va al F29 del mes de pago: ese F29 debe estar abierto.
        self.require_open(&pay_date[..7])?;
        let snap = Snapshot {
            worker: view.worker.clone(),
            month: view.month.clone(),
            input: view.input.clone(),
            result: view.result.clone(),
            indicators_source: view.indicators_source.clone(),
        };
        let now = now_utc();
        let user = self.actor_name()?;
        let by = self.user_id();
        let tx = self.db.conn_mut().transaction()?;
        let id = match view.id {
            Some(id) => id,
            None => db::save_payslip_inputs(
                &tx,
                worker_id,
                &period,
                &serde_json::to_string(&view.month).unwrap_or_else(|_| "{}".into()),
                &now,
            )?,
        };
        db::emit_payslip(
            &tx,
            id,
            &serde_json::to_string(&snap).unwrap_or_else(|_| "{}".into()),
            &pay_date,
            view.result.tax,
            view.result.to_pay,
            view.result.employer_cost,
            by,
            &now,
        )?;
        log(
            &tx,
            &user,
            "remuneraciones.liquidacion.emitir",
            "liquidacion",
            &id.to_string(),
            &format!(
                "Emitió la liquidación de {} de {period} (pago {pay_date}, impuesto único {})",
                view.worker.name, view.result.tax
            ),
            None,
        )?;
        tx.commit()?;
        self.payslip(worker_id, &period)
    }

    pub fn void_payslip(&mut self, id: i64, reason: &str) -> AppResult<PayslipView> {
        self.require("remuneraciones.editar")?;
        let reason = reason.trim();
        if reason.chars().count() < 3 {
            return Err(AppError::Validation(
                "indica el motivo de la anulación".into(),
            ));
        }
        let s = db::payslip(self.db.conn(), id)?
            .ok_or_else(|| AppError::NotFound("esa liquidación".into()))?;
        if s.status != "emitida" {
            return Err(AppError::Validation(
                "solo se anulan liquidaciones emitidas".into(),
            ));
        }
        if let Some(d) = &s.pay_date {
            self.require_open(&d[..7])?;
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::void_payslip(&tx, id, reason, &now)?;
        log(
            &tx,
            &user,
            "remuneraciones.liquidacion.anular",
            "liquidacion",
            &id.to_string(),
            &format!("Anuló la liquidación de {}", s.period),
            Some(reason),
        )?;
        tx.commit()?;
        self.payslip_by_id(id)
    }

    /// Descarta un borrador (vuelve a los valores del contrato).
    pub fn discard_payslip(&mut self, worker_id: i64, period: &str) -> AppResult<PayslipView> {
        self.require("remuneraciones.editar")?;
        let period = check_period(period)?;
        if let Some(s) = db::current_payslip(self.db.conn(), worker_id, &period)?
            .filter(|s| s.status == "borrador")
        {
            db::delete_draft(self.db.conn(), s.id)?;
        }
        self.payslip(worker_id, &period)
    }

    /// Impuesto único de las liquidaciones pagadas en el mes (código 48 del F29).
    pub(crate) fn payroll_tax_paid(&self, period: &str) -> AppResult<(i64, i64)> {
        let (from, to) = range(period);
        Ok(db::tax_paid_between(self.db.conn(), &from, &to)?)
    }
}

/* ───────────── Empleador, Previred, Libro de Remuneraciones y finiquito ───────────── */

const SETTINGS_KEY: &str = "remuneraciones.empleador";

/// Datos del empleador para Previred y el Libro de Remuneraciones Electrónico.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PayrollSettings {
    /// Caja de compensación (código LRE 1110; 0 = sin caja).
    #[serde(default)]
    pub ccaf: u32,
    /// Mutual o ISL (código LRE 1152: 0 ISL, 1 ACHS, 2 Mutual CChC, 3 IST).
    #[serde(default)]
    pub mutual: Option<u32>,
    /// Región y comuna donde se prestan los servicios, si la persona no tiene otras.
    #[serde(default)]
    pub region: Option<u32>,
    #[serde(default)]
    pub comuna: Option<u32>,
}

pub const CCAF_NAMES: [&str; 5] = [
    "Sin caja de compensación",
    "Los Andes",
    "La Araucana",
    "Los Héroes",
    "18 de Septiembre",
];
pub const MUTUAL_NAMES: [&str; 4] = ["ISL", "ACHS", "Mutual de Seguridad CChC", "IST"];

/// Monto a enterar en Previred a una institución.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PreviredRow {
    pub institution: String,
    /// "afp", "apv", "salud", "afc", "seguro_social", "mutual", "asignacion" u "otro".
    pub kind: String,
    pub worker: i64,
    pub employer: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PreviredView {
    pub period: String,
    pub rows: Vec<PreviredRow>,
    pub total: i64,
    pub due_date: Option<String>,
    pub payslips: usize,
    /// Personas con liquidación del mes aún no emitida.
    pub pending: Vec<String>,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LreExport {
    pub file_name: String,
    pub content: String,
    pub rows: usize,
    pub format: String,
    pub warnings: Vec<String>,
}

/// Lo que la persona ingresa para calcular un finiquito.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SeveranceForm {
    pub end_date: String,
    pub cause: Option<Cause>,
    #[serde(default)]
    pub notice_given: bool,
    #[serde(default)]
    pub base_172: Option<i64>,
    #[serde(default)]
    pub vacation_base: Option<i64>,
    #[serde(default)]
    pub pending_vacation_days_e2: i64,
    #[serde(default)]
    pub vacation_taken_days_e2: i64,
    #[serde(default)]
    pub afc_offset: i64,
    #[serde(default)]
    pub deductions: Vec<DeductionItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeveranceView {
    pub worker: Worker,
    pub form: SeveranceForm,
    pub input: SeveranceInput,
    pub result: SeveranceResult,
    /// Última remuneración que propone NÚCLEO (sueldo + haberes imponibles fijos).
    pub suggested_base: i64,
    /// Mes de los indicadores usados (el anterior al de término) y si estaban guardados.
    pub indicators_period: String,
    pub indicators_saved: bool,
}

fn add_row(
    rows: &mut Vec<PreviredRow>,
    institution: String,
    kind: &str,
    worker: i64,
    employer: i64,
) {
    if worker == 0 && employer == 0 {
        return;
    }
    match rows.iter_mut().find(|r| r.institution == institution) {
        Some(r) => {
            r.worker += worker;
            r.employer += employer;
            r.total = r.worker + r.employer;
        }
        None => rows.push(PreviredRow {
            institution,
            kind: kind.into(),
            worker,
            employer,
            total: worker + employer,
        }),
    }
}

impl CompanySession {
    pub fn payroll_settings(&self) -> AppResult<PayrollSettings> {
        self.require("remuneraciones.ver")?;
        self.load_payroll_settings()
    }

    fn load_payroll_settings(&self) -> AppResult<PayrollSettings> {
        Ok(nucleo_db::core::get_setting(self.db.conn(), SETTINGS_KEY)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn save_payroll_settings(&mut self, s: &PayrollSettings) -> AppResult<PayrollSettings> {
        self.require("remuneraciones.editar")?;
        if s.ccaf as usize >= CCAF_NAMES.len()
            || s.mutual.is_some_and(|m| m as usize >= MUTUAL_NAMES.len())
            || s.region.is_some_and(|r| !(1..=16).contains(&r))
        {
            return Err(AppError::Validation(
                "revisa la caja de compensación, la mutual y la región".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        nucleo_db::core::set_setting(
            &tx,
            SETTINGS_KEY,
            &serde_json::to_value(s).unwrap_or_default(),
        )?;
        log(
            &tx,
            &user,
            "remuneraciones.empleador",
            "remuneraciones",
            "empleador",
            "Actualizó los datos del empleador para Previred y el LRE",
            None,
        )?;
        tx.commit()?;
        self.load_payroll_settings()
    }

    /// Liquidaciones emitidas del mes con su foto.
    fn emitted_snapshots(&self, period: &str) -> AppResult<Vec<Snapshot>> {
        Ok(db::payslips_of_period(self.db.conn(), period)?
            .into_iter()
            .filter(|s| s.status == "emitida")
            .filter_map(|s| s.snapshot_json.and_then(|j| serde_json::from_str(&j).ok()))
            .collect())
    }

    /// Resumen de lo que se paga en Previred por las remuneraciones del mes, por institución.
    pub fn previred(&self, period: &str) -> AppResult<PreviredView> {
        self.require("remuneraciones.ver")?;
        let period = check_period(period)?;
        let settings = self.load_payroll_settings()?;
        let snaps = self.emitted_snapshots(&period)?;
        let mut rows: Vec<PreviredRow> = Vec::new();
        let mut notes = Vec::new();
        let mutual = settings
            .mutual
            .and_then(|m| MUTUAL_NAMES.get(m as usize))
            .map(|n| format!("Seguro de accidentes: {n}"))
            .unwrap_or_else(|| "Seguro de accidentes (mutual o ISL)".into());
        for s in &snaps {
            let t = &s.worker.terms;
            let r = &s.result;
            let afp_name = format!("AFP {}", t.afp.clone().unwrap_or_else(|| "—".into()));
            let health = if t.health == "isapre" {
                format!("Isapre {}", t.health_name.clone().unwrap_or_default())
                    .trim()
                    .to_string()
            } else {
                "Fonasa".to_string()
            };
            for l in &r.legal_deductions {
                match l.key.as_str() {
                    "afp" => add_row(&mut rows, afp_name.clone(), "afp", l.amount, 0),
                    "apv" => {
                        let inst = t
                            .apv
                            .as_ref()
                            .and_then(|a| a.institution.clone())
                            .unwrap_or_else(|| afp_name.clone());
                        add_row(
                            &mut rows,
                            format!("APV {inst}").replace("APV AFP", "APV en AFP"),
                            "apv",
                            l.amount,
                            0,
                        )
                    }
                    "salud" | "salud_adicional" => {
                        add_row(&mut rows, health.clone(), "salud", l.amount, 0)
                    }
                    "afc" => add_row(
                        &mut rows,
                        "Seguro de cesantía (AFC)".into(),
                        "afc",
                        l.amount,
                        0,
                    ),
                    _ => {}
                }
            }
            for l in &r.employer {
                match l.key.as_str() {
                    "afc_empleador" => add_row(
                        &mut rows,
                        "Seguro de cesantía (AFC)".into(),
                        "afc",
                        0,
                        l.amount,
                    ),
                    "ley16744" => add_row(&mut rows, mutual.clone(), "mutual", 0, l.amount),
                    code => {
                        let payee = s
                            .input
                            .params
                            .employer
                            .iter()
                            .find(|e| e.code == code)
                            .and_then(|e| e.payee.clone());
                        match payee.as_deref() {
                            Some("seguro_social") => add_row(
                                &mut rows,
                                "Seguro Social Previsional".into(),
                                "seguro_social",
                                0,
                                l.amount,
                            ),
                            Some("afp") | None => {
                                add_row(&mut rows, afp_name.clone(), "afp", 0, l.amount)
                            }
                            Some(_) => add_row(&mut rows, l.label.clone(), "otro", 0, l.amount),
                        }
                    }
                }
            }
            let allowance: i64 = r
                .other_earnings
                .iter()
                .filter(|l| l.key == "asignacion_familiar")
                .map(|l| l.amount)
                .sum();
            if allowance > 0 {
                let who = if settings.ccaf > 0 {
                    format!("caja {}", CCAF_NAMES[settings.ccaf as usize])
                } else {
                    "IPS".into()
                };
                add_row(
                    &mut rows,
                    format!("Asignación familiar pagada (la compensa la {who})"),
                    "asignacion",
                    0,
                    -allowance,
                );
            }
        }
        let order = [
            "afp",
            "apv",
            "salud",
            "afc",
            "seguro_social",
            "mutual",
            "otro",
            "asignacion",
        ];
        rows.sort_by_key(|r| {
            (
                order.iter().position(|k| *k == r.kind).unwrap_or(9),
                r.institution.clone(),
            )
        });
        if settings.mutual.is_none() && rows.iter().any(|r| r.kind == "mutual") {
            notes.push(Note {
                code: None,
                severity: Severity::Aviso,
                text: "Indica tu mutual (o ISL) en los datos del empleador.".into(),
            });
        }
        let ind = self.load_indicators(&period)?;
        let due_date = ind
            .indicators
            .previred_due_day
            .map(|d| format!("{}-{d:02}", crate::f29_ops::shift(&period, 1)));
        let conn = self.db.conn();
        let slips = db::payslips_of_period(conn, &period)?;
        let mut pending = Vec::new();
        for w in db::workers(conn)?.into_iter().map(worker_from_row) {
            let emitted = slips
                .iter()
                .any(|s| s.worker_id == w.id && s.status == "emitida");
            if !emitted && w.active && in_period(&w, &period) {
                pending.push(w.name);
            }
        }
        if !pending.is_empty() {
            notes.push(Note {
                code: None,
                severity: Severity::Aviso,
                text: format!(
                    "Faltan por emitir: {}. El resumen solo suma las liquidaciones emitidas.",
                    pending.join(", ")
                ),
            });
        }
        Ok(PreviredView {
            total: rows.iter().map(|r| r.total).sum(),
            period,
            rows,
            due_date,
            payslips: snaps.len(),
            pending,
            notes,
        })
    }

    /// Archivo del Libro de Remuneraciones Electrónico del mes (liquidaciones emitidas).
    pub fn lre(&self, period: &str) -> AppResult<LreExport> {
        self.require("remuneraciones.ver")?;
        let period = check_period(period)?;
        let biz = self.business()?;
        let Some(employer_rut) = biz.rut.clone().filter(|r| !r.trim().is_empty()) else {
            return Err(AppError::Validation(
                "para el Libro de Remuneraciones falta el RUT del negocio (Mi negocio)".into(),
            ));
        };
        let settings = self.load_payroll_settings()?;
        let snaps = self.emitted_snapshots(&period)?;
        if snaps.is_empty() {
            return Err(AppError::Validation(
                "no hay liquidaciones emitidas en este mes".into(),
            ));
        }
        let mut warnings = Vec::new();
        let mut rows = Vec::new();
        let (from, to) = range(&period);
        for s in &snaps {
            let w = &s.worker;
            let t = &w.terms;
            let name = &w.name;
            let mut amounts = std::collections::BTreeMap::new();
            let r = &s.result;
            for l in r
                .taxable_earnings
                .iter()
                .chain(&r.other_earnings)
                .chain(&r.legal_deductions)
                .chain(&r.other_deductions)
                .chain(&r.employer)
            {
                let code = match l.lre {
                    Some(c) => c,
                    None if r.other_earnings.iter().any(|x| std::ptr::eq(x, l)) => {
                        warnings.push(format!(
                            "{name}: «{}» no tiene código del LRE; se informó como gastos por causa del trabajo (2306).",
                            l.label
                        ));
                        2306
                    }
                    None if r.other_deductions.iter().any(|x| std::ptr::eq(x, l)) => 3183,
                    None if r.employer.iter().any(|x| std::ptr::eq(x, l)) => {
                        let msg = format!(
                            "«{}» no tiene código en el LRE vigente: no se informa (sí se paga en Previred).",
                            l.label
                        );
                        if !warnings.contains(&msg) {
                            warnings.push(msg);
                        }
                        continue;
                    }
                    None => continue,
                };
                *amounts.entry(code).or_insert(0) += l.amount;
            }
            if r.advance > 0 {
                *amounts.entry(3188).or_insert(0) += r.advance;
            }
            let afp = lre::afp_code(t.afp.as_deref()).unwrap_or_else(|| {
                warnings.push(format!(
                    "{name}: AFP sin código del LRE; se informó como «no está en AFP» (100)."
                ));
                100
            });
            let health = t
                .health_lre_code
                .or_else(|| lre::health_code(&t.health, t.health_name.as_deref()))
                .unwrap_or_else(|| {
                    warnings.push(format!(
                        "{name}: falta el código del LRE de la Isapre (ingrésalo en la ficha)."
                    ));
                    0
                });
            let region = t.region.or(settings.region).unwrap_or_else(|| {
                warnings.push(format!("{name}: falta la región donde presta servicios."));
                0
            });
            let comuna = t.comuna.or(settings.comuna).unwrap_or_else(|| {
                warnings.push(format!(
                    "{name}: falta la comuna (código territorial) donde presta servicios."
                ));
                0
            });
            let mutual = settings.mutual.unwrap_or_else(|| {
                let msg = "Falta la mutual o ISL del empleador (datos del empleador).".to_string();
                if !warnings.contains(&msg) {
                    warnings.push(msg);
                }
                0
            });
            let end = w.end_date.clone().filter(|e| *e >= from && *e <= to);
            let end_cause = end
                .as_ref()
                .and_then(|_| t.end_cause.and_then(|c| c.lre_code()));
            if end.is_some() && end_cause.is_none() {
                warnings.push(format!(
                    "{name}: terminó este mes; falta la causal de término."
                ));
            }
            rows.push(lre::LreRow {
                rut: w.rut.clone(),
                start_date: w.start_date.clone(),
                end_date: end,
                end_cause,
                region,
                comuna,
                jornada: t.jornada.unwrap_or(101),
                disability: t.disability,
                pensioner: t.pensioner,
                afp,
                health,
                afc: t.afc,
                ccaf: settings.ccaf,
                mutual,
                family_loads: t.family_loads.max(0) as u32,
                invalid_loads: t.invalid_loads.max(0) as u32,
                allowance_bracket: r.allowance_bracket.clone(),
                days: s.input.days.clamp(0, 30) as u32,
                young_subsidy: t.young_subsidy,
                apvi: t.apv.is_some(),
                amounts,
            });
        }
        // Cuadratura: el líquido del libro debe ser el de cada liquidación.
        for (row, s) in rows.iter().zip(&snaps) {
            let tot = lre::totals(&row.amounts);
            if tot.get(&5501).copied().unwrap_or(0) != s.result.to_pay {
                warnings.push(format!(
                    "{}: el total líquido del libro no cuadra con la liquidación; revísala.",
                    s.worker.name
                ));
            }
        }
        Ok(LreExport {
            file_name: lre::file_name(&employer_rut, &period),
            content: lre::build(&rows),
            rows: rows.len(),
            format: lre::FORMAT_VERSION.into(),
            warnings,
        })
    }

    /// Escribe el archivo del LRE en Windows-1252 donde la persona eligió.
    pub fn export_lre(&self, period: &str, dest: &std::path::Path) -> AppResult<LreExport> {
        let e = self.lre(period)?;
        std::fs::write(dest, lre::to_cp1252(&e.content))
            .map_err(|err| AppError::Validation(format!("no se pudo guardar el archivo: {err}")))?;
        Ok(e)
    }

    /// Calcula un finiquito (no se guarda: la persona lo imprime y lo firma ante ministro de fe).
    pub fn severance(&self, worker_id: i64, form: &SeveranceForm) -> AppResult<SeveranceView> {
        self.require("remuneraciones.ver")?;
        let w = self.worker_or_404(worker_id)?;
        let end = parse_date("La fecha de término", &form.end_date)?;
        let cause = form
            .cause
            .ok_or_else(|| AppError::Validation("elige la causal de término".into()))?;
        let end_period = end[..7].to_string();
        let prev_period = crate::f29_ops::shift(&end_period, -1);
        let prev = self.load_indicators(&prev_period)?;
        let cur = self.load_indicators(&end_period)?;
        let (ind, used, saved) = if prev.saved {
            (prev.indicators, prev_period, true)
        } else {
            (cur.indicators.clone(), end_period, cur.saved)
        };
        let t = &w.terms;
        let suggested_base = t.base_salary
            + t.items
                .iter()
                .filter(|i| i.taxable)
                .map(|i| i.amount)
                .sum::<i64>();
        let mut rules = ind.severance.clone();
        rules.uf_e2 = ind.params.uf_e2;
        let input = SeveranceInput {
            rules,
            start_date: w.start_date.clone(),
            end_date: end,
            cause,
            notice_given: form.notice_given,
            base_172: form.base_172.unwrap_or(suggested_base),
            vacation_base: form.vacation_base.unwrap_or(t.base_salary),
            pending_vacation_days_e2: form.pending_vacation_days_e2.max(0),
            vacation_taken_days_e2: form.vacation_taken_days_e2.max(0),
            afc_offset: form.afc_offset.max(0),
            deductions: form.deductions.clone(),
        };
        let mut result = severance::compute(&input);
        if w.is_owner {
            result.notes.insert(
                0,
                Note {
                    code: None,
                    severity: Severity::Aviso,
                    text: "El sueldo empresarial no nace de un contrato de trabajo: normalmente no hay finiquito ni indemnizaciones. Confírmalo con tu contador.".into(),
                },
            );
        }
        if !saved {
            result.complete = false;
            result.notes.insert(
                0,
                Note {
                    code: None,
                    severity: Severity::Falta,
                    text: "Faltan los indicadores del mes anterior al término (UF y reglas del finiquito).".into(),
                },
            );
        }
        Ok(SeveranceView {
            worker: w,
            form: form.clone(),
            input,
            result,
            suggested_base,
            indicators_period: used,
            indicators_saved: saved,
        })
    }
}

/// Una liquidación emitida, resumida para la renta anual (F22).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayrollEmitted {
    pub period: String,
    pub pay_date: String,
    /// Lo pagado a la persona (haberes menos cotizaciones e impuesto).
    pub net_paid: i64,
    /// Cotizaciones e impuesto retenidos más aportes del empleador (se enteran el mes siguiente).
    pub withheld_and_employer: i64,
}

impl CompanySession {
    pub(crate) fn payroll_emitted(&self) -> AppResult<Vec<PayrollEmitted>> {
        let mut st = self.db.conn().prepare(
            "SELECT period, pay_date, snapshot_json FROM payslips WHERE status = 'emitida' ORDER BY period",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (period, pay_date, json) = row?;
            let Ok(s) = serde_json::from_str::<Snapshot>(&json) else {
                continue;
            };
            let legal: i64 = s.result.legal_deductions.iter().map(|l| l.amount).sum();
            out.push(PayrollEmitted {
                period,
                pay_date,
                net_paid: s.result.total_earnings - legal,
                withheld_and_employer: legal + s.result.employer_total,
            });
        }
        Ok(out)
    }
}
