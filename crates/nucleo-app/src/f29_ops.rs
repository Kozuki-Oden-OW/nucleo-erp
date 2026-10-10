//! Casos de uso del borrador del F29 (Fase 10, hito A).
//!
//! NÚCLEO no declara ni envía nada al SII: arma el borrador código por código desde el Registro
//! de Compras y Ventas (importado de sii.cl) o, si no se importó, desde las ventas, compras,
//! gastos e importaciones registradas en NÚCLEO. Explica cada monto, avisa lo que falta y guarda
//! lo que la persona declaró (el remanente declarado alimenta el mes siguiente).

use std::collections::BTreeMap;

use crate::company::CompanySession;
use crate::sales_ops::{log, opt_text, parse_date};
use crate::{AppError, AppResult};
use nucleo_db::taxes::{self as db, TaxDocWrite};
use nucleo_db::{core as dbcore, now_utc};
use nucleo_domain::comex::to_clp;
use nucleo_domain::f29::{
    Direction, F29Input, F29Result, MANUAL_CODES, Note, Ppm, PurchaseKind, Remnant, Severity,
    TaxDoc, compute,
};
use nucleo_io::rcv;
use serde::{Deserialize, Serialize};

const PROFILE_KEY: &str = "impuestos.perfil";
const REGIMES: [&str; 3] = ["14d3", "14d8", "14a"];
const KINDS: [&str; 6] = [
    "giro",
    "supermercado",
    "activo_fijo",
    "uso_comun",
    "sin_derecho",
    "bien_raiz",
];

/// Perfil tributario de la empresa (se ingresa una vez en Configuración tributaria).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxProfile {
    /// "14d3" Pro Pyme general, "14d8" Pro Pyme transparente, "14a" régimen general.
    pub regime: String,
    /// Tasa de PPM asignada a la empresa, en partes por millón de los ingresos (0,25 % = 2.500).
    #[serde(default)]
    pub ppm_rate_ppm: Option<i64>,
    /// Decimales al convertir el remanente a UTM (`None` = sin redondeo intermedio).
    #[serde(default)]
    pub utm_decimals: Option<u32>,
    /// Día del mes siguiente en que vence el F29 (lo define la forma de declarar de la empresa).
    #[serde(default)]
    pub due_day: Option<u32>,
    /// Proporción del IVA de uso común con derecho a crédito (ppm), si la empresa la usa.
    #[serde(default)]
    pub common_use_ppm: Option<i64>,
}

impl Default for TaxProfile {
    fn default() -> Self {
        TaxProfile {
            regime: "14d3".into(),
            ppm_rate_ppm: None,
            utm_decimals: None,
            due_day: None,
            common_use_ppm: None,
        }
    }
}

/// Datos del mes que ingresa la persona.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct F29Inputs {
    /// Remanente (código 77) declarado el mes anterior; si falta, se usa el del F29 anterior
    /// marcado como declarado en NÚCLEO.
    #[serde(default)]
    pub remnant_amount: Option<i64>,
    #[serde(default)]
    pub utm_prev: Option<i64>,
    #[serde(default)]
    pub utm_cur: Option<i64>,
    #[serde(default)]
    pub ppm_loss: bool,
    #[serde(default)]
    pub ppm_credit: i64,
    #[serde(default)]
    pub ppm_base_override: Option<i64>,
    #[serde(default)]
    pub common_use_ppm: Option<i64>,
    /// Montos manuales por código ("48" impuesto único, "151" retención de honorarios…).
    #[serde(default)]
    pub manual: BTreeMap<String, i64>,
}

/// Un documento del borrador, con su origen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocLine {
    /// "rcv" (registro del SII), "manual" o "nucleo" (derivado de NÚCLEO).
    pub origin: String,
    /// Id de la fila guardada (solo registro y manual).
    pub id: Option<i64>,
    pub direction: String,
    pub sii_type: u32,
    pub folio: Option<String>,
    pub issue_date: Option<String>,
    pub counterpart: Option<String>,
    pub count: i64,
    pub exempt_minor: i64,
    pub net_minor: i64,
    pub tax_minor: i64,
    pub tax_non_rec_minor: i64,
    pub common_use_tax_minor: i64,
    pub kind: Option<String>,
    pub not_of_business: bool,
    /// Número interno en NÚCLEO (VEN-…, COM-…, GAS-…, IMP-…).
    pub reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F29Source {
    pub direction: String,
    /// "rcv" si se importó el registro del SII; "nucleo" si se usan los datos de NÚCLEO.
    pub source: String,
    pub file_name: Option<String>,
    pub imported_at: Option<String>,
    pub rows: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F29Declared {
    pub declared_77: i64,
    pub declared_91: i64,
    pub folio: Option<String>,
    pub at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F29PeriodSummary {
    pub period: String,
    pub status: String,
    pub declared_91: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct F29View {
    pub period: String,
    pub status: String,
    pub profile: TaxProfile,
    pub inputs: F29Inputs,
    /// Remanente sugerido desde el F29 anterior declarado en NÚCLEO.
    pub remnant_suggested: Option<i64>,
    pub remnant_from: Option<String>,
    pub sources: Vec<F29Source>,
    pub docs: Vec<DocLine>,
    pub result: F29Result,
    /// Avisos sobre la calidad de los datos (ventas sin documentar, IVA estimado…).
    pub checks: Vec<Note>,
    pub declared: Option<F29Declared>,
    pub due_date: Option<String>,
    pub periods: Vec<F29PeriodSummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaxDocInput {
    pub direction: String,
    pub sii_type: u32,
    pub folio: Option<String>,
    pub issue_date: Option<String>,
    pub counterpart_rut: Option<String>,
    pub counterpart_name: Option<String>,
    #[serde(default)]
    pub doc_count: Option<i64>,
    #[serde(default)]
    pub exempt_minor: i64,
    #[serde(default)]
    pub net_minor: i64,
    #[serde(default)]
    pub tax_minor: i64,
    #[serde(default)]
    pub purchase_kind: Option<String>,
    #[serde(default)]
    pub not_of_business: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RcvImportReport {
    pub rows: usize,
    pub skipped: Vec<String>,
    /// Documentos con fecha fuera del período (normal si se registraron tarde).
    pub other_period: usize,
    pub view: F29View,
}

/* ───────────────────────────── utilidades ───────────────────────────── */

fn check_period(p: &str) -> AppResult<String> {
    let p = p.trim();
    let ok = p.len() == 7
        && p.as_bytes()[4] == b'-'
        && p[..4]
            .parse::<u32>()
            .is_ok_and(|y| (2000..=2200).contains(&y))
        && p[5..].parse::<u32>().is_ok_and(|m| (1..=12).contains(&m));
    if ok {
        Ok(p.to_string())
    } else {
        Err(AppError::Validation(
            "el período debe tener el formato AAAA-MM".into(),
        ))
    }
}

fn ym(p: &str) -> (i32, u32) {
    (p[..4].parse().unwrap_or(2000), p[5..].parse().unwrap_or(1))
}

fn shift(p: &str, months: i32) -> String {
    let (y, m) = ym(p);
    let idx = y * 12 + (m as i32 - 1) + months;
    format!("{:04}-{:02}", idx.div_euclid(12), idx.rem_euclid(12) + 1)
}

fn days_in(y: i32, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn range(p: &str) -> (String, String) {
    let (y, m) = ym(p);
    (format!("{p}-01"), format!("{p}-{:02}", days_in(y, m)))
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .replace(['á'], "a")
        .replace(['é'], "e")
        .replace(['í'], "i")
        .replace(['ó'], "o")
        .replace(['ú'], "u")
}

/// Tipo de documento del SII a partir del texto que anotó la persona ("Factura", "Boleta"…).
pub fn sii_type_from_text(kind: Option<&str>, tax: i64, exempt: i64) -> Option<u32> {
    let k = kind.map(norm).unwrap_or_default();
    let afecta = tax > 0;
    Some(
        if k.contains("credito") || k.split_whitespace().any(|w| w == "nc") {
            61
        } else if k.contains("debito") || k.split_whitespace().any(|w| w == "nd") {
            56
        } else if k.contains("guia") {
            return None;
        } else if k.contains("boleta") {
            if afecta { 39 } else { 41 }
        } else if k.contains("export") {
            110
        } else if k.contains("comprobante") || k.contains("voucher") {
            48
        } else if k.contains("exent") || (!afecta && exempt > 0) {
            34
        } else {
            33
        },
    )
}

fn kind_of(s: &str) -> Option<PurchaseKind> {
    Some(match s {
        "giro" => PurchaseKind::Giro,
        "supermercado" => PurchaseKind::Supermercado,
        "activo_fijo" => PurchaseKind::ActivoFijo,
        "uso_comun" => PurchaseKind::UsoComun,
        "sin_derecho" => PurchaseKind::SinDerecho,
        "bien_raiz" => PurchaseKind::BienRaiz,
        _ => return None,
    })
}

fn clp(amount: i64, currency: &str, rate: Option<i64>) -> Option<i64> {
    if currency == "CLP" {
        Some(amount)
    } else {
        rate.map(|r| to_clp(amount, 2, r))
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

fn line_from_row(r: &db::TaxDocRow) -> DocLine {
    DocLine {
        origin: r.origin.clone(),
        id: Some(r.id),
        direction: r.direction.clone(),
        sii_type: r.sii_type,
        folio: r.folio.clone(),
        issue_date: r.issue_date.clone(),
        counterpart: match (&r.counterpart_name, &r.counterpart_rut) {
            (Some(n), _) => Some(n.clone()),
            (None, Some(rut)) => Some(rut.clone()),
            _ => None,
        },
        count: r.doc_count,
        exempt_minor: r.exempt_minor,
        net_minor: r.net_minor,
        tax_minor: r.tax_minor,
        tax_non_rec_minor: r.tax_non_rec_minor,
        common_use_tax_minor: r.common_use_tax_minor,
        kind: r.purchase_kind.clone(),
        not_of_business: r.not_of_business,
        reference: None,
    }
}

impl CompanySession {
    /* ───────────────────────────── perfil ───────────────────────────── */

    pub fn tax_profile(&self) -> AppResult<TaxProfile> {
        self.require("contabilidad.ver")?;
        self.load_tax_profile()
    }

    fn load_tax_profile(&self) -> AppResult<TaxProfile> {
        Ok(dbcore::get_setting(self.db.conn(), PROFILE_KEY)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn save_tax_profile(&mut self, p: &TaxProfile) -> AppResult<TaxProfile> {
        self.require("contabilidad.editar")?;
        if !REGIMES.contains(&p.regime.as_str()) {
            return Err(AppError::Validation("régimen tributario no válido".into()));
        }
        if p.ppm_rate_ppm.is_some_and(|v| !(0..=100_000).contains(&v)) {
            return Err(AppError::Validation(
                "la tasa de PPM debe estar entre 0 % y 10 %".into(),
            ));
        }
        if p.common_use_ppm
            .is_some_and(|v| !(0..=1_000_000).contains(&v))
        {
            return Err(AppError::Validation(
                "la proporción de uso común debe estar entre 0 % y 100 %".into(),
            ));
        }
        if p.utm_decimals.is_some_and(|d| d > 6)
            || p.due_day.is_some_and(|d| !(1..=28).contains(&d))
        {
            return Err(AppError::Validation(
                "revisa los decimales de UTM (0 a 6) y el día de vencimiento (1 a 28)".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        dbcore::set_setting(
            &tx,
            PROFILE_KEY,
            &serde_json::to_value(p).unwrap_or_default(),
        )?;
        log(
            &tx,
            &user,
            "impuestos.perfil",
            "impuestos",
            "perfil",
            "Actualizó la configuración tributaria",
            None,
        )?;
        tx.commit()?;
        self.load_tax_profile()
    }

    /* ───────────────────────────── borrador ───────────────────────────── */

    pub fn f29(&self, period: &str) -> AppResult<F29View> {
        self.require("contabilidad.ver")?;
        let period = check_period(period)?;
        self.build_f29(&period)
    }

    fn nucleo_docs(
        &self,
        period: &str,
        docs: &mut Vec<(TaxDoc, DocLine)>,
        checks: &mut Vec<Note>,
        want_sales: bool,
        want_purchases: bool,
    ) -> AppResult<()> {
        let conn = self.db.conn();
        let (from, to) = range(period);
        let mut check = |severity: Severity, text: String| {
            checks.push(Note {
                code: None,
                severity,
                text,
            })
        };
        if want_sales {
            let mut pending = (0i64, 0i64);
            let mut voided = 0i64;
            for s in db::sales_for_tax(conn, &from, &to)? {
                if s.commercial_state == "anulada" {
                    if s.documentation_state == "documentada" {
                        voided += 1;
                    }
                    continue;
                }
                match s.documentation_state.as_str() {
                    "pendiente" => {
                        pending.0 += 1;
                        pending.1 += s.total_minor;
                        continue;
                    }
                    "documentada" => {}
                    _ => continue,
                }
                let (Some(net), Some(ex), Some(tax)) = (
                    clp(s.net_minor, &s.currency_code, s.rate_e6),
                    clp(s.exempt_minor, &s.currency_code, s.rate_e6),
                    clp(s.tax_minor, &s.currency_code, s.rate_e6),
                ) else {
                    check(
                        Severity::Aviso,
                        format!(
                            "La venta {} está en {} sin tipo de cambio: no se incluyó.",
                            s.number, s.currency_code
                        ),
                    );
                    continue;
                };
                let t = if s.doc_type == "DEV" {
                    Some(61)
                } else {
                    sii_type_from_text(s.doc_kind.as_deref(), tax, ex)
                };
                let Some(t) = t else { continue };
                let doc = TaxDoc {
                    direction: Direction::Venta,
                    sii_type: t,
                    count: 1,
                    exempt: ex,
                    net,
                    tax,
                    tax_non_recoverable: 0,
                    common_use_tax: 0,
                    kind: None,
                    not_of_business: false,
                };
                docs.push((
                    doc,
                    DocLine {
                        origin: "nucleo".into(),
                        id: None,
                        direction: "venta".into(),
                        sii_type: t,
                        folio: s.external_number.clone(),
                        issue_date: Some(s.date.clone()),
                        counterpart: s.customer_name.clone().or(s.customer_rut.clone()),
                        count: 1,
                        exempt_minor: ex,
                        net_minor: net,
                        tax_minor: tax,
                        tax_non_rec_minor: 0,
                        common_use_tax_minor: 0,
                        kind: None,
                        not_of_business: false,
                        reference: Some(s.number.clone()),
                    },
                ));
            }
            if pending.0 > 0 {
                check(
                    Severity::Aviso,
                    format!(
                        "{} venta(s) del mes por {} siguen sin documentar: no entran al borrador hasta que anotes su factura o boleta.",
                        pending.0,
                        money(pending.1)
                    ),
                );
            }
            if voided > 0 {
                check(
                    Severity::Aviso,
                    format!(
                        "{voided} venta(s) documentada(s) se anularon: si emitiste la factura o boleta, regístrala con su nota de crédito."
                    ),
                );
            }
        }
        if want_purchases {
            for p in db::purchases_for_tax(conn, &from, &to)? {
                let (Some(net), Some(ex), Some(tax)) = (
                    clp(p.net_minor, &p.currency_code, p.rate_e6),
                    clp(p.exempt_minor, &p.currency_code, p.rate_e6),
                    clp(p.tax_minor, &p.currency_code, p.rate_e6),
                ) else {
                    check(
                        Severity::Aviso,
                        format!(
                            "La compra {} está en {} sin tipo de cambio: no se incluyó.",
                            p.number, p.currency_code
                        ),
                    );
                    continue;
                };
                let Some(t) = sii_type_from_text(p.doc_kind.as_deref(), tax, ex) else {
                    continue;
                };
                if p.currency_code != "CLP" {
                    check(
                        Severity::Info,
                        format!(
                            "La compra {} es en {}: las compras al extranjero no llevan IVA en el F29 salvo la declaración de ingreso.",
                            p.number, p.currency_code
                        ),
                    );
                    continue;
                }
                docs.push((
                    TaxDoc {
                        direction: Direction::Compra,
                        sii_type: t,
                        count: 1,
                        exempt: ex,
                        net,
                        tax,
                        tax_non_recoverable: 0,
                        common_use_tax: 0,
                        kind: Some(PurchaseKind::Giro),
                        not_of_business: false,
                    },
                    DocLine {
                        origin: "nucleo".into(),
                        id: None,
                        direction: "compra".into(),
                        sii_type: t,
                        folio: p.doc_number.clone(),
                        issue_date: Some(p.date.clone()),
                        counterpart: Some(p.supplier_name.clone()),
                        count: 1,
                        exempt_minor: ex,
                        net_minor: net,
                        tax_minor: tax,
                        tax_non_rec_minor: 0,
                        common_use_tax_minor: 0,
                        kind: Some("giro".into()),
                        not_of_business: false,
                        reference: Some(p.number.clone()),
                    },
                ));
            }
            let expenses = db::expenses_for_tax(conn, &from, &to)?;
            if !expenses.is_empty() {
                check(
                    Severity::Aviso,
                    format!(
                        "{} gasto(s) con IVA se tomaron como facturas del giro. Si alguno se pagó con boleta, su IVA no da crédito: importa el registro de compras del SII para usar lo que realmente recibiste.",
                        expenses.len()
                    ),
                );
            }
            for e in expenses {
                docs.push((
                    TaxDoc {
                        direction: Direction::Compra,
                        sii_type: 33,
                        count: 1,
                        exempt: 0,
                        net: e.net_minor,
                        tax: e.tax_minor,
                        tax_non_recoverable: 0,
                        common_use_tax: 0,
                        kind: Some(PurchaseKind::Giro),
                        not_of_business: false,
                    },
                    DocLine {
                        origin: "nucleo".into(),
                        id: None,
                        direction: "compra".into(),
                        sii_type: 33,
                        folio: None,
                        issue_date: Some(e.date.clone()),
                        counterpart: e.supplier_name.clone().or(Some(e.description.clone())),
                        count: 1,
                        exempt_minor: 0,
                        net_minor: e.net_minor,
                        tax_minor: e.tax_minor,
                        tax_non_rec_minor: 0,
                        common_use_tax_minor: 0,
                        kind: Some("giro".into()),
                        not_of_business: false,
                        reference: Some(e.number.clone()),
                    },
                ));
            }
            // IVA de importación: solo el real (de la declaración de ingreso).
            let mut din: BTreeMap<String, (TaxDoc, DocLine)> = BTreeMap::new();
            let mut estimated = 0i64;
            for v in db::import_vat_for_tax(conn, &from, &to)? {
                if v.is_estimate {
                    estimated += 1;
                    continue;
                }
                let Some(amount) = clp(v.amount_minor, &v.currency_code, v.rate_e6) else {
                    continue;
                };
                let key = v
                    .document_ref
                    .clone()
                    .unwrap_or_else(|| format!("{}·{}", v.import_number, v.date));
                let kind = if v.recoverable {
                    PurchaseKind::Giro
                } else {
                    PurchaseKind::SinDerecho
                };
                let e = din.entry(key.clone()).or_insert_with(|| {
                    (
                        TaxDoc {
                            direction: Direction::Compra,
                            sii_type: 914,
                            count: 1,
                            exempt: 0,
                            net: 0,
                            tax: 0,
                            tax_non_recoverable: 0,
                            common_use_tax: 0,
                            kind: Some(kind),
                            not_of_business: false,
                        },
                        DocLine {
                            origin: "nucleo".into(),
                            id: None,
                            direction: "compra".into(),
                            sii_type: 914,
                            folio: v.document_ref.clone(),
                            issue_date: Some(v.date.clone()),
                            counterpart: Some("Servicio Nacional de Aduanas".into()),
                            count: 1,
                            exempt_minor: 0,
                            net_minor: 0,
                            tax_minor: 0,
                            tax_non_rec_minor: 0,
                            common_use_tax_minor: 0,
                            kind: Some(if v.recoverable { "giro" } else { "sin_derecho" }.into()),
                            not_of_business: false,
                            reference: Some(v.import_number.clone()),
                        },
                    )
                });
                if v.recoverable {
                    e.0.tax += amount;
                    e.1.tax_minor += amount;
                } else {
                    e.0.tax_non_recoverable += amount;
                    e.1.tax_non_rec_minor += amount;
                }
                if v.document_ref.is_none() {
                    check(
                        Severity::Aviso,
                        format!(
                            "El IVA de importación de {} no tiene número de declaración de ingreso: agrégalo en la carpeta.",
                            v.import_number
                        ),
                    );
                }
            }
            docs.extend(din.into_values());
            if estimated > 0 {
                check(
                    Severity::Aviso,
                    format!(
                        "{estimated} IVA de importación del mes todavía es estimado: no entra al borrador hasta que ingreses el monto real de la declaración de ingreso."
                    ),
                );
            }
        }
        Ok(())
    }

    fn build_f29(&self, period: &str) -> AppResult<F29View> {
        let conn = self.db.conn();
        let profile = self.load_tax_profile()?;
        let row = db::f29_row(conn, period)?;
        let inputs: F29Inputs = row
            .as_ref()
            .and_then(|r| serde_json::from_str(&r.inputs_json).ok())
            .unwrap_or_default();
        let batches = db::batches(conn, period)?;
        let rows = db::tax_documents(conn, period)?;
        let mut checks: Vec<Note> = Vec::new();
        let mut docs: Vec<(TaxDoc, DocLine)> = Vec::new();
        let mut sources = Vec::new();
        let mut use_nucleo = (false, false);
        for dir in ["venta", "compra"] {
            let b: Vec<_> = batches.iter().filter(|b| b.direction == dir).collect();
            if let Some(last) = b.last() {
                sources.push(F29Source {
                    direction: dir.into(),
                    source: "rcv".into(),
                    file_name: last.file_name.clone(),
                    imported_at: Some(last.imported_at.clone()),
                    rows: b.iter().map(|x| x.row_count).sum(),
                });
            } else {
                sources.push(F29Source {
                    direction: dir.into(),
                    source: "nucleo".into(),
                    file_name: None,
                    imported_at: None,
                    rows: 0,
                });
                if dir == "venta" {
                    use_nucleo.0 = true;
                } else {
                    use_nucleo.1 = true;
                }
            }
        }
        for r in &rows {
            let direction = if r.direction == "venta" {
                Direction::Venta
            } else {
                Direction::Compra
            };
            docs.push((
                TaxDoc {
                    direction,
                    sii_type: r.sii_type,
                    count: r.doc_count,
                    exempt: r.exempt_minor,
                    net: r.net_minor,
                    tax: r.tax_minor,
                    tax_non_recoverable: r.tax_non_rec_minor,
                    common_use_tax: r.common_use_tax_minor,
                    kind: r.purchase_kind.as_deref().and_then(kind_of),
                    not_of_business: r.not_of_business,
                },
                line_from_row(r),
            ));
        }
        self.nucleo_docs(period, &mut docs, &mut checks, use_nucleo.0, use_nucleo.1)?;
        if use_nucleo.0 || use_nucleo.1 {
            checks.push(Note {
                code: None,
                severity: Severity::Info,
                text: "Parte del borrador usa los datos de NÚCLEO. Para que coincida con sii.cl, importa el Registro de Compras y Ventas del mes.".into(),
            });
        }

        // Remanente sugerido: el F29 del mes anterior marcado como declarado en NÚCLEO.
        let prev = shift(period, -1);
        let prev_row = db::f29_row(conn, &prev)?.filter(|r| r.status == "declarado");
        let remnant_suggested = prev_row.as_ref().and_then(|r| r.declared_77);
        let remnant_amount = inputs.remnant_amount.or(remnant_suggested).unwrap_or(0);
        let input = F29Input {
            docs: docs.iter().map(|d| d.0.clone()).collect(),
            remnant: (remnant_amount > 0).then(|| Remnant {
                amount: remnant_amount,
                utm_prev: inputs.utm_prev.unwrap_or(0),
                utm_cur: inputs.utm_cur.unwrap_or(0),
                utm_decimals: profile.utm_decimals,
            }),
            ppm: profile.ppm_rate_ppm.map(|rate| Ppm {
                rate_ppm: rate,
                credit: inputs.ppm_credit,
                loss: inputs.ppm_loss,
                base_override: inputs.ppm_base_override,
            }),
            common_use_ppm: inputs.common_use_ppm.or(profile.common_use_ppm),
            manual: inputs
                .manual
                .iter()
                .filter_map(|(k, v)| k.parse::<u32>().ok().map(|c| (c, *v)))
                .collect(),
        };
        let result = compute(&input);
        let declared = row
            .as_ref()
            .filter(|r| r.status == "declarado")
            .map(|r| F29Declared {
                declared_77: r.declared_77.unwrap_or(0),
                declared_91: r.declared_91.unwrap_or(0),
                folio: r.declared_folio.clone(),
                at: r.declared_at.clone(),
            });
        let due_date = profile
            .due_day
            .map(|d| format!("{}-{d:02}", shift(period, 1)));
        let periods = db::f29_statuses(conn)?
            .into_iter()
            .map(|(period, status, declared_91)| F29PeriodSummary {
                period,
                status,
                declared_91,
            })
            .collect();
        Ok(F29View {
            period: period.to_string(),
            status: row
                .as_ref()
                .map(|r| r.status.clone())
                .unwrap_or_else(|| "borrador".into()),
            profile,
            inputs,
            remnant_suggested,
            remnant_from: remnant_suggested.map(|_| prev),
            sources,
            docs: docs.into_iter().map(|d| d.1).collect(),
            result,
            checks,
            declared,
            due_date,
            periods,
        })
    }

    fn require_open(&self, period: &str) -> AppResult<()> {
        if db::f29_row(self.db.conn(), period)?.is_some_and(|r| r.status == "declarado") {
            return Err(AppError::Validation(
                "este F29 está marcado como declarado: reábrelo para cambiarlo".into(),
            ));
        }
        Ok(())
    }

    pub fn save_f29_inputs(&mut self, period: &str, inputs: &F29Inputs) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        self.require_open(&period)?;
        let money_ok = |v: i64| (0..=1_000_000_000_000).contains(&v);
        if inputs.remnant_amount.is_some_and(|v| !money_ok(v))
            || inputs
                .utm_prev
                .is_some_and(|v| !(1..=10_000_000).contains(&v))
            || inputs
                .utm_cur
                .is_some_and(|v| !(1..=10_000_000).contains(&v))
            || !money_ok(inputs.ppm_credit)
            || inputs.ppm_base_override.is_some_and(|v| !money_ok(v))
            || inputs
                .common_use_ppm
                .is_some_and(|v| !(0..=1_000_000).contains(&v))
        {
            return Err(AppError::Validation("revisa los montos ingresados".into()));
        }
        for (k, v) in &inputs.manual {
            let code: u32 = k
                .parse()
                .map_err(|_| AppError::Validation(format!("código {k} no válido")))?;
            if !MANUAL_CODES.contains(&code) {
                return Err(AppError::Validation(format!(
                    "el código {code} no se ingresa a mano"
                )));
            }
            if !money_ok(*v) {
                return Err(AppError::Validation(format!(
                    "revisa el monto del código {code}"
                )));
            }
        }
        let json = serde_json::to_string(inputs).unwrap_or_else(|_| "{}".into());
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::save_f29_inputs(&tx, &period, &json, &now_utc())?;
        log(
            &tx,
            &user,
            "f29.datos",
            "f29",
            &period,
            "Actualizó los datos del borrador del F29",
            None,
        )?;
        tx.commit()?;
        self.build_f29(&period)
    }

    /// Importa el Registro de Compras o de Ventas del SII (CSV) y reemplaza el importado antes.
    pub fn import_rcv(
        &mut self,
        period: &str,
        direction: &str,
        file_name: Option<&str>,
        text: &str,
    ) -> AppResult<RcvImportReport> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        self.require_open(&period)?;
        if !matches!(direction, "venta" | "compra") {
            return Err(AppError::Validation(
                "indica si es el registro de compras o de ventas".into(),
            ));
        }
        if text.len() > 20_000_000 {
            return Err(AppError::Validation(
                "el archivo es demasiado grande".into(),
            ));
        }
        let parsed = rcv::parse(text).map_err(|e| AppError::Validation(e.to_string()))?;
        if parsed.rows.is_empty() {
            return Err(AppError::Validation(
                "el archivo no tiene documentos".into(),
            ));
        }
        let (from, to) = range(&period);
        let other_period = parsed
            .rows
            .iter()
            .filter(|r| {
                r.issue_date
                    .as_deref()
                    .is_some_and(|d| d < from.as_str() || d > to.as_str())
            })
            .count();
        let now = now_utc();
        let user = self.actor_name()?;
        let user_id = self.user_id();
        let tx = self.db.conn_mut().transaction()?;
        db::delete_batches(&tx, &period, direction)?;
        let batch = db::insert_batch(
            &tx,
            &period,
            direction,
            file_name,
            parsed.rows.len() as i64,
            user_id,
            &now,
        )?;
        for r in &parsed.rows {
            let kind = (direction == "compra").then(|| rcv::purchase_kind(r));
            db::insert_tax_document(
                &tx,
                &TaxDocWrite {
                    period: &period,
                    direction,
                    sii_type: r.sii_type,
                    folio: r.folio.as_deref(),
                    issue_date: r.issue_date.as_deref(),
                    counterpart_rut: r.counterpart_rut.as_deref(),
                    counterpart_name: r.counterpart_name.as_deref(),
                    doc_count: r.count,
                    exempt_minor: r.exempt,
                    net_minor: r.net,
                    tax_minor: r.tax,
                    tax_non_rec_minor: r.tax_non_recoverable,
                    common_use_tax_minor: r.common_use_tax,
                    total_minor: r.total,
                    purchase_kind: kind,
                    not_of_business: direction == "venta" && rcv::sale_not_of_business(r),
                    origin: "rcv",
                    batch_id: Some(batch),
                    note: None,
                },
                &now,
            )?;
        }
        let what = if direction == "venta" {
            "ventas"
        } else {
            "compras"
        };
        log(
            &tx,
            &user,
            "f29.importar",
            "f29",
            &period,
            &format!(
                "Importó el registro de {what} del SII ({} documentos{})",
                parsed.rows.len(),
                file_name.map(|f| format!(", {f}")).unwrap_or_default()
            ),
            None,
        )?;
        tx.commit()?;
        Ok(RcvImportReport {
            rows: parsed.rows.len(),
            skipped: parsed
                .skipped
                .iter()
                .map(|(n, m)| format!("Línea {n}: {m}"))
                .collect(),
            other_period,
            view: self.build_f29(&period)?,
        })
    }

    /// Quita el registro importado de un período: el borrador vuelve a los datos de NÚCLEO.
    pub fn clear_rcv(&mut self, period: &str, direction: &str) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        self.require_open(&period)?;
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::delete_batches(&tx, &period, direction)?;
        log(
            &tx,
            &user,
            "f29.quitar_registro",
            "f29",
            &period,
            &format!(
                "Quitó el registro de {} importado",
                if direction == "venta" {
                    "ventas"
                } else {
                    "compras"
                }
            ),
            None,
        )?;
        tx.commit()?;
        self.build_f29(&period)
    }

    pub fn add_tax_document(&mut self, period: &str, d: &TaxDocInput) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        self.require_open(&period)?;
        if !matches!(d.direction.as_str(), "venta" | "compra")
            || d.sii_type == 0
            || d.sii_type > 999
        {
            return Err(AppError::Validation("revisa el tipo de documento".into()));
        }
        let kind = match d.purchase_kind.as_deref().filter(|k| !k.is_empty()) {
            Some(k) if KINDS.contains(&k) => Some(k.to_string()),
            Some(_) => {
                return Err(AppError::Validation(
                    "clasificación de compra no válida".into(),
                ));
            }
            None => None,
        };
        let count = d.doc_count.unwrap_or(1);
        let lim = |v: i64| (-1_000_000_000_000..=1_000_000_000_000).contains(&v);
        if !(1..=1_000_000).contains(&count)
            || !lim(d.net_minor)
            || !lim(d.exempt_minor)
            || !lim(d.tax_minor)
        {
            return Err(AppError::Validation(
                "revisa la cantidad y los montos".into(),
            ));
        }
        let date = match d.issue_date.as_deref().filter(|s| !s.is_empty()) {
            Some(s) => Some(parse_date("la fecha", s)?),
            None => None,
        };
        let folio = opt_text(&d.folio, 20, "el folio")?;
        let rut = opt_text(&d.counterpart_rut, 12, "el RUT")?;
        let name = opt_text(&d.counterpart_name, 100, "la razón social")?;
        let note = opt_text(&d.note, 300, "la nota")?;
        let now = now_utc();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::insert_tax_document(
            &tx,
            &TaxDocWrite {
                period: &period,
                direction: &d.direction,
                sii_type: d.sii_type,
                folio: folio.as_deref(),
                issue_date: date.as_deref(),
                counterpart_rut: rut.as_deref(),
                counterpart_name: name.as_deref(),
                doc_count: count,
                exempt_minor: d.exempt_minor,
                net_minor: d.net_minor,
                tax_minor: d.tax_minor,
                tax_non_rec_minor: 0,
                common_use_tax_minor: 0,
                total_minor: d.exempt_minor + d.net_minor + d.tax_minor,
                purchase_kind: kind.as_deref(),
                not_of_business: d.not_of_business,
                origin: "manual",
                batch_id: None,
                note: note.as_deref(),
            },
            &now,
        )?;
        log(
            &tx,
            &user,
            "f29.documento",
            "f29",
            &period,
            &format!("Agregó un documento tipo {} a mano", d.sii_type),
            None,
        )?;
        tx.commit()?;
        self.build_f29(&period)
    }

    pub fn delete_tax_document(&mut self, id: i64) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let r = db::tax_document(self.db.conn(), id)?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        self.require_open(&r.period)?;
        if r.origin != "manual" {
            return Err(AppError::Validation(
                "solo se quitan documentos ingresados a mano; para el registro del SII, vuelve a importarlo".into(),
            ));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::delete_tax_document(&tx, id)?;
        log(
            &tx,
            &user,
            "f29.documento_quitar",
            "f29",
            &r.period,
            &format!("Quitó un documento tipo {} ingresado a mano", r.sii_type),
            None,
        )?;
        tx.commit()?;
        self.build_f29(&r.period)
    }

    /// Cambia la clasificación de una compra del registro (giro, activo fijo, sin derecho…).
    pub fn set_tax_document_kind(&mut self, id: i64, kind: &str) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let r = db::tax_document(self.db.conn(), id)?
            .ok_or_else(|| AppError::NotFound("el documento".into()))?;
        self.require_open(&r.period)?;
        if r.direction != "compra" || !KINDS.contains(&kind) {
            return Err(AppError::Validation("clasificación no válida".into()));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::set_purchase_kind(&tx, id, Some(kind))?;
        log(
            &tx,
            &user,
            "f29.clasificar",
            "f29",
            &r.period,
            &format!(
                "Clasificó la compra folio {} como {kind}",
                r.folio.as_deref().unwrap_or("s/n")
            ),
            None,
        )?;
        tx.commit()?;
        self.build_f29(&r.period)
    }

    /// Registra lo que la persona declaró en sii.cl (no envía nada).
    pub fn mark_f29_declared(
        &mut self,
        period: &str,
        declared_77: i64,
        declared_91: i64,
        folio: Option<String>,
    ) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        self.require_open(&period)?;
        if !(0..=1_000_000_000_000).contains(&declared_77)
            || !(0..=1_000_000_000_000).contains(&declared_91)
        {
            return Err(AppError::Validation("revisa los montos declarados".into()));
        }
        let folio = opt_text(&folio, 30, "el folio")?;
        let view = self.build_f29(&period)?;
        let snapshot =
            serde_json::json!({ "codes": view.result.codes, "sources": view.sources }).to_string();
        let now = now_utc();
        let user = self.actor_name()?;
        let user_id = self.user_id();
        let tx = self.db.conn_mut().transaction()?;
        db::mark_f29_declared(
            &tx,
            &period,
            &snapshot,
            declared_77,
            declared_91,
            folio.as_deref(),
            user_id,
            &now,
        )?;
        let diff = declared_91 - view.result.codes.get(&91).copied().unwrap_or(0);
        let mut text = format!(
            "Marcó el F29 como declarado: total {} · remanente {}",
            money(declared_91),
            money(declared_77)
        );
        if diff != 0 {
            text.push_str(&format!(" · difiere del borrador en {}", money(diff)));
        }
        log(&tx, &user, "f29.declarar", "f29", &period, &text, None)?;
        tx.commit()?;
        self.build_f29(&period)
    }

    pub fn reopen_f29(&mut self, period: &str, reason: &str) -> AppResult<F29View> {
        self.require("contabilidad.editar")?;
        let period = check_period(period)?;
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(AppError::Validation("indica por qué se reabre".into()));
        }
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        db::reopen_f29(&tx, &period, &now_utc())?;
        log(
            &tx,
            &user,
            "f29.reabrir",
            "f29",
            &period,
            "Reabrió el F29",
            Some(reason),
        )?;
        tx.commit()?;
        self.build_f29(&period)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn periodos() {
        assert_eq!(shift("2026-01", -1), "2025-12");
        assert_eq!(shift("2026-12", 1), "2027-01");
        assert_eq!(range("2028-02"), ("2028-02-01".into(), "2028-02-29".into()));
        assert!(check_period("2026-13").is_err());
        assert!(check_period("2026-09").is_ok());
    }

    #[test]
    fn tipo_desde_texto() {
        assert_eq!(sii_type_from_text(Some("Factura"), 19, 0), Some(33));
        assert_eq!(sii_type_from_text(Some("Factura exenta"), 0, 100), Some(34));
        assert_eq!(sii_type_from_text(Some("Boleta"), 19, 0), Some(39));
        assert_eq!(sii_type_from_text(Some("Nota de crédito"), 19, 0), Some(61));
        assert_eq!(sii_type_from_text(Some("Guía de despacho"), 19, 0), None);
        assert_eq!(sii_type_from_text(None, 0, 500), Some(34));
        assert_eq!(money(1_234_567), "$1.234.567");
        assert_eq!(money(-500), "−$500");
    }
}
