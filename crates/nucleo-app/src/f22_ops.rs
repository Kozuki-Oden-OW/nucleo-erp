//! Casos de uso del borrador del F22 (Fase 10, hito C): renta anual de una empresa Pro Pyme general.
//!
//! NÚCLEO arma el recuadro 17 con lo cobrado y lo pagado en el año (ventas, compras, gastos,
//! importaciones y remuneraciones), toma los PPM de los F29 marcados como declarados y calcula el
//! impuesto, el capital propio tributario y las rentas afectas a impuestos finales. La persona ajusta
//! lo que NÚCLEO no sabe (tasa, incentivo 14 E, saldos del F22 anterior, factores de reajuste) y
//! cualquier código. No declara: deja cada código listo para comparar con la propuesta del SII.

use std::collections::BTreeMap;

use crate::company::CompanySession;
use crate::payroll_ops::PayrollEmitted;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::f22 as db;
use nucleo_db::now_utc;
use nucleo_domain::comex::{div_round, to_clp};
use nucleo_domain::f22::{
    F22Input, F22Line, F22Params, F22Result, PpmPaid, Registers, compute, label, r17_kind,
};
use nucleo_domain::f29::{Note, Severity};
use serde::{Deserialize, Serialize};

/// Lo que ingresa la persona para el F22 de un año comercial.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F22Inputs {
    #[serde(default)]
    pub params: F22Params,
    #[serde(default)]
    pub incentive: bool,
    #[serde(default)]
    pub art21: i64,
    #[serde(default)]
    pub rebates: i64,
    #[serde(default)]
    pub registers: Registers,
    /// Reemplaza el valor que calcula NÚCLEO para un código del recuadro 17.
    #[serde(default)]
    pub overrides: BTreeMap<String, i64>,
    /// Partidas que NÚCLEO no conoce (rentas extranjeras, pérdida de arrastre, relacionadas…).
    #[serde(default)]
    pub extra: Vec<F22Line>,
    /// Factor de reajuste de los PPM de cada mes ("01".."12"), × 1.000.000.
    #[serde(default)]
    pub ppm_factors: BTreeMap<String, i64>,
    /// PPM pagado de un mes cuando no está el F29 declarado en NÚCLEO.
    #[serde(default)]
    pub ppm_overrides: BTreeMap<String, i64>,
}

/// Una partida que NÚCLEO calculó desde sus datos, con su explicación.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DerivedLine {
    pub code: u32,
    pub label: String,
    pub amount: i64,
    /// Documentos que la componen.
    pub count: i64,
    pub source: String,
    /// Valor que se usó (el de NÚCLEO o el ingresado a mano).
    pub used: i64,
    pub overridden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PpmRow {
    pub period: String,
    pub amount: Option<i64>,
    /// "declarado" (F29 en NÚCLEO), "manual" o "sin_dato".
    pub source: String,
    pub factor_e6: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F22View {
    pub year: i32,
    /// Año tributario (año comercial + 1).
    pub tax_year: i32,
    pub regime: String,
    /// El año comercial aún no termina: el borrador es una proyección.
    pub in_progress: bool,
    pub inputs: F22Inputs,
    pub derived: Vec<DerivedLine>,
    pub ppm: Vec<PpmRow>,
    pub input: F22Input,
    pub result: F22Result,
    /// Resultado sin el incentivo 14 E (para comparar la opción).
    pub without_incentive: Option<F22Result>,
    pub checks: Vec<Note>,
    pub status: String,
}

fn clp(amount: i64, currency: &str, rate: Option<i64>) -> Option<i64> {
    if currency == "CLP" {
        Some(amount)
    } else {
        rate.map(|r| to_clp(amount, 2, r))
    }
}

/// Parte de un pago que corresponde al neto (sin IVA recuperable).
fn net_part(paid: i64, net: i64, total: i64) -> i64 {
    if total <= 0 {
        0
    } else {
        div_round(paid as i128 * net as i128, total as i128) as i64
    }
}

fn expense_code(category: Option<&str>) -> u32 {
    let c = category.unwrap_or_default().to_lowercase();
    if c.contains("arriendo") {
        1415
    } else if c.contains("remunera") {
        1411
    } else if c.contains("honorario") {
        1412
    } else if c.contains("maquinaria") || c.contains("equipo") || c.contains("activo") {
        1413
    } else if c.contains("interes") || c.contains("interés") {
        1419
    } else {
        1424
    }
}

#[derive(Default)]
struct Acc {
    amount: i64,
    count: i64,
    source: Vec<&'static str>,
}

impl Acc {
    fn add(&mut self, v: i64, src: &'static str) {
        self.amount += v;
        self.count += 1;
        if !self.source.contains(&src) {
            self.source.push(src);
        }
    }
}

impl CompanySession {
    pub fn f22(&self, year: i32) -> AppResult<F22View> {
        self.require("contabilidad.ver")?;
        if !(2000..=2200).contains(&year) {
            return Err(AppError::Validation("año no válido".into()));
        }
        self.build_f22(year)
    }

    fn build_f22(&self, year: i32) -> AppResult<F22View> {
        let conn = self.db.conn();
        let stored = db::inputs(conn, year)?;
        let inputs: F22Inputs = stored
            .as_ref()
            .and_then(|(j, _)| serde_json::from_str(j).ok())
            .unwrap_or_default();
        let status = stored.map(|(_, s)| s).unwrap_or_else(|| "borrador".into());
        let regime = self.tax_profile_regime()?;
        let (from, to) = (format!("{year}-01-01"), format!("{year}-12-31"));
        let today: String = conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?;
        let in_progress = today.as_str() <= to.as_str();
        let mut checks = Vec::new();
        let mut check = |severity: Severity, text: String| {
            checks.push(Note {
                code: None,
                severity,
                text,
            })
        };
        let mut acc: BTreeMap<u32, Acc> = BTreeMap::new();

        // Ventas cobradas en el año (parte neta; las del año anterior van al 1817).
        let mut no_rate = 0;
        for s in db::sales_collected(conn, &from, &to)? {
            let Some(paid) = clp(s.collected_minor, &s.currency_code, s.rate_e6) else {
                no_rate += 1;
                continue;
            };
            let total = clp(s.total_minor, &s.currency_code, s.rate_e6).unwrap_or(0);
            let net = clp(s.net_minor + s.exempt_minor, &s.currency_code, s.rate_e6).unwrap_or(0);
            let code = if s.doc_date.as_str() < from.as_str() {
                1817
            } else {
                1400
            };
            acc.entry(code)
                .or_default()
                .add(net_part(paid, net, total), "cobros de ventas");
        }
        // Compras, gastos e importaciones pagados en el año.
        for p in db::payables_paid(conn, &from, &to)? {
            let Some(paid) = clp(p.paid_minor, &p.currency_code, p.rate_e6) else {
                no_rate += 1;
                continue;
            };
            let total = clp(p.total_minor, &p.currency_code, p.rate_e6).unwrap_or(0);
            let net = clp(p.net_minor, &p.currency_code, p.rate_e6).unwrap_or(0);
            let prior = p.doc_date.as_str() < from.as_str();
            match p.source.as_str() {
                "COM" => acc
                    .entry(if prior { 1818 } else { 1409 })
                    .or_default()
                    .add(net_part(paid, net, total), "pagos de compras"),
                "GAS" => {
                    let code = expense_code(p.category.as_deref());
                    if code == 1411 {
                        check(
                            Severity::Aviso,
                            format!(
                                "El gasto {} está en la categoría Remuneraciones: si esa persona tiene liquidación en NÚCLEO, se estaría contando dos veces.",
                                p.number
                            ),
                        );
                    }
                    let v = if p.tax_minor > 0 {
                        net_part(paid, net, total)
                    } else {
                        paid
                    };
                    acc.entry(code).or_default().add(v, "pagos de gastos");
                }
                _ => {
                    if !p.recoverable {
                        acc.entry(1409)
                            .or_default()
                            .add(paid, "costos de importación pagados");
                    }
                }
            }
        }
        if no_rate > 0 {
            check(
                Severity::Aviso,
                format!(
                    "{no_rate} cobro(s) o pago(s) en moneda extranjera sin tipo de cambio no se incluyeron."
                ),
            );
        }
        // Remuneraciones: lo pagado a las personas en el año más las cotizaciones e impuesto
        // enterados en el año (los de diciembre anterior a noviembre).
        let emitted = self.payroll_emitted()?;
        let prev_dec = format!("{}-12", year - 1);
        let nov = format!("{year}-11");
        for e in &emitted {
            let PayrollEmitted {
                period,
                pay_date,
                net_paid,
                withheld_and_employer,
            } = e;
            if pay_date.as_str() >= from.as_str() && pay_date.as_str() <= to.as_str() {
                acc.entry(1411)
                    .or_default()
                    .add(*net_paid, "liquidaciones pagadas");
            }
            if period.as_str() >= prev_dec.as_str() && period.as_str() <= nov.as_str() {
                acc.entry(1411)
                    .or_default()
                    .add(*withheld_and_employer, "cotizaciones e impuesto enterados");
            }
        }
        if !emitted.is_empty() {
            check(
                Severity::Info,
                "Remuneraciones (1411): líquidos pagados en el año más cotizaciones e impuesto único enterados en el año (los de diciembre se pagan en enero y cuentan para el año siguiente).".into(),
            );
        }

        // Partidas de NÚCLEO con los reemplazos manuales.
        let mut derived = Vec::new();
        let mut lines = Vec::new();
        let mut codes: Vec<u32> = acc.keys().copied().collect();
        for k in inputs.overrides.keys() {
            if let Ok(c) = k.parse::<u32>()
                && !codes.contains(&c)
            {
                codes.push(c);
            }
        }
        codes.sort();
        for code in codes {
            let a = acc.remove(&code).unwrap_or_default();
            let ov = inputs.overrides.get(&code.to_string()).copied();
            let used = ov.unwrap_or(a.amount);
            derived.push(DerivedLine {
                code,
                label: label(code).to_string(),
                amount: a.amount,
                count: a.count,
                source: if a.source.is_empty() {
                    "ingresado a mano".into()
                } else {
                    a.source.join(", ")
                },
                used,
                overridden: ov.is_some(),
            });
            if used != 0 {
                lines.push(F22Line {
                    code,
                    amount: used,
                    label: None,
                });
            }
        }
        lines.extend(inputs.extra.iter().cloned());

        // PPM de los F29 declarados del año.
        let declared: BTreeMap<String, i64> = db::declared_ppm(conn, year)?.into_iter().collect();
        let mut ppm_rows = Vec::new();
        let mut ppm = Vec::new();
        for m in 1..=12 {
            let period = format!("{year}-{m:02}");
            let key = format!("{m:02}");
            let (amount, source) = match (inputs.ppm_overrides.get(&key), declared.get(&period)) {
                (Some(v), _) => (Some(*v), "manual"),
                (None, Some(v)) => (Some(*v), "declarado"),
                _ => (None, "sin_dato"),
            };
            let factor = inputs.ppm_factors.get(&key).copied();
            if let Some(a) = amount.filter(|a| *a != 0) {
                ppm.push(PpmPaid {
                    period: Some(period.clone()),
                    amount: a,
                    factor_e6: factor.unwrap_or(0),
                });
            }
            ppm_rows.push(PpmRow {
                period,
                amount,
                source: source.into(),
                factor_e6: factor,
            });
        }
        let missing = ppm_rows
            .iter()
            .filter(|r| {
                r.source == "sin_dato" && (!in_progress || r.period.as_str() < today.as_str())
            })
            .count();
        if missing > 0 {
            check(
                Severity::Aviso,
                format!(
                    "{missing} mes(es) sin PPM: marca esos F29 como declarados en Impuestos o ingresa el PPM pagado."
                ),
            );
        }
        if in_progress {
            check(
                Severity::Info,
                format!(
                    "El año {year} aún no termina: este borrador es una proyección con lo registrado hasta hoy."
                ),
            );
        }
        if regime != "14d3" {
            check(
                Severity::Falta,
                "Por ahora NÚCLEO prepara el F22 del régimen Pro Pyme general (14 D N°3). Para tu régimen, usa esta vista solo como referencia de lo cobrado y pagado.".into(),
            );
        }

        let has_registers = inputs.registers != Registers::default();
        let input = F22Input {
            params: inputs.params.clone(),
            lines,
            art21: inputs.art21,
            incentive: inputs.incentive,
            rebates: inputs.rebates,
            ppm,
            registers: has_registers.then(|| inputs.registers.clone()),
        };
        let result = compute(&input);
        let without_incentive = input.incentive.then(|| {
            compute(&F22Input {
                incentive: false,
                ..input.clone()
            })
        });
        Ok(F22View {
            year,
            tax_year: year + 1,
            regime,
            in_progress,
            inputs,
            derived,
            ppm: ppm_rows,
            input,
            result,
            without_incentive,
            checks,
            status,
        })
    }

    fn tax_profile_regime(&self) -> AppResult<String> {
        Ok(
            nucleo_db::core::get_setting(self.db.conn(), "impuestos.perfil")?
                .and_then(|v| v.get("regime").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_else(|| "14d3".into()),
        )
    }

    pub fn save_f22_inputs(&mut self, year: i32, inputs: &F22Inputs) -> AppResult<F22View> {
        self.require("contabilidad.editar")?;
        if !(2000..=2200).contains(&year) {
            return Err(AppError::Validation("año no válido".into()));
        }
        let p = &inputs.params;
        let rate_ok = |v: i64| (0..=1_000_000).contains(&v);
        if !rate_ok(p.idpc_rate_ppm)
            || !rate_ok(p.incentive_rate_ppm)
            || p.uf_e2 < 0
            || p.incentive_cap_uf_e4 < 0
        {
            return Err(AppError::Validation(
                "revisa la tasa, el porcentaje del incentivo, el tope y la UF".into(),
            ));
        }
        for k in inputs.overrides.keys() {
            if k.parse::<u32>().ok().and_then(r17_kind).is_none() {
                return Err(AppError::Validation(format!(
                    "el código {k} no es del recuadro 17"
                )));
            }
        }
        if inputs.extra.iter().any(|l| r17_kind(l.code).is_none()) {
            return Err(AppError::Validation(
                "cada partida agregada debe tener un código del recuadro 17".into(),
            ));
        }
        if inputs
            .ppm_factors
            .values()
            .any(|f| !(500_000..=2_000_000).contains(f))
        {
            return Err(AppError::Validation(
                "los factores de reajuste de los PPM deben estar entre 0,5 y 2".into(),
            ));
        }
        let user = self.actor_name()?;
        let now = now_utc();
        let tx = self.db.conn_mut().transaction()?;
        db::save_inputs(
            &tx,
            year,
            &serde_json::to_string(inputs).unwrap_or_else(|_| "{}".into()),
            &now,
        )?;
        log(
            &tx,
            &user,
            "impuestos.f22",
            "f22",
            &year.to_string(),
            &format!("Guardó los datos del F22 del año comercial {year}"),
            None,
        )?;
        tx.commit()?;
        self.build_f22(year)
    }
}
