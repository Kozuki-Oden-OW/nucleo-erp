//! Partir con los datos reales del SII: una empresa nueva ve sus ventas y compras en minutos, sin
//! entregar ninguna clave.
//!
//! La persona descarga del SII su Registro de Compras y Ventas (un archivo CSV por mes y por
//! registro) y suelta aquí todos los archivos juntos. NÚCLEO reconoce de cada uno si es de compras o
//! de ventas y su período, y con eso:
//!
//! * deja cargado el registro de cada mes (la base del F29);
//! * crea los clientes y proveedores que aún no existen, con su RUT y razón social;
//! * anota cada factura o boleta de venta como **venta histórica**: aparece en los informes y en la
//!   ficha del cliente, pero no mueve stock ni dinero.
//!
//! Se puede repetir: lo que ya estaba no se duplica. Las notas de crédito no se convierten en ventas
//! (el registro no dice qué factura corrigen); se informan aparte.

use crate::company::CompanySession;
use crate::history_ops::{HistoricalCustomer, HistoricalLine, HistoricalSale, MAX_BATCH};
use crate::purchase_ops::NewSupplier;
use crate::{AppError, AppResult};
use nucleo_io::rcv::{self, RcvRow};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

const MAX_FILES: usize = 60;

#[derive(Debug, Clone, Deserialize)]
pub struct StartFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartFileReport {
    pub name: String,
    /// "venta" o "compra".
    pub direction: Option<String>,
    /// AAAA-MM.
    pub period: Option<String>,
    pub documents: usize,
    pub total_minor: i64,
    /// "ok" o "error".
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StartReport {
    pub files: Vec<StartFileReport>,
    pub periods: Vec<String>,
    pub sales_docs: usize,
    pub sales_total_minor: i64,
    pub purchases_docs: usize,
    pub purchases_total_minor: i64,
    /// Ventas históricas anotadas ahora, las que ya estaban y las que no se pudieron anotar.
    pub sales_imported: usize,
    pub sales_existing: usize,
    pub sales_errors: usize,
    pub customers_created: usize,
    pub suppliers_created: usize,
    pub credit_notes: usize,
    pub credit_notes_minor: i64,
    pub notes: Vec<String>,
}

/// Nombre del documento de venta según el código del SII (None: no es una venta que se anote).
pub fn sale_kind(sii_type: u32) -> Option<&'static str> {
    Some(match sii_type {
        30 => "Factura",
        32 => "Factura exenta",
        33 => "Factura electrónica",
        34 => "Factura exenta electrónica",
        35 => "Boleta",
        38 => "Boleta exenta",
        39 => "Boleta electrónica",
        41 => "Boleta exenta electrónica",
        48 => "Comprobante de pago electrónico",
        110 => "Factura de exportación electrónica",
        _ => return None,
    })
}

/// ¿Compras o ventas? Primero por el nombre del archivo, después por las columnas.
pub fn detect_direction(name: &str, text: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if n.contains("venta") {
        return Some("venta");
    }
    if n.contains("compra") {
        return Some("compra");
    }
    let header: String = text
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    if header.contains("rutcliente") || header.contains("tipoventa") {
        Some("venta")
    } else if header.contains("rutproveedor") || header.contains("tipocompra") {
        Some("compra")
    } else {
        None
    }
}

/// Período AAAA-MM: seis dígitos seguidos en el nombre («…_202610.csv») o, si no, el mes con más
/// documentos.
pub fn detect_period(name: &str, rows: &[RcvRow]) -> Option<String> {
    let digits: Vec<(usize, char)> = name.char_indices().collect();
    let mut run = String::new();
    let mut runs: Vec<String> = Vec::new();
    for (_, c) in digits {
        if c.is_ascii_digit() {
            run.push(c);
        } else if !run.is_empty() {
            runs.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        runs.push(run);
    }
    for r in runs.iter().filter(|r| r.len() == 6) {
        let (y, m): (u32, u32) = (r[..4].parse().unwrap_or(0), r[4..].parse().unwrap_or(0));
        if (2000..=2200).contains(&y) && (1..=12).contains(&m) {
            return Some(format!("{y:04}-{m:02}"));
        }
    }
    let mut count: HashMap<&str, usize> = HashMap::new();
    for d in rows.iter().filter_map(|r| r.issue_date.as_deref()) {
        if let Some(ym) = d.get(..7) {
            *count.entry(ym).or_default() += 1;
        }
    }
    count
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(b.0)))
        .map(|(ym, _)| ym.to_string())
}

fn historical(row: &RcvRow, kind: &str, period: &str) -> Option<HistoricalSale> {
    let date = row.issue_date.clone()?;
    if row.total <= 0 {
        return None;
    }
    // Lo que no es neto, exento ni IVA (otros impuestos, retenciones) no se puede anotar con exactitud.
    if (row.net + row.exempt + row.tax - row.total).abs() > 5 {
        return None;
    }
    let summary = row.count > 1 || row.folio.is_none();
    let number = match (&row.folio, summary) {
        (Some(f), false) => f.clone(),
        (Some(f), true) => format!("{f} ({} documentos)", row.count),
        (None, _) => format!("{period}-{}-{date}", row.sii_type),
    };
    let mut lines = Vec::new();
    if row.net > 0 {
        lines.push(HistoricalLine {
            product_sku: None,
            description: if summary {
                format!("{kind}: {} documentos", row.count)
            } else {
                "Venta según el registro del SII".into()
            },
            qty_milli: 1000,
            unit_price_minor: row.net,
            net_minor: row.net,
            taxable: true,
        });
    }
    if row.exempt > 0 {
        lines.push(HistoricalLine {
            product_sku: None,
            description: "Venta exenta según el registro del SII".into(),
            qty_milli: 1000,
            unit_price_minor: row.exempt,
            net_minor: row.exempt,
            taxable: false,
        });
    }
    if lines.is_empty() {
        return None;
    }
    let customer = match (&row.counterpart_name, summary) {
        (Some(name), false) if !name.trim().is_empty() => Some(HistoricalCustomer {
            name: name.trim().to_string(),
            rut: row.counterpart_rut.clone(),
            ..Default::default()
        }),
        _ => None,
    };
    Some(HistoricalSale {
        doc_kind: kind.to_string(),
        number,
        issue_date: date,
        customer,
        lines,
        net_minor: row.net,
        exempt_minor: row.exempt,
        tax_minor: row.tax,
        total_minor: row.total,
        payment_terms: None,
        references: None,
        void_reason: None,
        documented: true,
        notes: Some("Tomada del Registro de Ventas del SII (sin el detalle de productos).".into()),
        due_date: None,
        terms: None,
    })
}

impl CompanySession {
    /// Carga de una vez los registros de compras y ventas descargados del SII.
    pub fn sii_start_import(&mut self, files: &[StartFile]) -> AppResult<StartReport> {
        self.require("contabilidad.editar")?;
        self.require("ventas.crear")?;
        self.require("ventas.documentar")?;
        if files.is_empty() {
            return Err(AppError::Validation(
                "elige los archivos del Registro de Compras y Ventas que descargaste del SII"
                    .into(),
            ));
        }
        if files.len() > MAX_FILES {
            return Err(AppError::Validation(format!(
                "hasta {MAX_FILES} archivos por vez"
            )));
        }
        let can_suppliers = self.can("proveedores.editar");
        let mut rep = StartReport::default();
        let mut periods: BTreeSet<String> = BTreeSet::new();
        let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
        let mut sales: Vec<HistoricalSale> = Vec::new();
        let mut suppliers: HashMap<String, String> = HashMap::new();
        let mut uncounted = 0usize;

        for f in files {
            let name: String = f.name.trim().chars().take(200).collect();
            let fail = |msg: String| StartFileReport {
                name: name.clone(),
                direction: None,
                period: None,
                documents: 0,
                total_minor: 0,
                status: "error".into(),
                message: Some(msg),
            };
            let parsed = match rcv::parse(&f.text) {
                Ok(p) if !p.rows.is_empty() => p,
                Ok(_) => {
                    rep.files
                        .push(fail("el archivo no tiene documentos".into()));
                    continue;
                }
                Err(e) => {
                    rep.files.push(fail(e.to_string()));
                    continue;
                }
            };
            let Some(direction) = detect_direction(&name, &f.text) else {
                rep.files.push(fail(
                    "no se reconoce si es el registro de compras o el de ventas: el nombre del archivo debe decir «COMPRA» o «VENTA», como lo entrega el SII".into(),
                ));
                continue;
            };
            let Some(period) = detect_period(&name, &parsed.rows) else {
                rep.files
                    .push(fail("no se pudo saber de qué mes es el archivo".into()));
                continue;
            };
            if !seen.insert((period.clone(), direction.to_string())) {
                rep.files.push(fail(format!(
                    "ya venía otro archivo de {} de {period}: se usó el primero",
                    if direction == "venta" {
                        "ventas"
                    } else {
                        "compras"
                    }
                )));
                continue;
            }
            if let Err(e) = self.import_rcv(&period, direction, Some(&name), &f.text) {
                rep.files.push(StartFileReport {
                    direction: Some(direction.into()),
                    period: Some(period),
                    ..fail(e.to_string())
                });
                continue;
            }
            // Las notas de crédito restan; el resto suma.
            let signed = |r: &RcvRow| if r.sii_type == 61 { -r.total } else { r.total };
            let total: i64 = parsed.rows.iter().map(signed).sum();
            if direction == "venta" {
                rep.sales_docs += parsed.rows.len();
                rep.sales_total_minor += total;
                for r in &parsed.rows {
                    if r.sii_type == 61 {
                        rep.credit_notes += 1;
                        rep.credit_notes_minor += r.total;
                        continue;
                    }
                    match sale_kind(r.sii_type).and_then(|k| historical(r, k, &period)) {
                        Some(h) => sales.push(h),
                        None => uncounted += 1,
                    }
                }
            } else {
                rep.purchases_docs += parsed.rows.len();
                rep.purchases_total_minor += total;
                for r in &parsed.rows {
                    if let (Some(rut), Some(n)) = (&r.counterpart_rut, &r.counterpart_name)
                        && !n.trim().is_empty()
                    {
                        suppliers
                            .entry(rut.trim().to_string())
                            .or_insert_with(|| n.trim().to_string());
                    }
                }
            }
            periods.insert(period.clone());
            rep.files.push(StartFileReport {
                name: name.clone(),
                direction: Some(direction.into()),
                period: Some(period),
                documents: parsed.rows.len(),
                total_minor: total,
                status: "ok".into(),
                message: (!parsed.skipped.is_empty()).then(|| {
                    format!(
                        "{} fila(s) sin tipo de documento se omitieron",
                        parsed.skipped.len()
                    )
                }),
            });
        }

        // Ventas históricas, por tandas.
        let mut first_error: Option<String> = None;
        for chunk in sales.chunks(MAX_BATCH) {
            let r = self.import_historical_sales(chunk)?;
            rep.sales_imported += r.imported;
            rep.sales_existing += r.skipped + r.updated;
            rep.sales_errors += r.errors;
            rep.customers_created += r.customers_created;
            if first_error.is_none() {
                first_error =
                    r.results.iter().find(|x| x.status == "error").map(|x| {
                        format!("{}: {}", x.number, x.message.clone().unwrap_or_default())
                    });
            }
        }

        // Proveedores que aún no existen.
        if can_suppliers {
            for (rut, name) in suppliers {
                let Ok(parsed) = nucleo_domain::rut::Rut::parse(&rut) else {
                    continue;
                };
                let exists: Option<i64> = self
                    .db
                    .conn()
                    .query_row(
                        "SELECT id FROM suppliers WHERE rut = ?1",
                        [parsed.compact()],
                        |r| r.get(0),
                    )
                    .optional()?;
                if exists.is_some() {
                    continue;
                }
                if self
                    .add_supplier(&NewSupplier {
                        name: name.chars().take(120).collect(),
                        rut: Some(rut),
                        email: None,
                        phone: None,
                        payment_terms_days: None,
                    })
                    .is_ok()
                {
                    rep.suppliers_created += 1;
                }
            }
        } else if !suppliers.is_empty() {
            rep.notes.push(
                "Tu usuario no puede crear proveedores: quedaron solo en el registro de compras."
                    .into(),
            );
        }

        if rep.credit_notes > 0 {
            rep.notes.push(format!(
                "{} nota(s) de crédito por {} no se anotaron como ventas: el registro no dice qué factura corrigen. Si alguna anuló una factura, anula esa venta en NÚCLEO.",
                rep.credit_notes,
                crate::insight_ops::money(rep.credit_notes_minor)
            ));
        }
        if uncounted > 0 {
            rep.notes.push(format!(
                "{uncounted} documento(s) de venta quedaron solo en el registro del mes (notas de débito, documentos con otros impuestos o sin fecha)."
            ));
        }
        if let Some(e) = first_error {
            rep.notes.push(format!(
                "{} venta(s) no se pudieron anotar. La primera: {e}",
                rep.sales_errors
            ));
        }
        rep.periods = periods.into_iter().collect();
        Ok(rep)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_registro_y_periodo() {
        assert_eq!(
            detect_direction("RCV_VENTA_77334963-0_202610.csv", ""),
            Some("venta")
        );
        assert_eq!(
            detect_direction(
                "descarga.csv",
                "Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social"
            ),
            Some("compra")
        );
        assert_eq!(detect_direction("descarga.csv", "a;b;c"), None);
        assert_eq!(
            detect_period("RCV_VENTA_77334963-0_202610.csv", &[]).as_deref(),
            Some("2026-10")
        );
        // El RUT no se confunde con un período, y un «209913» tampoco.
        assert_eq!(detect_period("RCV_77334963_209913.csv", &[]), None);
        assert_eq!(sale_kind(33), Some("Factura electrónica"));
        assert_eq!(sale_kind(61), None);
    }
}
