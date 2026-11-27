//! Importar ventas históricas: documentos ya emitidos fuera de NÚCLEO (facturas, guías de despacho que
//! constituyen venta) para tener el historial de clientes, productos y ventas desde el primer día.
//!
//! Una venta histórica queda con su estado final (cerrada, o anulada si una nota de crédito la anuló),
//! anotada con su documento externo y marcada `historical`: **no mueve stock, no registra cobros y no
//! genera asientos contables**, porque el stock y el dinero de hoy ya están en NÚCLEO. Se puede
//! importar de nuevo sin duplicar: un documento que ya está anotado se omite.
//!
//! Excepción: una factura a crédito que todavía no se paga (trae `due_date`) queda **por cobrar**:
//! efectuada y documentada, con su vencimiento en cuentas por cobrar, para registrar el cobro cuando
//! llegue. Esa venta sí genera su asiento de venta (clientes contra ventas e IVA, sin costo porque no
//! movió stock), para que el cobro cuadre. Importar de nuevo un documento ya anotado con `due_date`
//! (o con condiciones nuevas) actualiza la venta histórica en vez de omitirla.

use crate::company::{CompanySession, NewCustomer};
use crate::sale_terms::SaleTerms;
use crate::sales_ops::log;
use crate::{AppError, AppResult};
use nucleo_db::customers::CustomerProfile;
use nucleo_db::now_utc;
use nucleo_db::sales::{self as db, ExternalRefRow, HistoricalWrite, NewLine, Totals};
use nucleo_domain::rut::Rut;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

/// Máximo de documentos por llamada (se importa en tandas).
pub const MAX_BATCH: usize = 100;
/// Diferencia tolerada entre la suma de las líneas y el neto del documento (redondeos por línea).
const TOLERANCE_MINOR: i64 = 5;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct HistoricalCustomer {
    pub name: String,
    pub rut: Option<String>,
    /// Giro.
    pub business_activity: Option<String>,
    pub address: Option<String>,
    pub commune: Option<String>,
    pub city: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HistoricalLine {
    /// SKU de un producto de NÚCLEO (opcional): la línea queda enlazada para los análisis.
    pub product_sku: Option<String>,
    pub description: String,
    pub qty_milli: i64,
    pub unit_price_minor: i64,
    /// Valor neto de la línea tal como figura en el documento.
    pub net_minor: i64,
    #[serde(default = "yes")]
    pub taxable: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct HistoricalSale {
    /// Ej. «Factura electrónica», «Guía de despacho».
    pub doc_kind: String,
    /// Folio del documento.
    pub number: String,
    pub issue_date: String,
    pub customer: Option<HistoricalCustomer>,
    pub lines: Vec<HistoricalLine>,
    pub net_minor: i64,
    #[serde(default)]
    pub exempt_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    /// «Contado», «Crédito»…
    pub payment_terms: Option<String>,
    /// Referencias del documento (orden de compra, HES, guía…).
    pub references: Option<String>,
    /// Si tiene valor, la venta queda anulada con este motivo (ej. nota de crédito que la anuló).
    pub void_reason: Option<String>,
    /// Falso para una guía que constituye venta y aún no tiene factura: queda «pendiente de documentar».
    #[serde(default = "yes")]
    pub documented: bool,
    /// Texto libre que se agrega a las notas de la venta.
    pub notes: Option<String>,
    /// Vencimiento (AAAA-MM-DD) de una factura a crédito aún no pagada: la venta queda por cobrar.
    #[serde(default)]
    pub due_date: Option<String>,
    /// Condiciones del documento (forma de pago, referencias como la orden de compra…).
    #[serde(default)]
    pub terms: Option<SaleTerms>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoricalResult {
    pub number: String,
    /// «importada», «actualizada», «ya_existia» o «error».
    pub status: String,
    pub sale_uid: Option<String>,
    pub sale_number: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoricalReport {
    pub imported: usize,
    /// Ya estaban y se actualizaron (quedaron por cobrar o se completaron sus condiciones).
    #[serde(default)]
    pub updated: usize,
    pub skipped: usize,
    pub errors: usize,
    pub customers_created: usize,
    pub results: Vec<HistoricalResult>,
}

impl CompanySession {
    pub fn import_historical_sales(
        &mut self,
        items: &[HistoricalSale],
    ) -> AppResult<HistoricalReport> {
        self.require("ventas.crear")?;
        self.require("ventas.documentar")?;
        if items.len() > MAX_BATCH {
            return Err(AppError::Validation(format!(
                "se importan hasta {MAX_BATCH} documentos por vez"
            )));
        }
        let mut report = HistoricalReport {
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            customers_created: 0,
            results: Vec::new(),
        };
        for it in items {
            let res = match self.import_one(it, &mut report.customers_created) {
                Ok(Some((uid, number))) => {
                    report.imported += 1;
                    HistoricalResult {
                        number: it.number.clone(),
                        status: "importada".into(),
                        sale_uid: Some(uid),
                        sale_number: Some(number),
                        message: None,
                    }
                }
                Ok(None) => {
                    let uid = db::sale_with_external(
                        self.db.conn(),
                        it.doc_kind.trim(),
                        it.number.trim(),
                    )?;
                    match uid.as_deref().map(|u| self.update_existing(u, it)) {
                        Some(Ok(Some(msg))) => {
                            report.updated += 1;
                            HistoricalResult {
                                number: it.number.clone(),
                                status: "actualizada".into(),
                                sale_uid: uid,
                                sale_number: None,
                                message: Some(msg),
                            }
                        }
                        Some(Err(e)) => {
                            report.errors += 1;
                            HistoricalResult {
                                number: it.number.clone(),
                                status: "error".into(),
                                sale_uid: uid,
                                sale_number: None,
                                message: Some(e.to_string()),
                            }
                        }
                        _ => {
                            report.skipped += 1;
                            HistoricalResult {
                                number: it.number.clone(),
                                status: "ya_existia".into(),
                                sale_uid: uid,
                                sale_number: None,
                                message: None,
                            }
                        }
                    }
                }
                Err(e) => {
                    report.errors += 1;
                    HistoricalResult {
                        number: it.number.clone(),
                        status: "error".into(),
                        sale_uid: None,
                        sale_number: None,
                        message: Some(e.to_string()),
                    }
                }
            };
            report.results.push(res);
        }
        Ok(report)
    }

    /// Importa un documento. `None` si ya estaba anotado en otra venta.
    fn import_one(
        &mut self,
        it: &HistoricalSale,
        created: &mut usize,
    ) -> AppResult<Option<(String, String)>> {
        let kind = it.doc_kind.trim();
        let folio = it.number.trim();
        if kind.is_empty()
            || folio.is_empty()
            || kind.chars().count() > 60
            || folio.chars().count() > 40
        {
            return Err(AppError::Validation(
                "falta el tipo o el número del documento".into(),
            ));
        }
        let issue = crate::sales_ops::parse_date("la fecha", &it.issue_date)?;
        if db::sale_with_external(self.db.conn(), kind, folio)?.is_some() {
            return Ok(None);
        }
        if it.lines.is_empty() || it.lines.len() > crate::sales_ops::MAX_LINES {
            return Err(AppError::Validation("el documento no tiene líneas".into()));
        }
        // Montos: las líneas deben sumar el neto + exento del documento, y neto + IVA + exento = total.
        let lines_sum: i64 = it.lines.iter().map(|l| l.net_minor).sum();
        if (lines_sum - (it.net_minor + it.exempt_minor)).abs() > TOLERANCE_MINOR
            || (it.net_minor + it.exempt_minor + it.tax_minor - it.total_minor).abs()
                > TOLERANCE_MINOR
        {
            return Err(AppError::Validation(format!(
                "los montos no cuadran (líneas {lines_sum}, neto {}, IVA {}, total {})",
                it.net_minor, it.tax_minor, it.total_minor
            )));
        }
        for l in &it.lines {
            if l.qty_milli <= 0
                || l.unit_price_minor < 0
                || l.net_minor < 0
                || l.description.trim().is_empty()
            {
                return Err(AppError::Validation(
                    "una línea tiene cantidad, precio o descripción no válidos".into(),
                ));
            }
        }
        let customer_id = match &it.customer {
            Some(c) => Some(self.historical_customer(c, created)?),
            None => None,
        };

        // Líneas, enlazadas al producto por SKU cuando existe (sin tocar el stock).
        let conn = self.db.conn();
        let mut lines = Vec::with_capacity(it.lines.len());
        let mut costs = Vec::with_capacity(it.lines.len());
        let mut cost_total = 0i64;
        for (i, l) in it.lines.iter().enumerate() {
            let product: Option<(i64, i64)> = match l.product_sku.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(sku) => conn
                    .query_row(
                        "SELECT id, avg_cost_e4 FROM products WHERE sku = ?1 AND archived_at IS NULL",
                        [sku],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?,
                None => None,
            };
            let gross = (l.qty_milli as i128 * l.unit_price_minor as i128 / 1000) as i64;
            let discount = (gross - l.net_minor).max(0);
            let ppm = if gross > 0 {
                (discount as i128 * 1_000_000 / gross as i128) as i64
            } else {
                0
            };
            lines.push(NewLine {
                product_id: product.map(|p| p.0),
                description: l.description.trim().chars().take(500).collect(),
                detail: None,
                qty_milli: l.qty_milli,
                list_price_minor: l.unit_price_minor,
                unit_price_minor: l.unit_price_minor,
                discount_ppm: ppm,
                discount_minor: discount,
                taxable: l.taxable,
                net_minor: l.net_minor,
            });
            let (unit, cost) = match product {
                Some((_, avg)) if avg > 0 => {
                    let c = (avg as i128 * l.qty_milli as i128 / 10_000_000) as i64;
                    cost_total += c;
                    (Some(avg), Some(c))
                }
                _ => (None, None),
            };
            costs.push((i as i64 + 1, unit, cost));
        }

        let voided = it
            .void_reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty());
        let due = match (
            voided,
            it.due_date
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty()),
        ) {
            (None, Some(d)) => Some(historical_due(&issue, d)?),
            _ => None,
        };
        let terms = historical_terms(it, &issue, due.as_deref())?;
        let state = match (voided, it.documented, &due) {
            (Some(_), _, _) => "anulada",
            (None, true, None) => "cerrada",
            _ => "efectuada",
        };
        let mut notes = match &due {
            Some(d) => format!(
                "Importada como historial desde {kind} Nº {folio}: no movió stock. Factura a crédito por cobrar, vence el {d}."
            ),
            None => format!(
                "Importada como historial desde {kind} Nº {folio}: no movió stock ni dinero en NÚCLEO."
            ),
        };
        if let Some(p) = it.payment_terms.as_deref().filter(|p| !p.trim().is_empty()) {
            notes.push_str(&format!(" Forma de pago: {}.", p.trim()));
        }
        if let Some(n) = it.notes.as_deref().filter(|n| !n.trim().is_empty()) {
            notes.push_str(&format!(" {}", n.trim()));
        }
        let notes: String = notes.chars().take(2000).collect();
        let discount_total: i64 = lines.iter().map(|l| l.discount_minor).sum();
        let prefix = if kind.to_lowercase().contains("gu") {
            "GD"
        } else if kind.to_lowercase().contains("bolet") {
            "BE"
        } else {
            "FE"
        };
        let number = format!("{prefix}-{folio}");
        let uid = uuid::Uuid::now_v7().to_string();
        let now = now_utc();
        let user_id = self.user_id();
        let user = self.actor_name()?;
        let tx = self.db.conn_mut().transaction()?;
        let id = db::insert_historical_sale(
            &tx,
            &HistoricalWrite {
                uid: &uid,
                number: &number,
                customer_id,
                issue_date: &issue,
                commercial_state: state,
                documentation_state: if it.documented {
                    "documentada"
                } else {
                    "pendiente"
                },
                totals: Totals {
                    net_minor: it.net_minor,
                    exempt_minor: it.exempt_minor,
                    discount_minor: discount_total,
                    tax_minor: it.tax_minor,
                    total_minor: it.total_minor,
                },
                cost_minor: if voided.is_some() { 0 } else { cost_total },
                due_date: due.as_deref(),
                payment_method: it
                    .payment_terms
                    .as_deref()
                    .map(str::trim)
                    .filter(|p| !p.is_empty()),
                notes: Some(&notes),
                void_reason: voided,
            },
            user_id,
            &now,
        )
        .map_err(|e| match e {
            nucleo_db::DbError::Sqlite(rusqlite::Error::SqliteFailure(f, _))
                if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                AppError::Validation(format!("ya existe una venta con el número {number}"))
            }
            other => other.into(),
        })?;
        db::replace_sale_items(&tx, id, &lines)?;
        db::set_item_costs(&tx, id, &costs)?;
        db::finish_historical_sale(&tx, id, state)?;
        if let Some(d) = &due {
            db::insert_receivable(&tx, id, customer_id, d, it.total_minor)?;
        }
        if let Some(t) = &terms {
            db::set_sale_terms(
                &tx,
                id,
                Some(&serde_json::to_string(t).map_err(|e| AppError::Validation(e.to_string()))?),
            )?;
        }
        if it.documented {
            db::upsert_external_ref(
                &tx,
                id,
                &ExternalRefRow {
                    doc_kind: Some(kind.to_string()),
                    external_number: Some(folio.to_string()),
                    issue_date: Some(issue.clone()),
                    observation: it
                        .references
                        .as_deref()
                        .map(|r| r.trim().chars().take(500).collect()),
                    marked_at: now.clone(),
                },
                user_id,
            )?;
        } else {
            // La guía queda anotada para reconocerla al importar de nuevo, aunque falte la factura.
            db::upsert_external_ref(
                &tx,
                id,
                &ExternalRefRow {
                    doc_kind: Some(kind.to_string()),
                    external_number: Some(folio.to_string()),
                    issue_date: Some(issue.clone()),
                    observation: Some("Guía que constituye venta: falta la factura.".into()),
                    marked_at: now.clone(),
                },
                user_id,
            )?;
            db::set_documentation_state(&tx, id, "pendiente", &now)?;
        }
        log(
            &tx,
            &user,
            "venta.historial",
            "venta",
            &uid,
            &format!("Importada como historial: {kind} Nº {folio}"),
            None,
        )?;
        tx.commit()?;
        Ok(Some((uid, number)))
    }

    /// Documento ya importado: si trae vencimiento y la venta histórica figura pagada sin cobros
    /// registrados, la deja por cobrar; si trae condiciones (orden de compra, forma de pago) y la venta
    /// no tenía, las completa. `None` si no había nada que cambiar.
    fn update_existing(&mut self, uid: &str, it: &HistoricalSale) -> AppResult<Option<String>> {
        let s = self.sale_row(uid)?;
        if !s.historical
            || s.commercial_state == "anulada"
            || it
                .void_reason
                .as_deref()
                .is_some_and(|r| !r.trim().is_empty())
        {
            return Ok(None);
        }
        let due = match it
            .due_date
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
        {
            Some(d) => Some(historical_due(&s.issue_date, d)?),
            None => None,
        };
        let conn = self.db.conn();
        let has_terms = db::sale_terms(conn, s.id)?.is_some_and(|j| !j.trim().is_empty());
        let payments: i64 = conn.query_row(
            "SELECT count(*) FROM payment_allocations a JOIN receivables r ON r.id = a.receivable_id WHERE r.sale_id = ?1",
            [s.id],
            |r| r.get(0),
        )?;
        let receivables: i64 = conn.query_row(
            "SELECT count(*) FROM receivables WHERE sale_id = ?1 AND status <> 'anulada'",
            [s.id],
            |r| r.get(0),
        )?;
        let reopen = due.is_some() && payments == 0 && receivables == 0;
        let terms = if reopen || !has_terms {
            historical_terms(it, &s.issue_date, due.as_deref())?
        } else {
            None
        };
        if !reopen && terms.is_none() {
            return Ok(None);
        }
        let now = now_utc();
        let user = self.actor_name()?;
        let customer_id = s.customer_id;
        let tx = self.db.conn_mut().transaction()?;
        let mut done = Vec::new();
        if let (true, Some(d)) = (reopen, &due) {
            // Vuelve de «cerrada» a «efectuada» (solo se permite en ventas históricas) y sin pagos.
            tx.execute(
                "UPDATE sales SET commercial_state = 'efectuada', paid_minor = 0, payment_state = 'sin_pago', due_date = ?3, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![s.id, now, d],
            )?;
            db::insert_receivable(&tx, s.id, customer_id, d, s.totals.total_minor)?;
            let note: String = format!(
                "{} Factura a crédito por cobrar, vence el {d}.",
                s.notes.as_deref().unwrap_or("").trim()
            )
            .trim()
            .chars()
            .take(2000)
            .collect();
            tx.execute(
                "UPDATE sales SET notes = ?2 WHERE id = ?1",
                rusqlite::params![s.id, note],
            )?;
            done.push(format!("queda por cobrar, vence el {d}"));
        }
        if let Some(t) = &terms {
            db::set_sale_terms(
                &tx,
                s.id,
                Some(&serde_json::to_string(t).map_err(|e| AppError::Validation(e.to_string()))?),
            )?;
            if !t.references.is_empty() {
                done.push(format!(
                    "referencias: {}",
                    t.references
                        .iter()
                        .map(|r| r.folio.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
        let msg = if done.is_empty() {
            "condiciones completadas".to_string()
        } else {
            done.join(" · ")
        };
        log(
            &tx,
            &user,
            "venta.historial",
            "venta",
            uid,
            &format!("Historial actualizado: {msg}"),
            None,
        )?;
        tx.commit()?;
        Ok(Some(msg))
    }

    /// Cliente por RUT (o por nombre exacto si no trae RUT); si no existe, se crea con su ficha.
    pub(crate) fn historical_customer(
        &mut self,
        c: &HistoricalCustomer,
        created: &mut usize,
    ) -> AppResult<i64> {
        let name = c.name.trim();
        if name.is_empty() {
            return Err(AppError::Validation(
                "el documento no trae el nombre del cliente".into(),
            ));
        }
        let rut = match c.rut.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
            Some(r) => Some(
                Rut::parse(r)
                    .map_err(|e| AppError::Validation(format!("RUT del cliente: {e}")))?
                    .compact(),
            ),
            None => None,
        };
        let conn = self.db.conn();
        let found: Option<i64> = match &rut {
            Some(r) => conn
                .query_row("SELECT id FROM customers WHERE rut = ?1", [r], |x| x.get(0))
                .optional()?,
            None => conn
                .query_row(
                    "SELECT id FROM customers WHERE rut IS NULL AND lower(name) = lower(?1)",
                    [name],
                    |x| x.get(0),
                )
                .optional()?,
        };
        if let Some(id) = found {
            return Ok(id);
        }
        let empresa = rut
            .as_deref()
            .and_then(|r| r.split('-').next()?.parse::<u64>().ok())
            .is_some_and(|n| n >= 50_000_000);
        let clip = |s: &Option<String>, n: usize| {
            s.as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(n).collect::<String>())
        };
        let row = self.add_customer(&NewCustomer {
            name: name.chars().take(200).collect(),
            rut,
            email: clip(&c.email, 254).filter(|e| e.contains('@')),
            phone: None,
            profile: CustomerProfile {
                kind: if empresa {
                    "empresa".into()
                } else {
                    "persona".into()
                },
                business_activity: clip(&c.business_activity, 200),
                address: clip(&c.address, 200),
                commune: clip(&c.commune, 100),
                city: clip(&c.city, 100),
                ..Default::default()
            },
        })?;
        *created += 1;
        Ok(row.id)
    }
}

/// Vencimiento válido: fecha AAAA-MM-DD no anterior a la emisión.
fn historical_due(issue: &str, due: &str) -> AppResult<String> {
    let d = crate::sales_ops::parse_date("el vencimiento", due)?;
    if d.as_str() < issue {
        return Err(AppError::Validation(
            "el vencimiento no puede ser anterior a la emisión".into(),
        ));
    }
    Ok(d)
}

/// Condiciones validadas de la venta histórica. Con vencimiento, la forma de pago es crédito.
fn historical_terms(
    it: &HistoricalSale,
    issue: &str,
    due: Option<&str>,
) -> AppResult<Option<SaleTerms>> {
    let mut t = it.terms.clone().unwrap_or_default();
    if let Some(d) = due {
        t.payment = "credito".into();
        t.due_date = Some(d.to_string());
        let days = crate::inventory_ops::date_ord(d).unwrap_or(0)
            - crate::inventory_ops::date_ord(issue).unwrap_or(0);
        t.credit_days = Some(days.clamp(1, 365));
    }
    if t == SaleTerms::default() {
        return Ok(None);
    }
    Ok(Some(t.validated(issue)?))
}
